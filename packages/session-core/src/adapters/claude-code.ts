/**
 * Claude Code adapter.
 *
 * Sessions live as JSONL files at:
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *
 * Each line has a `type` discriminator. The types we care about:
 *   - user       — user turn (message.content blocks)
 *   - assistant  — assistant turn
 *   - custom-title — LLM-generated session title (rare but high-value)
 *   - agent-name — same content as custom-title
 *   - last-prompt — latest user prompt (cached for fast resume UI)
 *
 * Most sessions also have `cwd`, `gitBranch`, `slug` fields on every
 * non-marker entry — we pick the first one we see.
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonl } from '../jsonl.ts';
import {
  clean,
  deriveTitle,
  isSystemPrompt,
  previewPrompt,
  textFromAnthropicContent,
} from '../derive.ts';
import type { NormalizedMessage, NormalizedSession, SessionAdapter } from '../types.ts';

function defaultRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

interface ScanResult {
  title?: string;
  cwd?: string;
  git_branch?: string;
  model?: string;
  first_user_prompt?: string;
  last_user_prompt?: string;
  started_at?: string;
  last_active_at?: string;
  message_count: number;
}

/** Extract the summary-level fields from a Claude Code jsonl in one pass. */
async function scanSession(path: string): Promise<ScanResult> {
  const res: ScanResult = { message_count: 0 };
  for await (const d of readJsonl(path)) {
    if (!d || typeof d !== 'object') continue;
    const t = (d as any).type;

    if (t === 'custom-title' && !res.title) {
      const v = (d as any).customTitle;
      if (typeof v === 'string') res.title = v;
      continue;
    }
    if (t === 'agent-name' && !res.title) {
      const v = (d as any).agentName;
      if (typeof v === 'string') res.title = v;
      continue;
    }
    if (t === 'last-prompt') {
      const v = (d as any).lastPrompt;
      if (typeof v === 'string') res.last_user_prompt = previewPrompt(v);
      continue;
    }
    if (t === 'user') {
      res.message_count++;
      const content = (d as any).message?.content;
      const text = textFromAnthropicContent(content);
      if (text && !isSystemPrompt(text)) {
        if (!res.first_user_prompt) res.first_user_prompt = previewPrompt(text);
        res.last_user_prompt = previewPrompt(text);
      }
    } else if (t === 'assistant') {
      res.message_count++;
      const model = (d as any).message?.model;
      if (model && !res.model) res.model = model;
    }

    if (!res.cwd && (d as any).cwd) res.cwd = (d as any).cwd;
    if (!res.git_branch && (d as any).gitBranch) res.git_branch = (d as any).gitBranch;

    const ts = (d as any).timestamp;
    if (typeof ts === 'string') {
      if (!res.started_at) res.started_at = ts;
      res.last_active_at = ts;
    }
  }
  return res;
}

function idFromFilename(name: string): string | null {
  if (!name.endsWith('.jsonl')) return null;
  return name.slice(0, -6);
}

async function listSessionFiles(root: string): Promise<string[]> {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  const files: { path: string; mtime: number }[] = [];
  for (const d of dirs) {
    const projPath = join(root, d);
    let st;
    try {
      st = await stat(projPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let entries: string[];
    try {
      entries = await readdir(projPath);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const full = join(projPath, f);
      try {
        const fs = await stat(full);
        if (fs.isFile()) files.push({ path: full, mtime: fs.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.map((f) => f.path);
}

export interface ClaudeCodeAdapterOptions {
  /** Override storage root. Defaults to ~/.claude/projects. */
  root?: string;
}

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly runtime = 'claude-code' as const;
  private readonly root: string;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.root = options.root ?? defaultRoot();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const s = await stat(this.root);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  async list(options?: { limit?: number; since?: Date }): Promise<NormalizedSession[]> {
    const files = await listSessionFiles(this.root);
    const since = options?.since?.toISOString() ?? '';
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const out: NormalizedSession[] = [];
    for (const path of files) {
      if (out.length >= limit) break;
      const base = path.split('/').pop() ?? '';
      const id = idFromFilename(base);
      if (!id) continue;
      const r = await scanSession(path);
      if (since && r.last_active_at && r.last_active_at < since) continue;
      out.push({
        runtime: this.runtime,
        id,
        started_at: r.started_at ?? new Date(0).toISOString(),
        last_active_at: r.last_active_at,
        cwd: r.cwd,
        git_branch: r.git_branch,
        title: deriveTitle({ explicit: r.title, firstUserPrompt: r.first_user_prompt }),
        model: r.model,
        first_user_prompt: r.first_user_prompt,
        last_user_prompt: r.last_user_prompt,
        message_count: r.message_count,
        raw_path: path,
      });
    }
    return out;
  }

  async get(id: string): Promise<NormalizedSession | null> {
    const files = await listSessionFiles(this.root);
    for (const path of files) {
      const base = path.split('/').pop() ?? '';
      if (idFromFilename(base) === id) {
        const [s] = await Promise.all([
          (async () => {
            const r = await scanSession(path);
            return {
              runtime: this.runtime,
              id,
              started_at: r.started_at ?? new Date(0).toISOString(),
              last_active_at: r.last_active_at,
              cwd: r.cwd,
              git_branch: r.git_branch,
              title: deriveTitle({ explicit: r.title, firstUserPrompt: r.first_user_prompt }),
              model: r.model,
              first_user_prompt: r.first_user_prompt,
              last_user_prompt: r.last_user_prompt,
              message_count: r.message_count,
              raw_path: path,
            } as NormalizedSession;
          })(),
        ]);
        return s;
      }
    }
    return null;
  }

  async messages(id: string): Promise<NormalizedMessage[]> {
    const files = await listSessionFiles(this.root);
    let path: string | undefined;
    for (const p of files) {
      const base = p.split('/').pop() ?? '';
      if (idFromFilename(base) === id) {
        path = p;
        break;
      }
    }
    if (!path) return [];
    const out: NormalizedMessage[] = [];
    for await (const d of readJsonl(path)) {
      if (!d || typeof d !== 'object') continue;
      const t = (d as any).type;
      if (t !== 'user' && t !== 'assistant') continue;
      const content = (d as any).message?.content;
      const text = clean(textFromAnthropicContent(content));
      if (!text) continue;
      const ts = (d as any).timestamp ?? '';
      out.push({
        session_id: id,
        role: t,
        timestamp: ts,
        text,
      });
    }
    return out;
  }
}
