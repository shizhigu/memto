// Generate assets/banner.svg from cfonts output.
// Run: bun scripts/gen-banner.mjs
import cfonts from 'cfonts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORD = 'memto';
const FONT = 'huge';
// env:'browser' treats maxLength:0 as "no wrap"; node env uses terminal cols (80).
const { string } = cfonts.render(WORD, {
  font: FONT,
  colors: ['system'],
  space: false,
  env: 'browser',
  maxLength: 0,
});
const lines = string.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim().length > 0);

const maxLen = Math.max(...lines.map((l) => l.length));
const rows = lines.length;

// Each cell is a 2x3 pixel sub-grid so we can render box-drawing chars with internal detail.
// map: char → 2x3 matrix (col-major x row)
const MAP = {
  ' ': ['000', '000'],
  '█': ['111', '111'],
  '║': ['010', '010'],
  '═': ['000', '111'].map(() => '010'), // unused; replaced below
};

// Each char becomes a 3×3 sub-grid. Rows top→bottom, cols left→right.
// Values are 1=filled, 0=empty.
const SUB = {
  ' ': ['000', '000', '000'],
  '█': ['111', '111', '111'],
  '▀': ['111', '000', '000'],
  '▄': ['000', '000', '111'],
  '▌': ['110', '110', '110'],
  '▐': ['011', '011', '011'],
  '░': ['101', '010', '101'],
  '▒': ['101', '111', '101'],
  '▓': ['111', '110', '111'],
  '║': ['010', '010', '010'],
  '═': ['000', '111', '000'],
  '╔': ['000', '011', '010'],
  '╗': ['000', '110', '010'],
  '╚': ['010', '011', '000'],
  '╝': ['010', '110', '000'],
};

const CELL_W = 3;
const CELL_H = 3;
const PX = 6;
const PAD = 50;

const artW = maxLen * CELL_W * PX;
const artH = rows * CELL_H * PX;
const SVG_W = artW + PAD * 2;
const SVG_H = artH + PAD * 2;

const gradY1 = PAD;
const gradY2 = PAD + artH;

const cells = [];
for (let r = 0; r < rows; r++) {
  const line = lines[r];
  for (let c = 0; c < line.length; c++) {
    const ch = line[c];
    const sub = SUB[ch];
    if (!sub) continue;
    for (let sr = 0; sr < CELL_H; sr++) {
      for (let sc = 0; sc < CELL_W; sc++) {
        if (sub[sr][sc] !== '1') continue;
        const x = PAD + c * CELL_W * PX + sc * PX;
        const y = PAD + r * CELL_H * PX + sr * PX;
        cells.push(`<rect x="${x}" y="${y}" width="${PX}" height="${PX}"/>`);
      }
    }
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}" role="img" aria-label="${WORD}">
  <defs>
    <linearGradient id="mint" x1="0" y1="${gradY1}" x2="0" y2="${gradY2}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#c3f0b8"/>
      <stop offset="50%" stop-color="#7bd88f"/>
      <stop offset="100%" stop-color="#2d6b3c"/>
    </linearGradient>
  </defs>
  <rect width="${SVG_W}" height="${SVG_H}" fill="#0b1410"/>
  <g fill="url(#mint)" shape-rendering="crispEdges">
    ${cells.join('')}
  </g>
</svg>
`;

const out = resolve(import.meta.dirname, '..', 'assets', 'banner.svg');
writeFileSync(out, svg);
console.log(`wrote ${out}`);
console.log(`  grid: ${maxLen} cols × ${rows} rows · cells filled: ${cells.length}`);
console.log(`  size: ${SVG_W} × ${SVG_H}`);
