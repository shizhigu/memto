# Contributing

## Development

```bash
bun install
bun test
bun x tsc --noEmit
bun x biome check .
```

## Adding a new adapter

1. Create `packages/session-core/src/adapters/<runtime>.ts`.
2. Implement the `SessionAdapter` interface from `../types.ts`.
3. If the runtime doesn't ship native fork, add a branch in `packages/session-core/src/resume.ts` for non-destructive fork.
4. Add a `<runtime>.test.ts` with synthetic fixtures — do *not* rely on the contributor's real local data.
5. Register the adapter in `packages/session-core/src/index.ts`.

## Code style

- TypeScript strict mode.
- Use `bun:test` for all tests.
- Prefer small, pure helpers. The adapter files should be readable top-to-bottom in under a minute.
- Comments explain *why*, not *what*. If code is obvious, no comment needed.

## PR expectations

- Tests for new behavior.
- No `console.log` left over.
- `bun test` and `bun x tsc --noEmit` pass on your machine.
