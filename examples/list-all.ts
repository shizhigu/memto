/**
 * List every session across every installed runtime.
 *
 *   bun run examples/list-all.ts
 *   bun run examples/list-all.ts --limit 10
 *   bun run examples/list-all.ts --runtime claude-code
 */

import { listAllSessions, availableAdapters } from '../packages/session-core/src/index.ts';
import {
  banner,
  c,
  runtimeTag,
  runtimeDot,
  section,
  rule,
  timeAgo,
  formatSize,
  shortenCwd,
  truncate,
} from './_ui.ts';

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx >= 0 && argv[limitIdx + 1] ? Number.parseInt(argv[limitIdx + 1], 10) : 20;

const runtimeIdx = argv.indexOf('--runtime');
const runtimeFilter = runtimeIdx >= 0 ? argv[runtimeIdx + 1] : undefined;

process.stdout.write(banner('list'));

const avail = await availableAdapters();
const availLine = avail
  .map((a) => `${runtimeDot(a.runtime)} ${c.cream(a.runtime)}`)
  .join('   ');
console.log(`  ${section('AVAILABLE RUNTIMES')}`);
console.log(`  ${availLine || c.dim('(none installed)')}`);
console.log();

const t0 = performance.now();
const sessions = await listAllSessions({ limitPerRuntime: limit });
const dt = performance.now() - t0;

const filtered = runtimeFilter ? sessions.filter((s) => s.runtime === runtimeFilter) : sessions;
const shown = filtered.slice(0, limit * (avail.length || 1));

const byRuntime: Record<string, number> = {};
for (const s of filtered) byRuntime[s.runtime] = (byRuntime[s.runtime] ?? 0) + 1;
const statParts = Object.entries(byRuntime)
  .sort(([, a], [, b]) => b - a)
  .map(([r, n]) => `${runtimeDot(r)} ${c.cream(String(n))} ${c.dim(r)}`)
  .join('   ');

console.log(`  ${section('SCAN SUMMARY')}`);
console.log(
  `  ${c.cream(String(filtered.length))} ${c.dim('sessions')}   ${c.cream(dt.toFixed(0) + 'ms')} ${c.dim('wall-clock')}   ${statParts}`,
);
console.log();

console.log(`  ${section('RECENT SESSIONS')}`);
console.log(`  ${rule(90)}`);

for (const s of shown) {
  const ts = s.last_active_at ?? s.started_at;
  const ago = timeAgo(ts);
  const title = c.bold(c.cream(truncate(s.title ?? '(untitled)', 56)));
  const meta = [
    s.size_bytes ? c.dim(formatSize(s.size_bytes)) : null,
    ago ? c.forest(ago) : null,
  ]
    .filter(Boolean)
    .join('  ');

  console.log(`  ${runtimeTag(s.runtime)}  ${title}   ${meta}`);
  console.log(`    ${c.dim('cwd   ')} ${c.cream(shortenCwd(s.cwd))}`);
  if (s.first_user_prompt) {
    console.log(`    ${c.dim('first ')} ${c.italic(c.cream(truncate(s.first_user_prompt, 88)))}`);
  }
  if (s.last_assistant_preview) {
    console.log(`    ${c.dim('reply ')} ${c.italic(c.slate(truncate(s.last_assistant_preview, 88)))}`);
  }
  if (s.model) console.log(`    ${c.dim('model ')} ${c.slate(s.model)}`);
  console.log(`    ${c.dim('id    ')} ${c.slate(s.id)}`);
  console.log();
}

if (shown.length === 0) {
  console.log(`  ${c.dim('(no sessions — did you pass --runtime for an uninstalled adapter?)')}`);
  console.log();
}
