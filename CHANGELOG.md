# Changelog

All notable changes to this project will be documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-17

### Added

- First public release.
- `@memento/session-core`: universal adapter for Claude Code, Codex, Hermes, and OpenClaw session stores. Exposes a common `NormalizedSession` / `NormalizedMessage` shape + three methods per adapter (`isAvailable`, `list`, `get`, `messages`).
- Non-destructive fork + resume for every runtime via `ask(session, question)`.
- `@memento/memory-mcp`: zero-dependency MCP stdio server exposing two tools — `list_agents` and `ask_agents`.
- `isSystemPrompt()` helper to skip shell-injected prompt wrappers (`<environment_context>`, `Sender (untrusted metadata):`, Claude slash-command blobs).
- Synthetic-fixture test suites for every adapter plus JSONL streaming helpers (38 tests).
- End-to-end smoke tests for the MCP server (3 tests).
- `examples/list-all.ts` and `examples/ask-agents.ts`.
