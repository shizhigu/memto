#!/usr/bin/env node
/**
 * memto CLI — one binary, three subcommands.
 *
 *   memto list     [--limit N] [--runtime claude-code|codex|hermes|openclaw] [--json]
 *   memto messages --id <id> [--last N] [--head N] [--grep <pat>] [--role …] [--json]
 *   memto ask      --id <id>[,<id>...] --question "..." [--runtime <rt>] [--json]
 *
 * `messages` is cheap (just reads the stored transcript) — prefer it for
 * content lookup. `ask` forks the session and re-runs the original agent —
 * prefer it when you need the agent's reasoning, not raw content.
 *
 * Agents integrate via the bundled skill at ./skills/memto.md — they call
 * the CLI through their existing Bash tool. Bundled via `bun build` into a
 * single dist/cli.js that runs under node ≥ 20.
 */

import {
  ask,
  availableAdapters,
  getMessages,
  getSession,
  listAllSessions,
} from '@memto/session-core';
import type { NormalizedMessage, NormalizedSession, Runtime } from '@memto/session-core';
import {
  banner,
  c,
  forest,
  formatSize,
  runtimeTag,
  runtimeDot,
  section,
  rule,
  shortenCwd,
  timeAgo,
  truncate,
} from './ui.js';

type Argv = string[];

function flag(argv: Argv, name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

function numFlag(argv: Argv, name: string, def: number): number {
  const v = flag(argv, name);
  return v ? Number.parseInt(v, 10) : def;
}

async function cmdList(argv: Argv) {
  const limit = numFlag(argv, '--limit', 20);
  const runtimeFilter = flag(argv, '--runtime');
  const json = argv.includes('--json');

  const avail = await availableAdapters();
  const all = await listAllSessions({ limitPerRuntime: limit });
  const sessions = runtimeFilter ? all.filter((s) => s.runtime === runtimeFilter) : all;

  if (json) {
    process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
    return;
  }

  process.stdout.write(banner('list'));
  console.log(`  ${section('AVAILABLE RUNTIMES')}`);
  console.log(`  ${avail.map((a) => `${runtimeDot(a.runtime)} ${c.cream(a.runtime)}`).join('   ') || c.dim('(none)')}`);
  console.log();

  const byRuntime: Record<string, number> = {};
  for (const s of sessions) byRuntime[s.runtime] = (byRuntime[s.runtime] ?? 0) + 1;
  console.log(`  ${section('SCAN')}  ${c.cream(String(sessions.length))} ${c.dim('sessions')}`);
  for (const [rt, n] of Object.entries(byRuntime).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${runtimeDot(rt)} ${c.cream(String(n).padStart(3))} ${c.dim(rt)}`);
  }
  console.log();

  console.log(`  ${section('RECENT SESSIONS')}`);
  console.log(`  ${rule(90)}`);
  for (const s of sessions) {
    const ts = s.last_active_at ?? s.started_at;
    const meta = [s.size_bytes ? c.dim(formatSize(s.size_bytes)) : null, forest(timeAgo(ts))]
      .filter(Boolean)
      .join('  ');
    console.log(`  ${runtimeTag(s.runtime)}  ${c.bold(c.cream(truncate(s.title ?? '(untitled)', 56)))}   ${meta}`);
    console.log(`    ${c.dim('cwd   ')} ${c.cream(shortenCwd(s.cwd))}`);
    if (s.first_user_prompt)
      console.log(`    ${c.dim('first ')} ${c.italic(c.cream(truncate(s.first_user_prompt, 88)))}`);
    console.log(`    ${c.dim('id    ')} ${c.slate(s.id)}`);
    console.log();
  }
}

async function cmdMessages(argv: Argv) {
  const idArg = flag(argv, '--id');
  const runtimeHint = flag(argv, '--runtime') as Runtime | undefined;
  const last = flag(argv, '--last');
  const head = flag(argv, '--head');
  const grep = flag(argv, '--grep');
  const role = flag(argv, '--role');
  const json = argv.includes('--json');

  if (!idArg) {
    console.error(
      `${c.red('usage:')} memto messages --id <id> [--runtime <rt>] [--last N] [--head N] [--grep <pattern>] [--role user|assistant] [--json]`,
    );
    process.exit(1);
  }

  const runtimes: Runtime[] = runtimeHint
    ? [runtimeHint]
    : ['claude-code', 'codex', 'hermes', 'openclaw'];
  let messages: NormalizedMessage[] = [];
  let session: NormalizedSession | null = null;
  for (const rt of runtimes) {
    const s = await getSession(rt, idArg);
    if (s) {
      session = s;
      messages = await getMessages(rt, idArg);
      break;
    }
  }

  if (!session) {
    if (json) {
      process.stdout.write(JSON.stringify({ id: idArg, messages: [], missing: true }) + '\n');
      process.exit(2);
    }
    console.error(`  ${c.red('not found:')} ${c.dim(`no session with id ${idArg}`)}`);
    process.exit(2);
  }

  let filtered = messages;
  if (role) filtered = filtered.filter((m) => m.role === role);
  if (grep) {
    const re = new RegExp(grep, 'i');
    filtered = filtered.filter((m) => re.test(m.text));
  }
  if (head) filtered = filtered.slice(0, Number.parseInt(head, 10));
  else if (last) filtered = filtered.slice(-Number.parseInt(last, 10));

  if (json) {
    process.stdout.write(JSON.stringify({ session, messages: filtered }, null, 2) + '\n');
    return;
  }

  process.stdout.write(banner('messages'));
  console.log(`  ${section('SESSION')}`);
  console.log(`  ${runtimeTag(session.runtime)}  ${c.cream(truncate(session.title ?? '(untitled)', 56))}`);
  console.log(`  ${c.dim('cwd   ')} ${c.cream(shortenCwd(session.cwd))}`);
  console.log(`  ${c.dim('total ')} ${c.cream(String(messages.length))} ${c.dim('messages')}   ${c.dim('showing')} ${c.cream(String(filtered.length))}`);
  console.log();
  console.log(`  ${section('TRANSCRIPT')}`);
  console.log(`  ${rule(90)}`);
  for (const m of filtered) {
    const who =
      m.role === 'user'
        ? c.green(c.bold('user'))
        : m.role === 'assistant'
          ? c.gold(c.bold('assistant'))
          : c.slate(m.role);
    const when = c.dim(m.timestamp.slice(11, 19));
    console.log(`  ${who}  ${when}${m.tool_name ? '  ' + c.slate(`→ ${m.tool_name}`) : ''}`);
    const text = truncate(m.text || '(empty)', 300);
    console.log(`    ${c.cream(text)}`);
    console.log();
  }
}

async function cmdAsk(argv: Argv) {
  const question = flag(argv, '--question') ?? flag(argv, '-q');
  const timeoutMs = numFlag(argv, '--timeout', 120_000);
  const json = argv.includes('--json');
  const idArg = flag(argv, '--id');
  const runtimeHint = flag(argv, '--runtime') as Runtime | undefined;

  if (!idArg || !question) {
    const reason = !idArg ? '--id is required' : '--question is required';
    console.error(
      `${c.red('usage:')} memto ask --id <id>[,<id>...] --question "..." [--runtime <rt>] [--timeout ms] [--json]\n${c.dim('  (' + reason + ')')}\n${c.dim('  tip: for cheap content lookup without forking, try `memto messages --id <id> --grep <pattern>`')}`,
    );
    process.exit(1);
  }

  const ids = idArg.split(',').map((s) => s.trim()).filter(Boolean);
  const sessions: NormalizedSession[] = [];
  const missing: string[] = [];

  // Resolve each id → session. If runtime is given, scan only that adapter;
  // else try every adapter in order.
  const runtimes: Runtime[] = runtimeHint
    ? [runtimeHint]
    : ['claude-code', 'codex', 'hermes', 'openclaw'];
  for (const id of ids) {
    let found: NormalizedSession | null = null;
    for (const rt of runtimes) {
      found = await getSession(rt, id);
      if (found) break;
    }
    if (found) sessions.push(found);
    else missing.push(id);
  }

  if (sessions.length === 0) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ question, results: [], missing }, null, 2) + '\n',
      );
      process.exit(2);
    }
    console.error(`  ${c.red('no match.')} ${c.dim(`no session found for id(s): ${missing.join(', ')}`)}`);
    process.exit(2);
  }

  if (!json) {
    process.stdout.write(banner('ask'));
    console.log(`  ${section('QUESTION')}`);
    console.log(`  ${c.cream(question)}`);
    console.log();
    console.log(`  ${section(`ASKING ${sessions.length} SESSION${sessions.length === 1 ? '' : 'S'}`)}`);
    for (const s of sessions)
      console.log(`  ${runtimeTag(s.runtime)}  ${c.cream(truncate(s.title ?? '(untitled)', 56))}`);
    if (missing.length > 0) {
      console.log(`  ${c.red(`(${missing.length} id(s) not found:`)} ${c.dim(missing.join(', '))}${c.red(')')}`);
    }
    console.log();
  }

  const t0 = performance.now();
  const results = await Promise.all(
    sessions.map(async (s) => {
      try {
        const r = await ask(s, question, { timeoutMs });
        return { session: s, ...r, err: null as string | null };
      } catch (e) {
        return { session: s, answer: '', timed_out: false, err: (e as Error).message };
      }
    }),
  );
  const dt = performance.now() - t0;

  if (json) {
    process.stdout.write(
      JSON.stringify({ question, elapsed_ms: Math.round(dt), results, missing }, null, 2) + '\n',
    );
    return;
  }

  console.log(`  ${section('ANSWERS')}  ${forest(`(${(dt / 1000).toFixed(1)}s)`)}`);
  console.log(`  ${rule(90)}`);
  for (const { session: s, answer, err, timed_out } of results) {
    console.log(
      `  ${runtimeTag(s.runtime)}  ${c.bold(c.cream(truncate(s.title ?? '(untitled)', 56)))}`,
    );
    if (err) console.log(`    ${c.red('error:')} ${c.cream(err)}`);
    else if (timed_out) console.log(`    ${c.red('timed out')}`);
    else
      console.log(
        (answer || c.dim('(empty)')).split('\n').map((l) => `    ${c.cream(l)}`).join('\n'),
      );
    console.log();
  }
}

function help() {
  process.stdout.write(banner());
  console.log(`  ${section('USAGE')}`);
  console.log(`    ${c.cream('memto list')}      ${c.dim('[--limit N] [--runtime …] [--json]')}`);
  console.log(
    `    ${c.cream('memto messages')}  ${c.dim('--id <id> [--last N] [--head N] [--grep <pat>] [--role user|assistant] [--json]')}`,
  );
  console.log(
    `    ${c.cream('memto ask')}       ${c.dim('--id <id>[,<id>…] --question "…" [--runtime <rt>] [--timeout ms] [--json]')}`,
  );
  console.log();
  console.log(`  ${section('TEACH YOUR AGENT')}`);
  console.log(`    ${c.dim('drop the bundled skill into ~/.claude/skills/ so Claude Code learns')}`);
  console.log(`    ${c.dim('when to run memto on its own:')}`);
  console.log(`    ${c.cream('curl -fsSL https://raw.githubusercontent.com/shizhigu/memto/main/skills/memto.md \\')}`);
  console.log(`    ${c.cream('  > ~/.claude/skills/memto.md')}`);
  console.log();
}

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  switch (sub) {
    case 'list':
      await cmdList(rest);
      break;
    case 'messages':
      await cmdMessages(rest);
      break;
    case 'ask':
      await cmdAsk(rest);
      break;
    case '--version':
    case '-v':
      // replaced at build time — see scripts/build.mjs
      console.log('__MEMTO_VERSION__');
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      help();
      break;
    default:
      console.error(`${c.red('unknown command:')} ${sub}`);
      help();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(c.red('fatal:'), e instanceof Error ? e.message : e);
  process.exit(1);
});
