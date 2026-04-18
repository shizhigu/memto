/**
 * @memto/session-core — universal adapter for AI coding agent session stores.
 *
 * Quick start:
 *
 *   import { listAllSessions, ask } from '@memto/session-core';
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
export {
  ask,
  reconstruct,
  type AskOptions,
  type AskResult,
  type ReconstructOptions,
} from './resume.ts';
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
 * by most recent activity. Primary entry point for any UI / CLI / caller
 * that wants a unified view of the user's past agent sessions.
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
        console.error(`[memto] adapter ${a.runtime} failed:`, err);
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

export interface GrepHit {
  session: NormalizedSession;
  message: NormalizedMessage;
  /** 0-based index of this message within its session's transcript. */
  index: number;
}

export interface GrepOptions {
  /** JS RegExp source string. */
  pattern: string;
  /** RegExp flags. Default `'i'` (case-insensitive). */
  flags?: string;
  /** Only match messages with this role. */
  role?: NormalizedMessage['role'];
  /** Limit search to specific runtimes. Default: all available. */
  runtimes?: Runtime[];
  /** Per-runtime session cap (passed to listAllSessions). Default 200. */
  limitPerRuntime?: number;
  /** Only search sessions active after this date. */
  since?: Date;
  /** Parallel session-read concurrency. Default 16. */
  concurrency?: number;
  /** Stop after this many total hits. Default unlimited. */
  maxHits?: number;
}

/**
 * Stream-grep every available session's transcript for `pattern`. Runs
 * `getMessages()` in parallel batches, filters by regex, returns structured
 * hits. Fast enough for interactive use: ~100-200 sessions → a few seconds.
 *
 * This is the primitive the `messages` per-session reader is missing. For
 * "find the thing across everything", reach for this instead of iterating
 * `messages` calls one session at a time.
 */
export async function grepAllSessions(options: GrepOptions): Promise<GrepHit[]> {
  const re = new RegExp(options.pattern, options.flags ?? 'i');
  const sessions = await listAllSessions({
    runtimes: options.runtimes,
    limitPerRuntime: options.limitPerRuntime ?? 200,
    since: options.since,
  });

  const concurrency = Math.max(1, options.concurrency ?? 16);
  const maxHits = options.maxHits ?? Number.POSITIVE_INFINITY;
  const hits: GrepHit[] = [];
  let stopped = false;

  for (let i = 0; i < sessions.length && !stopped; i += concurrency) {
    const batch = sessions.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (s) => {
        try {
          const msgs = await getMessages(s.runtime, s.id);
          const local: GrepHit[] = [];
          for (let j = 0; j < msgs.length; j++) {
            const m = msgs[j];
            if (options.role && m.role !== options.role) continue;
            if (re.test(m.text)) local.push({ session: s, message: m, index: j });
          }
          return local;
        } catch {
          return [] as GrepHit[];
        }
      }),
    );
    for (const r of batchResults) {
      for (const hit of r) {
        hits.push(hit);
        if (hits.length >= maxHits) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  }

  return hits;
}
