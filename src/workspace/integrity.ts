// CHEF FACTORY — Gate 46 — Workspace Integrity Service.
//
// Deterministic, GIT-INDEPENDENT source manifest hashing for binding verification
// to workspace state (VERIFICATION_TO_WORKSPACE_STATE_BINDING).
//
// The trusted acceptance gate uses this to assert:
//
//   FINGERPRINT_BEFORE == FINGERPRINT_AFTER
//
// (the workspace did not change while verification ran), and the same fingerprinter
// is re-run at the completion boundary to close the final post-hash -> completion
// interval.
//
// Security invariants (frozen semantics):
//   - Workspace ROOT is derived from trusted infrastructure, never from the model or
//     agent. MODEL/AGENT_CAN_SUPPLY_WORKSPACE_HASH = NO.
//   - Protected / secret paths are NEVER opened merely for hashing (structural deny
//     at walk time).
//   - Symlink/junction content is NOT followed; external escapes FAIL CLOSED.
//   - Bounded: any bound breach fails closed (NO_PARTIAL_FINGERPRINT = TRUE).
//   - Git-independent core: does NOT require git ls-files/hash-object/write-tree/
//     status for correctness.
//   - Deterministic canonical manifest paths (relative, "/" separators, NFC unicode,
//     no blind lowercasing) with explicit length-framed aggregation (no
//     concatenation ambiguity). Canonical collision -> FAIL CLOSED.

import { createHash } from 'node:crypto';
import { lstat, readdir, open } from 'node:fs/promises';
import { realpathSync, readlinkSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { isPathContained } from './resolver.js';
import { isProtectedPath, isProtectedDirectory } from './protected.js';

// ---------- Manifest bounds (conservative; justified by workspace/read limits) ----------
// MAX_FILE_READ_SIZE is 100KB per tool read; a fingerprint must bound the aggregate
// trusted source set without unbounded memory/traversal. Values cover expected
// enterprise projects while keeping a hard cap.
export const MANIFEST_BOUNDS = {
  /** Absolute maximum number of trusted source entries in one manifest. */
  MAX_MANIFEST_FILES: 20_000,
  /** Absolute maximum aggregate byte total across all hashed file contents. */
  MAX_MANIFEST_TOTAL_BYTES: 200 * 1024 * 1024, // 200MB
  /** Per-file content cap (a single source file larger than this fails closed). */
  MAX_MANIFEST_FILE_BYTES: 200 * 1024 * 1024, // 200MB
} as const;

export interface WorkspaceFingerprint {
  algorithm: 'sha256';
  /** hex SHA-256 of the deterministic length-framed manifest. */
  fingerprint: string;
  fileCount: number;
  totalBytes: number;
}

export type FingerprintFailureReason =
  | 'unresolvable'
  | 'bound_files_exceeded'
  | 'bound_total_bytes_exceeded'
  | 'bound_file_bytes_exceeded'
  | 'collision'
  | 'escaped_symlink'
  | 'read_error';

export type FingerprintResult =
  | { ok: true; value: WorkspaceFingerprint }
  | { ok: false; reason: FingerprintFailureReason; detail: string };

interface ManifestEntry {
  /** canonical normalized relative path (forward slashes, NFC). */
  path: string;
  /** 'file' → content digest; 'link' → normalized contained target (never followed). */
  kind: 'file' | 'link';
  payload: string;
}

/**
 * Canonicalize a workspace-relative path for deterministic cross-platform hashing:
 *   - normalized "/" separators, relative to workspace root
 *   - NFC unicode normalized
 *   - NOT lowercased (must not collapse distinct paths on case-sensitive filesystems)
 */
export function canonicalManifestPath(relativePath: string): string {
  let p = relativePath.replace(/\\/g, '/');
  const parts = p.split('/').filter((seg) => seg !== '' && seg !== '.');
  return parts.join('/').normalize('NFC');
}

/** Canonicalize the trusted root once. A missing root cannot be fingerprinted. */
function canonicalRoot(workspaceRoot: string): string | null {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return null;
  }
}

/**
 * Transient / generated / log / temp artifacts excluded from the trusted manifest
 * (directive §7: exclude logs, temporary files, generated transient outputs). These
 * are NOT authoritative software source. The workspace atomic-writer temp prefix is
 * `.chef-tmp-*`.
 */
export function isTransientPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop() ?? '';
  if (name.startsWith('.chef-tmp-')) return true;
  if (name.endsWith('.log')) return true;
  if (name.endsWith('.tmp')) return true;
  if (name === '.DS_Store' || name === 'Thumbs.db') return true;
  return false;
}

export type ManifestBounds = typeof MANIFEST_BOUNDS;

/**
 * Compute the trusted workspace fingerprint over the authoritative software source
 * set. Any bound/collision/escape breach FAILS CLOSED (NO_PARTIAL_FINGERPRINT).
 *
 * @param workspaceRoot a trusted (passport-derived) workspace root.
 * @param bounds optional bounds override (tests pass tiny bounds; production uses
 *        the conservative MANIFEST_BOUNDS defaults).
 */
export async function fingerprintWorkspace(
  workspaceRoot: string,
  bounds: ManifestBounds = MANIFEST_BOUNDS,
): Promise<FingerprintResult> {
  const root = canonicalRoot(workspaceRoot);
  if (!root) return { ok: false, reason: 'unresolvable', detail: 'workspace root unresolved' };

  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();
  let fileCount = 0;
  let totalBytes = 0;

  const record = (
    entry: ManifestEntry, size: number,
  ): FingerprintResult | null => {
    if (seen.has(entry.path)) {
      return { ok: false, reason: 'collision', detail: `colliding manifest path: ${entry.path}` };
    }
    seen.add(entry.path);
    entries.push(entry);
    fileCount += 1;
    totalBytes += size;
    if (fileCount > bounds.MAX_MANIFEST_FILES) {
      return { ok: false, reason: 'bound_files_exceeded', detail: `files=${fileCount}` };
    }
    if (totalBytes > bounds.MAX_MANIFEST_TOTAL_BYTES) {
      return { ok: false, reason: 'bound_total_bytes_exceeded', detail: `bytes=${totalBytes}` };
    }
    if (entry.kind === 'file' && size > bounds.MAX_MANIFEST_FILE_BYTES) {
      return { ok: false, reason: 'bound_file_bytes_exceeded', detail: `path=${entry.path} bytes=${size}` };
    }
    return null;
  };

  const walkDir = async (dirPath: string): Promise<FingerprintResult | null> => {
    let items: string[];
    try {
      items = await readdir(dirPath);
    } catch (e) {
      return { ok: false, reason: 'read_error', detail: `readdir ${dirPath}: ${String(e)}` };
    }
    // Deterministic order, independent of filesystem readdir order.
    items.sort();

    for (const item of items) {
      const fullPath = join(dirPath, item);
      const relPath = canonicalManifestPath(relative(root, fullPath));

      if (isProtectedPath(relPath)) continue;
      if (isTransientPath(relPath)) continue;

      let linkInfo;
      try {
        linkInfo = await lstat(fullPath);
      } catch (e) {
        return { ok: false, reason: 'read_error', detail: `lstat ${fullPath}: ${String(e)}` };
      }

      if (linkInfo.isSymbolicLink()) {
        // DO NOT follow content. Inspect safely; verify containment; represent the
        // safe link deterministically OR fail closed.
        let rawTarget: string;
        try {
          rawTarget = readlinkSync(fullPath);
        } catch (e) {
          return { ok: false, reason: 'read_error', detail: `readlink ${fullPath}: ${String(e)}` };
        }
        let resolved: string;
        try {
          resolved = isAbsolute(rawTarget)
            ? realpathSync(rawTarget)
            : realpathSync(join(dirPath, rawTarget));
        } catch (e) {
          return { ok: false, reason: 'read_error', detail: `resolve link ${relPath}: ${String(e)}` };
        }
        if (!isPathContained(resolved, root).ok) {
          return { ok: false, reason: 'escaped_symlink', detail: `symlink escapes workspace: ${relPath}` };
        }
        const err = record({ path: relPath, kind: 'link', payload: canonicalManifestPath(relative(root, resolved)) }, 0);
        if (err) return err;
        continue;
      }

      // A directory reparse point/junction is not always reported as a symbolic
      // link. Resolve every non-link entry before descending or reading so an
      // external target cannot be silently skipped or hashed.
      if (!isPathContained(fullPath, root).ok) {
        return { ok: false, reason: 'escaped_symlink', detail: `path escapes workspace: ${relPath}` };
      }

      if (linkInfo.isDirectory()) {
        if (isProtectedDirectory(relative(root, fullPath))) continue;
        const sub = await walkDir(fullPath);
        if (sub) return sub;
        continue;
      }

      if (!linkInfo.isFile()) continue;

      const err = record({ path: relPath, kind: 'file', payload: '' }, linkInfo.size);
      if (err) return err;
    }
    return null;
  };

  const walkErr = await walkDir(root);
  if (walkErr) return walkErr;

  // Deterministic sort before aggregate hashing.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const aggregate = createHash('sha256');
  let totalBytesHashed = 0;

  for (const entry of entries) {
    if (entry.kind === 'link') {
      // Represent the link deterministically WITHOUT reading any target content.
      const payload = `L:${entry.path}:${entry.payload}`;
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(Buffer.byteLength(payload, 'utf8'), 0);
      aggregate.update(lenBuf);
      aggregate.update(payload, 'utf8');
      continue;
    }

    const fullPath = join(root, ...entry.path.split('/'));
    let fd;
    try {
      fd = await open(fullPath, 'r');
      const digest = createHash('sha256');
      const stream = fd.createReadStream();
      let fileBytesHashed = 0;
      for await (const chunk of stream) {
        digest.update(chunk);
        fileBytesHashed += chunk.length;
        totalBytesHashed += chunk.length;
        // Re-enforce bounds during the read. A file can grow after the lstat
        // manifest pass; it must not turn into an unbounded/partial fingerprint.
        if (fileBytesHashed > bounds.MAX_MANIFEST_FILE_BYTES) {
          stream.destroy();
          await fd.close().catch(() => undefined);
          return { ok: false, reason: 'bound_file_bytes_exceeded', detail: `path=${entry.path} bytes=${fileBytesHashed}` };
        }
        if (totalBytesHashed > bounds.MAX_MANIFEST_TOTAL_BYTES) {
          stream.destroy();
          await fd.close().catch(() => undefined);
          return { ok: false, reason: 'bound_total_bytes_exceeded', detail: `bytes=${totalBytesHashed}` };
        }
      }
      const payload = `F:${entry.path}:${digest.digest('hex')}`;
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(Buffer.byteLength(payload, 'utf8'), 0);
      aggregate.update(lenBuf);
      aggregate.update(payload, 'utf8');
    } catch (e) {
      if (fd) await fd.close().catch(() => undefined);
      return { ok: false, reason: 'read_error', detail: `read ${entry.path}: ${String(e)}` };
    }
    if (fd) await fd.close().catch(() => undefined);
  }

  return {
    ok: true,
    value: {
      algorithm: 'sha256',
      fingerprint: aggregate.digest('hex'),
      fileCount: entries.length,
      totalBytes: totalBytesHashed,
    },
  };
}
