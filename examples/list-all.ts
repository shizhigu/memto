/**
 * Quick diagnostic: list every session across every installed runtime.
 *
 *   bun run examples/list-all.ts
 *   bun run examples/list-all.ts --limit 10
 */

import { listAllSessions, availableAdapters } from '../packages/session-core/src/index.ts';

const limitArg = process.argv.indexOf('--limit');
const limit =
  limitArg >= 0 && process.argv[limitArg + 1] ? Number.parseInt(process.argv[limitArg + 1], 10) : 20;

const avail = await availableAdapters();
console.log(`available runtimes: ${avail.map((a) => a.runtime).join(', ') || '(none)'}`);

const t0 = performance.now();
const sessions = await listAllSessions({ limitPerRuntime: limit });
const dt = performance.now() - t0;

console.log(`\n${sessions.length} sessions across ${avail.length} runtimes in ${dt.toFixed(0)}ms\n`);

for (const s of sessions.slice(0, limit)) {
  const ts = s.last_active_at ?? s.started_at;
  const cwd = s.cwd ? s.cwd.replace(process.env.HOME ?? '', '~') : '(no cwd)';
  console.log(
    `[${s.runtime.padEnd(11)}] ${ts.slice(0, 19)}  ${(s.title ?? 'untitled').slice(0, 60)}`,
  );
  console.log(`  cwd:   ${cwd}`);
  if (s.first_user_prompt) {
    console.log(`  first: ${s.first_user_prompt.replace(/\n/g, ' ').slice(0, 100)}`);
  }
  if (s.model) console.log(`  model: ${s.model}`);
  console.log(`  id:    ${s.id}`);
}
