/**
 * Runtime-agnostic SQLite shim.
 *
 * We need SQLite for the Hermes adapter. Bun ships `bun:sqlite` as a
 * builtin; plain Node doesn't have that, so there we rely on
 * `better-sqlite3` (auto-installed as a regular dep, prebuilt binaries
 * fetched by npm for the user's platform).
 *
 * The two libraries have almost-but-not-quite identical APIs. This
 * module exposes a tiny unified `Database` class with exactly the
 * surface our code uses (`query(sql).all/get`, `run(sql, args)`, `close()`).
 */

import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

type BunStmt = { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
type BetterStmt = {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
};
type BunDb = {
  query(sql: string): BunStmt;
  run(sql: string, args?: unknown[]): unknown;
  close(): void;
};
type BetterDb = {
  prepare(sql: string): BetterStmt;
  close(): void;
};
type BackendDb = BunDb | BetterDb;
type BackendCtor = new (path: string) => BackendDb;

let Ctor: BackendCtor | null = null;
let backend: 'bun:sqlite' | 'better-sqlite3' | null = null;

try {
  if (isBun) {
    Ctor = nodeRequire('bun:sqlite').Database as BackendCtor;
    backend = 'bun:sqlite';
  } else {
    Ctor = nodeRequire('better-sqlite3') as BackendCtor;
    backend = 'better-sqlite3';
  }
} catch {
  /* leave Ctor null — Database construction will throw a clearer message */
}

export function hasSqliteBackend(): boolean {
  return Ctor !== null;
}

export interface Stmt<R = unknown> {
  all(...args: unknown[]): R[];
  get(...args: unknown[]): R | undefined;
}

export class Database {
  private readonly db: BackendDb;

  constructor(path: string) {
    if (!Ctor) {
      throw new Error(
        '[memto] hermes adapter needs SQLite. Install `better-sqlite3` or run under bun.',
      );
    }
    this.db = new Ctor(path);
  }

  query<R = unknown>(sql: string): Stmt<R> {
    if (backend === 'bun:sqlite') {
      const s = (this.db as BunDb).query(sql);
      return {
        all: (...args: unknown[]) => s.all(...args) as R[],
        get: (...args: unknown[]) => s.get(...args) as R | undefined,
      };
    }
    const s = (this.db as BetterDb).prepare(sql);
    return {
      all: (...args: unknown[]) => s.all(...args) as R[],
      get: (...args: unknown[]) => s.get(...args) as R | undefined,
    };
  }

  run(sql: string, args: unknown[] = []): void {
    if (backend === 'bun:sqlite') {
      (this.db as BunDb).run(sql, args);
    } else {
      (this.db as BetterDb).prepare(sql).run(...args);
    }
  }

  close(): void {
    this.db.close();
  }
}
