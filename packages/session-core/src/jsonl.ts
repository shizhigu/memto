import { createReadStream, existsSync } from 'node:fs';

/**
 * Streaming JSONL reader. Lazily parses each line and yields the object,
 * skipping malformed lines silently (session files occasionally have
 * partial trailing lines from a killed process). Uses node fs so the same
 * code runs under bun (fast) and under plain node (via `npx memto-cli`).
 */
export async function* readJsonl(path: string): AsyncGenerator<any, void, void> {
  if (!existsSync(path)) return;
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk;
    let nl: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard loop
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        /* skip malformed */
      }
    }
  }
  if (buf.trim()) {
    try {
      yield JSON.parse(buf);
    } catch {
      /* ignore */
    }
  }
}

/** Read all jsonl lines into an array. For small files / test fixtures. */
export async function readJsonlAll(path: string): Promise<any[]> {
  const out: any[] = [];
  for await (const d of readJsonl(path)) out.push(d);
  return out;
}
