import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeliveryManifestEntry } from '../../core/types.js';
import { isPathContained } from '../../workspace/resolver.js';
import { isProtectedPath } from '../../workspace/protected.js';
import { scanForSecrets } from '../dlpscan.js';
import { runGit } from './runner.js';
import { runGitWithIndex } from './runner.js';

/** Normalize a commit message deterministically for hash binding. */
export function normalizeCommitMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed;
}

/** Canonical commit-message hash using the gate47-message-v1 prefix. */
export function hashCommitMessage(normalizedMessage: string): string {
  const value = Buffer.from(normalizedMessage, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return createHash('sha256').update('gate47-message-v1\0').update(length).update(value).digest('hex');
}

/** Length framing prevents distinct entry sequences from sharing an encoding. */
export function manifestHash(entries: DeliveryManifestEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    for (const field of ['gate47-manifest-v1', entry.path, entry.kind, entry.sha256 ?? '']) {
      const value = Buffer.from(field, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(value.length);
      hash.update(length); hash.update(value);
    }
  }
  return hash.digest('hex');
}

/** Parse porcelain -z without relying on shell quoting. Renames/copies are refused. */
export async function currentBaseCommit(cwd: string): Promise<string | null> {
  const result = await runGit({ subcommand: 'rev-parse', args: ['HEAD'], cwd });
  const value = result.stdout.trim();
  return result.ok && /^[0-9a-f]{40,64}$/.test(value) ? value : null;
}

/** Parse porcelain -z without relying on shell quoting. Renames/copies are refused. */
export async function currentManifest(cwd: string): Promise<{ manifest: DeliveryManifestEntry[]; fingerprint: string } | { error: string }> {
  const result = await runGit({ subcommand: 'status', args: ['--porcelain=v1', '-z', '--untracked-files=all'], cwd });
  if (!result.ok) return { error: `git status failed: ${result.stderr}` };
  const entries: DeliveryManifestEntry[] = [];
  for (const token of result.stdout.split('\0')) {
    if (!token) continue;
    if (token.length < 4) return { error: 'malformed git status entry' };
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (xy.includes('R') || xy.includes('C')) return { error: 'rename_or_copy_not_supported' };
    if (!path || path.includes('\0')) return { error: 'invalid manifest path' };
    const canonical = resolve(cwd, path);
    const contained = isPathContained(canonical, cwd);
    const relative = contained.relative?.replace(/\\/g, '/');
    if (!contained.ok || !relative || isProtectedPath(relative)) return { error: `invalid manifest path: ${path}` };
    const kind: DeliveryManifestEntry['kind'] = xy.includes('D') ? 'D' : xy === '??' ? 'A' : 'M';
    let sha256: string | null = null;
    if (kind !== 'D') {
      try {
        const content = readFileSync(canonical);
        const dlp = scanForSecrets(content.toString('utf8'));
        if (!dlp.clean) return { error: `DLP violation in ${relative}: ${dlp.reason}` };
        sha256 = createHash('sha256').update(content).digest('hex');
      } catch {
        return { error: `cannot read manifest file ${relative}` };
      }
    }
    entries.push({ path: relative, kind, sha256 });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  if (!entries.length) return { error: 'no changes to commit' };
  const fingerprint = manifestHash(entries);
  return { manifest: entries, fingerprint };
}

/** Same manifest comparison. */
export function sameManifest(a: DeliveryManifestEntry[], b: DeliveryManifestEntry[]): boolean {
  return manifestHash(a) === manifestHash(b);
}

/** Write a prepared tree from a base commit and manifest, returning the Git tree SHA. */
export async function writePreparedTree(cwd: string, baseCommit: string, manifest: DeliveryManifestEntry[], indexFile: string): Promise<string | null> {
  const seed = await runGitWithIndex('read-tree', [baseCommit], cwd, indexFile);
  if (!seed.ok) return null;
  const stage = await runGitWithIndex('add', ['-A', '--', ...manifest.map((entry) => entry.path)], cwd, indexFile);
  if (!stage.ok) return null;
  const tree = await runGitWithIndex('write-tree', [], cwd, indexFile);
  const value = tree.stdout.trim();
  return tree.ok && /^[0-9a-f]{40,64}$/.test(value) ? value : null;
}
