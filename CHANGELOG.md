# Changelog

All notable changes to this project will be documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] — 2026-04-17

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
