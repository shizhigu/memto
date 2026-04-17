/**
 * Pick sessions whose title / first-prompt contains <keyword>, fork each,
 * ask a follow-up question in parallel. The originals are never mutated.
 *
 *   bun run examples/ask-agents.ts billing --question "what did we decide about retries?"
 */

import { ask, listAllSessions } from '../packages/session-core/src/index.ts';
import {
  banner,
  c,
  runtimeTag,
  section,
  rule,
  timeAgo,
  shortenCwd,
  truncate,
} from './_ui.ts';

const args = process.argv.slice(2);
const keyword = args[0];
const qIdx = args.indexOf('--question');
const question = qIdx >= 0 ? args[qIdx + 1] : 'In one short sentence, what was this session about?';
const topIdx = args.indexOf('--top');
const top = topIdx >= 0 && args[topIdx + 1] ? Number.parseInt(args[topIdx + 1], 10) : 3;

process.stdout.write(banner('ask'));

if (!keyword) {
  console.error(`  ${c.red('usage:')} ${c.cream('bun run examples/ask-agents.ts <keyword> [--question "..."] [--top N]')}`);
  process.exit(1);
}

const all = await listAllSessions({ limitPerRuntime: 30 });
const matches = all.filter((s) => {
  const hay = `${s.title ?? ''}\n${s.first_user_prompt ?? ''}\n${s.last_user_prompt ?? ''}\n${s.cwd ?? ''}`.toLowerCase();
  return hay.includes(keyword.toLowerCase());
});

if (matches.length === 0) {
  console.error(`  ${c.red('no match.')} ${c.dim(`nothing in recent sessions matched "${keyword}"`)}`);
  process.exit(2);
}

const chosen = matches.slice(0, top);

console.log(`  ${section('QUESTION')}`);
console.log(`  ${c.cream(question)}`);
console.log();
console.log(`  ${section('ASKING ' + chosen.length + ' / ' + matches.length + ' MATCHES')}`);
for (const s of chosen) {
  console.log(
    `  ${runtimeTag(s.runtime)}  ${c.bold(c.cream(truncate(s.title ?? '(untitled)', 56)))}   ${c.dim(shortenCwd(s.cwd))}`,
  );
}
console.log();

const t0 = performance.now();
const answers = await Promise.all(
  chosen.map(async (s) => {
    try {
      const r = await ask(s, question, { timeoutMs: 120_000 });
      return { session: s, answer: r.answer, err: null as string | null, timed_out: r.timed_out };
    } catch (e) {
      return { session: s, answer: '', err: (e as Error).message, timed_out: false };
    }
  }),
);
const dt = performance.now() - t0;

console.log(`  ${section('ANSWERS')}  ${c.forest(`(${(dt / 1000).toFixed(1)}s wall-clock)`)}`);
console.log(`  ${rule(90)}`);

for (const { session, answer, err, timed_out } of answers) {
  console.log(`  ${runtimeTag(session.runtime)}  ${c.bold(c.cream(truncate(session.title ?? '(untitled)', 56)))}   ${c.forest(timeAgo(session.last_active_at ?? session.started_at))}`);
  if (err) {
    console.log(`    ${c.red('error:')} ${c.cream(err)}`);
  } else if (timed_out) {
    console.log(`    ${c.red('timed out')} — ${c.dim('partial answer below')}`);
    console.log(`    ${c.cream(truncate(answer || '(empty)', 500))}`);
  } else {
    const formatted = (answer || c.dim('(empty)')).split('\n').map((l) => `    ${c.cream(l)}`).join('\n');
    console.log(formatted);
  }
  console.log();
}
