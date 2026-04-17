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
  sampleItems,
  textFromAnthropicContent,
} from '../derive.ts';
import type {
  ListOptions,
  NormalizedMessage,
  NormalizedSession,
  SamplingConfig,
  SessionAdapter,
} from '../types.ts';

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
  all_user_prompts: string[];
  last_assistant_preview?: string;
  started_at?: string;
  last_active_at?: string;
  message_count: number;
}

/** Extract the summary-level fields from a Claude Code jsonl in one pass. */
async function scanSession(path: string): Promise<ScanResult> {
  const res: ScanResult = { message_count: 0, all_user_prompts: [] };
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
        const cleaned = clean(text);
        res.all_user_prompts.push(previewPrompt(cleaned));
        if (!res.first_user_prompt) res.first_user_prompt = previewPrompt(cleaned);
        res.last_user_prompt = previewPrompt(cleaned);
      }
    } else if (t === 'assistant') {
      res.message_count++;
      const msg = (d as any).message;
      if (msg?.model && !res.model) res.model = msg.model;
      const text = clean(textFromAnthropicContent(msg?.content));
      if (text) res.last_assistant_preview = previewPrompt(text);
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

async function listSessionFiles(root: string): Promise<FileInfo[]> {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  const files: FileInfo[] = [];
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
        if (fs.isFile()) files.push({ path: full, mtime: fs.mtimeMs, size: fs.size });
      } catch {
        /* skip */
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

interface FileInfo {
  path: string;
  mtime: number;
  size: number;
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

  async list(options?: ListOptions): Promise<NormalizedSession[]> {
    const files = await listSessionFiles(this.root);
    const since = options?.since?.toISOString() ?? '';
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const sampling = options?.sampling;
    const out: NormalizedSession[] = [];
    for (const f of files) {
      if (out.length >= limit) break;
      const base = f.path.split('/').pop() ?? '';
      const id = idFromFilename(base);
      if (!id) continue;
      const r = await scanSession(f.path);
      if (since && r.last_active_at && r.last_active_at < since) continue;
      out.push(this.buildSession(id, f, r, sampling));
    }
    return out;
  }

  private buildSession(
    id: string,
    f: FileInfo,
    r: ScanResult,
    sampling?: SamplingConfig,
  ): NormalizedSession {
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
      sampled_user_prompts: sampleItems(r.all_user_prompts, sampling),
      last_assistant_preview: r.last_assistant_preview,
      message_count: r.message_count,
      size_bytes: f.size,
      raw_path: f.path,
    };
  }

  async get(
    id: string,
    options?: { sampling?: SamplingConfig },
  ): Promise<NormalizedSession | null> {
    const files = await listSessionFiles(this.root);
    for (const f of files) {
      const base = f.path.split('/').pop() ?? '';
      if (idFromFilename(base) === id) {
        const r = await scanSession(f.path);
        return this.buildSession(id, f, r, options?.sampling);
      }
    }
    return null;
  }

  async messages(id: string): Promise<NormalizedMessage[]> {
    const files = await listSessionFiles(this.root);
    let path: string | undefined;
    for (const f of files) {
      const base = f.path.split('/').pop() ?? '';
      if (idFromFilename(base) === id) {
        path = f.path;
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
