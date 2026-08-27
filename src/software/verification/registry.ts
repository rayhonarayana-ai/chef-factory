// CHEF FACTORY — Gate 35B — Trusted verification profile registry.
// Maps operation enum → trusted executable + args. Resolved server-side only.
// Repository content (package.json) is NOT used as security policy.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { VerificationOperation, VerificationProfile } from './types.js';
import { VERIFICATION_CONSTANTS } from './types.js';

/**
 * Build trusted verification profiles for a given workspace root.
 * Executables are resolved from node_modules — NOT from PATH, NOT from npm scripts.
 * shell=false is enforced by the runner, not by this registry.
 */
export function buildVerificationProfiles(workspaceRoot: string): Map<VerificationOperation, VerificationProfile> {
  const nodeExe = process.execPath;
  const vitestEntrypoint = resolve(workspaceRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const tscEntrypoint = resolve(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  const profiles = new Map<VerificationOperation, VerificationProfile>();

  profiles.set('test', {
    operation: 'test',
    description: 'Run project tests via Vitest',
    executable: nodeExe,
    script: vitestEntrypoint,
    args: ['run'],
    timeoutMs: VERIFICATION_CONSTANTS.DEFAULT_TIMEOUT_MS,
    cwdSource: 'workspace_root',
  });

  profiles.set('typecheck', {
    operation: 'typecheck',
    description: 'Run TypeScript type checking',
    executable: nodeExe,
    script: tscEntrypoint,
    args: ['--noEmit'],
    timeoutMs: VERIFICATION_CONSTANTS.DEFAULT_TIMEOUT_MS,
    cwdSource: 'workspace_root',
  });

  profiles.set('build', {
    operation: 'build',
    description: 'Run TypeScript build',
    executable: nodeExe,
    script: tscEntrypoint,
    args: ['-p', 'tsconfig.build.json'],
    timeoutMs: VERIFICATION_CONSTANTS.MAX_TIMEOUT_MS,
    cwdSource: 'workspace_root',
  });

  return profiles;
}

/**
 * Validate that a profile's script file exists on disk.
 * Returns true if the trusted executable and script are present.
 */
export function validateProfile(profile: VerificationProfile): { ok: boolean; error?: string } {
  if (!existsSync(profile.executable)) {
    return { ok: false, error: `trusted executable not found: ${profile.executable}` };
  }
  if (!existsSync(profile.script)) {
    return { ok: false, error: `verification tool not installed: ${profile.script}` };
  }
  return { ok: true };
}
