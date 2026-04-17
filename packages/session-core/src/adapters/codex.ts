/**
 * Codex (OpenAI CLI) adapter.
 *
 * Sessions live as JSONL at:
 *   ~/.codex/sessions/<year>/<month>/<day>/rollout-<ts>-<uuid>.jsonl
 *
 * Key line types:
 *   - session_meta (first line): { id, cwd, git: {commit_hash, branch, repository_url} }
 *   - response_item: wrapped message (user/assistant) with content blocks
 *   - event_msg: high-level event (user_message, agent_message, token_count, task_complete)
 *   - turn_context: per-turn model + sandbox config (we grab model from here)
 *
 * Codex also maintains ~/.codex/session_index.jsonl — an append-only index
 * of { id, thread_name, updated_at }. thread_name is LLM-generated and
 * typically present, so we use it as our primary title source.
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
  return join(homedir(), '.codex', 'sessions');
}
function defaultIndexPath(): string {
  return join(homedir(), '.codex', 'session_index.jsonl');
}

interface IndexEntry {
  thread_name?: string;
  updated_at?: string;
}

async function loadIndex(indexPath: string): Promise<Map<string, IndexEntry>> {
  const m = new Map<string, IndexEntry>();
  for await (const d of readJsonl(indexPath)) {
    if (!d || typeof d !== 'object') continue;
    const id = (d as any).id;
    if (typeof id !== 'string') continue;
    m.set(id, {
      thread_name: (d as any).thread_name,
      updated_at: (d as any).updated_at,
    });
  }
  return m;
}

interface ScanResult {
  cwd?: string;
  git_repo?: string;
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

/** Extract the session uuid from a rollout filename. */
function idFromFilename(name: string): string | null {
  // rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
  const m = name.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]+)\.jsonl$/i);
  return m ? m[1] : null;
}

async function scanSession(path: string): Promise<ScanResult> {
  const res: ScanResult = { message_count: 0, all_user_prompts: [] };
  for await (const d of readJsonl(path)) {
    if (!d || typeof d !== 'object') continue;
    const t = (d as any).type;
    const ts = (d as any).timestamp;
    if (typeof ts === 'string') {
      if (!res.started_at) res.started_at = ts;
      res.last_active_at = ts;
    }

    if (t === 'session_meta') {
      const p = (d as any).payload;
      if (p) {
        if (!res.cwd && typeof p.cwd === 'string') res.cwd = p.cwd;
        const g = p.git;
        if (g) {
          if (typeof g.repository_url === 'string') res.git_repo = g.repository_url;
          if (typeof g.branch === 'string') res.git_branch = g.branch;
        }
      }
      continue;
    }

    if (t === 'turn_context') {
      const p = (d as any).payload;
      if (p && typeof p.model === 'string' && !res.model) res.model = p.model;
      continue;
    }

    if (t === 'event_msg') {
      const p = (d as any).payload;
      if (!p) continue;
      if (p.type === 'user_message' && typeof p.message === 'string') {
        res.message_count++;
        if (!isSystemPrompt(p.message)) {
          const text = previewPrompt(p.message);
          res.all_user_prompts.push(text);
          if (!res.first_user_prompt) res.first_user_prompt = text;
          res.last_user_prompt = text;
        }
      } else if (p.type === 'agent_message' && typeof p.message === 'string') {
        res.message_count++;
        res.last_assistant_preview = previewPrompt(p.message);
      }
      continue;
    }

    if (t === 'response_item') {
      // response_item wraps OpenAI-style message objects
      const p = (d as any).payload;
      if (!p) continue;
      if (p.type === 'message') {
        const role = p.role;
        if (role === 'user' && !res.first_user_prompt) {
          const text = clean(textFromAnthropicContent(p.content));
          if (text && !isSystemPrompt(text)) res.first_user_prompt = previewPrompt(text);
        }
      }
    }
  }
  return res;
}

interface FileInfo {
  path: string;
  mtime: number;
  size: number;
}

async function listSessionFiles(root: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) await walk(full);
      else if (st.isFile() && e.endsWith('.jsonl')) {
        files.push({ path: full, mtime: st.mtimeMs, size: st.size });
      }
    }
  }
  await walk(root);
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

export interface CodexAdapterOptions {
  root?: string;
  indexPath?: string;
}

export class CodexAdapter implements SessionAdapter {
  readonly runtime = 'codex' as const;
  private readonly root: string;
  private readonly indexPath: string;

  constructor(options: CodexAdapterOptions = {}) {
    this.root = options.root ?? defaultRoot();
    this.indexPath = options.indexPath ?? defaultIndexPath();
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
    const [files, index] = await Promise.all([
      listSessionFiles(this.root),
      loadIndex(this.indexPath),
    ]);
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
      const idx = index.get(id);
      out.push({
        runtime: this.runtime,
        id,
        started_at: r.started_at ?? new Date(0).toISOString(),
        last_active_at: r.last_active_at ?? idx?.updated_at,
        cwd: r.cwd,
        git_repo: r.git_repo,
        git_branch: r.git_branch,
        title: deriveTitle({
          explicit: idx?.thread_name,
          firstUserPrompt: r.first_user_prompt,
        }),
        model: r.model,
        first_user_prompt: r.first_user_prompt,
        last_user_prompt: r.last_user_prompt,
        sampled_user_prompts: sampleItems(r.all_user_prompts, sampling),
        last_assistant_preview: r.last_assistant_preview,
        message_count: r.message_count,
        size_bytes: f.size,
        raw_path: f.path,
      });
    }
    return out;
  }

  async get(
    id: string,
    options?: { sampling?: SamplingConfig },
  ): Promise<NormalizedSession | null> {
    const all = await this.list({ sampling: options?.sampling });
    return all.find((s) => s.id === id) ?? null;
  }

  async messages(id: string): Promise<NormalizedMessage[]> {
    const sess = await this.get(id);
    if (!sess) return [];
    const out: NormalizedMessage[] = [];
    for await (const d of readJsonl(sess.raw_path)) {
      if (!d || typeof d !== 'object') continue;
      const t = (d as any).type;
      const ts = (d as any).timestamp ?? '';
      if (t === 'event_msg') {
        const p = (d as any).payload;
        if (!p) continue;
        if (p.type === 'user_message' && typeof p.message === 'string') {
          out.push({ session_id: id, role: 'user', timestamp: ts, text: clean(p.message) });
        } else if (p.type === 'agent_message' && typeof p.message === 'string') {
          out.push({
            session_id: id,
            role: 'assistant',
            timestamp: ts,
            text: clean(p.message),
          });
        }
      }
    }
    return out;
  }
}
