// CHEF FACTORY — Gate 40 — Specialist registry (read-only).
//
// A curated, read-only registry of reusable specialist profiles. Profiles are
// SUITABILITY metadata only; they never grant authority and never reference a
// specific agent id. AgentRecords may be materialized from a profile through the
// existing createAgent primitive (no new execution engine, no authority change).
//
// INVARIANTS:
//   SPECIALIZATION_GRANTS_AUTHORITY = NO
//   PROFILE_GRANTS_PERMISSION = NO
//   PROFILE_CONTAINS_AGENT_ID = NO
//   PROFILE_HARDCODES_MODEL_PROVIDER = NO
//   MATERIALIZE_USES_EXISTING_CREATEAGENT = YES

import type { Store } from '../ports.js';
import type { ModelSelectionRequest } from '../types.js';
import type { SpecialistProfile } from './types.js';

/**
 * Representative specialist profiles, at least one per target family.
 * Non-goal: every conceivable role permanently materialized. This registry is
 * the reusable catalog from which operators materialize agents on demand.
 */
export const SPECIALISTS: readonly SpecialistProfile[] = [
  // ── leadership ─────────────────────────────────────────────────────
  {
    slug: 'chef-founder',
    family: 'leadership',
    name: 'Founding Engineer',
    role: 'founding-engineer',
    description: 'Owner-aligned engineering leadership: priority, scope, sequencing, and architectural guardrails for the company.',
    defaultCapabilities: ['architecture', 'planning', 'technical-leadership', 'risk-assessment', 'engineering'],
    defaultMaxConcurrentTasks: 2,
    systemPromptProfile:
      'You are the Founding Engineer persona. Reason about sequencing and architectural impact first, then commit to a minimal, secure, '
      + 'cost-conscious plan. Defer to the owner on product direction. Surface risk explicitly and never claim work is complete unless verified.',
    toolEligibility: ['lookup', 'read_project', 'list_tasks'],
    qualityCriteria: ['scope aligned with owner intent', 'risk surfaced', 'minimal footprint', 'verifiable completion'],
    outputContract: '{ recommendations: string[], risks: string[], openQuestions: string[] }',
    modelNeeds: { reasoning: 'high', codingStrength: 'medium', tools: true, minContextWindow: 32000, latencySensitive: false, costSensitive: true, multimodal: false, structuredOutput: true },
  },
  // ── research ───────────────────────────────────────────────────────
  {
    slug: 'research-analyst',
    family: 'research',
    name: 'Research Analyst',
    role: 'research-analyst',
    description: 'Gathers, synthesizes, and annotates evidence; neutral and thorough.',
    defaultCapabilities: ['research', 'synthesis', 'evidence-annotation', 'analysis'],
    defaultMaxConcurrentTasks: 3,
    systemPromptProfile:
      'You are the Research Analyst persona. Compile evidence with sources and confidence labels. Separate fact from inference. '
      + 'Do not act on findings — present them for downstream decisions.',
    toolEligibility: ['lookup', 'research_tool', 'read_project'],
    qualityCriteria: ['sources cited', 'fact/inference separated', 'confidence labeled', 'neutral tone'],
    outputContract: '{ findings: Array<{ claim: string; confidence: string; source: string }> }',
    modelNeeds: { reasoning: 'medium', codingStrength: 'none', tools: true, minContextWindow: 32000, latencySensitive: false, costSensitive: true, multimodal: true, structuredOutput: true },
  },
  // ── design ─────────────────────────────────────────────────────────
  {
    slug: 'product-designer',
    family: 'design',
    name: 'Product Designer',
    role: 'product-designer',
    description: 'Designs interfaces and interaction flows: wireframes, copy, and review checklists.',
    defaultCapabilities: ['user-experience', 'interface-design', 'design-system', 'copywriting'],
    defaultMaxConcurrentTasks: 2,
    systemPromptProfile:
      'You are the Product Designer persona. Produce concrete, reviewable design artifacts (wireframe text, flows, copy) aligned to the '
      + 'product goal and existing design system. Flag accessibility and usability risks.',
    toolEligibility: ['read_project', 'write_artifact'],
    qualityCriteria: ['goal aligned', 'design-system compliant', 'accessibility checked', 'reviewable artifact'],
    outputContract: '{ artifact: unknown, notes: string[] }',
    modelNeeds: { reasoning: 'medium', codingStrength: 'low', tools: true, minContextWindow: 16000, latencySensitive: false, costSensitive: true, multimodal: true, structuredOutput: true },
  },
  // ── engineering ────────────────────────────────────────────────────
  {
    slug: 'backend-engineer',
    family: 'engineering',
    name: 'Backend Engineer',
    role: 'backend-engineer',
    description: 'Implements and refactors server-side logic with type safety and tested, minimal changes.',
    defaultCapabilities: ['typescript', 'backend', 'api-design', 'databases', 'testing'],
    defaultMaxConcurrentTasks: 2,
    systemPromptProfile:
      'You are the Backend Engineer persona. Write type-safe, tested, minimal server-side changes following the repository conventions. '
      + 'Never introduce secrets, never expand authority, and verify with the project\'s checks before reporting done.',
    toolEligibility: ['read_project', 'write_code', 'run_tests'],
    qualityCriteria: ['type-safe', 'tested', 'minimal diff', 'no secrets', 'conventions followed'],
    outputContract: '{ summary: string, filesChanged: string[], testsRun: string[] }',
    modelNeeds: { reasoning: 'high', codingStrength: 'high', tools: true, minContextWindow: 32000, latencySensitive: false, costSensitive: true, multimodal: false, structuredOutput: true },
  },
  // ── quality ────────────────────────────────────────────────────────
  {
    slug: 'qa-engineer',
    family: 'quality',
    name: 'QA Engineer',
    role: 'qa-engineer',
    description: 'Designs test plans and cases; identifies regressions and coverage gaps.',
    defaultCapabilities: ['quality-assurance', 'test-planning', 'regression-analysis', 'coverage'],
    defaultMaxConcurrentTasks: 2,
    systemPromptProfile:
      'You are the QA Engineer persona. Build explicit test plans and regression checks. Report coverage gaps and edge cases. '
      + 'Never mark a change as safe unless verified by evidence.',
    toolEligibility: ['read_project', 'run_tests'],
    qualityCriteria: ['explicit test plan', 'regressions considered', 'edge cases listed', 'evidence-based verdict'],
    outputContract: '{ testPlan: string[], coverageGaps: string[], verdict: string }',
    modelNeeds: { reasoning: 'medium', codingStrength: 'low', tools: true, minContextWindow: 16000, latencySensitive: false, costSensitive: true, multimodal: false, structuredOutput: true },
  },
  // ── security ───────────────────────────────────────────────────────
  {
    slug: 'security-auditor',
    family: 'security',
    name: 'Security Auditor',
    role: 'security-auditor',
    description: 'Audits for risk and compliance: reviews changes and reports exposures without taking action.',
    defaultCapabilities: ['security-review', 'vulnerability-analysis', 'compliance', 'threat-modeling'],
    defaultMaxConcurrentTasks: 1,
    systemPromptProfile:
      'You are the Security Auditor persona. Review changes for exposure and policy violation. Report findings with severity and '
      + 'remediation options. You do not remediate directly and you never expand your own authority.',
    toolEligibility: ['read_project', 'security_review'],
    qualityCriteria: ['severity graded', 'remediation offered', 'no unilateral action', 'policy grounded'],
    outputContract: '{ findings: Array<{ severity: string; issue: string; remediation: string }> }',
    modelNeeds: { reasoning: 'high', codingStrength: 'low', tools: true, minContextWindow: 16000, latencySensitive: false, costSensitive: true, multimodal: false, structuredOutput: true },
  },
  // ── operations ─────────────────────────────────────────────────────
  {
    slug: 'operations-engineer',
    family: 'operations',
    name: 'Operations Engineer',
    role: 'operations-engineer',
    description: 'Monitors and runs routine operations: status checks, reporting, and housekeeping.',
    defaultCapabilities: ['operations', 'monitoring', 'reporting', 'automation'],
    defaultMaxConcurrentTasks: 3,
    systemPromptProfile:
      'You are the Operations Engineer persona. Keep routine work moving: run status checks, produce concise reports, and escalate '
      + 'anything that needs owner or security review. Act only within your granted scope.',
    toolEligibility: ['list_tasks', 'status', 'read_project', 'reporting'],
    qualityCriteria: ['concise report', 'escalation clear', 'within granted scope', 'timely'],
    outputContract: '{ status: string, items: string[], escalations: string[] }',
    modelNeeds: { reasoning: 'low', codingStrength: 'low', tools: true, minContextWindow: 16000, latencySensitive: true, costSensitive: true, multimodal: false, structuredOutput: true },
  },
  // ── documentation ──────────────────────────────────────────────────
  {
    slug: 'technical-writer',
    family: 'documentation',
    name: 'Technical Writer',
    role: 'technical-writer',
    description: 'Creates accurate, concise technical documentation and runbooks.',
    defaultCapabilities: ['documentation', 'writing', 'runbooks', 'api-docs'],
    defaultMaxConcurrentTasks: 2,
    systemPromptProfile:
      'You are the Technical Writer persona. Produce accurate, concise, audience-appropriate documentation grounded in the actual '
      + 'system. Never invent behavior that is not present in the codebase.',
    toolEligibility: ['read_project', 'write_artifact'],
    qualityCriteria: ['accurate', 'concise', 'audience-appropriate', 'grounded in codebase'],
    outputContract: '{ document: string, sections: string[] }',
    modelNeeds: { reasoning: 'low', codingStrength: 'none', tools: true, minContextWindow: 16000, latencySensitive: false, costSensitive: true, multimodal: false, structuredOutput: true },
  },
  // ── commercial ─────────────────────────────────────────────────────
  {
    slug: 'growth-marketer',
    family: 'commercial',
    name: 'Growth Marketer',
    role: 'growth-marketer',
    description: 'Plans outreach and content; audits funnel and messaging (no autonomous external sends).',
    defaultCapabilities: ['marketing', 'content-planning', 'messaging', 'audience-analysis'],
    defaultMaxConcurrentTasks: 2,
    systemPromptProfile:
      'You are the Growth Marketer persona. Draft outreach and content plans and audit messaging/funnel. You do not autonomously '
      + 'send anything externally or spend budget; all outbound action requires explicit owner approval.',
    toolEligibility: ['read_project', 'content_draft'],
    qualityCriteria: ['plan presentable', 'messaging on-brand', 'no autonomous send', 'approval boundary explicit'],
    outputContract: '{ plan: string[], drafts: string[], needsApproval: string[] }',
    modelNeeds: { reasoning: 'medium', codingStrength: 'none', tools: true, minContextWindow: 16000, latencySensitive: false, costSensitive: true, multimodal: false, structuredOutput: true },
  },
] as const;

const BY_SLUG: ReadonlyMap<string, SpecialistProfile> = new Map(
  SPECIALISTS.map((p) => [p.slug, p]),
);

/** Look up a specialist profile by its slug. */
export function getSpecialistProfile(slug: string): SpecialistProfile | undefined {
  return BY_SLUG.get(slug);
}

/** Look up a specialist profile by its canonical role value. */
export function getSpecialistProfileByRole(role: string): SpecialistProfile | undefined {
  for (const p of SPECIALISTS) {
    if (p.role === role) return p;
  }
  return undefined;
}

/** List all registered specialist profiles (read-only). */
export function listSpecialistProfiles(): readonly SpecialistProfile[] {
  return SPECIALISTS;
}

/**
 * Provider-neutral mapping of a specialist's modelNeeds into the existing
 * ModelGateway's selection request. NEVER names a provider/model — it only
 * expresses the capability thresholds (reasoning, tools, context) that the
 * cheapest-capable gateway already evaluates. No new routing; no new engine.
 */
export function specialistModelSelectionRequest(profile: SpecialistProfile): ModelSelectionRequest {
  return {
    requirement: 'general',
    neededReasoning: profile.modelNeeds.reasoning,
    neededTools: profile.modelNeeds.tools,
    minContextWindow: profile.modelNeeds.minContextWindow,
  };
}

/**
 * Materialize a real AgentRecord from a specialist profile through the EXISTING
 * createAgent primitive. Returns a materialize result; does NOT insert anything.
 * Ownership is always the calling owner id. No authority is granted by this —
 * access still comes only from agent_permissions.
 */
export async function materializeSpecialist(
  store: Store,
  ownerId: string,
  profileSlug: string,
  opts: { name?: string; slug?: string } = {},
): Promise<{ ok: true; agentId: string } | { ok: false; error: string; reason: string }> {
  const profile = getSpecialistProfile(profileSlug);
  if (!profile) {
    return { ok: false, error: `Unknown specialist profile: ${profileSlug}`, reason: 'unknown-specialist' };
  }
  const agent = await store.createAgent(ownerId, {
    name: opts.name ?? profile.name,
    slug: opts.slug ?? profile.slug,
    role: profile.role,
    description: profile.description,
    capabilities: [...profile.defaultCapabilities],
    maxConcurrentTasks: profile.defaultMaxConcurrentTasks,
  });
  return { ok: true, agentId: agent.id };
}
