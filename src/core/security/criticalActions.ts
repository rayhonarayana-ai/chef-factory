// CHEF FACTORY — Gate 2 → Gate 3 — Critical Action Registry.
// Centralized, versioned classification of protected actions. Agents can never
// modify their own critical-action classification; core rules are immutable even
// for superuser (enforced in the database by trigger).
// Gate 3: Aligned action keys to match pipeline actionTypes (underscore format).

import type { CriticalActionMatch, CriticalActionRule } from './types.js';
import type { EnvironmentName } from '../types.js';

export const CRITICAL_ACTIONS_REGISTRY_VERSION = 2;

// Factory core registry. `isCore: true` rows are immutable (DB trigger hard-blocks
// UPDATE/DELETE on them). Gate 3: keys use underscore format matching pipeline actionTypes.
export const CRITICAL_ACTIONS: readonly CriticalActionRule[] = [
  { action: 'production_modification', classification: 'production', defaultDecision: 'require_approval', environments: 'all', description: 'Any modification of production configuration or resources.', isCore: true },
  { action: 'production_deletion', classification: 'production', defaultDecision: 'deny', environments: ['production'], description: 'Deletion of production resources — deny by default.', isCore: true },
  { action: 'database_destructive', classification: 'destructive', defaultDecision: 'deny', environments: 'all', description: 'Destructive database operations (DROP/TRUNCATE/ALTER destroying data).', isCore: true },
  { action: 'secret_access', classification: 'secret', defaultDecision: 'require_approval', environments: 'all', description: 'Access to stored secrets/credentials.', isCore: true },
  { action: 'secret_rotation', classification: 'secret', defaultDecision: 'require_approval', environments: 'all', description: 'Rotation of secrets/credentials.', isCore: true },
  { action: 'permission_escalation', classification: 'permission', defaultDecision: 'deny', environments: 'all', description: 'Granting or escalating permissions.', isCore: true },
  { action: 'security_policy_modification', classification: 'policy', defaultDecision: 'require_approval', environments: 'all', description: 'Changing security policy rules.', isCore: true },
  { action: 'disable_audit', classification: 'audit', defaultDecision: 'deny', environments: 'all', description: 'Disabling or weakening audit recording.', isCore: true },
  { action: 'disable_rls', classification: 'audit', defaultDecision: 'deny', environments: 'all', description: 'Disabling row-level security.', isCore: true },
  { action: 'owner_identity_change', classification: 'identity', defaultDecision: 'require_approval', environments: 'all', description: 'Changing owner identity or authentication.', isCore: true },
  { action: 'authority_rule_change', classification: 'authority', defaultDecision: 'require_approval', environments: 'all', description: 'Changing authority matrix rules.', isCore: true },
  { action: 'autonomy_rule_change', classification: 'authority', defaultDecision: 'require_approval', environments: 'all', description: 'Changing autonomy/escalation rules.', isCore: true },
  { action: 'financial_transaction', classification: 'financial', defaultDecision: 'deny', environments: 'all', description: 'Any financial transfer or money movement.', isCore: true },
  { action: 'legal_commitment', classification: 'contractual', defaultDecision: 'deny', environments: 'all', description: 'External contractual or legally binding commitments.', isCore: true },
  { action: 'external_irreversible', classification: 'external_irreversible', defaultDecision: 'require_approval', environments: 'all', description: 'Irreversible actions on external systems.', isCore: true },
  { action: 'factory_shutdown', classification: 'factory', defaultDecision: 'deny', environments: 'all', description: 'Shutting down the Factory.', isCore: true },
  { action: 'lockdown_release', classification: 'factory', defaultDecision: 'deny', environments: 'all', description: 'Releasing an emergency lockdown — owner-only, explicit, audited.', isCore: true },
  // Gate 3 — Pipeline-aligned vocabulary (ACTIVE, not INERT)
  { action: 'project_create', classification: 'project', defaultDecision: 'require_approval', environments: 'all', description: 'Creating a new project.', isCore: true },
  { action: 'project_delete', classification: 'project', defaultDecision: 'deny', environments: 'all', description: 'Deleting a project.', isCore: true },
  { action: 'task_create', classification: 'task', defaultDecision: 'allow', environments: 'all', description: 'Creating a new task.', isCore: true },
  { action: 'task_delete', classification: 'task', defaultDecision: 'require_approval', environments: 'all', description: 'Deleting a task.', isCore: true },
  { action: 'agent_create', classification: 'agent', defaultDecision: 'require_approval', environments: 'all', description: 'Creating a new agent.', isCore: true },
  { action: 'agent_delete', classification: 'agent', defaultDecision: 'deny', environments: 'all', description: 'Deleting an agent.', isCore: true },
  { action: 'security_policy_edit', classification: 'security', defaultDecision: 'deny', environments: 'all', description: 'Editing security policy configuration.', isCore: true },
  // Gate 35B — Safe Verification Execution
  { action: 'software.verification.execute', classification: 'verification', defaultDecision: 'allow', environments: ['development', 'staging'], description: 'Running structured verification (test, typecheck, build) in approved workspace.', isCore: true },
  // Gate 36 V1 — Secure Read-Only Version Control
  { action: 'software.git.status', classification: 'verification', defaultDecision: 'allow', environments: ['development', 'staging'], description: 'Reading git working tree status in approved workspace. Read-only.', isCore: true },
  { action: 'software.git.diff', classification: 'verification', defaultDecision: 'allow', environments: ['development', 'staging'], description: 'Reading git diff in approved workspace. Read-only.', isCore: true },
  // Gate 36 V2 — Controlled Staging and Verified Commit
  { action: 'software.git.stage', classification: 'git_commit', defaultDecision: 'require_approval', environments: ['development', 'staging'], description: 'Preparing a git commit with state-bound attribution and human approval.', isCore: true },
  { action: 'software.git.commit', classification: 'git_commit', defaultDecision: 'require_approval', environments: ['development', 'staging'], description: 'Executing a human-approved git commit via temp index.', isCore: true },
  // Deferred (INERT — memory backend not yet implemented)
  { action: 'memory_write', classification: 'memory', defaultDecision: 'allow', environments: 'all', description: 'Writing to memory backend (deferred).', isCore: true },
  { action: 'memory_delete', classification: 'memory', defaultDecision: 'allow', environments: 'all', description: 'Deleting from memory backend (deferred).', isCore: true },
];

const INDEX = new Map<string, CriticalActionRule[]>();
for (const rule of CRITICAL_ACTIONS) {
  const list = INDEX.get(rule.action) ?? [];
  list.push(rule);
  INDEX.set(rule.action, list);
}

// G5-06: Pipeline action types → canonical critical action vocabulary.
// Maps the short action types produced by actionTypeFor() to the registry's
// canonical underscore-format names, activating the dormant defense-in-depth layer.
const ACTION_TYPE_ALIASES: Record<string, string> = {
  'financial': 'financial_transaction',
  'legal': 'legal_commitment',
  'account_security': 'secret_access',
  'deploy': 'production_modification',
  'delete': 'production_deletion',
};

/** Match a critical action rule for an action + environment. First match wins.
 *  G5-06: Also checks vocabulary aliases for pipeline action types. */
export function classifyCriticalAction(action: string, environment: EnvironmentName): CriticalActionMatch | null {
  // Try direct match first
  const direct = INDEX.get(action);
  if (direct && direct.length > 0) {
    for (const rule of direct) {
      if (rule.environments === 'all' || (rule.environments as string[]).includes(environment)) {
        return { rule, version: CRITICAL_ACTIONS_REGISTRY_VERSION };
      }
    }
  }
  // G5-06: Try vocabulary alias
  const canonical = ACTION_TYPE_ALIASES[action];
  if (canonical) {
    const aliased = INDEX.get(canonical);
    if (aliased && aliased.length > 0) {
      for (const rule of aliased) {
        if (rule.environments === 'all' || (rule.environments as string[]).includes(environment)) {
          return { rule, version: CRITICAL_ACTIONS_REGISTRY_VERSION };
        }
      }
    }
  }
  return null;
}

/** Actions that are protected by default in ANY environment (core registry). */
export function isProtectedCriticalAction(action: string): boolean {
  return INDEX.has(action);
}
