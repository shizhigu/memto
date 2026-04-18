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
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { Database } from './sqlite.ts';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { NormalizedSession, Runtime } from './types.ts';

export interface AskOptions {
  /** Ask a question without a fork. The original session will be mutated. */
  inPlace?: boolean;
  /**
   * Override timeout in ms. Defaults to a size-based auto-scale:
   * 120s floor, + 1s per MB of session transcript. Large Claude Code
   * sessions (50+ MB) can genuinely take several minutes to reload.
   */
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
  /** True if the subprocess exceeded the timeout. Answer is empty when true. */
  timed_out: boolean;
  /** Subprocess exit code, or null if killed. */
  exit_code: number | null;
}

const DEFAULT_TIMEOUT_FLOOR_MS = 120_000;
const DEFAULT_TIMEOUT_PER_MB_MS = 1_000;

function autoTimeout(session: NormalizedSession, override: number | undefined): number {
  if (override !== undefined) return override;
  const mb = (session.size_bytes ?? 0) / (1024 * 1024);
  return Math.max(DEFAULT_TIMEOUT_FLOOR_MS, Math.round(DEFAULT_TIMEOUT_FLOOR_MS + mb * DEFAULT_TIMEOUT_PER_MB_MS));
}

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
// Claude Code: cp + sanitize + --resume (no --fork-session)
// ====================================================================
//
// We used to rely on `claude --fork-session`. That worked until we hit
// sessions containing `server_tool_use` blocks with IDs that violate
// Anthropic's current `^srvtoolu_[a-zA-Z0-9_]+$` pattern (e.g. legacy
// cross-provider imports whose IDs start with `call_*`). Those blocks
// replay verbatim and make the API reject the whole turn with
// `invalid_request_error`.
//
// The fix: copy the original jsonl ourselves, rewrite the sessionId to
// a new UUID, and strip content blocks whose IDs the API would reject.
// Then resume the copy directly.

const SERVER_TOOL_USE_ID_RE = /^srvtoolu_[a-zA-Z0-9_]+$/;
const TOOL_USE_ID_RE = /^toolu_[a-zA-Z0-9_]+$/;

function sanitizeClaudeLine(line: any, newSessionId: string): any | null {
  if (!line || typeof line !== 'object') return line;
  if (line.sessionId) line.sessionId = newSessionId;
  const content = line?.message?.content;
  if (!Array.isArray(content)) return line;
  const droppedIds = new Set<string>();
  // First pass — drop server_tool_use / tool_use blocks with bad IDs.
  const filtered = content.filter((b: any) => {
    if (!b || typeof b !== 'object') return true;
    if (b.type === 'server_tool_use') {
      if (!b.id || !SERVER_TOOL_USE_ID_RE.test(b.id)) {
        if (b.id) droppedIds.add(b.id);
        return false;
      }
    }
    if (b.type === 'tool_use') {
      if (!b.id || !TOOL_USE_ID_RE.test(b.id)) {
        if (b.id) droppedIds.add(b.id);
        return false;
      }
    }
    return true;
  });
  // Second pass — drop any *_tool_result blocks that referenced a dropped id.
  const final = filtered.filter((b: any) => {
    if (!b || typeof b !== 'object') return true;
    if (
      (b.type === 'web_search_tool_result' || b.type === 'tool_result') &&
      b.tool_use_id &&
      droppedIds.has(b.tool_use_id)
    ) {
      return false;
    }
    return true;
  });
  line.message.content = final;
  return line;
}

async function forkClaudeSession(
  session: NormalizedSession,
): Promise<{ newId: string; newPath: string; projectDir: string }> {
  if (!session.raw_path) {
    throw new Error('claude-code adapter did not populate raw_path on the session');
  }
  const projectDir = dirname(session.raw_path);
  const newId = randomUUID();
  const newPath = join(projectDir, `${newId}.jsonl`);
  const raw = await readFile(session.raw_path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const sanitized = sanitizeClaudeLine(parsed, newId);
      if (sanitized) out.push(JSON.stringify(sanitized));
    } catch {
      /* malformed line — drop */
    }
  }
  await writeFile(newPath, `${out.join('\n')}\n`, { mode: 0o600 });
  return { newId, newPath, projectDir };
}

async function askClaude(
  session: NormalizedSession,
  question: string,
  opts: AskOptions,
): Promise<AskResult> {
  let targetId = session.id;
  let newPath: string | null = null;
  let projectDir: string | null = null;

  if (!opts.inPlace) {
    const fork = await forkClaudeSession(session);
    targetId = fork.newId;
    newPath = fork.newPath;
    projectDir = fork.projectDir;
  }

  // claude --resume only finds sessions whose project matches the current
  // cwd, so we spawn the subprocess in the original working directory.
  const r = await run(
    'claude',
    ['-p', question, '--resume', targetId],
    autoTimeout(session, opts.timeoutMs),
    session.cwd,
  );

  let cleanedUp = false;
  if (!opts.inPlace && newPath && projectDir) {
    await unlink(newPath).catch(() => {
      /* best effort */
    });
    // Claude may create a sibling directory <newId>/ for tool results.
    await rmrf(join(projectDir, targetId));
    cleanedUp = true;
  }

  return {
    runtime: 'claude-code',
    session_id: session.id,
    answer: r.stdout.trim(),
    raw_stdout: r.stdout,
    raw_stderr: r.stderr,
    cleaned_up: cleanedUp,
    timed_out: r.timedOut,
    exit_code: r.code,
  };
}

async function snapshotJsonlIds(dir: string): Promise<Set<string>> {
  try {
    const entries = await readdir(dir);
    return new Set(
      entries.filter((e) => e.endsWith('.jsonl')).map((e) => e.slice(0, -'.jsonl'.length)),
    );
  } catch {
    return new Set();
  }
}

async function rmrf(path: string): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises');
    await rm(path, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
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

  // --skip-git-repo-check: codex refuses to run in non-trusted cwds by
  // default. Since we're re-entering an archived session non-interactively,
  // the trust check is not meaningful — bypass it.
  const r = await run(
    'codex',
    ['exec', '--skip-git-repo-check', 'resume', targetId, question],
    autoTimeout(session, opts.timeoutMs),
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
    timed_out: r.timedOut,
    exit_code: r.code,
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
    autoTimeout(session, opts.timeoutMs),
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
    timed_out: r.timedOut,
    exit_code: r.code,
  };
}

/**
 * Hermes `-Q` (quiet) mode is supposed to suppress chrome but still leaks
 * a surprising amount. We've seen:
 *
 *   ↻ Resumed session fork_xxx (5 user messages, 7 total messages)
 *   "fork-test-fork_xxx" (5 user messages, 7 total messages)
 *
 *   ╭─ ⚕ Hermes ────────────────────────────────────────────────────────╮
 *   │ The actual answer text, possibly wrapped across multiple lines    │
 *   ╰───────────────────────────────────────────────────────────────────╯
 *
 *   session_id: fork_xxx
 *
 * This extractor strips every known noise pattern. Exported for unit
 * testing since the real hermes binary isn't available in CI.
 */
export function extractHermesAnswer(stdout: string): string {
  const noise: RegExp[] = [
    // resume banner
    /^↻\s/,
    // "quoted title" (N user messages, M total messages) — fork stats line
    /^["'][^"']*["']\s*\(\d+\s+(user|total)\s+messages/i,
    // bare "(N user messages, M total messages)" continuation
    /^\(\d+\s+(user|total)\s+messages/i,
    // box top/bottom frame (may include the ⚕ glyph, dashes, any text)
    /^[╭╰╔╚┌└]/,
    // trailing session id
    /^session_id\s*[:=]/i,
    // hermes "thinking..." spinner fragments
    /^⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
  ];

  const cleaned: string[] = [];
  for (const raw of stdout.split('\n')) {
    let line = raw;
    // strip sidewall chars at either end (any combination of │ ║ ┃ and padding)
    line = line.replace(/^[│║┃]\s?/, '').replace(/\s*[│║┃]\s*$/, '');
    const t = line.trim();
    if (!t) continue;
    if (noise.some((p) => p.test(t))) continue;
    cleaned.push(t);
  }
  return cleaned.join('\n').trim();
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
    autoTimeout(session, opts.timeoutMs),
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
    timed_out: r.timedOut,
    exit_code: r.code,
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
