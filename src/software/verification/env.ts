// CHEF FACTORY — Gate 35B — Child process environment allowlist.
// Explicit allowlist model: only non-secret system variables forwarded.
// FACTORY_*, OPENAI_*, ANTHROPIC_*, GOOGLE_*, SUPABASE_*, and all secrets are blocked.

/** Variables safe to forward to child verification processes. */
const CHILD_ENV_ALLOWLIST: readonly string[] = [
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

/** Prefixes that indicate secret/sensitive variables — never forwarded. */
const BLOCKED_PREFIXES: readonly string[] = [
  'FACTORY_',
  'OPENAI_',
  'ANTHROPIC_',
  'GOOGLE_',
  'SUPABASE_',
  'OPENCODE_',
];

/** Variable names that are never forwarded regardless of prefix. */
const BLOCKED_NAMES: readonly string[] = [
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'CI',
];

/**
 * Build a sanitized child process environment from the current process.env.
 * Only allowlisted non-secret variables are included.
 */
export function buildChildEnv(currentEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const childEnv: Record<string, string> = {};

  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = currentEnv[key];
    if (value !== undefined && value !== '') {
      childEnv[key] = value;
    }
  }

  // Ensure NODE_ENV is set for test configuration
  if (!childEnv['NODE_ENV']) {
    childEnv['NODE_ENV'] = 'development';
  }

  return childEnv;
}

/**
 * Check whether a variable name is blocked (secret/sensitive).
 * Used in tests to verify the allowlist is correct.
 */
export function isBlockedVariable(name: string): boolean {
  const upper = name.toUpperCase();
  if (BLOCKED_NAMES.includes(upper)) return true;
  for (const prefix of BLOCKED_PREFIXES) {
    if (upper.startsWith(prefix)) return true;
  }
  if (upper.includes('PASSWORD') || upper.includes('SECRET') || upper.includes('TOKEN') || upper.includes('KEY')) {
    return true;
  }
  return false;
}

export { CHILD_ENV_ALLOWLIST, BLOCKED_PREFIXES, BLOCKED_NAMES };
