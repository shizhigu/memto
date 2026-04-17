/**
 * Resume / fork orchestrator — per-runtime strategies for waking up a
 * past session and asking it a fresh question.
 *
 * Each runtime has a slightly different story for non-destructive reads:
 *
 *   claude    — native `--fork-session` flag (cleanest)
 *   codex     — cp the jsonl, patch session_meta.payload.id, resume, rm
 *   hermes    — SQL INSERT copying session row + messages, resume, DELETE
 *   openclaw  — cp the jsonl, patch line 0 id, invoke, rm
 *
 * `ask()` returns the full string reply plus a `cleanup()` for callers
 * that want to defer deletion of the forked artifact. Default cleanup
 * runs automatically on success.
 */

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { Database } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { NormalizedSession, Runtime } from './types.ts';

export interface AskOptions {
  /** Ask a question without a fork. The original session will be mutated. */
  inPlace?: boolean;
  /** Override timeout in ms. Defaults to 120_000. */
  timeoutMs?: number;
}

export interface AskResult {
  runtime: Runtime;
  session_id: string;
  /** The plaintext reply from the agent. */
  answer: string;
  /** Raw stdout for callers that want to parse tool-call blocks themselves. */
  raw_stdout: string;
  /** Raw stderr (usually empty on success). */
  raw_stderr: string;
  /** True if we forked and have already cleaned up the artifact. */
  cleaned_up: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run a subprocess with a timeout and capture stdout/stderr. Resolves with
 * { code, stdout, stderr, timedOut }. Never throws — caller interprets exit.
 */
async function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\nspawn error: ${err.message}`;
      resolve({ code: -1, stdout, stderr, timedOut });
    });
  });
}

// ====================================================================
// Claude Code: native --fork-session
// ====================================================================

async function askClaude(
  session: NormalizedSession,
  question: string,
  opts: AskOptions,
): Promise<AskResult> {
  const args = ['-p', question, '--resume', session.id];
  if (!opts.inPlace) args.push('--fork-session');
  // claude --resume only finds sessions whose project matches the current
  // cwd, so we spawn the subprocess in the original working directory.
  // Fallback to undefined (inherit) when cwd isn't recorded.
  const r = await run('claude', args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, session.cwd);
  // Claude's -p mode prints the answer on stdout. Strip trailing whitespace.
  return {
    runtime: 'claude-code',
    session_id: session.id,
    answer: r.stdout.trim(),
    raw_stdout: r.stdout,
    raw_stderr: r.stderr,
    cleaned_up: true, // claude handles its own state
  };
}

// ====================================================================
// Codex: cp jsonl + patch session_meta.payload.id
// ====================================================================

async function forkCodexFile(origPath: string): Promise<{ newId: string; newPath: string }> {
  const raw = await readFile(origPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error(`codex session file is empty: ${origPath}`);
  let first: any;
  try {
    first = JSON.parse(lines[0]);
  } catch {
    throw new Error(`codex session file has malformed first line: ${origPath}`);
  }
  if (first?.type !== 'session_meta') {
    throw new Error(`expected session_meta on line 0, got ${first?.type}`);
  }

  const newId = randomUUID();
  first.payload = first.payload ?? {};
  first.payload.id = newId;
  lines[0] = JSON.stringify(first);

  // Same directory structure, fresh timestamp, new uuid. Codex scans the
  // tree recursively so placement doesn't matter — we keep it next to the
  // original for locality.
  const dir = dirname(origPath);
  const tsStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const newPath = join(dir, `rollout-${tsStamp}-${newId}.jsonl`);
  await writeFile(newPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { newId, newPath };
}

async function askCodex(
  session: NormalizedSession,
  question: string,
  opts: AskOptions,
): Promise<AskResult> {
  let targetId = session.id;
  let cleanupPath: string | null = null;

  if (!opts.inPlace) {
    const { newId, newPath } = await forkCodexFile(session.raw_path);
    targetId = newId;
    cleanupPath = newPath;
  }

  const r = await run(
    'codex',
    ['exec', 'resume', targetId, question],
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    session.cwd,
  );

  if (cleanupPath) {
    await unlink(cleanupPath).catch(() => {
      /* best effort */
    });
  }

  // Codex exec prints a header + user echo + answer + token stats.
  // The final non-empty line is reliably the answer.
  const answer = extractCodexAnswer(r.stdout);

  return {
    runtime: 'codex',
    session_id: session.id,
    answer,
    raw_stdout: r.stdout,
    raw_stderr: r.stderr,
    cleaned_up: cleanupPath !== null,
  };
}

/** Strip header/footer chrome from `codex exec resume` output. */
function extractCodexAnswer(stdout: string): string {
  const lines = stdout.split('\n');
  // The last plain line before EOF — codex echoes the answer as the last
  // non-blank line after the agent_message event.
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return '';
  return nonEmpty[nonEmpty.length - 1].trim();
}

// ====================================================================
// Hermes: SQL INSERT + DELETE
// ====================================================================

const HERMES_DB = join(homedir(), '.hermes', 'state.db');

async function forkHermesSession(origId: string): Promise<{ newId: string }> {
  const newId = `fork_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const db = new Database(HERMES_DB);
  try {
    db.run('BEGIN');
    db.run(
      `INSERT INTO sessions (id, source, user_id, model, model_config, system_prompt,
           parent_session_id, started_at, ended_at, end_reason, message_count,
           tool_call_count, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, reasoning_tokens, billing_provider, billing_base_url,
           billing_mode, estimated_cost_usd, actual_cost_usd, cost_status, cost_source,
           pricing_version, title)
       SELECT ?, source, user_id, model, model_config, system_prompt,
              id, started_at, ended_at, end_reason, message_count,
              tool_call_count, input_tokens, output_tokens, cache_read_tokens,
              cache_write_tokens, reasoning_tokens, billing_provider, billing_base_url,
              billing_mode, estimated_cost_usd, actual_cost_usd, cost_status, cost_source,
              pricing_version, NULL
         FROM sessions WHERE id = ?`,
      [newId, origId],
    );
    db.run(
      `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name,
           timestamp, token_count, finish_reason, reasoning, reasoning_details,
           codex_reasoning_items)
       SELECT ?, role, content, tool_call_id, tool_calls, tool_name, timestamp, token_count,
              finish_reason, reasoning, reasoning_details, codex_reasoning_items
         FROM messages WHERE session_id = ?`,
      [newId, origId],
    );
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return { newId };
}

async function cleanupHermesFork(forkId: string): Promise<void> {
  const db = new Database(HERMES_DB);
  try {
    db.run('BEGIN');
    db.run('DELETE FROM messages WHERE session_id = ?', [forkId]);
    db.run('DELETE FROM sessions WHERE id = ?', [forkId]);
    db.run('COMMIT');
  } catch {
    db.run('ROLLBACK');
  } finally {
    db.close();
  }
}

async function askHermes(
  session: NormalizedSession,
  question: string,
  opts: AskOptions,
): Promise<AskResult> {
  let targetId = session.id;
  let forkId: string | null = null;

  if (!opts.inPlace) {
    const r = await forkHermesSession(session.id);
    targetId = r.newId;
    forkId = r.newId;
  }

  const r = await run(
    'hermes',
    ['chat', '-Q', '-q', question, '--resume', targetId],
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (forkId) await cleanupHermesFork(forkId);

  const answer = extractHermesAnswer(r.stdout);

  return {
    runtime: 'hermes',
    session_id: session.id,
    answer,
    raw_stdout: r.stdout,
    raw_stderr: r.stderr,
    cleaned_up: forkId !== null,
  };
}

/** Hermes -Q mode wraps the reply in a box + a trailing session_id line. */
function extractHermesAnswer(stdout: string): string {
  // Strip the Hermes box frame (lines starting with ╭ │ ╰).
  const lines = stdout.split('\n').filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (t.startsWith('╭') || t.startsWith('╰') || t.startsWith('session_id:')) return false;
    return true;
  });
  // Inside-the-box lines are prefixed with "│ " in some terminal widths.
  return lines
    .map((l) => l.replace(/^│\s?/, '').replace(/\s*│$/, '').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

// ====================================================================
// OpenClaw: cp jsonl + patch line 0
// ====================================================================

async function forkOpenClawFile(origPath: string): Promise<{ newId: string; newPath: string }> {
  const newId = randomUUID();
  const raw = await readFile(origPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error(`openclaw session file is empty: ${origPath}`);
  let first: any;
  try {
    first = JSON.parse(lines[0]);
  } catch {
    throw new Error(`openclaw session file has malformed first line: ${origPath}`);
  }
  if (first?.type !== 'session') {
    throw new Error(`expected session on line 0, got ${first?.type}`);
  }
  first.id = newId;
  lines[0] = JSON.stringify(first);

  const newPath = join(dirname(origPath), `${newId}.jsonl`);
  await writeFile(newPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { newId, newPath };
}

async function askOpenClaw(
  session: NormalizedSession,
  question: string,
  opts: AskOptions,
): Promise<AskResult> {
  let targetId = session.id;
  let cleanupPath: string | null = null;

  if (!opts.inPlace) {
    const f = await forkOpenClawFile(session.raw_path);
    targetId = f.newId;
    cleanupPath = f.newPath;
  }

  const r = await run(
    'openclaw',
    ['agent', '--session-id', targetId, '--message', question, '--local', '--json'],
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (cleanupPath) {
    await unlink(cleanupPath).catch(() => {
      /* best effort */
    });
  }

  const answer = extractOpenClawAnswer(r.stdout);

  return {
    runtime: 'openclaw',
    session_id: session.id,
    answer,
    raw_stdout: r.stdout,
    raw_stderr: r.stderr,
    cleaned_up: cleanupPath !== null,
  };
}

/** OpenClaw --json mode returns `{payloads: [{text, ...}], ...}`. */
function extractOpenClawAnswer(stdout: string): string {
  // The CLI sometimes prints non-JSON log lines to stdout before the JSON
  // blob. Find the last `{` that opens a balanced JSON object.
  const start = stdout.indexOf('\n{');
  const slice = start >= 0 ? stdout.slice(start + 1) : stdout.trim();
  try {
    const d = JSON.parse(slice);
    const payloads = d?.payloads;
    if (Array.isArray(payloads)) {
      const texts = payloads.map((p: any) => (typeof p?.text === 'string' ? p.text : ''));
      return texts.filter(Boolean).join('\n').trim();
    }
  } catch {
    /* fall through */
  }
  return stdout.trim();
}

// ====================================================================
// Public entry point
// ====================================================================

export async function ask(
  session: NormalizedSession,
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  switch (session.runtime) {
    case 'claude-code':
      return askClaude(session, question, options);
    case 'codex':
      return askCodex(session, question, options);
    case 'hermes':
      return askHermes(session, question, options);
    case 'openclaw':
      return askOpenClaw(session, question, options);
    default: {
      const _exhaustive: never = session.runtime;
      throw new Error(`unsupported runtime: ${String(_exhaustive)}`);
    }
  }
}
