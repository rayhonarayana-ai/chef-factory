// CHEF FACTORY — Gate 35A — Distributed file mutation coordination.
// PostgreSQL advisory locks (two-int4 API) for cross-process safety.
// Atomic writes via temp file + fsync + rename.
// CAS via SHA-256 content hash precondition.

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { DbQuery } from '../tools/types.js';

/**
 * Derive two signed int32 keys for PostgreSQL pg_advisory_lock(int4, int4).
 * Uses SHA-256 for uniform distribution. Both values are safe JavaScript integers.
 */
export function fileLockKeys(workspaceRoot: string, relativePath: string): [number, number] {
  const input = `${workspaceRoot}:${relativePath}`;
  const hash = createHash('sha256').update(input).digest();
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return [key1, key2];
}

/**
 * Gate 36 V2 — Derive repo-level advisory lock keys.
 * Scoped to workspace root only (not per-file).
 */
export function repoLockKeys(workspaceRoot: string): [number, number] {
  const input = `git-repo:${workspaceRoot}`;
  const hash = createHash('sha256').update(input).digest();
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return [key1, key2];
}

/**
 * Execute within the workspace-level advisory lock. This is the narrow
 * coordination primitive shared by Git actions, CHEF source mutations, and Gate46
 * final verification-to-completion binding. It MUST be acquired before any file
 * lock (canonical order: repo -> file).
 */
export async function withRepoLock<T>(
  poolOrDb: Pool | DbQuery,
  workspaceRoot: string,
  fn: (db: DbQuery) => Promise<T>,
): Promise<T> {
  const [key1, key2] = repoLockKeys(workspaceRoot);

  if ('connect' in poolOrDb && typeof poolOrDb.connect === 'function') {
    const pool = poolOrDb as Pool;
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
      try {
        return await fn({
          query: (sql: string, params?: unknown[]) => client.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>,
        });
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
      }
    } finally {
      client.release();
    }
  } else {
    const db = poolOrDb as DbQuery;
    await db.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
    try {
      return await fn(db);
    } finally {
      await db.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
    }
  }
}

/**
 * Compute SHA-256 content hash of a string.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Execute a function within a PostgreSQL advisory lock.
 * Uses a dedicated client for the full critical section.
 * Lock is session-level — released on explicit unlock or connection loss.
 */
export async function withFileLock<T>(
  poolOrDb: Pool | DbQuery,
  workspaceRoot: string,
  relativePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const [key1, key2] = fileLockKeys(workspaceRoot, relativePath);

  if ('connect' in poolOrDb && typeof poolOrDb.connect === 'function') {
    const pool = poolOrDb as Pool;
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
      }
    } finally {
      client.release();
    }
  } else {
    const db = poolOrDb as DbQuery;
    await db.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
    try {
      return await fn();
    } finally {
      await db.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
    }
  }
}

/**
 * Gate 36 V2 — Execute a function within a PostgreSQL advisory lock,
 * exposing the same Pool client to the callback for attribution queries.
 * The callback receives (client) so it can run attribution INSERTs/SELECTs
 * on the same connection that holds the lock.
 */
export async function withFileLockAndDb<T>(
  poolOrDb: Pool | DbQuery,
  workspaceRoot: string,
  relativePath: string,
  fn: (db: DbQuery) => Promise<T>,
): Promise<T> {
  const [key1, key2] = fileLockKeys(workspaceRoot, relativePath);

  if ('connect' in poolOrDb && typeof poolOrDb.connect === 'function') {
    const pool = poolOrDb as Pool;
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
      try {
        return await fn({
          query: (sql: string, params?: unknown[]) => client.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>,
        });
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
      }
    } finally {
      client.release();
    }
  } else {
    const db = poolOrDb as DbQuery;
    await db.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
    try {
      return await fn(db);
    } finally {
      await db.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
    }
  }
}

/**
 * Run a source mutation under the shared workspace coordination lock followed by
 * its existing path-specific lock. This preserves concurrent different-file work
 * except during Gate46's short final acceptance window.
 */
export async function withRepoAndFileLockAndDb<T>(
  poolOrDb: Pool | DbQuery,
  workspaceRoot: string,
  relativePath: string,
  fn: (db: DbQuery) => Promise<T>,
): Promise<T> {
  return withRepoLock(poolOrDb, workspaceRoot, async (db) =>
    withFileLockAndDb(db, workspaceRoot, relativePath, fn));
}

/**
 * Read file content. Returns null if file doesn't exist.
 */
export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Atomic replace: write to temp sibling, fsync, rename.
 * Returns the temp file path that was used.
 */
export async function atomicReplace(targetPath: string, content: string): Promise<void> {
  const dir = dirname(targetPath);
  const tempName = `.chef-tmp-${randomBytes(8).toString('hex')}`;
  const tempPath = join(dir, tempName);

  const fd = await open(tempPath, 'w');
  try {
    await fd.writeFile(content, 'utf8');
    await fd.sync();
  } finally {
    await fd.close();
  }

  try {
    await rename(tempPath, targetPath);
  } catch (e) {
    try { await unlink(tempPath); } catch { /* best effort cleanup */ }
    throw e;
  }
}

/**
 * Exclusive file creation using O_CREAT | O_EXCL semantics.
 * Fails atomically if file already exists.
 */
export async function exclusiveCreate(filePath: string, content: string): Promise<void> {
  const fd = await open(filePath, 'wx');
  try {
    await fd.writeFile(content, 'utf8');
    await fd.sync();
  } finally {
    await fd.close();
  }
}

/**
 * Verify a file exists and is readable.
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
