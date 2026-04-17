/**
 * Streaming JSONL reader. Lazily parses each line and yields the object,
 * skipping malformed lines silently (session files occasionally have
 * partial trailing lines from a killed process).
 */
export async function* readJsonl(path: string): AsyncGenerator<any, void, void> {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) break;
    let nl: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard loop
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // malformed line — skip
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
