// CHEF FACTORY — Gate 41 — Global Workforce Emergency Stop (core logic + privileged write).
//
// This is the durable, explicit SYSTEM/workforce control primitive. The Development Lead
// rejected the sentinel-owner workaround; this is a real control row with an explicit
// meaning: "is the global Workforce permitted to schedule NEW work?".
//
// SECURITY BOUNDARY (capability separation):
//   * READ (getWorkforceControl) is on the general `Store` so Worker/Security code can
//     fail closed against the global state before each cycle and before initiating
//     discovered work.
//   * WRITE is a SEPARATE privileged capability (WorkforceControlAdminPersistence) that is
//     NOT part of the general `Store`. It is reachable ONLY through `setGlobalEmergencyStop`
//     below, which first validates a system-admin actor via `canSetGlobalControl`.
//   * Agents, the workforce service, the Mission Engine, and specialist roles are always
//     denied the write path — structurally (no raw write on their dependency) and
//     defensively (authorization rejection before any write).

import type { Store, WorkforceControlAdminPersistence } from '../ports.js';

export const WORKFORCE_CONTROL_SINGLETON = 'global';

/**
 * Canonical authorized SYSTEM ADMIN authority identity used by canSetGlobalControl.
 * This is the AUTHORITY discriminator (a reserved system identity), NOT an audit id.
 */
export const SYSTEM_ADMIN_ACTOR = 'system:admin';

/**
 * Stable, well-known system UUID used ONLY for DB audit attribution of global-control
 * events (audit_events.actor_id is a uuid column). Attribution ONLY — it grants no
 * authority by itself; canSetGlobalControl() remains the sole authority gate.
 */
export const SYSTEM_ADMIN_AUDIT_ACTOR_ID = '00000000-0000-4000-a000-00000000f1ff';

export interface WorkforceControlRecord {
  singletonKey: string;
  globallyEnabled: boolean;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}

/**
 * Whether the global Workforce is STOPPED given a control record.
 *
 * FAIL-CLOSED: a null record (row missing) is treated as STOPPED — the migration always
 * seeds the enabled singleton, so a null record is an anomaly and must never permit new
 * scheduling during security-sensitive uncertainty.
 */
export function isGlobalStopActive(record: WorkforceControlRecord | null): boolean {
  if (!record) return true;
  return record.globallyEnabled === false;
}

/**
 * Whether the global Workforce is ENABLED (opposite of isGlobalStopActive). Convenience
 * for call sites that branch on "may schedule".
 */
export function isGlobalWorkforceEnabled(record: WorkforceControlRecord | null): boolean {
  return !isGlobalStopActive(record);
}

/**
 * Allowlist of identities that may toggle the global emergency stop. Only this explicit
 * authorized system-admin identity is permitted. Generic `system` actors, the workforce
 * service, agents, owners (unless explicitly designated), the Mission Engine, and
 * specialist roles are all denied.
 */
export const WORKFORCE_CONTROL_ADMIN_ACTORS = new Set<string>([SYSTEM_ADMIN_ACTOR]);

/**
 * Authorization gate for the WRITE path. Returns true ONLY for an explicitly authorized
 * system-admin identity. Everything else (agent, owner, generic system actor, workforce
 * service, mission/planner, specialist) is denied.
 */
export function canSetGlobalControl(actorId: string, actorType: string): boolean {
  if (actorType !== 'system') return false;
  return WORKFORCE_CONTROL_ADMIN_ACTORS.has(actorId);
}

/**
 * The single privileged core function that may change global emergency-stop state.
 *
 * Preconditions enforced here (mandatory, not by convention):
 *   1. explicit trusted actor context (actorId + actorType)
 *   2. canSetGlobalControl(...) — rejects agents, owners, generic system, workforce service
 *   3. non-empty reason required when stopping globally
 *   4. invokes the privileged raw persistence (WorkforceControlAdminPersistence) ONLY after
 *      authority validation succeeds
 *   5. emits safe audit evidence (no secrets)
 *
 * The worker loop NEVER calls this function; it only reads. Any attempt by an agent,
 * the workforce service, the Mission Engine, or a specialist role to call it throws.
 */
export async function setGlobalEmergencyStop(
  deps: { control: WorkforceControlAdminPersistence; store: Store },
  input: {
    globallyEnabled: boolean;
    reason: string;
    actorId: string;
    actorType: string;
    correlationId?: string | null;
  },
): Promise<WorkforceControlRecord> {
  if (!canSetGlobalControl(input.actorId, input.actorType)) {
    throw new Error(
      `global workforce control denied for actorType=${input.actorType} actorId=${input.actorId}: only authorized system admin control may change emergency-stop state`,
    );
  }
  if (input.globallyEnabled === false && (!input.reason || input.reason.trim().length === 0)) {
    throw new Error('global emergency stop requires a non-empty reason');
  }

  // Authority validated above; only now touch the privileged raw persistence.
  const record = await deps.control.setWorkforceControlRaw({
    globallyEnabled: input.globallyEnabled,
    reason: input.reason,
    updatedBy: input.actorId,
  });

  await safeAudit(deps.store, {
    actorType: 'system',
    actorId: SYSTEM_ADMIN_AUDIT_ACTOR_ID,
    action: input.globallyEnabled ? 'workforce.global_control.enabled' : 'workforce.global_control.stopped',
    projectId: null,
    environmentId: null,
    resourceType: 'workforce_control',
    resourceId: WORKFORCE_CONTROL_SINGLETON,
    authorizationResult: null,
    correlationId: input.correlationId ?? null,
    taskId: null,
    metadata: {
      globallyEnabled: input.globallyEnabled,
      updatedBy: input.actorId,
      systemAdmin: SYSTEM_ADMIN_ACTOR,
      authorized: true,
      reason: input.reason,
    },
  });
  return record;
}

async function safeAudit(store: Store, event: Parameters<Store['recordAudit']>[0]): Promise<void> {
  try {
    await store.recordAudit(event);
  } catch (e) {
    console.warn(`[Gate 41] global-control audit persistence failed for ${event.action}: ${e}`);
  }
}
