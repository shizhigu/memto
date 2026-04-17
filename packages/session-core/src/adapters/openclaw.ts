/**
 * OpenClaw adapter.
 *
 * Sessions live at:
 *   ~/.openclaw/agents/<agent-name>/sessions/<uuid>.jsonl
 *
 * Line 0 is `{type:"session", id, timestamp, cwd}`.
 * `message` lines carry Anthropic-style `message: {role, content:[...] }`.
 *
 * OpenClaw doesn't set a title itself; we always derive from the first
 * user prompt.
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
  return join(homedir(), '.openclaw', 'agents');
}

async function listSessionFiles(root: string): Promise<string[]> {
  const files: { path: string; mtime: number }[] = [];
  let agents: string[];
  try {
    agents = await readdir(root);
  } catch {
    return [];
  }
  for (const a of agents) {
    const sessDir = join(root, a, 'sessions');
    let entries: string[];
    try {
      entries = await readdir(sessDir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith('.jsonl')) continue;
      const full = join(sessDir, e);
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

function idFromFilename(name: string): string | null {
  if (!name.endsWith('.jsonl')) return null;
  return name.slice(0, -6);
}

interface ScanResult {
  cwd?: string;
  model?: string;
  first_user_prompt?: string;
  last_user_prompt?: string;
  started_at?: string;
  last_active_at?: string;
  message_count: number;
}

async function scanSession(path: string): Promise<ScanResult> {
  const res: ScanResult = { message_count: 0 };
  for await (const d of readJsonl(path)) {
    if (!d || typeof d !== 'object') continue;
    const t = (d as any).type;
    const ts = (d as any).timestamp;
    if (typeof ts === 'string') {
      if (!res.started_at) res.started_at = ts;
      res.last_active_at = ts;
    }

    if (t === 'session') {
      if (!res.cwd && typeof (d as any).cwd === 'string') res.cwd = (d as any).cwd;
      continue;
    }
    if (t === 'model_change') {
      const m = (d as any).modelId;
      if (typeof m === 'string' && !res.model) res.model = m;
      continue;
    }
    if (t === 'message') {
      res.message_count++;
      const m = (d as any).message;
      if (!m) continue;
      const text = clean(textFromAnthropicContent(m.content));
      if (m.role === 'user' && text && !isSystemPrompt(text)) {
        if (!res.first_user_prompt) res.first_user_prompt = previewPrompt(text);
        res.last_user_prompt = previewPrompt(text);
      }
    }
  }
  return res;
}

export interface OpenClawAdapterOptions {
  /** Override ~/.openclaw/agents root. */
  root?: string;
}

export class OpenClawAdapter implements SessionAdapter {
  readonly runtime = 'openclaw' as const;
  private readonly root: string;

  constructor(options: OpenClawAdapterOptions = {}) {
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
        title: deriveTitle({ firstUserPrompt: r.first_user_prompt }),
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
    const all = await this.list();
    return all.find((s) => s.id === id) ?? null;
  }

  async messages(id: string): Promise<NormalizedMessage[]> {
    const sess = await this.get(id);
    if (!sess) return [];
    const out: NormalizedMessage[] = [];
    for await (const d of readJsonl(sess.raw_path)) {
      if (!d || typeof d !== 'object') continue;
      const t = (d as any).type;
      if (t !== 'message') continue;
      const m = (d as any).message;
      if (!m) continue;
      const text = clean(textFromAnthropicContent(m.content));
      if (!text) continue;
      const role =
        m.role === 'user' || m.role === 'assistant' || m.role === 'system' ? m.role : 'assistant';
      const ts = (d as any).timestamp ?? '';
      out.push({ session_id: id, role, timestamp: ts, text });
    }
    return out;
  }
}
