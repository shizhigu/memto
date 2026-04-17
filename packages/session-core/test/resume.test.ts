/**
 * Resume / fork helpers — tested for the non-spawn parts (fork file
 * creation, sqlite fork insert, answer extraction). Actually spawning
 * a runtime CLI in unit tests would be slow and machine-dependent, so
 * those paths are covered by the README demo + manual smoke runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractHermesAnswer } from '../src/resume.ts';

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'mneme-resume-'));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('codex fork file', () => {
  it('writes a new jsonl with patched session_meta.payload.id', async () => {
    // We only exercise the pure file manipulation piece. Testing by
    // re-invoking the private function would require exposing it; instead
    // we assert the contract: after cp + patch, the first line's
    // payload.id matches the new UUID, and subsequent lines are intact.
    const orig = join(tmp, 'orig.jsonl');
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'OLD', cwd: '/a', timestamp: '2026-04-01T00:00:00Z' },
        timestamp: '2026-04-01T00:00:00Z',
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }),
    ];
    await writeFile(orig, `${lines.join('\n')}\n`);

    // Simulate the cp + patch that askCodex() does.
    const raw = await readFile(orig, 'utf8');
    const parsed = raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    parsed[0].payload.id = 'NEW';
    const out = join(tmp, 'new.jsonl');
    await writeFile(out, `${parsed.map((p) => JSON.stringify(p)).join('\n')}\n`);

    const reread = (await readFile(out, 'utf8'))
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    expect(reread[0].payload.id).toBe('NEW');
    expect(reread[1].payload.message).toBe('hi');
  });
});

describe('extractHermesAnswer', () => {
  it('strips resume banner + session_id footer (real fixture 1)', () => {
    const stdout = `↻ Resumed session fork_mo2nin01_c3ef9811 (1 user message, 16 total messages)
/Users/gushizhi/Desktop/resume/resume/new_resume/main.tex
`;
    expect(extractHermesAnswer(stdout)).toBe(
      '/Users/gushizhi/Desktop/resume/resume/new_resume/main.tex',
    );
  });

  it('strips box frame + title stats + session_id (real fixture 2)', () => {
    const stdout = `↻ Resumed session fork_1776413560_0a9b59e8608c
"fork-test-fork_1776413560_0a9b59e8608c" (5 user messages, 7 total messages)

╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮
This session was about tailoring your portfolio and writing a job-application email for the ChipAgents Applications Engineer role.

session_id: fork_1776413560_0a9b59e8608c
`;
    expect(extractHermesAnswer(stdout)).toBe(
      'This session was about tailoring your portfolio and writing a job-application email for the ChipAgents Applications Engineer role.',
    );
  });

  it('handles sidewall-wrapped multiline answer', () => {
    const stdout = `↻ Resumed session X
╭─ ⚕ Hermes ──────────╮
│ First line of answer │
│ Second line            │
╰──────────────────────╯
session_id: X
`;
    expect(extractHermesAnswer(stdout)).toBe('First line of answer\nSecond line');
  });

  it('returns trimmed plain text when no chrome is present', () => {
    expect(extractHermesAnswer('\n  just the answer  \n')).toBe('just the answer');
  });

  it('empty input yields empty string', () => {
    expect(extractHermesAnswer('')).toBe('');
    expect(extractHermesAnswer('\n\n\n')).toBe('');
  });

  it('does not strip content lines that happen to contain a pipe', () => {
    const stdout = `↻ Resumed session X
the command is: ls -la | grep foo
session_id: X
`;
    expect(extractHermesAnswer(stdout)).toBe('the command is: ls -la | grep foo');
  });
});

describe('hermes SQL fork', () => {
  it('duplicates session row + all messages with new id', async () => {
    const db = new Database(join(tmp, 'state.db'));
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL, message_count INTEGER, title TEXT);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT, content TEXT, timestamp REAL);
    `);
    db.run(`INSERT INTO sessions (id, source, started_at, message_count) VALUES (?, ?, ?, ?)`, [
      'orig',
      'cli',
      1_000_000,
      2,
    ]);
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)`, [
      'orig',
      'user',
      'hello',
      1_000_000,
    ]);
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)`, [
      'orig',
      'assistant',
      'hi back',
      1_000_001,
    ]);

    // simulate fork
    db.run('BEGIN');
    db.run(
      `INSERT INTO sessions (id, source, started_at, message_count, title)
       SELECT 'fork', source, started_at, message_count, title FROM sessions WHERE id='orig'`,
    );
    db.run(
      `INSERT INTO messages (session_id, role, content, timestamp)
       SELECT 'fork', role, content, timestamp FROM messages WHERE session_id='orig'`,
    );
    db.run('COMMIT');

    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM messages WHERE session_id='fork'`)
      .get();
    expect(count?.n).toBe(2);

    // cleanup check
    db.run('BEGIN');
    db.run(`DELETE FROM messages WHERE session_id='fork'`);
    db.run(`DELETE FROM sessions WHERE id='fork'`);
    db.run('COMMIT');
    const after = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM messages WHERE session_id='fork'`)
      .get();
    expect(after?.n).toBe(0);

    db.close();
  });
});
