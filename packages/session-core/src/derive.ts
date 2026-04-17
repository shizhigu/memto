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
