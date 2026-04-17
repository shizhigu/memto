#!/usr/bin/env bun
/**
 * @mneme/memory-mcp — stdio MCP server exposing two tools.
 *
 *   list_agents(runtime?, limit?, since?)
 *     Returns recent sessions across all installed AI agent runtimes
 *     (Claude Code / Codex / Hermes / OpenClaw). Each entry has title,
 *     cwd, model, first_user_prompt, last_user_prompt — enough for a
 *     caller to decide which session(s) to wake up.
 *
 *   ask_agents(targets[], question, in_place?)
 *     For each {runtime, id} target, forks (non-destructively by default)
 *     the matching session, asks the question via that runtime's CLI,
 *     and returns the answer. Runs all targets in parallel.
 *
 * The protocol is plain JSON-RPC 2.0 over stdio (the MCP transport).
 * We do not depend on @modelcontextprotocol/sdk — the surface area is
 * small and keeping this zero-dep means the binary stays tiny and the
 * failure modes stay legible.
 */

import {
  ask,
  getSession,
  listAllSessions,
  type Runtime,
  type SamplingConfig,
} from '@mneme/session-core';

// ====================================================================
// Protocol primitives — minimal JSON-RPC 2.0 framing
// ====================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'mneme-memory-mcp', version: '0.1.0' };

// ====================================================================
// Tool schemas (JSON Schema subset — MCP consumers use this for UI)
// ====================================================================

const TOOLS = [
  {
    name: 'list_agents',
    description:
      'List recent AI-agent sessions across all installed runtimes (Claude Code, Codex, Hermes, OpenClaw). ' +
      'Each entry includes title, cwd, model, first_user_prompt, last_user_prompt. Useful when you need to ' +
      'find which past session knows about a topic before asking a question.',
    inputSchema: {
      type: 'object',
      properties: {
        runtime: {
          type: 'string',
          enum: ['claude-code', 'codex', 'hermes', 'openclaw'],
          description: 'Optional: restrict to one runtime.',
        },
        limit: {
          type: 'number',
          description: 'Max sessions to return (default 20).',
        },
        since_days: {
          type: 'number',
          description: 'Only include sessions active in the last N days.',
        },
        sampling_strategy: {
          type: 'string',
          enum: ['evenly-spaced', 'first-n', 'last-n', 'head-and-tail', 'every-nth', 'all', 'none'],
          description:
            'How to pick representative user prompts per session (field `sampled_user_prompts`). Default "evenly-spaced".',
        },
        sampling_count: {
          type: 'number',
          description: 'Prompt count for evenly-spaced / first-n / last-n (default 5).',
        },
        sampling_head: {
          type: 'number',
          description: 'For head-and-tail: number of prompts from the start (default 2).',
        },
        sampling_tail: {
          type: 'number',
          description: 'For head-and-tail: number of prompts from the end (default 2).',
        },
        sampling_stride: {
          type: 'number',
          description: 'For every-nth: step size (default 3).',
        },
      },
    },
  },
  {
    name: 'ask_agents',
    description:
      'Ask a question to one or more past agent sessions. Each target is forked (non-destructive by default) ' +
      'and resumed via the appropriate CLI; the answers are returned. Use this after list_agents to get a ' +
      'context-rich answer from the session that originally worked on the relevant topic.',
    inputSchema: {
      type: 'object',
      required: ['targets', 'question'],
      properties: {
        targets: {
          type: 'array',
          description: 'Sessions to query. Ask all in parallel and aggregate.',
          items: {
            type: 'object',
            required: ['runtime', 'id'],
            properties: {
              runtime: { type: 'string', enum: ['claude-code', 'codex', 'hermes', 'openclaw'] },
              id: { type: 'string' },
            },
          },
        },
        question: {
          type: 'string',
          description: 'The question to ask each session.',
        },
        in_place: {
          type: 'boolean',
          description:
            'If true, resume directly on the original session (mutates it). Default false — fork first.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Per-target timeout. Default 120000 (2min).',
        },
      },
    },
  },
] as const;

// ====================================================================
// Tool implementations
// ====================================================================

function samplingFromArgs(args: Record<string, unknown>): SamplingConfig | undefined {
  const keys = [
    'sampling_strategy',
    'sampling_count',
    'sampling_head',
    'sampling_tail',
    'sampling_stride',
  ];
  if (!keys.some((k) => args[k] !== undefined)) return undefined;
  return {
    strategy: (args.sampling_strategy as SamplingConfig['strategy']) ?? undefined,
    count: typeof args.sampling_count === 'number' ? args.sampling_count : undefined,
    head: typeof args.sampling_head === 'number' ? args.sampling_head : undefined,
    tail: typeof args.sampling_tail === 'number' ? args.sampling_tail : undefined,
    stride: typeof args.sampling_stride === 'number' ? args.sampling_stride : undefined,
  };
}

async function toolListAgents(args: Record<string, unknown>): Promise<unknown> {
  const runtime = typeof args.runtime === 'string' ? (args.runtime as Runtime) : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const sinceDays = typeof args.since_days === 'number' ? args.since_days : undefined;
  const since = sinceDays
    ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    : undefined;
  const sampling = samplingFromArgs(args);

  const sessions = await listAllSessions({
    limitPerRuntime: limit,
    runtimes: runtime ? [runtime] : undefined,
    since,
    sampling,
  });

  const trimmed = sessions.slice(0, limit).map((s) => ({
    runtime: s.runtime,
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    model: s.model,
    git_repo: s.git_repo,
    git_branch: s.git_branch,
    started_at: s.started_at,
    last_active_at: s.last_active_at,
    first_user_prompt: s.first_user_prompt,
    last_user_prompt: s.last_user_prompt,
    sampled_user_prompts: s.sampled_user_prompts,
    last_assistant_preview: s.last_assistant_preview,
    message_count: s.message_count,
    size_bytes: s.size_bytes,
    parent_session_id: s.parent_session_id,
  }));

  return { sessions: trimmed, total: trimmed.length };
}

interface AskTarget {
  runtime: Runtime;
  id: string;
}

async function toolAskAgents(args: Record<string, unknown>): Promise<unknown> {
  const targetsRaw = args.targets;
  if (!Array.isArray(targetsRaw) || targetsRaw.length === 0) {
    throw new Error('targets must be a non-empty array of {runtime, id}');
  }
  const question = args.question;
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('question must be a non-empty string');
  }
  const inPlace = args.in_place === true;
  const timeoutMs =
    typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined;

  const targets: AskTarget[] = targetsRaw.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error(`targets[${i}] is not an object`);
    const o = t as Record<string, unknown>;
    if (typeof o.runtime !== 'string' || typeof o.id !== 'string') {
      throw new Error(`targets[${i}] needs {runtime: string, id: string}`);
    }
    return { runtime: o.runtime as Runtime, id: o.id };
  });

  const answers = await Promise.all(
    targets.map(async (t) => {
      const session = await getSession(t.runtime, t.id);
      if (!session) {
        return {
          runtime: t.runtime,
          id: t.id,
          error: `session not found`,
          answer: '',
        };
      }
      try {
        const r = await ask(session, question, { inPlace, timeoutMs });
        return {
          runtime: r.runtime,
          id: r.session_id,
          answer: r.answer,
          cleaned_up: r.cleaned_up,
        };
      } catch (e) {
        return {
          runtime: t.runtime,
          id: t.id,
          answer: '',
          error: (e as Error).message,
        };
      }
    }),
  );

  return { answers };
}

// ====================================================================
// Dispatcher
// ====================================================================

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  try {
    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (req.method === 'notifications/initialized') {
      return null; // notifications don't take responses
    }
    if (req.method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }
    if (req.method === 'tools/call') {
      const p = req.params ?? {};
      const name = p.name as string | undefined;
      const args = (p.arguments as Record<string, unknown> | undefined) ?? {};
      let result: unknown;
      if (name === 'list_agents') result = await toolListAgents(args);
      else if (name === 'ask_agents') result = await toolAskAgents(args);
      else {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `unknown tool: ${name}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      };
    }
    if (req.method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `method not found: ${req.method}` },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: 'internal error',
        data: { detail: (err as Error).message },
      },
    };
  }
}

// ====================================================================
// stdio loop
// ====================================================================

function write(resp: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(resp)}\n`);
}

async function main(): Promise<void> {
  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buf += chunk;
    let nl: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard loop
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line);
      } catch {
        write({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'parse error' },
        });
        continue;
      }
      const resp = await handle(req);
      if (resp) write(resp);
    }
  }
}

main().catch((err) => {
  console.error(`[mneme-mcp] fatal:`, err);
  process.exit(1);
});
