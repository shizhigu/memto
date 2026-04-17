# Changelog

All notable changes to this project will be documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] — 2026-04-17

### Fixed

- Published bundle crashed on user machines with `ERR_MODULE_NOT_FOUND` for `/home/runner/.../sqlite-shim.mjs`. The build script now inlines the `bun:sqlite` stub into the bundle instead of emitting an absolute-path import. `npx memto-cli` now runs cleanly under plain node.

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
