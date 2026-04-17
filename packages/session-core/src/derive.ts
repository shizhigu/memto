/**
 * Shared derivation helpers. Every adapter uses these to normalize title,
 * prompt previews, and role extraction so the final `NormalizedSession`
 * looks the same regardless of which runtime it came from.
 */

const PROMPT_PREVIEW_CHARS = 240;
const TITLE_PREVIEW_CHARS = 80;

/**
 * Trim and collapse whitespace. Returns empty string if the input is
 * nullish or consists only of whitespace.
 */
export function clean(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Turn an arbitrarily-long user prompt into a fixed-width preview,
 * suitable for dashboard listing.
 */
export function previewPrompt(s: string | null | undefined): string {
  const t = clean(s);
  if (t.length <= PROMPT_PREVIEW_CHARS) return t;
  return `${t.slice(0, PROMPT_PREVIEW_CHARS - 1)}…`;
}

/**
 * Derive a title. Order of preference:
 *   1. Explicit title from the runtime (custom-title, thread_name, sessions.title, etc.)
 *   2. A short, cleaned preview of the first user prompt.
 *   3. "untitled"
 */
export function deriveTitle(opts: {
  explicit?: string | null;
  firstUserPrompt?: string | null;
}): string {
  const explicit = clean(opts.explicit);
  if (explicit) return explicit;
  const prompt = clean(opts.firstUserPrompt);
  if (prompt) {
    return prompt.length <= TITLE_PREVIEW_CHARS
      ? prompt
      : `${prompt.slice(0, TITLE_PREVIEW_CHARS - 1)}…`;
  }
  return 'untitled';
}

/**
 * Detect whether a "user" message is actually system-injected chrome
 * rather than something the human typed. Common examples:
 *   - Codex's `<environment_context> ... </environment_context>` wrapper
 *   - OpenClaw's `Sender (untrusted metadata): {"label":"..."}` prefix
 *   - Claude Code's <command-message>/<system-reminder>/<attachment> blobs
 *   - Any slash-command header (`/loop`, `/fast`, etc) with no actual text
 *
 * These show up as the first "user" turn of many sessions but carry no
 * semantic information about what the user is working on.
 */
export function isSystemPrompt(text: string): boolean {
  const t = text.trimStart();
  if (!t) return true;
  if (t.startsWith('<environment_context>')) return true;
  if (t.startsWith('Sender (untrusted metadata')) return true;
  if (t.startsWith('<command-message>') && t.length < 4000 && /^<command[\s\S]+<\/command-args>\s*$/i.test(t)) {
    return true;
  }
  if (t.startsWith('<system-reminder>')) return true;
  if (t.startsWith('# AGENTS.md instructions')) return true;
  return false;
}

/**
 * Configurable prompt sampling. How should we pick a representative
 * subset from a session's user prompts?
 *
 *   evenly-spaced  — default. always keep first + last, fill middle
 *                    with an even spread. `count` = total picks.
 *   first-n        — first N prompts.
 *   last-n         — last N prompts.
 *   head-and-tail  — first `head` + last `tail`, no middle.
 *   every-nth      — take every Nth prompt (N = stride).
 *   all            — every prompt (may be a LOT for long sessions).
 *   none           — empty array.
 */
export type SamplingStrategy =
  | 'evenly-spaced'
  | 'first-n'
  | 'last-n'
  | 'head-and-tail'
  | 'every-nth'
  | 'all'
  | 'none';

export interface SamplingConfig {
  strategy?: SamplingStrategy;
  /** How many total prompts to pick. Used by evenly-spaced / first-n / last-n. Default 5. */
  count?: number;
  /** For `head-and-tail`: how many from the start. Default 2. */
  head?: number;
  /** For `head-and-tail`: how many from the end. Default 2. */
  tail?: number;
  /** For `every-nth`: step size. Default 3. */
  stride?: number;
}

export const DEFAULT_SAMPLING: Required<SamplingConfig> = {
  strategy: 'evenly-spaced',
  count: 5,
  head: 2,
  tail: 2,
  stride: 3,
};

/**
 * Apply a SamplingConfig to pull a subset out of an ordered list.
 * Preserves original order. De-duplicates adjacent identical picks
 * so callers don't need to.
 */
export function sampleItems<T>(items: readonly T[], cfg: SamplingConfig = {}): T[] {
  if (items.length === 0) return [];
  const c: Required<SamplingConfig> = { ...DEFAULT_SAMPLING, ...cfg };
  let picked: T[] = [];

  switch (c.strategy) {
    case 'none':
      return [];
    case 'all':
      picked = items.slice();
      break;
    case 'first-n':
      picked = items.slice(0, Math.max(0, c.count));
      break;
    case 'last-n':
      picked = items.slice(Math.max(0, items.length - c.count));
      break;
    case 'head-and-tail': {
      const head = Math.max(0, c.head);
      const tail = Math.max(0, c.tail);
      if (items.length <= head + tail) {
        picked = items.slice();
      } else {
        picked = [...items.slice(0, head), ...items.slice(items.length - tail)];
      }
      break;
    }
    case 'every-nth': {
      const stride = Math.max(1, c.stride);
      for (let i = 0; i < items.length; i += stride) picked.push(items[i]);
      if (picked[picked.length - 1] !== items[items.length - 1]) {
        picked.push(items[items.length - 1]);
      }
      break;
    }
    default: {
      // evenly-spaced
      const k = Math.max(1, c.count);
      if (items.length <= k) {
        picked = items.slice();
      } else {
        picked.push(items[0]);
        const step = (items.length - 1) / (k - 1);
        for (let i = 1; i < k - 1; i++) picked.push(items[Math.round(i * step)]);
        picked.push(items[items.length - 1]);
      }
    }
  }

  // de-duplicate adjacent identical picks
  const dedup: T[] = [];
  for (const v of picked) {
    if (dedup.length === 0 || dedup[dedup.length - 1] !== v) dedup.push(v);
  }
  return dedup;
}

/**
 * Legacy alias. Prefer `sampleItems(items, { strategy: 'evenly-spaced', count: k })`.
 */
export function pickSampled<T>(items: readonly T[], k: number): T[] {
  return sampleItems(items, { strategy: 'evenly-spaced', count: k });
}

/**
 * Extract plain text from an Anthropic-style content array:
 *   [{type: "text", text: "..."}, {type: "image", ...}, ...]
 * Returns an empty string if no text blocks are present.
 */
export function textFromAnthropicContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const rec = b as Record<string, unknown>;
    const type = rec.type;
    if (type === 'text' && typeof rec.text === 'string') parts.push(rec.text);
    // Codex uses input_text for user content
    if (type === 'input_text' && typeof rec.text === 'string') parts.push(rec.text);
    // Codex uses output_text for assistant responses
    if (type === 'output_text' && typeof rec.text === 'string') parts.push(rec.text);
  }
  return parts.join('\n');
}
