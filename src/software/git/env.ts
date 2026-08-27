// CHEF FACTORY — Gate 36 V1 — Git child process environment builder.
// Explicit allowlist model extending Gate 35B with Git-specific blocks.
// ALL GIT_* dangerous variables stripped. CHEF secrets never forwarded.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Variables safe to forward to child Git processes. */
const GIT_CHILD_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'OS',
  'NODE_ENV',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'COMSPEC',
  'PATHEXT',
  'LOCALAPPDATA',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'COMPUTERNAME',
  'SYSTEMDRIVE',
  'WINDIR',
  'APPDATA',
  'PROGRAMDATA',
];

/** Git-specific dangerous variables that must never be forwarded. */
const GIT_BLOCKED_VARS: readonly string[] = [
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_EXTERNAL_DIFF',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_MERGE_AUTOEDIT',
  'GIT_PAGER',
  'GIT_REFLOG_ACTION',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_SHALLOW_HOOKS',
  'GIT_OPTIONAL_LOCKS',
  'GIT_LFS_SKIP_SMUDGE',
];

/** CHEF secret prefixes — never forwarded. */
const CHEF_SECRET_PREFIXES: readonly string[] = [
  'FACTORY_',
  'OPENAI_',
  'ANTHROPIC_',
  'GOOGLE_',
  'SUPABASE_',
  'OPENCODE_',
];

/** CHEF secret names — never forwarded. */
const CHEF_SECRET_NAMES: readonly string[] = [
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'CI',
];

/**
 * Resolve a trusted empty global Git config file.
 * Created once at startup. Points GIT_CONFIG_GLOBAL to this file
 * so user/system global configs are never read by the child process.
 * The file is intentionally empty — no settings.
 */
let trustedGlobalConfigPath: string | null = null;

export function getTrustedGlobalConfigPath(): string {
  if (trustedGlobalConfigPath && existsSync(trustedGlobalConfigPath)) return trustedGlobalConfigPath;
  const dir = join(resolve(process.cwd()), '.chef-git-config');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  trustedGlobalConfigPath = join(dir, 'trusted-empty.gitconfig');
  if (!existsSync(trustedGlobalConfigPath)) {
    writeFileSync(trustedGlobalConfigPath, '# CHEF FACTORY trusted empty global git config\n');
  }
  return trustedGlobalConfigPath;
}

/**
 * Build a sanitized child process environment for Git operations.
 * Only allowlisted non-secret variables are included.
 * All GIT_* dangerous variables are stripped.
 * GIT_CONFIG_GLOBAL → trusted empty file (not user's real config).
 * GIT_CONFIG_NOSYSTEM=1 → system config disabled.
 */
export function buildGitChildEnv(currentEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const childEnv: Record<string, string> = {};

  for (const key of GIT_CHILD_ENV_ALLOWLIST) {
    const value = currentEnv[key];
    if (value !== undefined && value !== '') {
      childEnv[key] = value;
    }
  }

  // Ensure NODE_ENV is set
  if (!childEnv['NODE_ENV']) {
    childEnv['NODE_ENV'] = 'development';
  }

  // Force GIT_CONFIG_NOSYSTEM to ignore system-level gitconfig
  childEnv['GIT_CONFIG_NOSYSTEM'] = '1';

  // Force GIT_CONFIG_GLOBAL to a trusted empty file
  // This overrides any user-level ~/.gitconfig — not by absence, but by construction
  childEnv['GIT_CONFIG_GLOBAL'] = getTrustedGlobalConfigPath();

  // Force GIT_TERMINAL_PROMPT=0 to prevent interactive credential prompts
  childEnv['GIT_TERMINAL_PROMPT'] = '0';

  // Force GIT_EDITOR to a no-op to prevent editor launch
  childEnv['GIT_EDITOR'] = 'true';

  return childEnv;
}

/**
 * Check whether a variable name is blocked (secret/sensitive or Git-dangerous).
 */
export function isGitBlockedVariable(name: string): boolean {
  const upper = name.toUpperCase();

  // Always block GIT_* vars
  if (upper.startsWith('GIT_')) return true;

  // Block SSH_ASKPASS
  if (upper === 'SSH_ASKPASS') return true;

  // Block CHEF secret names
  if (CHEF_SECRET_NAMES.includes(upper)) return true;

  // Block CHEF secret prefixes
  for (const prefix of CHEF_SECRET_PREFIXES) {
    if (upper.startsWith(prefix)) return true;
  }

  // Block generic secret patterns
  if (upper.includes('PASSWORD') || upper.includes('SECRET') || upper.includes('TOKEN') || upper.includes('KEY')) {
    return true;
  }

  return false;
}

export { GIT_CHILD_ENV_ALLOWLIST, GIT_BLOCKED_VARS, CHEF_SECRET_PREFIXES, CHEF_SECRET_NAMES };
