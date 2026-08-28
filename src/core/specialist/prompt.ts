// CHEF FACTORY — Gate 40 — Specialist-aware system prompt assembly.
//
// The specialist profile contributes a ROLE body only. It is composed ON TOP of
// the invariant guardrail prompt (bounded worker, no self-delegation, no secret
// exposure, deny-obey). The guardrails are never weakened or removed by a
// profile. Specialization never grants authority; it only shapes how the agent
// reasons and communicates within its granted scope.
//
// INVARIANTS:
//   SPECIALIZATION_GRANTS_AUTHORITY = NO
//   PROFILE_NEVER_REMOVES_GUARDRAILS = YES
//   PROMPT_NEVER_MENTIONS_AN_AGENT_ID = NO (restricted to the guardrail header)

import type { SpecialistProfile } from './types.js';

/** Invariant guardrail block shared by every specialist system prompt. */
export function specialistGuardrailPrompt(agentId: string, ownerId: string, taskId: string): string {
  return [
    'You are an assigned CHEF agent executing a specific task.',
    `Agent ID: ${agentId}`,
    `Owner ID: ${ownerId}`,
    `Task ID: ${taskId}`,
    '',
    'You are a bounded worker with limited authority. You must:',
    '- Execute only the assigned task',
    '- Obey all SecurityGuardian and ToolBroker decisions',
    '- Stop immediately if approval is required',
    '- Never expose secrets, credentials, or sensitive data',
    '- Never self-assign tasks or delegate to other agents',
    '- Never attempt to approve your own actions',
    '- Report ambiguity rather than fabricate certainty',
    '- Redact secrets from all outputs and audit trails',
    '',
    'Your task assignment does NOT grant arbitrary permissions.',
    'Each tool call is independently authorized.',
    'If denied, accept the denial and report it.',
  ].join('\n');
}

/**
 * Assemble the full agent system prompt for a specialist: guardrails first,
 * then the role-specific body. Returns the guardrail-only prompt when no
 * specialist profile matches (identical to the pre-Gate-40 behavior).
 */
export function buildSpecialistSystemPrompt(
  agentId: string,
  ownerId: string,
  taskId: string,
  profile?: SpecialistProfile | null,
): string {
  const guardrails = specialistGuardrailPrompt(agentId, ownerId, taskId);
  if (!profile) return guardrails;
  return [
    guardrails,
    '',
    `Specialist: ${profile.name} (${profile.family})`,
    '',
    profile.systemPromptProfile,
    '',
    'Your role defines how you reason and communicate. It does NOT grant any',
    'additional permission or authority. Access is decided independently per',
    'tool call by SecurityGuardian and ToolBroker.',
  ].join('\n');
}
