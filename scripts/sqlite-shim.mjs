// Node-runtime stub for bun:sqlite. The hermes adapter uses SQLite; when the
// CLI runs under plain node via `npx memto-cli`, the adapter simply reports
// hermes as unavailable instead of crashing on import.
export class Database {
  constructor() {
    throw new Error(
      '[memto] hermes adapter requires bun:sqlite. Install bun (bun.sh) and run with `bunx memto` to use the hermes runtime.',
    );
  }
}
export default { Database };
