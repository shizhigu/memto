/**
 * Derive helpers — pure functions, no I/O.
 */

import { describe, expect, it } from 'bun:test';
import {
  clean,
  deriveTitle,
  isSystemPrompt,
  pickSampled,
  previewPrompt,
  sampleItems,
  textFromAnthropicContent,
} from '../src/derive.ts';

describe('clean', () => {
  it('trims and collapses whitespace', () => {
    expect(clean('  hello   world  ')).toBe('hello world');
  });
  it('returns empty for nullish', () => {
    expect(clean(null)).toBe('');
    expect(clean(undefined)).toBe('');
    expect(clean('')).toBe('');
  });
});

describe('previewPrompt', () => {
  it('returns short strings unchanged', () => {
    expect(previewPrompt('hi')).toBe('hi');
  });
  it('truncates with ellipsis', () => {
    const long = 'a'.repeat(300);
    const out = previewPrompt(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('deriveTitle', () => {
  it('prefers explicit title', () => {
    expect(deriveTitle({ explicit: 'My Title', firstUserPrompt: 'hello' })).toBe('My Title');
  });
  it('falls back to first prompt', () => {
    expect(deriveTitle({ firstUserPrompt: 'build a thing' })).toBe('build a thing');
  });
  it('returns "untitled" when nothing available', () => {
    expect(deriveTitle({})).toBe('untitled');
  });
  it('truncates overly long prompts', () => {
    const long = 'hello '.repeat(50);
    const out = deriveTitle({ firstUserPrompt: long });
    expect(out.length).toBeLessThanOrEqual(80);
  });
});

describe('isSystemPrompt', () => {
  it('detects codex environment_context', () => {
    expect(isSystemPrompt('<environment_context>\n<cwd>/x</cwd></environment_context>')).toBe(true);
  });
  it('detects openclaw sender metadata', () => {
    expect(
      isSystemPrompt('Sender (untrusted metadata):\n```json\n{"label":"x"}```'),
    ).toBe(true);
  });
  it('detects claude command wrappers', () => {
    expect(
      isSystemPrompt('<command-message>loop</command-message><command-args>x</command-args>'),
    ).toBe(true);
  });
  it('keeps a real user prompt', () => {
    expect(isSystemPrompt('help me fix this bug')).toBe(false);
    expect(isSystemPrompt('你好,请帮我改简历')).toBe(false);
  });
});

describe('sampleItems', () => {
  const seq = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('defaults to evenly-spaced count=5', () => {
    expect(sampleItems(seq)).toEqual(['a', 'c', 'e', 'f', 'h']);
  });

  it('evenly-spaced keeps first and last', () => {
    const out = sampleItems(seq, { strategy: 'evenly-spaced', count: 3 });
    expect(out[0]).toBe('a');
    expect(out[out.length - 1]).toBe('h');
  });

  it('evenly-spaced returns full list when k >= N', () => {
    expect(sampleItems(seq, { strategy: 'evenly-spaced', count: 20 })).toEqual(seq);
  });

  it('first-n returns first N', () => {
    expect(sampleItems(seq, { strategy: 'first-n', count: 3 })).toEqual(['a', 'b', 'c']);
  });

  it('last-n returns last N', () => {
    expect(sampleItems(seq, { strategy: 'last-n', count: 3 })).toEqual(['f', 'g', 'h']);
  });

  it('head-and-tail splits correctly', () => {
    expect(sampleItems(seq, { strategy: 'head-and-tail', head: 2, tail: 2 })).toEqual([
      'a',
      'b',
      'g',
      'h',
    ]);
  });

  it('every-nth with stride 3 includes endpoints', () => {
    const out = sampleItems(seq, { strategy: 'every-nth', stride: 3 });
    expect(out[0]).toBe('a');
    expect(out[out.length - 1]).toBe('h'); // always closes with last
  });

  it('all returns everything', () => {
    expect(sampleItems(seq, { strategy: 'all' })).toEqual(seq);
  });

  it('none returns empty', () => {
    expect(sampleItems(seq, { strategy: 'none' })).toEqual([]);
  });

  it('empty input returns empty', () => {
    expect(sampleItems([], { strategy: 'evenly-spaced', count: 5 })).toEqual([]);
  });

  it('pickSampled (legacy alias) works', () => {
    expect(pickSampled(seq, 4)).toEqual(sampleItems(seq, { strategy: 'evenly-spaced', count: 4 }));
  });
});

describe('textFromAnthropicContent', () => {
  it('passes through strings', () => {
    expect(textFromAnthropicContent('hi')).toBe('hi');
  });
  it('joins text blocks', () => {
    const content = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ];
    expect(textFromAnthropicContent(content)).toBe('a\nb');
  });
  it('skips non-text blocks', () => {
    const content = [
      { type: 'text', text: 'a' },
      { type: 'image', source: { data: 'b64' } },
      { type: 'text', text: 'c' },
    ];
    expect(textFromAnthropicContent(content)).toBe('a\nc');
  });
  it('handles codex input_text / output_text', () => {
    expect(textFromAnthropicContent([{ type: 'input_text', text: 'a' }])).toBe('a');
    expect(textFromAnthropicContent([{ type: 'output_text', text: 'b' }])).toBe('b');
  });
  it('returns empty for missing / wrong shape', () => {
    expect(textFromAnthropicContent(undefined)).toBe('');
    expect(textFromAnthropicContent(42)).toBe('');
    expect(textFromAnthropicContent([{ foo: 'bar' }])).toBe('');
  });
});
