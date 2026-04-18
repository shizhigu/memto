---
name: memto
description: Query past AI coding-agent sessions across Claude Code, Codex, Hermes, and OpenClaw. Use when the user references work, decisions, or files from an earlier session — especially when they can't remember which agent tab it was in, or want to compare answers across agents.
---

# memto — wake up a past session and ask it

`memto` turns every past session across your installed AI coding agents
(Claude Code, Codex, Hermes, OpenClaw) into a queryable expert. Each past
session still has the full context it built up. You can list the fleet,
read raw transcript messages cheaply, or fork a session non-destructively
and ask a follow-up question.

## When to use this skill

Use `memto` when:

- The user says something like *"where is …?"*, *"what did we decide about …?"*,
  *"which tab was I working on X in?"* and you don't have that context.
- The user wants to pull knowledge from a different agent tab / project.
- You need to cross-check: same question to multiple past sessions and
  compare answers.

Do NOT use for:
- Things visible in the current cwd (just read the files).
- General knowledge questions unrelated to past sessions.

## Three commands, one decision tree

```
Need raw content (file path, error message, verbatim quote, tool call)?
  → memto messages --id <id> --grep <pat>   (cheap, <1s)

Need the original agent's reasoning / synthesis?
  → memto ask --id <id> --question "…"      (expensive: 30–120s, real tokens)

Don't know which session to query yet?
  → memto list --json --limit 30  | jq to filter
```

### 1. Find candidate sessions

```bash
memto list --json --limit 30
```

Returns an array of `NormalizedSession` objects. Filter with `jq`:

```bash
memto list --json --limit 30 | jq '.[] | select(.cwd | test("billing"))'
memto list --json --limit 30 | jq '.[] | select(.first_user_prompt | test("retry"; "i"))'
```

Good signals for relevance:
- `title` or `first_user_prompt` matches the user's keyword
- `cwd` matches the project they're asking about
- `last_active_at` is recent (higher = more relevant)

### 2. Read the transcript directly (cheap, preferred)

```bash
memto messages --id <id> --last 30 --json
memto messages --id <id> --grep "retry" --json
memto messages --id <id> --role user --head 5 --json
```

Returns `NormalizedMessage[]` — ISO timestamp, role, plaintext, optional
tool_name. Runs locally, no API calls, completes in under a second.

Use this when the user's question is a **content lookup**: where is X,
what error message did we see, which file was edited, what command was run.

### 3. Fork + ask when you need synthesis (expensive)

```bash
memto ask --id <id>[,<id2>...] --question "what did we decide about retries?" --json
```

- `--id` accepts one id or a comma-separated list (parallel fork + ask).
- `--runtime <rt>` optional — disambiguates if an id is ambiguous.
- `--timeout <ms>` overrides the default (120s + 1s per MB of transcript).
- Returns `{ question, elapsed_ms, results: [{ session, answer, timed_out, err }], missing }`.

Originals are **never mutated**. `memto` forks each target non-destructively
(copy + sanitize for Claude Code, cp + patch for Codex / OpenClaw, SQL
`INSERT … SELECT` for Hermes). Fork artifacts are cleaned up on exit.

## Cost & latency expectations

| Operation | Wall time | Token cost |
|---|---|---|
| `memto list` | 100–500ms for all runtimes | free |
| `memto messages` | <1s | free |
| `memto ask` (first time, big session) | 30–120s | input tokens × model price |
| `memto ask` (same session within 5 min) | 5–15s | ~10% of first call (prompt cache hit) |

**Rules of thumb:**

- Always try `memto messages` first. Most user questions ("where is …",
  "what did we run") are content lookups, not synthesis.
- If you must `ask`, batch multiple questions into ONE call rather than
  round-tripping — the prompt cache makes the first call expensive and
  every later call in the 5-minute window cheap.
- Never `ask` more than 3 sessions in parallel without explicit user
  approval — each fork loads the full session into a model context.

## Runtime-specific notes

- **OpenClaw** agents bind their model at config time — the `ask` fork uses
  whatever model the agent was configured with. If that provider is out of
  credit, `ask` fails even though `list` and `messages` still work.
- Everything else is runtime-agnostic. All four (Claude Code, Codex, Hermes,
  OpenClaw) normalize into the same `NormalizedSession` / `NormalizedMessage`
  shape.

## Typical workflow

```bash
# 1. narrow the fleet
memto list --json --limit 30 \
  | jq '[.[] | select(.cwd | test("billing"))] | .[0:3]'

# 2. cheap lookup first — does the raw transcript have the answer?
memto messages --id <id> --grep "retry" --role user --json

# 3. only if raw content isn't enough, fork + ask
memto ask --id <id1>,<id2> \
  --question "what retry ladder did we settle on, and why?" --json
```

Show the user answers side-by-side when multiple sessions were queried.
Call out disagreements between sessions explicitly — those are often the
interesting signal.

## Install / update

```bash
npx memto-cli list                  # one-shot, no install
npm i -g memto-cli && memto --help  # global
```

Source: <https://github.com/shizhigu/memto>.
