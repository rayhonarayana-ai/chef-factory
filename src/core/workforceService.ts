// CHEF FACTORY — Gate 41 — Narrow SYSTEM WORKFORCE identity.
//
// The continuous 24/7 runtime is neither an OWNER nor an AGENT. It is a trusted
// SYSTEM WORKFORCE SERVICE with an explicit, narrow identity. The Development Lead
// mandated this distinction (OWNER ≠ WORKFORCE SERVICE ≠ AGENT) and rejected the
// reconnaissance suggestion where the worker impersonates the owner via
// actorId === ownerId as its security identity.
//
// The Workforce Service may ONLY initiate the deterministic scheduling path
// (runWorkforce) for already-authorized work. It may NOT approve anything, resolve
// approvals, create/modify permissions, grant authority, change budgets or owner
// preferences, create legal/financial commitments, impersonate the owner for
// general commands, bypass SecurityGuardian/ToolBroker, execute tools directly,
// call agents outside AgentExecutor, create arbitrary tasks, mutate Mission plans,
// or perform Git commit/push.
//
// These limits are structural:
//   * The worker always invokes runWorkforce with actorType='system' and this actorId.
//   * Every internal execution routes through executeAssignedAgentTask with the
//     ASSIGNED AGENT's identity (agent scope), never the workforce identity.
//   * The owner-gated primitives (placement, approvals, permissions) are reached
//     ONLY through the canonical scheduling path, not as a general bypass.
//
// AUDIT PERSISTENCE NOTE:
//   The DB column audit_events.actor_id is a `uuid` (the schema's representation for
//   system actors), so the human-readable name 'workforce-service' cannot be written
//   verbatim to actor_id. The workforce runtime therefore records actor_id as a stable,
//   well-known SYSTEM UUID and carries the canonical name ('workforce-service') in the
//   audit metadata. Authorization/identity comparisons still use the string constant
//   WORKFORCE_SERVICE_ACTOR; only DB-bound persistence uses the uuid.

export const WORKFORCE_SERVICE_ACTOR = 'workforce-service';
export const WORKFORCE_SERVICE_ACTOR_TYPE = 'system';

/**
 * Stable, well-known system UUID used ONLY for DB audit attribution
 * (audit_events.actor_id is a uuid column). AUTHORITY identity is the separate
 * WORKFORCE_SERVICE_ACTOR string. This UUID is attribution, NOT authority: its mere
 * presence never grants scheduling/administrative power.
 *
 * Same Workforce Service process/restart => same audit actor UUID (stable attribution).
 */
export const WORKFORCE_SERVICE_AUDIT_ACTOR_ID = '00000000-0000-4000-a000-00000000f41a';

/** Sentinel that marks a runWorkforce initiator as the trusted workforce service. */
export const WORKFORCE_INITIATOR = 'workforce-service';
