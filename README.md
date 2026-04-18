<p align="center">
  <img src="./assets/banner.svg" alt="memto — memory for your fleet of AI coding agents" width="100%"/>
</p>

<h1 align="center">memto 🎞️</h1>

<p align="center">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-7bd88f?style=flat-square"/></a>
  <img alt="npm" src="https://img.shields.io/badge/install-npx%20memto--cli-c3f0b8?style=flat-square"/>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-f4ede0?style=flat-square"/>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-5e9bff?style=flat-square"/>
  <img alt="Tests" src="https://img.shields.io/badge/tests-61%20passing-7bd88f?style=flat-square"/>
  <img alt="Runtimes" src="https://img.shields.io/badge/runtimes-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Hermes%20%C2%B7%20OpenClaw-d9893a?style=flat-square"/>
</p>

<p align="center">
  <b>Memory for your fleet of AI coding agents.</b><br/>
  <code>memto</code> is the unified memory layer for the multiple AI coding CLIs you use.
</p>

<p align="center">
  Wake up any past session across <b>Claude Code, Codex, Hermes, and OpenClaw</b><br/>
  and ask it a question — or just read its transcript.<br/>
  No extraction. No daemon. No cloud.
</p>

<p align="center">
  <i>Like the movie — every past AI session is a polaroid you can hold up and ask questions of.<br/>Because your agents remember, and you don't.</i>
</p>

---

## 🎬 Who this is for

If you run **one** AI coding tab at a time, you don't need this.

If you run **five** — résumé in one, startup in another, debugging a customer issue in a third, deep research in a fourth, taxes in a fifth — then today the answer to *"where is the LaTeX file for my résumé?"* lives in exactly **one** agent's head.

The other four have no idea. You, the human, are the only thing connecting them, and your short-term memory is the bottleneck.

`memto` is built for that scenario: **multiple AI coding agents running in parallel across unrelated projects**. Not for enterprise teams locked to a single tool. Not for deep single-codebase work. For the super-individual with five tabs open.

---

## 🧭 Three axioms

Product decisions come from these three. None of them are negotiable.

1. **The memory IS the session.** No extraction, no embeddings, no "facts in a vector DB". The raw transcript file your agent CLI already wrote — that's the memory. We just make it queryable.
2. **Never mutate the past.** Every `ask` forks a non-destructive copy. Your original session files are never touched. Rolling back is always a no-op because nothing changed.
3. **Agent-native, zero ops.** One bundled CLI, `--json` on every command, a bundled skill that teaches your agents when to call it. No daemon. No database. No cloud. `npx memto-cli` and go.

---

## ✨ What memto gives you

| | |
|---|---|
| 🔗 **Cross-runtime, no extraction** | One unified interface for Claude Code, Codex, Hermes, and OpenClaw. Every adapter reads native files directly; no conversion step, no ingestion pipeline. This is the only thing in the market that does this. |
| 🪞 **Fork-safe by design** | Every `ask` copies the session, asks on the copy, deletes the copy. Original files untouched. You can safely query a 3-month-old session without fear of polluting it. |
| ⚡ **Two-tier access** | `memto messages` reads the transcript directly. `memto ask` forks and revives the original agent. Pick the one that fits the question — agents learn to read first, synthesize second. |
| 🤖 **Agent-native output** | `--json` everywhere. Ships a markdown skill so any modern agent CLI picks up the usage pattern automatically. No MCP server needed. |
| 🧪 **No DB, no daemon, no cloud** | Contrast with Mem0 / Letta / Zep / chum-mem — all require ingestion pipelines and external stores. memto ships a single 60 KB JS file. |
| ⏱ **Auto-scaled timeouts** | 120s floor + 1s per MB of transcript. Large sessions (60 MB+) don't silently die from premature kills. |
| 🕵️ **Prompt wrapper filtering** | Runtime-specific noise (`<environment_context>`, `Sender (untrusted metadata):`, slash-command blobs, skill-injection headers) gets stripped so `first_user_prompt` is what the human actually typed. |
| 🧪 **61 tests, 4 runtimes verified** | Every adapter has synthetic-fixture tests. All four runtimes end-to-end verified against real local stores. |

---

## 🏃 Install

```bash
# one-shot, no install
npx memto-cli list

# global install
npm i -g memto-cli && memto --help
```

Teach your agents to call memto automatically — drop the bundled skill into your agent's skills directory:

```bash
curl -fsSL https://raw.githubusercontent.com/shizhigu/memto/main/skills/memto.md \
  > ~/.claude/skills/memto.md   # adjust path for your agent
```

Once dropped in, your agent automatically learns when to use `memto messages` vs `memto ask`.

---

## 🔍 Three commands

### `memto list` — see every past session, merged

```bash
memto list --limit 10
```

```text
[claude-code] 2026-04-10  refactor-billing-service
  cwd:   ~/Projects/billing
  first: migrate Stripe webhooks to async handlers, preserve idempotency…
  model: claude-opus-4-6

[codex     ] 2026-04-09  fix-memory-leak-in-parser
  cwd:   ~/Projects/lsp-server
  first: investigate heap growth during long document parses

[hermes    ] 2026-04-08  onboarding-email-sequence
  first: draft a 5-email welcome series for new B2B signups

[openclaw  ] 2026-04-05  deploy-staging
  first: verify the CD pipeline is green before Tuesday's release cut
```

Every runtime, one merged view. Pipe to `jq` for filtering:

```bash
memto list --json --limit 30 | jq '.[] | select(.cwd | test("billing"))'
```

### `memto messages` — read the transcript directly

```bash
memto messages --id <session_id> --last 10 --json
memto messages --id <session_id> --grep "retry" --role user --json
```

Sub-second, zero tokens. Use this for content lookup — file paths, error messages, decisions stated verbatim. 80% of memory queries can be answered here without ever forking.

### `memto ask` — fork and revive the original agent

```bash
memto ask --id <session_id> --question "what did we decide about retry logic?"
```

```text
━━━ [claude-code] refactor-billing-service ━━━
  We settled on exponential backoff keyed by (customer_id, event_type), 
  capped at 24h, with idempotency keys persisted to Redis for 7 days.
```

Use when raw content isn't enough — when you need the original agent's synthesis, not just its transcript. Fork is non-destructive; originals are never touched.

---

## 🧩 Architecture

```
you / your agent
      │
      │  memto list · messages · ask
      ▼
┌────────────────────────────────────┐
│  memto  — one CLI, npx-able        │
└──────────────┬─────────────────────┘
               │  NormalizedSession / NormalizedMessage
               ▼
┌────────────────────────────────────┐
│  @memto/session-core               │
│  claude-code · codex · hermes · openclaw
└──┬──────────┬──────────┬───────┬───┘
   ▼          ▼          ▼       ▼
~/.claude  ~/.codex  ~/.hermes  ~/.openclaw
```

Four native stores, one normalized shape. Each adapter reads its runtime's files directly — no ingestion, no duplicate store. SQLite for hermes uses `bun:sqlite` under bun and `better-sqlite3` under node (picked at runtime).

---

## 📚 Use it as a library

```ts
import { listAllSessions, getMessages, ask } from '@memto/session-core';

// 1. enumerate
const sessions = await listAllSessions({
  limitPerRuntime: 20,
  sampling: { strategy: 'head-and-tail', head: 2, tail: 2 },
});

// 2. read transcript directly
const resumeSession = sessions.find(s => /résumé/i.test(s.title ?? ''));
if (resumeSession) {
  const msgs = await getMessages(resumeSession.runtime, resumeSession.id);
  const hit = msgs.find(m => /\.tex/.test(m.text));
  if (hit) console.log(hit.text);
}

// 3. synthesize — wake up the original agent
if (resumeSession) {
  const { answer, timed_out } = await ask(resumeSession, 'where is the LaTeX file?');
  if (!timed_out) console.log(answer);
}
```

---

## 🧠 The mental model

Think of memory not as a database but as a **fleet of dormant coworkers**.

Each past session is one coworker. They kept detailed notes while they were working — the full transcript, every file they touched, every decision they made. They went home at the end of the day.

When you want to know something, you don't try to rebuild their knowledge from scratch by reading their notes. Either:

- **You read their notes directly** — that's `memto messages`. Fast, free, but you have to scan.
- **You tap one on the shoulder** — that's `memto ask`. *"Hey, quick question."* They wake up, answer from the full context already in their head, then go back to sleep.

The *"tap on the shoulder"* is called **fork-resume** — we clone their session state just enough to run the question, get the answer, and discard the clone. The original session file is never modified.

---

## 🎯 Why not Mem0 / Letta / Zep?

| | **memto** | Mem0 / Zep | Letta |
|---|---|---|---|
| Unit of memory | **whole past session, queryable live** | extracted facts in a vector DB | hierarchical summary tiers in one agent |
| Cross-runtime | ✅ 4 runtimes, 1 interface | ❌ app-specific | ❌ per-agent |
| Non-destructive read | ✅ fork-safe | n/a | ✅ internal only |
| External dependencies | **0** — just node | ChromaDB etc. | Postgres / SQLite |
| First-time cost | none — indexes what your CLIs already wrote | re-ETL every conversation | re-architect your agent |
| Best for | **the super-individual running 5+ AI tabs** | single-app long-term memory | single-agent role-played memory |

The fundamental divide: everything on the right takes your agent conversations, **extracts** structured claims from them, and stores those claims elsewhere. `memto` doesn't extract. The raw session IS the memory — you just wake it up and ask.

---

## 📦 What's in the box

```
memto/
├── packages/
│   ├── cli/                ← the `memto` binary
│   └── session-core/       ← universal adapter + fork/ask orchestration
│       └── src/
│           ├── types.ts
│           ├── jsonl.ts      ← streaming JSONL reader
│           ├── sqlite.ts     ← bun:sqlite / better-sqlite3 shim
│           ├── derive.ts     ← title / prompt / sampling helpers
│           ├── resume.ts     ← ask() orchestrator per runtime
│           └── adapters/
│               ├── claude-code.ts
│               ├── codex.ts
│               ├── hermes.ts
│               └── openclaw.ts
├── skills/
│   └── memto.md          ← standard-format skill; drop into your agent's skills/
├── examples/
└── assets/
```

---

## 🛣 Roadmap

- **v0.4** — Cursor / Windsurf / Zed adapters · live file-watch indexing · richer summary hooks
- **v0.5** — cross-device encrypted sync · per-session privacy tags
- **v0.6** — team-shared memory (opt-in sharing of specific sessions between people) · simple web dashboard

File an issue if one of these matters to you, or open a PR.

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: each adapter is ~200 lines, tests use synthetic fixtures, PRs welcome.

---

## 📜 License

[MIT](./LICENSE)

<p align="center">
  <br/>
  <sub>Built for the super-individual running five AI tabs at once.</sub><br/>
  <sub>🎞️ every session becomes a polaroid you can ask questions of.</sub>
</p>
