# Changelog

All notable changes to this project will be documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-04-18

### Added

- `memto grep <pattern>` — full-text regex search across every session's transcript, in parallel. The missing middle command. Flags: `-i / --ignore-case`, `--role`, `--runtime`, `--limit N`, `--max-hits N`, `--since YYYY-MM-DD`, `--json`. Returns hits grouped by session with role, timestamp, and snippet. Scans ~170 sessions across 4 runtimes in 2–20s depending on pattern (vs. the ~10 minutes it used to take to iterate `list` + `messages` by hand).
- `grepAllSessions()` exported from `@memto/session-core` for programmatic use. Uses `getMessages()` under the hood with a parallel batch pattern (default concurrency 16).

### Changed

- Help text + skill file updated to recommend `grep` for cross-session lookups before `messages` or `ask`.

### Changed

- Dropped chum-mem from the comparison matrix — it's a very new/small project and not load-bearing for the contrast memto is trying to draw. Mem0, Letta, and Zep are the established incumbents; those are the real comparisons readers care about.

## [0.3.4] — 2026-04-17

### Changed

- Section title "✨ Selling points" → "✨ What memto gives you". memto isn't being sold.
- Architecture diagram: replaced the detailed SVG (hard to scan) with a compact ASCII diagram inline in markdown. Kept the key flow (human / agent → memto → session-core → 4 native stores) and dropped the fork-strategy table details — they belong in the code, not the README.
- Removed "cheap" / "expensive" framing from command descriptions. `memto messages` and `memto ask` are described by what they do, not by how much they cost.

## [0.3.3] — 2026-04-17

### Changed

- README: removed an unsubstantiated claim about skill front-matter being a universal standard. Let the format speak for itself.

## [0.3.2] — 2026-04-17

### Changed

- README rewritten around three axioms (the memory IS the session · never mutate the past · agent-native zero-ops), a sharper ICP statement ("super-individual running 5+ AI tabs in parallel on unrelated projects"), and a per-selling-point feature table. De-emphasized Claude Code specifically where the behavior is cross-runtime.
- Skill file: removed the stale "hermes only visible under bunx" note (fixed in 0.3.1) and cleaned up install instructions. Skill front-matter is the standard format every modern agent CLI picks up automatically.

## [0.3.1] — 2026-04-17

### Fixed

- Hermes works under plain node (`npx memto-cli`). Previously the hermes adapter imported `bun:sqlite` directly, which made hermes invisible to anyone installing memto via npm. Added a small shim at `packages/session-core/src/sqlite.ts` that picks `bun:sqlite` under bun and `better-sqlite3` under node. `better-sqlite3` is now a runtime dep; npm fetches the right prebuilt binary per platform at install time.
- End-to-end verified under node: `list`, `messages`, and `ask` all work against hermes sessions.

## [0.3.0] — 2026-04-17

### Added

- `memto messages --id <id>` — read the stored transcript directly, no fork. Flags: `--last N`, `--head N`, `--grep <pattern>`, `--role user|assistant`, `--json`. Completes in under a second; use for content lookups (file paths, error messages, verbatim quotes) instead of the expensive `ask` path. This splits memto's surface into "cheap read" and "expensive synthesize", which is how agents should naturally stage their queries.
- Skill file now documents cost/latency expectations, the messages-first decision tree, and per-runtime caveats (hermes needs bunx; openclaw fails if its provider is out of credit).

### Changed

- `memto ask` now requires `--question` (previously defaulted to a useless "what was this session about?"). The default encouraged lazy calls that forked a 70MB session to get a generic one-liner.

### Fixed

- Codex fork path now passes `--skip-git-repo-check`. Codex refuses to run in non-trusted cwds by default; for archived session replays the trust check is not meaningful.

### Removed

- `--model` flag (added in 0.2.1, never released as motivating feature). The motivation was "use a cheaper model to answer the forked question." In practice:
  - memto's value is waking up **large** old sessions — but cheap models (haiku, gpt-5-nano) have small context windows, so they can't load the exact sessions this feature was meant to optimize.
  - Prompt caching already makes repeat queries to the same session near-free within the 5-minute TTL (≈ 10× discount on input tokens). Cache hit dominates model choice economically.
  - Covering all four runtimes cleanly is impossible: hermes model names depend on the user's gateway config, openclaw has no per-invocation flag. An honest CLI would degrade silently for half the runtimes.
  - Keeping the flag implied a savings pathway that almost never applies. Removing it keeps the surface small and honest.

## [0.2.1] — 2026-04-17 (superseded)

Added and then removed `--model`. See 0.2.2.

## [0.2.0] — 2026-04-17

### Breaking

- `memto ask <keyword>` is replaced with `memto ask --id <id>[,<id>...]`. Session selection is now the caller's job — the CLI no longer does substring matching over title/prompt/cwd. This was a hack that didn't handle CN/EN synonyms or fuzzy matches; pushing the decision out to LLM-driven callers (the bundled skill, or a human) yields much better session picks. Pipe from `memto list --json` to choose ids.
- `--top N` flag is gone (no longer meaningful).
- `--runtime <rt>` optional filter for disambiguating ids across runtimes.

### Fixed

- Claude Code fork now copies + sanitizes the session jsonl instead of relying on `claude --fork-session`. Sessions containing legacy `server_tool_use` or `tool_use` blocks whose ids don't match Anthropic's current pattern (e.g. cross-provider imports with `call_*` ids) would crash with `invalid_request_error`. The sanitizer strips bad-id blocks and their paired `*_tool_result` before resuming.

## [0.1.4] — 2026-04-17

### Fixed

- Add `/g` flag to the `bun:sqlite` replacement regex. The bundle contained two `bun:sqlite` import statements; earlier versions only stubbed the first, so the CLI still crashed under plain node. `npx memto-cli` now truly runs everywhere.

## [0.1.3] — 2026-04-17

### Fixed

- Inline the `bun:sqlite` stub instead of referencing an absolute path (first attempt; still buggy — superseded by v0.1.4).

## [0.1.2] — 2026-04-17

### Fixed

- Attempted to fix the `bun:sqlite` import path (superseded by v0.1.3 — do not use).

## [0.1.1] — 2026-04-17

### Fixed

- CI typecheck: drop deprecated `bun-types` reference from `tsconfig.json` (`@types/bun` is now auto-picked up).

### Changed

- Publish workflow switched to npm OIDC Trusted Publisher — no NPM_TOKEN secret needed, no rotation.

## [0.1.0] — 2026-04-17

### Added

- First public release.
- `@memto/session-core`: universal adapter for Claude Code, Codex, Hermes, and OpenClaw session stores. Exposes a common `NormalizedSession` / `NormalizedMessage` shape + three methods per adapter (`isAvailable`, `list`, `get`, `messages`).
- Non-destructive fork + resume for every runtime via `ask(session, question)`.
- `memto` CLI with `list` and `ask` subcommands, both with `--json` output. Ships as a single bundled JS file via `npx memto`.
- `skills/memto.md` — drop-in Claude Code skill that teaches agents when and how to invoke `memto`.
- `isSystemPrompt()` helper to skip shell-injected prompt wrappers (`<environment_context>`, `Sender (untrusted metadata):`, Claude slash-command blobs).
- Synthetic-fixture test suites for every adapter plus JSONL streaming helpers (64 tests).
- `examples/list-all.ts` and `examples/ask-agents.ts`.
