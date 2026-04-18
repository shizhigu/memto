// Build script: bundle packages/cli + session-core into a single
// Node-compatible JS file at dist/cli.js. No TS toolchain required at install
// time — users just `npx memto-cli` and Node runs the bundle.
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'packages/cli/src/index.ts');
const OUT = resolve(ROOT, 'dist/cli.js');

mkdirSync(dirname(OUT), { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

// Pre-render the banner so the bundle doesn't need cfonts' font JSON at runtime.
const { default: cfonts } = await import('cfonts');
const prerendered = cfonts.render('memto', {
  font: 'block',
  gradient: ['#c3f0b8', '#7bd88f', '#2d6b3c'],
  transitionGradient: true,
  space: false,
  env: 'node',
  maxLength: 0,
});
const bannerAnsi = (prerendered && prerendered.string) || 'memto';

// Externalize both SQLite backends + cfonts. The sqlite shim picks the
// right one at runtime (bun:sqlite under bun, better-sqlite3 under node).
// `createRequire` from node:module wraps the dynamic load; bun build
// keeps the require() calls intact since we pass --external.
execSync(
  `bun build ${JSON.stringify(ENTRY)} --outfile ${JSON.stringify(OUT)} --target node --format esm --external bun:sqlite --external better-sqlite3 --external cfonts`,
  { stdio: 'inherit', cwd: ROOT },
);

let code = readFileSync(OUT, 'utf8');
code = code.replaceAll('__MEMTO_VERSION__', version);
if (!code.startsWith('#!')) code = `#!/usr/bin/env node\n${code}`;

// Replace the cfonts import with an inline renderer that returns the
// pre-rendered ANSI string. Keeps the bundle self-contained.
const cfontsShim = `const cfonts = { render: () => ({ string: ${JSON.stringify(bannerAnsi)} }) };`;
code = code.replace(
  /import\s+cfonts\s+from\s+["']cfonts["'];?/,
  cfontsShim,
);

writeFileSync(OUT, code);
chmodSync(OUT, 0o755);
console.log(`  built ${OUT} (v${version}, ${(code.length / 1024).toFixed(1)} KB)`);
