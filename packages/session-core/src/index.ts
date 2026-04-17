/**
 * @mneme/session-core — universal adapter for AI coding agent session stores.
 *
 * Quick start:
 *
 *   import { listAllSessions, ask } from '@mneme/session-core';
 *
 *   const sessions = await listAllSessions({ limit: 20 });
 *   const resume = sessions.find(s => s.title.includes('resume'));
 *   if (resume) {
 *     const { answer } = await ask(resume, 'where is the LaTeX file?');
 *     console.log(answer);
 *   }
 */

import { ClaudeCodeAdapter } from './adapters/claude-code.ts';
import { CodexAdapter } from './adapters/codex.ts';
import { HermesAdapter } from './adapters/hermes.ts';
import { OpenClawAdapter } from './adapters/openclaw.ts';
import type {
  ListOptions,
  NormalizedMessage,
  NormalizedSession,
  Runtime,
  SamplingConfig,
  SamplingStrategy,
  SessionAdapter,
} from './types.ts';

export type {
  ListOptions,
  NormalizedMessage,
  NormalizedSession,
  Runtime,
  SamplingConfig,
  SamplingStrategy,
  SessionAdapter,
};
export { DEFAULT_SAMPLING, sampleItems } from './derive.ts';
export { ask, type AskOptions, type AskResult } from './resume.ts';
export { ClaudeCodeAdapter, CodexAdapter, HermesAdapter, OpenClawAdapter };

const allAdapters: SessionAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new HermesAdapter(),
  new OpenClawAdapter(),
];

/** Adapter instances for every supported runtime. */
export function adapters(): SessionAdapter[] {
  return allAdapters;
}

/** Return only the adapters whose runtime is installed on this machine. */
export async function availableAdapters(): Promise<SessionAdapter[]> {
  const checks = await Promise.all(allAdapters.map((a) => a.isAvailable()));
  return allAdapters.filter((_, i) => checks[i]);
}

export interface ListAllOptions {
  /** Limit PER ADAPTER (not total). Defaults to 50. */
  limitPerRuntime?: number;
  /** Only include sessions whose last activity is newer than this. */
  since?: Date;
  /** Restrict to a subset of runtimes. */
  runtimes?: Runtime[];
  /**
   * How to sample the `sampled_user_prompts` field on each session.
   * Default: `{ strategy: 'evenly-spaced', count: 5 }`.
   */
  sampling?: SamplingConfig;
}

/**
 * Enumerate sessions across every available runtime, merged and sorted
 * by most recent activity. This is the primary entry point for any UI /
 * MCP tool that wants a unified view of the user's past agent sessions.
 */
export async function listAllSessions(
  options: ListAllOptions = {},
): Promise<NormalizedSession[]> {
  const filter = options.runtimes ? new Set(options.runtimes) : null;
  const avail = await availableAdapters();
  const selected = filter ? avail.filter((a) => filter.has(a.runtime)) : avail;
  const limit = options.limitPerRuntime ?? 50;
  const since = options.since;
  const sampling = options.sampling;
  const results = await Promise.all(
    selected.map((a) =>
      a.list({ limit, since, sampling }).catch((err) => {
        console.error(`[mneme] adapter ${a.runtime} failed:`, err);
        return [] as NormalizedSession[];
      }),
    ),
  );
  const flat = results.flat();
  flat.sort((a, b) => {
    const at = a.last_active_at ?? a.started_at;
    const bt = b.last_active_at ?? b.started_at;
    return bt.localeCompare(at);
  });
  return flat;
}

/** Look up a session by (runtime, id) across all adapters. */
export async function getSession(
  runtime: Runtime,
  id: string,
  options?: { sampling?: SamplingConfig },
): Promise<NormalizedSession | null> {
  const a = allAdapters.find((a) => a.runtime === runtime);
  if (!a) return null;
  if (!(await a.isAvailable())) return null;
  return a.get(id, options);
}

/** Fetch the full message history for (runtime, id). */
export async function getMessages(
  runtime: Runtime,
  id: string,
): Promise<NormalizedMessage[]> {
  const a = allAdapters.find((a) => a.runtime === runtime);
  if (!a) return [];
  if (!(await a.isAvailable())) return [];
  return a.messages(id);
}
