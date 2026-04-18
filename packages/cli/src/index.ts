#!/usr/bin/env node
/**
 * memto CLI — one binary, four subcommands.
 *
 *   memto list     [--limit N] [--runtime claude-code|codex|hermes|openclaw] [--json]
 *   memto grep     <pattern> [-i] [--role …] [--runtime …] [--since …] [--json]
 *   memto messages --id <id> [--last N] [--head N] [--grep <pat>] [--role …] [--json]
 *   memto ask      --id <id>[,<id>...] --question "..." [--runtime <rt>] [--json]
 *
 * `grep` scans every session's transcript in parallel — use it to locate
 * the right session(s). `messages` reads one session's transcript fully.
 * `ask` forks and revives the original agent for big or synthesis queries.
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
  grepAllSessions,
  listAllSessions,
  reconstruct,
} from '@memto/session-core';
import type { GrepHit, NormalizedMessage, NormalizedSession, Runtime } from '@memto/session-core';
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

async function cmdGrep(argv: Argv) {
  const pattern = argv[0];
  if (!pattern || pattern.startsWith('-')) {
    console.error(
      `${c.red('usage:')} memto grep <pattern> [--role user|assistant] [--runtime <rt>] [--limit N] [-i|--ignore-case] [--max-hits N] [--since YYYY-MM-DD] [--json]`,
    );
    process.exit(1);
  }
  const role = flag(argv, '--role') as NormalizedMessage['role'] | undefined;
  const runtime = flag(argv, '--runtime') as Runtime | undefined;
  const limitPerRuntime = numFlag(argv, '--limit', 200);
  const maxHits = numFlag(argv, '--max-hits', Number.POSITIVE_INFINITY);
  const sinceStr = flag(argv, '--since');
  const ignoreCase = argv.includes('-i') || argv.includes('--ignore-case');
  const json = argv.includes('--json');

  const t0 = performance.now();
  const hits = await grepAllSessions({
    pattern,
    flags: ignoreCase ? 'i' : '',
    role,
    runtimes: runtime ? [runtime] : undefined,
    limitPerRuntime,
    maxHits: Number.isFinite(maxHits) ? maxHits : undefined,
    since: sinceStr ? new Date(sinceStr) : undefined,
  });
  const dt = performance.now() - t0;

  const bySession = new Map<string, GrepHit[]>();
  for (const h of hits) {
    const key = `${h.session.runtime}:${h.session.id}`;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key)!.push(h);
  }

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          pattern,
          elapsed_ms: Math.round(dt),
          total_hits: hits.length,
          session_count: bySession.size,
          sessions: Array.from(bySession.values()).map((group) => ({
            session: {
              runtime: group[0].session.runtime,
              id: group[0].session.id,
              title: group[0].session.title,
              cwd: group[0].session.cwd,
              last_active_at: group[0].session.last_active_at,
            },
            hits: group.map((h) => ({
              index: h.index,
              role: h.message.role,
              timestamp: h.message.timestamp,
              text: h.message.text,
              tool_name: h.message.tool_name,
            })),
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  process.stdout.write(banner('grep'));
  console.log(`  ${section('PATTERN')}  ${c.cream(pattern)}   ${c.dim(`(${ignoreCase ? 'ignore-case' : 'case-sensitive'})`)}`);
  console.log(
    `  ${section('RESULTS')}  ${c.cream(String(hits.length))} ${c.dim('hits across')} ${c.cream(String(bySession.size))} ${c.dim('sessions')}   ${forest(`(${(dt / 1000).toFixed(1)}s)`)}`,
  );
  console.log();

  if (hits.length === 0) {
    console.log(`  ${c.dim('no matches.')}`);
    return;
  }

  const re = new RegExp(pattern, ignoreCase ? 'i' : '');
  for (const group of bySession.values()) {
    const s = group[0].session;
    const when = s.last_active_at?.slice(0, 10) ?? '';
    console.log(
      `  ${runtimeTag(s.runtime)}  ${c.bold(c.cream(truncate(s.title ?? '(untitled)', 56)))}   ${c.dim(when)}`,
    );
    console.log(`    ${c.dim('cwd   ')} ${c.cream(shortenCwd(s.cwd))}`);
    console.log(`    ${c.dim('id    ')} ${c.slate(s.id)}`);
    for (const h of group.slice(0, 3)) {
      const hilite = highlightMatch(h.message.text, re);
      console.log(
        `    ${c.green(h.message.role)} ${c.dim(h.message.timestamp.slice(11, 19))}  ${c.cream(truncate(hilite, 200))}`,
      );
    }
    if (group.length > 3) console.log(`    ${c.dim(`… and ${group.length - 3} more hits`)}`);
    console.log();
  }
}

function highlightMatch(text: string, re: RegExp): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = re.exec(clean);
  if (!m) return clean;
  const i = m.index;
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + clean.slice(start, i + (m[0]?.length ?? 0) + 60);
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

async function cmdReconstruct(argv: Argv) {
  const idArg = flag(argv, '--id');
  const question = flag(argv, '--question') ?? flag(argv, '-q');
  const fromMsg = flag(argv, '--from-msg');
  const uptoMsg = flag(argv, '--upto-msg');
  const fromTime = flag(argv, '--from');
  const uptoTime = flag(argv, '--upto');
  const runtimeHint = flag(argv, '--runtime') as Runtime | undefined;
  const timeoutMs = numFlag(argv, '--timeout', 120_000);
  const json = argv.includes('--json');

  if (!idArg || !question || (!fromMsg && !uptoMsg && !fromTime && !uptoTime)) {
    console.error(
      `${c.red('usage:')} memto reconstruct --id <id> --question "…" [--from-msg N] [--upto-msg M] [--from <iso>] [--upto <iso>] [--runtime <rt>] [--timeout ms] [--json]
  ${c.dim('window must be specified (at least one of --from-msg / --upto-msg / --from / --upto).')}
  ${c.dim('example: reconstruct what you thought during messages 20..40 of a session:')}
    memto reconstruct --id <id> --from-msg 20 --upto-msg 40 -q "what was my position?"`,
    );
    process.exit(1);
  }

  const runtimes: Runtime[] = runtimeHint
    ? [runtimeHint]
    : ['claude-code', 'codex', 'hermes', 'openclaw'];
  let session = null as Awaited<ReturnType<typeof getSession>>;
  for (const rt of runtimes) {
    session = await getSession(rt, idArg);
    if (session) break;
  }
  if (!session) {
    console.error(`${c.red('not found:')} no session with id ${idArg}`);
    process.exit(2);
  }

  const t0 = performance.now();
  const result = await reconstruct(session, question, {
    timeoutMs,
    fromMsg: fromMsg ? Number.parseInt(fromMsg, 10) : undefined,
    uptoMsg: uptoMsg ? Number.parseInt(uptoMsg, 10) : undefined,
    fromTime,
    uptoTime,
  });
  const dt = performance.now() - t0;

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          question,
          window: { fromMsg, uptoMsg, fromTime, uptoTime },
          elapsed_ms: Math.round(dt),
          session: {
            runtime: session.runtime,
            id: session.id,
            title: session.title,
            cwd: session.cwd,
          },
          ...result,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  process.stdout.write(banner('reconstruct'));
  console.log(`  ${section('SESSION')}  ${runtimeTag(session.runtime)} ${c.cream(truncate(session.title ?? '(untitled)', 56))}`);
  const windowStr = [
    fromMsg ? `from msg ${fromMsg}` : fromTime ? `from ${fromTime}` : null,
    uptoMsg ? `upto msg ${uptoMsg}` : uptoTime ? `upto ${uptoTime}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(`  ${section('WINDOW')}  ${c.cream(windowStr)}`);
  console.log(`  ${section('QUESTION')}  ${c.cream(question)}`);
  console.log(`  ${section('ANSWER')}  ${forest(`(${(dt / 1000).toFixed(1)}s)`)}`);
  console.log(`  ${rule(90)}`);
  if (result.timed_out) console.log(`    ${c.red('timed out')}`);
  else
    console.log(
      (result.answer || c.dim('(empty)')).split('\n').map((l) => `    ${c.cream(l)}`).join('\n'),
    );
  console.log();
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
  console.log(`    ${c.cream('memto list')}         ${c.dim('[--limit N] [--runtime …] [--json]')}`);
  console.log(
    `    ${c.cream('memto grep')}         ${c.dim('<pattern> [-i] [--role …] [--runtime …] [--since …] [--max-hits N] [--json]')}`,
  );
  console.log(
    `    ${c.cream('memto messages')}     ${c.dim('--id <id> [--last N] [--head N] [--grep <pat>] [--role …] [--json]')}`,
  );
  console.log(
    `    ${c.cream('memto ask')}          ${c.dim('--id <id>[,<id>…] --question "…" [--runtime <rt>] [--timeout ms] [--json]')}`,
  );
  console.log(
    `    ${c.cream('memto reconstruct')}  ${c.dim('--id <id> --question "…" [--from-msg N] [--upto-msg M] [--from <iso>] [--upto <iso>]')}`,
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
    case 'grep':
      await cmdGrep(rest);
      break;
    case 'messages':
      await cmdMessages(rest);
      break;
    case 'reconstruct':
      await cmdReconstruct(rest);
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
