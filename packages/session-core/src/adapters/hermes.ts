/**
 * Hermes adapter.
 *
 * Hermes is the odd one out: storage is SQLite at ~/.hermes/state.db
 * rather than JSONL. Two relevant tables:
 *   sessions(id, source, model, started_at (epoch), ended_at, title,
 *            parent_session_id, message_count, ...)
 *   messages(session_id, role, content, timestamp, tool_name, ...)
 *
 * `messages_fts` is a bonus (FTS5 over content) — we don't use it for
 * `list()` but downstream tools can run full-text search directly.
 */

import { Database } from 'bun:sqlite';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clean, deriveTitle, previewPrompt } from '../derive.ts';
import type { NormalizedMessage, NormalizedSession, SessionAdapter } from '../types.ts';

function defaultDbPath(): string {
  return join(homedir(), '.hermes', 'state.db');
}

interface SessionRow {
  id: string;
  source: string | null;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  title: string | null;
  parent_session_id: string | null;
  message_count: number | null;
}

interface MessageRow {
  session_id: string;
  role: string;
  content: string | null;
  tool_name: string | null;
  timestamp: number;
}

function openDb(path: string): Database {
  // Read-only isn't safe here because Hermes uses WAL journalling — Bun's
  // `readonly: true` can't prepare statements without touching the -shm
  // companion file. We open read/write but our adapter never issues any
  // INSERT/UPDATE/DELETE; the fork path uses its own connection explicitly.
  return new Database(path);
}

function epochToIso(epochSec: number | null | undefined): string | undefined {
  if (epochSec == null) return undefined;
  const ms = epochSec * 1000;
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

export interface HermesAdapterOptions {
  /** Override the SQLite path. Defaults to ~/.hermes/state.db. */
  dbPath?: string;
}

export class HermesAdapter implements SessionAdapter {
  readonly runtime = 'hermes' as const;
  private readonly dbPath: string;

  constructor(options: HermesAdapterOptions = {}) {
    this.dbPath = options.dbPath ?? defaultDbPath();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const s = await stat(this.dbPath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  async list(options?: { limit?: number; since?: Date }): Promise<NormalizedSession[]> {
    if (!(await this.isAvailable())) return [];
    const db = openDb(this.dbPath);
    try {
      const limit = options?.limit ?? 1000;
      const sinceEpoch = options?.since ? options.since.getTime() / 1000 : 0;

      const rows = db
        .query<SessionRow, [number, number]>(
          `SELECT id, source, model, started_at, ended_at, title, parent_session_id, message_count
             FROM sessions
            WHERE started_at >= ?
         ORDER BY started_at DESC
            LIMIT ?`,
        )
        .all(sinceEpoch, limit);

      // Batch-fetch first user prompt per session (single query instead of N).
      // Fallback-friendly: if schema differs we just skip.
      const prompts = new Map<string, string>();
      try {
        for (const s of rows) {
          const m = db
            .query<{ content: string | null }, [string]>(
              `SELECT content FROM messages
                WHERE session_id = ? AND role = 'user'
             ORDER BY timestamp ASC LIMIT 1`,
            )
            .get(s.id);
          if (m?.content) prompts.set(s.id, m.content);
        }
      } catch {
        /* shape mismatch — skip prompt extraction */
      }

      return rows.map((r) => ({
        runtime: this.runtime,
        id: r.id,
        started_at: epochToIso(r.started_at) ?? new Date(0).toISOString(),
        last_active_at: epochToIso(r.ended_at) ?? epochToIso(r.started_at),
        title: deriveTitle({ explicit: r.title, firstUserPrompt: prompts.get(r.id) }),
        model: r.model ?? undefined,
        first_user_prompt: previewPrompt(prompts.get(r.id)),
        message_count: r.message_count ?? undefined,
        parent_session_id: r.parent_session_id ?? undefined,
        raw_path: `${this.dbPath}#${r.id}`,
      }));
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<NormalizedSession | null> {
    if (!(await this.isAvailable())) return null;
    const db = openDb(this.dbPath);
    try {
      const r = db
        .query<SessionRow, [string]>(
          `SELECT id, source, model, started_at, ended_at, title, parent_session_id, message_count
             FROM sessions WHERE id = ?`,
        )
        .get(id);
      if (!r) return null;

      const first = db
        .query<{ content: string | null }, [string]>(
          `SELECT content FROM messages WHERE session_id = ? AND role = 'user'
        ORDER BY timestamp ASC LIMIT 1`,
        )
        .get(id);
      const last = db
        .query<{ content: string | null }, [string]>(
          `SELECT content FROM messages WHERE session_id = ? AND role = 'user'
        ORDER BY timestamp DESC LIMIT 1`,
        )
        .get(id);

      return {
        runtime: this.runtime,
        id: r.id,
        started_at: epochToIso(r.started_at) ?? new Date(0).toISOString(),
        last_active_at: epochToIso(r.ended_at) ?? epochToIso(r.started_at),
        title: deriveTitle({
          explicit: r.title,
          firstUserPrompt: first?.content ?? undefined,
        }),
        model: r.model ?? undefined,
        first_user_prompt: previewPrompt(first?.content ?? undefined),
        last_user_prompt: previewPrompt(last?.content ?? undefined),
        message_count: r.message_count ?? undefined,
        parent_session_id: r.parent_session_id ?? undefined,
        raw_path: `${this.dbPath}#${r.id}`,
      };
    } finally {
      db.close();
    }
  }

  async messages(id: string): Promise<NormalizedMessage[]> {
    if (!(await this.isAvailable())) return [];
    const db = openDb(this.dbPath);
    try {
      const rows = db
        .query<MessageRow, [string]>(
          `SELECT session_id, role, content, tool_name, timestamp
             FROM messages
            WHERE session_id = ?
         ORDER BY timestamp ASC`,
        )
        .all(id);
      return rows
        .map((r) => {
          const text = clean(r.content);
          if (!text) return null;
          const role =
            r.role === 'user' || r.role === 'assistant' || r.role === 'system' || r.role === 'tool'
              ? r.role
              : 'assistant';
          return {
            session_id: r.session_id,
            role,
            timestamp: epochToIso(r.timestamp) ?? '',
            text,
            tool_name: r.tool_name ?? undefined,
          } as NormalizedMessage;
        })
        .filter((x): x is NormalizedMessage => x !== null);
    } finally {
      db.close();
    }
  }
}
