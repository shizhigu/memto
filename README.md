# mneme

**Your AI coding agents all have their own memory. You have none.**

`mneme` is a tiny, opinionated layer that turns every past session across **Claude Code, Codex, Hermes, and OpenClaw** into a queryable expert you can wake up and ask.

It is the muscle memory your super-individual workflow has been missing.

---

## Why this exists

If you run one Claude Code tab at a time, you don't need this.

If you run five — one editing your resume, one grinding on your startup, one debugging a customer issue, one doing research, one filing your taxes — then today the answer to *"where is the LaTeX file for my resume?"* lives in exactly one agent's head. The other four have no idea. You, the human, are the only thing connecting them, and your short-term memory is the bottleneck.

`mneme` fixes this. Every past session becomes an **askable expert**. When you need something, you (or more often, the agent you're currently talking to) lists the fleet, picks the one who knows, forks it non-destructively, asks a question, and gets an answer grounded in the full context that original session built up.

No RAG. No embeddings. No extracted "facts" that lose all their nuance. Memory is the original agent, woken up.

---

## The 30-second demo

```bash
# list everything your agents have been working on
bun run examples/list-all.ts --limit 10

# find the session that knows about your resume and ask it a follow-up
bun run examples/ask-agents.ts "resume" --question "where is the LaTeX file?"
# => /Users/you/Desktop/resume/resume/new_resume/startup_ai_resume.tex
```

That file path was only known to the "resume editor" agent session. The agent you ran the demo from had never seen it. `mneme` woke up a fork of that session, asked it the question, and brought back the answer.

---

## What's in the box

This is a Bun monorepo with two packages:

| package | what it is |
|---|---|
| **`@mneme/session-core`** | Universal adapter library. Reads sessions from all four supported runtimes and normalizes them into a common shape. Also handles non-destructive fork + resume. |
| **`@mneme/memory-mcp`** | Zero-dependency MCP server exposing two tools — `list_agents` and `ask_agents` — to any MCP client (Claude Code, Codex, Cursor, Zed, etc). |

And four runtime adapters, each a hundred-ish lines:

| runtime | storage | native fork? | mneme strategy |
|---|---|---|---|
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | ✅ `--fork-session` | native |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | interactive-only | cp + patch `session_meta.payload.id` |
| **Hermes** | `~/.hermes/state.db` (SQLite + FTS5) | ❌ | `INSERT … SELECT` to a new id |
| **OpenClaw** | `~/.openclaw/agents/*/sessions/*.jsonl` | ❌ | cp + patch line-0 `id` |

Every fork path is **fully verified** end-to-end — `ask()` is the same call regardless of which runtime owns the target session.

---

## Install

You need Bun ≥ 1.2.

```bash
git clone https://github.com/yourname/mneme
cd mneme
bun install
bun test
```

### As an MCP server (the point of the project)

Wire `mneme-mcp` up in your MCP client config. For Claude Code in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "mneme": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/mneme/packages/memory-mcp/src/index.ts"]
    }
  }
}
```

Restart Claude Code and you'll have two new tools: `mcp__mneme__list_agents` and `mcp__mneme__ask_agents`.

### As a library

```ts
import { listAllSessions, ask } from '@mneme/session-core';

const sessions = await listAllSessions({ limitPerRuntime: 20 });
const resumeSession = sessions.find((s) => s.title?.includes('resume'));

if (resumeSession) {
  const { answer } = await ask(resumeSession, 'where is the LaTeX file?');
  console.log(answer);
}
```

---

## The mental model

Think of memory not as a database but as a **fleet of dormant coworkers**.

Each past session is one coworker. They kept detailed notes while they were working — the full transcript, every file they touched, every decision they made. They went home at the end of the day.

When you want to know something, you don't try to rebuild their knowledge from scratch by reading their notes. You tap one on the shoulder, say "hey, quick question," and they answer from the full context already in their head. Then they go back to sleep.

That's `ask_agents`. The *"tap on the shoulder"* is called **fork-resume** — we clone their session state just enough to run the question, get the answer, and discard the clone. The original session file is never modified.

---

## Status

Alpha. The core paths are tested with both synthetic fixtures (38 adapter / derive / jsonl tests) and real end-to-end fork-and-ask runs on all four runtimes. The MCP server has smoke tests over the stdio protocol.

What's NOT here yet:

- Cloud sync across devices
- Team-shared memory
- Auto-labeling (better summaries)
- VSCode / Cursor / Zed extension UI
- Any form of auth or permission scoping

What this is _not_:

- A vector database
- A RAG pipeline
- A replacement for your agents
- Trying to compete with Anthropic's Managed Agents Memory

It's a small sharp hammer for the specific pain of running many agents at once.

---

## Comparison with existing memory layers

| | mneme | Mem0 | Letta (MemGPT) | Zep |
|---|---|---|---|---|
| Unit of memory | **whole past session, queryable live** | extracted facts in vector DB | hierarchical summary tiers in one agent | facts + knowledge graph |
| Cross-runtime | ✅ Claude + Codex + Hermes + OpenClaw | ❌ app-specific | ❌ per-agent | ❌ app-specific |
| Fork / non-destructive read | ✅ all four | n/a | ✅ internal | n/a |
| External dependencies | **0** (besides Bun + optional MCP client) | ChromaDB / etc. | Postgres / SQLite | Postgres / Elastic |
| First-time cost | none — indexes whatever your CLIs already wrote | re-ETL every convo | re-architect your agent | re-ETL every convo |

The fundamental difference: every memory layer on the right takes your agent conversations, extracts "facts" from them, and stores those facts elsewhere. `mneme` doesn't extract anything. The agent session IS the memory.

---

## Contributing

1. Fork + clone
2. `bun install && bun test`
3. Add your adapter under `packages/session-core/src/adapters/`, add fixtures and tests, PR

Everything is TypeScript + Bun. No build step.

---

## License

[MIT](./LICENSE)
