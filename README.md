<p align="center">
  <img src="./assets/banner.svg" alt="memento — memory for your fleet of AI coding agents" width="100%"/>
</p>

<h1 align="center">memento 🎞️</h1>

<p align="center">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-f5b94c?style=flat-square"/></a>
  <img alt="Bun" src="https://img.shields.io/badge/runtime-bun%20%3E%3D1.2-f4ede0?style=flat-square"/>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-5e9bff?style=flat-square"/>
  <img alt="Tests" src="https://img.shields.io/badge/tests-64%20passing-7bd88f?style=flat-square"/>
  <img alt="Runtimes" src="https://img.shields.io/badge/runtimes-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Hermes%20%C2%B7%20OpenClaw-d9893a?style=flat-square"/>
  <img alt="MCP" src="https://img.shields.io/badge/MCP-stdio%20server-b68cf5?style=flat-square"/>
</p>

<p align="center">
  <b>Your AI coding agents all have their own memory. You have none.</b>
</p>

<p align="center">
  <code>memento</code> turns every past session across <b>Claude Code, Codex, Hermes, and OpenClaw</b><br/>
  into a queryable expert you can <b>wake up and ask</b>.
</p>

<p align="center">
  <i>Like the movie — every past AI session is a polaroid you can hold up and ask questions of.<br/>Because your agents remember, and you don't.</i>
</p>

---

## 🎬 The problem

If you run one Claude Code tab at a time, you don't need this.

If you run five — one editing your résumé, one grinding on your startup, one debugging a customer issue, one doing research, one filing your taxes — then today the answer to *"where is the LaTeX file for my résumé?"* lives in exactly **one** agent's head.

The other four have no idea. You, the human, are the only thing connecting them, and your short-term memory is the bottleneck.

`memento` fixes this. Every past session becomes an **askable expert**. When you need something, you (or more often, the agent you're currently talking to) lists the fleet, picks the one who knows, forks it non-destructively, asks a question, and gets an answer grounded in the full context that original session built up.

> **No RAG. No embeddings. No extracted "facts" that lose all their nuance. Memory is the original agent, woken up.**

---

## ✨ Features

| | |
|---|---|
| 🎞️ **4 runtimes, one view** | Claude Code, Codex, Hermes, and OpenClaw — all normalized into the same `NormalizedSession` shape. One API reads them all. |
| 🌱 **Non-destructive by default** | Every `ask` forks the target session. The original is never mutated. Fork artifacts are cleaned up automatically. |
| ⚡ **Under 1 second to scan everything** | ~440 MB/s over your entire `~/.claude`, `~/.codex`, `~/.hermes`, `~/.openclaw`. 68 sessions × 442 MB = 1 second wall-clock. |
| 🎛 **Configurable prompt sampling** | 7 strategies (`evenly-spaced` / `first-n` / `last-n` / `head-and-tail` / `every-nth` / `all` / `none`) for `sampled_user_prompts`. |
| 🔌 **Zero-dep MCP server** | `@memento/memory-mcp` is ~250 lines of vanilla TypeScript. Wire it into any MCP client — Claude Code, Cursor, Zed, Codex, your own. |
| ⏱ **Auto-scaled timeouts** | 120s floor + 1s per MB of transcript. 60 MB Claude sessions no longer come back empty from premature kill. |
| 🕵️ **System-prompt filtering** | `<environment_context>`, `Sender (untrusted metadata):`, Claude slash-command blobs — stripped so `first_user_prompt` is what the human actually typed. |
| 🧪 **64 tests, 0 flakes** | Every adapter has synthetic-fixture tests. End-to-end verified against real local stores. |

---

## 🏃 Quickstart

```bash
git clone https://github.com/shizhigu/memento
cd memento
bun install
bun test
```

### See everything your agents have been working on

```bash
bun run examples/list-all.ts --limit 10
```

```text
[claude-code] 2026-04-17  glancequote-ui-ux-redesign
  cwd:   ~/Projects/glance-quote
  first: use DESIGN.md for UI work — Stripe-style palette…
  id:    93429b4d-88af-4848-bb7e-69909efce266

[codex     ] 2026-04-16  Fix parser bug
  cwd:   ~/Projects/za-open
  first: find me the bug in parser.ts

[hermes    ] 2026-04-16  Review this résumé from an AI hiring-manager perspective
  first: Review this résumé from an AI hiring-manager perspective…

[openclaw  ] 2026-03-12  deploy the site
  first: deploy the site
```

### Ask a past session a follow-up question

```bash
bun run examples/ask-agents.ts "résumé" \
  --question "In one short sentence, where is the LaTeX file on disk?"
```

```text
found 4 matching session(s). asking top 3 in parallel.

━━━ [claude-code] 帮我看看我的 ai-startup 简历… ━━━
  /Users/you/Desktop/resume/resume/new_resume/startup_ai_resume.tex

━━━ [hermes] Review this résumé… ━━━
  /Users/you/Desktop/resume/resume/new_resume/main.tex
```

That file path was only known to the session that originally wrote it. The agent running the demo had never seen it.

---

## 🧩 Architecture

<p align="center">
  <img src="./assets/architecture.svg" alt="memento architecture" width="100%"/>
</p>

Four native storage formats, one normalized interface. Four fork strategies, one `ask()` call:

| Runtime | Storage | Native fork? | `memento` strategy |
|---|---|---|---|
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | ✅ `--fork-session` | native + automatic artifact cleanup |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | interactive only | `cp` + patch `session_meta.payload.id` |
| **Hermes** | `~/.hermes/state.db` (SQLite + FTS5) | ❌ | `INSERT … SELECT` with `parent_session_id` |
| **OpenClaw** | `~/.openclaw/agents/*/sessions/*.jsonl` | ❌ | `cp` + patch line-0 `id` |

---

## 🔌 Use it as an MCP server

Add this to your MCP client config. For Claude Code, `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memento": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/memento/packages/memory-mcp/src/index.ts"]
    }
  }
}
```

Restart the client. You'll get two new tools:

- **`mcp__memento__list_agents`** — list recent sessions across every installed runtime, with titles, cwds, sampled user prompts, last assistant reply, size, timestamps.
- **`mcp__memento__ask_agents`** — fork one or more sessions and ask a question in parallel. Returns each answer.

That's the whole surface. No config server, no cloud, no account.

---

## 📚 Use it as a library

```ts
import { listAllSessions, ask } from '@memento/session-core';

// 1. enumerate
const sessions = await listAllSessions({
  limitPerRuntime: 20,
  sampling: { strategy: 'head-and-tail', head: 2, tail: 2 },
});

// 2. pick
const resume = sessions.find((s) =>
  s.sampled_user_prompts?.some((p) => p.includes('résumé')),
);

// 3. ask
if (resume) {
  const { answer, timed_out } = await ask(resume, 'where is the LaTeX file?');
  if (!timed_out) console.log(answer);
}
```

---

## 🧠 The mental model

Think of memory not as a database but as a **fleet of dormant coworkers**.

Each past session is one coworker. They kept detailed notes while they were working — the full transcript, every file they touched, every decision they made. They went home at the end of the day.

When you want to know something, you don't try to rebuild their knowledge from scratch by reading their notes. You tap one on the shoulder, say *"hey, quick question,"* and they answer from the full context already in their head. Then they go back to sleep.

That's `ask_agents`. The *"tap on the shoulder"* is called **fork-resume** — we clone their session state just enough to run the question, get the answer, and discard the clone. The original session file is never modified.

---

## 🎯 Why not just use Mem0 / Letta / Zep?

| | **memento** | Mem0 | Letta (MemGPT) | Zep |
|---|---|---|---|---|
| Unit of memory | **whole past session, queryable live** | extracted facts in a vector DB | hierarchical summary tiers in one agent | facts + knowledge graph |
| Cross-runtime | ✅ Claude + Codex + Hermes + OpenClaw | ❌ app-specific | ❌ per-agent | ❌ app-specific |
| Fork / non-destructive read | ✅ all four runtimes | n/a | ✅ internal only | n/a |
| External dependencies | **0** (besides Bun + optional MCP client) | ChromaDB etc. | Postgres / SQLite | Postgres / Elastic |
| First-time cost | none — indexes whatever your CLIs already wrote | re-ETL every conversation | re-architect your agent | re-ETL every conversation |

The fundamental difference: every memory layer on the right takes your agent conversations, **extracts** "facts" from them, and stores those facts elsewhere. `memento` doesn't extract anything. The agent session IS the memory.

---

## 📦 What's in the box

```
memento/
├── packages/
│   ├── session-core/     ← the universal adapter + fork/ask orchestration
│   │   └── src/
│   │       ├── types.ts
│   │       ├── jsonl.ts      ← streaming JSONL reader
│   │       ├── derive.ts     ← title / prompt / sampling helpers
│   │       ├── resume.ts     ← ask() orchestrator per runtime
│   │       ├── index.ts
│   │       └── adapters/
│   │           ├── claude-code.ts
│   │           ├── codex.ts
│   │           ├── hermes.ts    (SQLite)
│   │           └── openclaw.ts
│   └── memory-mcp/       ← zero-dep MCP stdio server (list_agents + ask_agents)
├── examples/
│   ├── list-all.ts
│   └── ask-agents.ts
└── assets/
    ├── banner.svg
    └── architecture.svg
```

---

## 🛣 Roadmap

- **v0.2** — Cursor / Windsurf / Zed adapters · live file-watch indexing · richer summary hooks
- **v0.3** — cross-device encrypted sync · per-session privacy tags
- **v0.4** — team-shared memory (opt-in sharing of specific sessions between people) · simple web dashboard

File an issue if one of these matters to you, or open a PR.

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The TL;DR: each adapter is ~200 lines, tests use synthetic fixtures, PRs welcome.

---

## 📜 License

[MIT](./LICENSE)

<p align="center">
  <br/>
  <sub>Built for the super-individual running ten Claude Codes at once.</sub><br/>
  <sub>🎞️ every session becomes a polaroid you can ask questions of.</sub>
</p>
