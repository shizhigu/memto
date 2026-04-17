---
name: memto
description: Query past AI coding-agent sessions across Claude Code, Codex, Hermes, and OpenClaw. Use when the user references work, decisions, or files from an earlier session — especially when they can't remember which agent tab it was in, or want to compare answers across agents.
---

# memto — wake up a past session and ask it

`memto` turns every past session across your installed AI coding agents
(Claude Code, Codex, Hermes, OpenClaw) into a queryable expert. Each past
session still has the full context it built up. You can list the fleet,
fork a session non-destructively, and ask it a follow-up question —
getting an answer grounded in the original session's full state, not a
summary extracted by an embedding pipeline.

## When to use this skill

Use `memto` when:

- The user says something like *"where is …?"*, *"what did we decide about …?"*,
  *"which tab was I working on X in?"* and you don't have that context.
- The user wants to pull knowledge from a different agent tab / project.
- You need to cross-check: same question to multiple past sessions and
  compare answers (e.g., "what's our retry policy?" asked to three
  different services' sessions).

Do NOT use for:
- Things visible in the current cwd (just read the files).
- General knowledge questions unrelated to past sessions.

## Commands

Always pass `--json` so you can parse the output cleanly.

### 1. Discover which sessions are candidates

```bash
memto list --json --limit 20
```

Returns an array of `NormalizedSession` objects:
```jsonc
{
  "id": "…",
  "runtime": "claude-code" | "codex" | "hermes" | "openclaw",
  "title": "refactor-billing-service",
  "started_at": "2026-04-10T…",
  "last_active_at": "2026-04-11T…",
  "cwd": "/Users/…/Projects/billing",
  "first_user_prompt": "migrate Stripe webhooks …",
  "last_user_prompt": "…",
  "sampled_user_prompts": [ "…", "…" ],
  "last_assistant_preview": "…",
  "size_bytes": 73250
}
```

Filter client-side with `jq` / your preferred JSON tool. Good signals:

- `title` or `first_user_prompt` matches the user's keyword
- `cwd` matches the project they're asking about
- `last_active_at` is recent (higher = more relevant)

### 2. Ask one or more matching sessions a question

```bash
memto ask "billing" --question "what did we decide about webhook retries?" --top 3 --json
```

- `<keyword>` matches against title + first prompt + cwd (case-insensitive substring).
- `--top N` limits the number of sessions queried in parallel (default 3).
- `--timeout <ms>` override per-session timeout (default 120s + 1s per MB).
- Returns an array of `{ session, answer, timed_out, err }`.

The original sessions are **never mutated**. `memto` forks each target
non-destructively — for Claude Code via native `--fork-session`, for Codex
by copying the jsonl and patching the id, etc. Fork artifacts are cleaned
up automatically on exit.

## Typical workflow

```bash
# 1. Narrow candidates
memto list --json --limit 30 | jq '.[] | select(.cwd | test("billing"))'

# 2. Ask the top matches in parallel
memto ask "billing" -q "latest retry ladder for failed webhook deliveries?" --json
```

Show the user the answers side-by-side if more than one session was
queried. Call out disagreements between sessions explicitly — those are
often the interesting signal.

## Install / update

The CLI is auto-installed on first use via `npx memto-cli`. To install
globally: `npm i -g memto-cli`. Source: <https://github.com/shizhigu/memto>.
