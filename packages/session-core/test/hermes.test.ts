/**
 * Hermes adapter — synthetic SQLite fixture. We build a DB on disk with
 * the same schema Hermes uses and point the adapter at a fake HOME.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesAdapter } from '../src/adapters/hermes.ts';

let fakeHome: string;
let adapter: HermesAdapter;

beforeAll(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'mneme-hermes-'));
  const dbPath = join(fakeHome, '.hermes', 'state.db');
  adapter = new HermesAdapter({ dbPath });

  await mkdir(join(fakeHome, '.hermes'), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      user_id TEXT,
      model TEXT,
      model_config TEXT,
      system_prompt TEXT,
      parent_session_id TEXT,
      started_at REAL NOT NULL,
      ended_at REAL,
      end_reason TEXT,
      message_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      billing_provider TEXT,
      billing_base_url TEXT,
      billing_mode TEXT,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      cost_status TEXT,
      cost_source TEXT,
      pricing_version TEXT,
      title TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      tool_name TEXT,
      timestamp REAL NOT NULL,
      token_count INTEGER,
      finish_reason TEXT,
      reasoning TEXT,
      reasoning_details TEXT,
      codex_reasoning_items TEXT
    );
  `);

  // one session with two user turns and one assistant turn
  const t0 = 1_733_000_000;
  db.run(
    `INSERT INTO sessions (id, source, model, started_at, ended_at, message_count, title)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['sess_a', 'cli', 'claude-opus-4-6', t0, t0 + 120, 3, 'Fix login flow'],
  );
  db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)`, [
    'sess_a',
    'user',
    'login is broken in safari',
    t0,
  ]);
  db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)`, [
    'sess_a',
    'assistant',
    'Let me check the cookie policy.',
    t0 + 30,
  ]);
  db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)`, [
    'sess_a',
    'user',
    'thanks, that worked',
    t0 + 120,
  ]);

  // one session with no title
  db.run(
    `INSERT INTO sessions (id, source, model, started_at, message_count)
     VALUES (?, ?, ?, ?, ?)`,
    ['sess_b', 'cli', 'gpt-5.4', t0 - 3600, 1],
  );
  db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)`, [
    'sess_b',
    'user',
    'quick tax question',
    t0 - 3600,
  ]);

  db.close();
});

afterAll(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

describe('HermesAdapter', () => {
  const a = () => adapter;

  it('isAvailable when state.db exists', async () => {
    expect(await a().isAvailable()).toBe(true);
  });

  it('lists sessions newest first', async () => {
    const list = await a().list({ limit: 10 });
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('sess_a'); // newer
    expect(list[1].id).toBe('sess_b');
  });

  it('uses explicit title when present, else first prompt', async () => {
    const list = await a().list({ limit: 10 });
    const byId = new Map(list.map((s) => [s.id, s]));
    expect(byId.get('sess_a')?.title).toBe('Fix login flow');
    expect(byId.get('sess_b')?.title).toBe('quick tax question');
  });

  it('messages returns in timestamp order', async () => {
    const msgs = await a().messages('sess_a');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs.map((m) => m.text)).toEqual([
      'login is broken in safari',
      'Let me check the cookie policy.',
      'thanks, that worked',
    ]);
  });

  it('get(id) returns null for missing', async () => {
    expect(await a().get('nope')).toBeNull();
  });
});
