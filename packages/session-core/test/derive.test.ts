/**
 * Derive helpers — pure functions, no I/O.
 */

import { describe, expect, it } from 'bun:test';
import {
  clean,
  deriveTitle,
  isSystemPrompt,
  previewPrompt,
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
