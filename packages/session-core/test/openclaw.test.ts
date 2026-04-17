/**
 * OpenClaw adapter — synthetic HOME fixture.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawAdapter } from '../src/adapters/openclaw.ts';

let fakeHome: string;
let adapter: OpenClawAdapter;
const sessionId = '01932abc-cafe-babe-feed-deadbeef0001';

beforeAll(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'mneme-openclaw-'));
  adapter = new OpenClawAdapter({ root: join(fakeHome, '.openclaw', 'agents') });

  const sessDir = join(fakeHome, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessDir, { recursive: true });

  const lines = [
    {
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: '2026-04-01T12:00:00.000Z',
      cwd: '/Users/fake/.openclaw/workspace',
    },
    {
      type: 'model_change',
      id: 'mc-1',
      timestamp: '2026-04-01T12:00:00.050Z',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    },
    {
      type: 'message',
      id: 'm-1',
      timestamp: '2026-04-01T12:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Sender (untrusted metadata): ... ignore this noise' }],
      },
    },
    {
      type: 'message',
      id: 'm-2',
      timestamp: '2026-04-01T12:00:02.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'deploy the site' }],
      },
    },
    {
      type: 'message',
      id: 'm-3',
      timestamp: '2026-04-01T12:00:03.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'deploying now.' }],
      },
    },
  ];

  await writeFile(
    join(sessDir, `${sessionId}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  );
});

afterAll(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

describe('OpenClawAdapter', () => {
  const a = () => adapter;

  it('isAvailable', async () => {
    expect(await a().isAvailable()).toBe(true);
  });

  it('lists synthetic session, skips Sender-metadata first user msg', async () => {
    const list = await a().list({ limit: 10 });
    expect(list).toHaveLength(1);
    const s = list[0];
    expect(s.id).toBe(sessionId);
    expect(s.title).toBe('deploy the site');
    expect(s.cwd).toBe('/Users/fake/.openclaw/workspace');
    expect(s.model).toBe('claude-sonnet-4-6');
    expect(s.first_user_prompt).toBe('deploy the site');
  });

  it('messages returns all three in order', async () => {
    const msgs = await a().messages(sessionId);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('user');
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[2].text).toBe('deploying now.');
  });
});
