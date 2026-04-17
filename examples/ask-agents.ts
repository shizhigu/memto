/**
 * End-to-end demo: list sessions, pick one that mentions a keyword in its
 * title or first prompt, ask it a follow-up question.
 *
 *   bun run examples/ask-agents.ts "resume"   --question "where is the resume LaTeX file?"
 *   bun run examples/ask-agents.ts "chronicle" --question "what does event sourcing get us?"
 *
 * The fork lifecycle is handled automatically — the original session is
 * not mutated. For claude-code this uses --fork-session; for codex /
 * openclaw it copies the session file; for hermes it copies the DB rows.
 */

import { ask, listAllSessions } from '../packages/session-core/src/index.ts';

const args = process.argv.slice(2);
const keyword = args[0];
const qIdx = args.indexOf('--question');
const question = qIdx >= 0 ? args[qIdx + 1] : 'In one short sentence, what was this session about?';

if (!keyword) {
  console.error('usage: bun run examples/ask-agents.ts <keyword> [--question "..."]');
  process.exit(1);
}

const all = await listAllSessions({ limitPerRuntime: 30 });
const matches = all.filter((s) => {
  const hay = `${s.title ?? ''}\n${s.first_user_prompt ?? ''}\n${s.last_user_prompt ?? ''}\n${s.cwd ?? ''}`.toLowerCase();
  return hay.includes(keyword.toLowerCase());
});

if (matches.length === 0) {
  console.error(`no sessions match "${keyword}"`);
  process.exit(2);
}

console.log(`found ${matches.length} matching session(s). asking top ${Math.min(3, matches.length)} in parallel.\n`);
console.log(`question: ${question}\n`);

const top = matches.slice(0, 3);
for (const s of top) {
  console.log(`  - [${s.runtime}] ${s.title}  (cwd=${s.cwd ?? '(none)'})`);
}

console.log('\nasking…');
const t0 = performance.now();
const answers = await Promise.all(
  top.map(async (s) => {
    try {
      const r = await ask(s, question, { timeoutMs: 90_000 });
      return { session: s, answer: r.answer, err: null as string | null };
    } catch (e) {
      return { session: s, answer: '', err: (e as Error).message };
    }
  }),
);
const dt = performance.now() - t0;

console.log(`\ndone in ${(dt / 1000).toFixed(1)}s\n`);
for (const { session, answer, err } of answers) {
  console.log(`━━━ [${session.runtime}] ${session.title} ━━━`);
  if (err) console.log(`  (error: ${err})`);
  else console.log(`  ${answer}`);
  console.log();
}
