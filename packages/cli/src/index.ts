#!/usr/bin/env node
/**
 * memto CLI — one binary, two subcommands.
 *
 *   memto list [--limit N] [--runtime claude-code|codex|hermes|openclaw] [--json]
 *   memto ask  <keyword> [--question "..."] [--top N] [--json]
 *
 * Agents integrate via the bundled skill at ./skills/memto.md — they call
 * the CLI through their existing Bash tool. Bundled via `bun build` into a
 * single dist/cli.js that runs under node ≥ 20.
 */

import { ask, availableAdapters, listAllSessions } from '@memto/session-core';
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

async function cmdAsk(argv: Argv) {
  const keyword = argv[0];
  const question =
    flag(argv, '--question') ?? flag(argv, '-q') ?? 'In one sentence, what was this session about?';
  const topN = numFlag(argv, '--top', 3);
  const timeoutMs = numFlag(argv, '--timeout', 120_000);
  const json = argv.includes('--json');

  if (!keyword || keyword.startsWith('-')) {
    console.error(`${c.red('usage:')} memto ask <keyword> [--question "..."] [--top N] [--json]`);
    process.exit(1);
  }

  const all = await listAllSessions({ limitPerRuntime: 30 });
  const matches = all.filter((s) => {
    const hay = `${s.title ?? ''}\n${s.first_user_prompt ?? ''}\n${s.cwd ?? ''}`.toLowerCase();
    return hay.includes(keyword.toLowerCase());
  });

  if (matches.length === 0) {
    if (json) {
      process.stdout.write(JSON.stringify({ question, results: [] }) + '\n');
      process.exit(2);
    }
    console.error(`  ${c.red('no match.')} ${c.dim(`nothing in recent sessions matched "${keyword}"`)}`);
    process.exit(2);
  }

  const chosen = matches.slice(0, topN);

  if (!json) {
    process.stdout.write(banner('ask'));
    console.log(`  ${section('QUESTION')}`);
    console.log(`  ${c.cream(question)}`);
    console.log();
    console.log(`  ${section(`ASKING ${chosen.length}/${matches.length} MATCHES`)}`);
    for (const s of chosen)
      console.log(`  ${runtimeTag(s.runtime)}  ${c.cream(truncate(s.title ?? '(untitled)', 56))}`);
    console.log();
  }

  const t0 = performance.now();
  const results = await Promise.all(
    chosen.map(async (s) => {
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
      JSON.stringify({ question, elapsed_ms: Math.round(dt), results }, null, 2) + '\n',
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
  console.log(`    ${c.cream('memto list')}  ${c.dim('[--limit N] [--runtime …] [--json]')}`);
  console.log(
    `    ${c.cream('memto ask')}   ${c.dim('<keyword> [--question "…"] [--top N] [--timeout ms] [--json]')}`,
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
