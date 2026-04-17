/**
 * Codex adapter test — synthetic HOME fixture.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAdapter } from '../src/adapters/codex.ts';

let fakeHome: string;
let adapter: CodexAdapter;
const sessionId = 'deadbeef-1234-5678-9abc-def012345678';

beforeAll(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'memto-codex-'));
  adapter = new CodexAdapter({
    root: join(fakeHome, '.codex', 'sessions'),
    indexPath: join(fakeHome, '.codex', 'session_index.jsonl'),
  });

  const sessDir = join(fakeHome, '.codex', 'sessions', '2026', '04', '01');
  await mkdir(sessDir, { recursive: true });

  const lines = [
    {
      timestamp: '2026-04-01T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-04-01T00:00:00.000Z',
        cwd: '/Users/fake/codex-proj',
        git: {
          commit_hash: 'abc123',
          branch: 'main',
          repository_url: 'https://github.com/example/codex-proj.git',
        },
      },
    },
    {
      timestamp: '2026-04-01T00:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>noise</environment_context>' }],
      },
    },
    {
      timestamp: '2026-04-01T00:00:10.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'find me the bug in parser.ts', kind: 'plain' },
    },
    {
      timestamp: '2026-04-01T00:00:11.000Z',
      type: 'turn_context',
      payload: { model: 'gpt-5-codex', cwd: '/Users/fake/codex-proj' },
    },
    {
      timestamp: '2026-04-01T00:00:20.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Found it on line 42.' },
    },
    {
      timestamp: '2026-04-01T00:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'ship it' },
    },
  ];

  await writeFile(
    join(sessDir, `rollout-2026-04-01T00-00-00-${sessionId}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  );

  // Also populate the session_index.jsonl
  await appendFile(
    join(fakeHome, '.codex', 'session_index.jsonl'),
    `${JSON.stringify({
      id: sessionId,
      thread_name: 'Fix parser bug',
      updated_at: '2026-04-01T00:01:00.000Z',
    })}\n`,
  );
});

afterAll(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

describe('CodexAdapter', () => {
  const a = () => adapter;

  it('isAvailable when ~/.codex/sessions exists', async () => {
    expect(await a().isAvailable()).toBe(true);
  });

  it('lists session and skips system-injected first prompt', async () => {
    const list = await a().list({ limit: 10 });
    // NOTE: adapter caches session_index across calls. We're ok because
    // this test creates its own index row.
    const ours = list.find((s) => s.id === sessionId);
    expect(ours).toBeDefined();
    expect(ours?.runtime).toBe('codex');
    expect(ours?.title).toBe('Fix parser bug');
    expect(ours?.cwd).toBe('/Users/fake/codex-proj');
    expect(ours?.git_repo).toBe('https://github.com/example/codex-proj.git');
    expect(ours?.git_branch).toBe('main');
    expect(ours?.model).toBe('gpt-5-codex');
    expect(ours?.first_user_prompt).toBe('find me the bug in parser.ts');
    expect(ours?.last_user_prompt).toBe('ship it');
    expect(ours?.sampled_user_prompts).toEqual([
      'find me the bug in parser.ts',
      'ship it',
    ]);
    expect(ours?.last_assistant_preview).toBe('Found it on line 42.');
    expect(ours?.size_bytes).toBeGreaterThan(0);
  });

  it('honors sampling=first-n', async () => {
    const list = await a().list({ limit: 10, sampling: { strategy: 'first-n', count: 1 } });
    const ours = list.find((s) => s.id === sessionId);
    expect(ours?.sampled_user_prompts).toEqual(['find me the bug in parser.ts']);
  });

  it('messages returns user + assistant events in order', async () => {
    const msgs = await a().messages(sessionId);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs.map((m) => m.text)).toEqual([
      'find me the bug in parser.ts',
      'Found it on line 42.',
      'ship it',
    ]);
  });
});
