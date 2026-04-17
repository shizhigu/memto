/**
 * MCP server smoke test — speaks the stdio JSON-RPC protocol directly.
 *
 * Spawns the server as a subprocess, writes requests to stdin, reads
 * responses from stdout. Asserts that the handshake works and that
 * `tools/list` advertises both tools.
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const SERVER_ENTRY = join(__dirname, '..', 'src', 'index.ts');

function talk(requests: unknown[], timeoutMs = 5000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', SERVER_ENTRY], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const out: string[] = [];
    let buf = '';

    child.stdout.on('data', (c) => {
      buf += c.toString();
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard loop
      while ((nl = buf.indexOf('\n')) >= 0) {
        out.push(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('smoke test timed out'));
    }, timeoutMs);

    // Write all requests.
    for (const r of requests) {
      child.stdin.write(`${JSON.stringify(r)}\n`);
    }

    // Give the server time to respond, then close stdin → it exits.
    setTimeout(() => {
      child.stdin.end();
    }, 500);

    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

describe('memory-mcp stdio protocol', () => {
  it('handshake + tools/list returns both tools', async () => {
    const lines = await talk([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const init = JSON.parse(lines[0]);
    expect(init.result.serverInfo.name).toBe('mneme-memory-mcp');
    expect(init.result.capabilities.tools).toBeDefined();

    const tools = JSON.parse(lines[1]);
    const toolNames = tools.result.tools.map((t: any) => t.name).sort();
    expect(toolNames).toEqual(['ask_agents', 'list_agents']);
  }, 10_000);

  it('returns proper error for unknown tool', async () => {
    const lines = await talk([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'no_such_tool', arguments: {} },
      },
    ]);
    const err = JSON.parse(lines[1]);
    expect(err.error.code).toBe(-32601);
    expect(err.error.message).toContain('no_such_tool');
  }, 10_000);

  it('returns proper error for bad method', async () => {
    const lines = await talk([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      },
      { jsonrpc: '2.0', id: 2, method: 'some/fake/method' },
    ]);
    const err = JSON.parse(lines[1]);
    expect(err.error.code).toBe(-32601);
  }, 10_000);
});
