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

// Bun build → single-file node bundle. `bun:sqlite` stays external — the CLI
// falls back gracefully when the hermes adapter's native import is missing.
execSync(
  `bun build ${JSON.stringify(ENTRY)} --outfile ${JSON.stringify(OUT)} --target node --format esm --external bun:sqlite --external cfonts`,
  { stdio: 'inherit', cwd: ROOT },
);

let code = readFileSync(OUT, 'utf8');
code = code.replaceAll('__MEMTO_VERSION__', version);
if (!code.startsWith('#!')) code = `#!/usr/bin/env node\n${code}`;

// Replace the `import { Database } from "bun:sqlite"` statement with an
// INLINE stub class. Referencing a separate .mjs file would bake an
// absolute path into the bundle (see v0.1.1/v0.1.2 regression).
const sqliteStub = `const Database=class{constructor(){throw new Error("[memto] hermes adapter requires the bun runtime (install from https://bun.sh and use 'bunx memto-cli').")}};`;
code = code.replace(
  /import\s*\{\s*Database[^}]*\}\s*from\s*["']bun:sqlite["']\s*;?/,
  sqliteStub,
);

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
