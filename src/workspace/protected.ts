// CHEF FACTORY — Gate 35A — Protected path policy.
// Hard DENY agent access to sensitive files regardless of workspace location.
// Protected content must not enter Agent context — denied before read, not redacted after.

import { basename, extname, join, sep } from 'node:path';

const PROTECTED_BASENAMES = new Set([
  '.env',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'credentials.json',
  'service-account.json',
  '.credentials',
]);

const PROTECTED_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.env',
  '.token',
  '.secret',
  '.keystore',
]);

const PROTECTED_GIT_PATHS = new Set([
  join('.git', 'config'),
  join('.git', 'credentials'),
  join('.git', 'hooks'),
  join('.git', 'COMMIT_EDITMSG'),
]);

const PROTECTED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
]);

function matchesProtectedBasename(name: string): boolean {
  const lower = name.toLowerCase();
  if (PROTECTED_BASENAMES.has(lower)) return true;
  if (lower.startsWith('.env')) return true;
  if (lower.endsWith('.pem') || lower.endsWith('.key')) return true;
  if (lower.includes('credential') || lower.includes('service-account')) return true;
  if (lower.includes('token') && extname(lower) === '') return true;
  return false;
}

export function isProtectedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) return false;

  const name = parts[parts.length - 1]!;

  if (PROTECTED_BASENAMES.has(name)) return true;
  if (matchesProtectedBasename(name)) return true;
  if (PROTECTED_EXTENSIONS.has(extname(name).toLowerCase())) return true;

  if (parts.length >= 2) {
    const gitPath = parts.slice(0, 2).join('/');
    if (gitPath === '.git') {
      if (parts.length === 2) return true;
      const gitInternal = parts.slice(1).join('/');
      for (const p of PROTECTED_GIT_PATHS) {
        if (gitInternal === p.replace(/\\/g, '/')) return true;
      }
      if (parts[2] === 'config' || parts[2] === 'credentials' || parts[2] === 'hooks') return true;
    }
  }

  for (const part of parts) {
    if (PROTECTED_DIR_NAMES.has(part.toLowerCase())) return true;
  }

  return false;
}

export function isProtectedDirectory(dirName: string): boolean {
  return PROTECTED_DIR_NAMES.has(dirName.toLowerCase());
}

export { PROTECTED_EXTENSIONS, PROTECTED_BASENAMES };
