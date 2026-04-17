/**
 * JSONL reader — tested on synthesized fixtures so we don't depend on
 * the user's live session data.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonl, readJsonlAll } from '../src/jsonl.ts';

let tmpDir: string | null = null;

async function fixture(content: string): Promise<string> {
  if (!tmpDir) tmpDir = await mkdtemp(join(tmpdir(), 'memto-jsonl-'));
  const p = join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jsonl`);
  await writeFile(p, content);
  return p;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('readJsonl', () => {
  it('yields parsed objects', async () => {
    const p = await fixture('{"a":1}\n{"b":2}\n{"c":3}\n');
    const out = await readJsonlAll(p);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('skips malformed lines silently', async () => {
    const p = await fixture('{"a":1}\nnot json\n{"b":2}\n');
    const out = await readJsonlAll(p);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles trailing partial line', async () => {
    const p = await fixture('{"a":1}\n{"b":'); // unclosed
    const out = await readJsonlAll(p);
    expect(out).toEqual([{ a: 1 }]);
  });

  it('returns empty for missing file', async () => {
    const out: any[] = [];
    for await (const d of readJsonl('/tmp/this-does-not-exist-memto.jsonl')) out.push(d);
    expect(out).toEqual([]);
  });

  it('handles empty lines between entries', async () => {
    const p = await fixture('{"a":1}\n\n{"b":2}\n');
    const out = await readJsonlAll(p);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
