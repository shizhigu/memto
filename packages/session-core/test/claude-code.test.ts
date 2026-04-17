/**
 * Claude Code adapter — test against a synthesized HOME so we don't depend
 * on the user's real session state.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.ts';

let fakeHome: string;
let adapter: ClaudeCodeAdapter;

beforeAll(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'mneme-claude-'));
  adapter = new ClaudeCodeAdapter({ root: join(fakeHome, '.claude', 'projects') });

  const proj = join(fakeHome, '.claude', 'projects', '-Users-fake-myproj');
  await mkdir(proj, { recursive: true });

  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const lines = [
    { type: 'permission-mode', permissionMode: 'default', sessionId },
    {
      type: 'user',
      sessionId,
      cwd: '/Users/fake/myproj',
      gitBranch: 'main',
      timestamp: '2026-04-01T00:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'help me add auth to this app' }],
      },
    },
    {
      type: 'assistant',
      sessionId,
      cwd: '/Users/fake/myproj',
      timestamp: '2026-04-01T00:00:05.000Z',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok, I will add auth.' }],
      },
    },
    { type: 'custom-title', customTitle: 'add-auth-feature', sessionId },
    {
      type: 'user',
      sessionId,
      cwd: '/Users/fake/myproj',
      timestamp: '2026-04-01T00:05:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'use sessions not JWT' }],
      },
    },
  ];
  await writeFile(
    join(proj, `${sessionId}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  );
});

afterAll(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

describe('ClaudeCodeAdapter', () => {
  const a = () => adapter;

  it('reports available when ~/.claude/projects exists', async () => {
    expect(await a().isAvailable()).toBe(true);
  });

  it('lists the synthetic session', async () => {
    const list = await a().list({ limit: 10 });
    expect(list).toHaveLength(1);
    const s = list[0];
    expect(s.runtime).toBe('claude-code');
    expect(s.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(s.title).toBe('add-auth-feature');
    expect(s.cwd).toBe('/Users/fake/myproj');
    expect(s.git_branch).toBe('main');
    expect(s.model).toBe('claude-opus-4-6');
    expect(s.message_count).toBe(3);
    expect(s.first_user_prompt).toBe('help me add auth to this app');
    expect(s.last_user_prompt).toBe('use sessions not JWT');
  });

  it('get(id) returns the same session', async () => {
    const s = await a().get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(s).not.toBeNull();
    expect(s?.title).toBe('add-auth-feature');
  });

  it('get(id) returns null for unknown id', async () => {
    const s = await a().get('does-not-exist');
    expect(s).toBeNull();
  });

  it('messages returns user + assistant in order', async () => {
    const msgs = await a().messages('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[2].role).toBe('user');
    expect(msgs[0].text).toBe('help me add auth to this app');
    expect(msgs[2].text).toBe('use sessions not JWT');
  });
});
