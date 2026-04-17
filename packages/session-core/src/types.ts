/**
 * Shared types for the universal session adapter.
 *
 * A `NormalizedSession` is the lowest-common-denominator shape across
 * Claude Code / Codex / Hermes / OpenClaw. Each adapter lifts its
 * native format into this shape so downstream tools (memory-mcp, dashboards,
 * analytics) don't have to care which agent produced a session.
 */

import type { SamplingConfig as _SamplingConfig } from './derive.ts';

export type Runtime = 'claude-code' | 'codex' | 'hermes' | 'openclaw';

export type { SamplingConfig, SamplingStrategy } from './derive.ts';

type SamplingConfig = _SamplingConfig;

export interface NormalizedSession {
  /** Which agent runtime produced this session. */
  runtime: Runtime;
  /** Session identifier (UUID or runtime-specific). Unique within its runtime. */
  id: string;
  /** ISO 8601 timestamp of the first event. */
  started_at: string;
  /** ISO 8601 timestamp of the last event, if the adapter can determine it. */
  last_active_at?: string;
  /** Working directory at session start (where available). */
  cwd?: string;
  /** Git repository URL if the runtime records it (only Codex today). */
  git_repo?: string;
  /** Git branch if available. */
  git_branch?: string;
  /** Best-effort human-readable title. Derived if the runtime didn't set one. */
  title?: string;
  /** Model used (e.g. "claude-sonnet-4-6", "gpt-5-codex"). */
  model?: string;
  /**
   * First user prompt, truncated to a short preview. This is almost always
   * the most informative single field for deciding if a session is the one
   * you want to ask a question to.
   */
  first_user_prompt?: string;
  /** Most recent user prompt. */
  last_user_prompt?: string;
  /**
   * 3–5 additional user prompts sampled evenly across the session. Gives a
   * sense of how the conversation evolved beyond just the first and last
   * turns — important for long sessions where the topic drifted. Previews
   * are short (~200 chars each). Empty array for short sessions.
   */
  sampled_user_prompts?: string[];
  /**
   * Preview of the last substantive assistant reply. Useful to see "where
   * the conversation was" when you're about to wake it up with a question.
   */
  last_assistant_preview?: string;
  /** Total message count (including assistant/tool/system). */
  message_count?: number;
  /** Size on disk in bytes, if the adapter can cheaply determine it. */
  size_bytes?: number;
  /** Parent session id, if the runtime tracks hierarchy (Hermes). */
  parent_session_id?: string;
  /** Absolute path to the raw storage artifact (jsonl file) or runtime-specific locator. */
  raw_path: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface NormalizedMessage {
  /** Which session this message belongs to (foreign key to NormalizedSession.id). */
  session_id: string;
  /** Message role. */
  role: MessageRole;
  /** ISO timestamp. */
  timestamp: string;
  /** Plain-text content, concatenated across content blocks. */
  text: string;
  /** If this is a tool call / result, the tool name. */
  tool_name?: string;
}

export interface ListOptions {
  /** Max sessions to return. */
  limit?: number;
  /** Only include sessions whose last activity is newer than this. */
  since?: Date;
  /**
   * Prompt sampling config for `sampled_user_prompts`.
   * Default: `{ strategy: 'evenly-spaced', count: 5 }`.
   */
  sampling?: SamplingConfig;
}

/**
 * Every adapter implements this tiny interface. `list()` should be cheap
 * (seconds for all sessions) and `messages()` can be expensive for large
 * sessions since it streams the full transcript.
 */
export interface SessionAdapter {
  /** Which runtime this adapter handles. */
  readonly runtime: Runtime;
  /**
   * Return whether this runtime is installed on the current machine.
   * Cheap — typically checks for existence of `~/.<runtime>/`.
   */
  isAvailable(): Promise<boolean>;
  /**
   * Enumerate all sessions stored locally. Ordered newest first.
   * `limit` is a soft cap; adapters may over-return if it's cheap.
   */
  list(options?: ListOptions): Promise<NormalizedSession[]>;
  /** Get one session by id. Returns `null` if not found. */
  get(id: string, options?: { sampling?: SamplingConfig }): Promise<NormalizedSession | null>;
  /** Stream messages for a session. */
  messages(id: string): Promise<NormalizedMessage[]>;
}
