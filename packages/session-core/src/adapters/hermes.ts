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

import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clean, deriveTitle, previewPrompt, sampleItems } from '../derive.ts';
import { Database, hasSqliteBackend } from '../sqlite.ts';
import type {
  ListOptions,
  NormalizedMessage,
  NormalizedSession,
  SamplingConfig,
  SessionAdapter,
} from '../types.ts';

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
  // Hermes uses WAL journalling. We open read/write but our adapter never
  // issues INSERT/UPDATE/DELETE; the fork path uses its own connection.
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
      if (!s.isFile()) return false;
      // When running under plain node via `npx memto-cli`, bun:sqlite is stubbed
      // and throws on construction — report unavailable instead of crashing.
      try {
        const db = new Database(this.dbPath);
        db.close?.();
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  async list(options?: ListOptions): Promise<NormalizedSession[]> {
    if (!(await this.isAvailable())) return [];
    const db = openDb(this.dbPath);
    try {
      const limit = options?.limit ?? 1000;
      const sinceEpoch = options?.since ? options.since.getTime() / 1000 : 0;
      const sampling = options?.sampling;

      const rows = db
        .query<SessionRow>(
          `SELECT id, source, model, started_at, ended_at, title, parent_session_id, message_count
             FROM sessions
            WHERE started_at >= ?
         ORDER BY started_at DESC
            LIMIT ?`,
        )
        .all(sinceEpoch, limit);

      // Pull all user prompts + last assistant reply per session in one
      // prepared statement. Slightly more work than "just the first", but
      // it keeps the list view meaningful for long sessions that drifted.
      const userStmt = db.query<{ content: string | null }>(
        `SELECT content FROM messages
          WHERE session_id = ? AND role = 'user' AND content IS NOT NULL
       ORDER BY timestamp ASC`,
      );
      const lastAssistantStmt = db.query<{ content: string | null }>(
        `SELECT content FROM messages
          WHERE session_id = ? AND role = 'assistant' AND content IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1`,
      );

      return rows.map((r) => {
        let userPrompts: string[] = [];
        let firstPrompt: string | undefined;
        let lastPrompt: string | undefined;
        let lastAssistant: string | undefined;
        try {
          const all = userStmt.all(r.id);
          userPrompts = all
            .map((m) => clean(m.content))
            .filter((t) => t.length > 0)
            .map((t) => previewPrompt(t));
          firstPrompt = userPrompts[0];
          lastPrompt = userPrompts[userPrompts.length - 1];
          const la = lastAssistantStmt.get(r.id);
          if (la?.content) lastAssistant = previewPrompt(la.content);
        } catch {
          /* schema drift — skip silently */
        }
        return {
          runtime: this.runtime,
          id: r.id,
          started_at: epochToIso(r.started_at) ?? new Date(0).toISOString(),
          last_active_at: epochToIso(r.ended_at) ?? epochToIso(r.started_at),
          title: deriveTitle({ explicit: r.title, firstUserPrompt: firstPrompt }),
          model: r.model ?? undefined,
          first_user_prompt: firstPrompt,
          last_user_prompt: lastPrompt,
          sampled_user_prompts: sampleItems(userPrompts, sampling),
          last_assistant_preview: lastAssistant,
          message_count: r.message_count ?? undefined,
          parent_session_id: r.parent_session_id ?? undefined,
          raw_path: `${this.dbPath}#${r.id}`,
        };
      });
    } finally {
      db.close();
    }
  }

  async get(
    id: string,
    options?: { sampling?: SamplingConfig },
  ): Promise<NormalizedSession | null> {
    if (!(await this.isAvailable())) return null;
    const sampling = options?.sampling;
    const db = openDb(this.dbPath);
    try {
      const r = db
        .query<SessionRow>(
          `SELECT id, source, model, started_at, ended_at, title, parent_session_id, message_count
             FROM sessions WHERE id = ?`,
        )
        .get(id);
      if (!r) return null;

      const userPrompts = db
        .query<{ content: string | null }>(
          `SELECT content FROM messages WHERE session_id = ? AND role = 'user' AND content IS NOT NULL
        ORDER BY timestamp ASC`,
        )
        .all(id)
        .map((m) => clean(m.content))
        .filter((t) => t.length > 0)
        .map((t) => previewPrompt(t));
      const lastAssistant = db
        .query<{ content: string | null }>(
          `SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' AND content IS NOT NULL
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
          firstUserPrompt: userPrompts[0],
        }),
        model: r.model ?? undefined,
        first_user_prompt: userPrompts[0],
        last_user_prompt: userPrompts[userPrompts.length - 1],
        sampled_user_prompts: sampleItems(userPrompts, sampling),
        last_assistant_preview: lastAssistant?.content
          ? previewPrompt(lastAssistant.content)
          : undefined,
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
        .query<MessageRow>(
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
