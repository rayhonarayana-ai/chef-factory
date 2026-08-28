// CHEF FACTORY — Gate 40 — Specialized AI Workforce Architecture (unit/security).
// An agent's specialist role/profile is SUITABILITY metadata only:
//   - it shapes the system prompt (role body on top of invariant guardrails)
//   - it contributes provider-neutral model needs to the existing ModelGateway
//   - it NEVER grants authority, NEVER adds a permission, NEVER bypasses the
//     SecurityGuardian/ToolBroker path, and NEVER contains an agent id.
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { executeAssignedAgentTask } from './agentExecutor.js';
import { createExecutionRunner } from '../api/execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import {
  SPECIALISTS,
  listSpecialistProfiles,
  getSpecialistProfile,
  getSpecialistProfileByRole,
  materializeSpecialist,
  specialistModelSelectionRequest,
} from './specialist/registry.js';
import { buildSpecialistSystemPrompt, specialistGuardrailPrompt } from './specialist/prompt.js';
import type { Store } from './ports.js';
import type { AgentRecord, TaskRecord } from './types.js';
import type { ActorContext, ExecutionOutcome, ExecutionRunner, ConversationMessage } from './pipeline.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../gateways/providerAdapter.js';
import type { DbQuery } from '../tools/types.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const mockDb: DbQuery = { query: async () => ({ rows: [] }) };

async function fixtures() {
  const store = new MemoryStore();
  const ownerId = 'owner-' + uuid();
  const project = await store.createProject(ownerId, { name: 'P', slug: 'p-' + uuid() });
  return { store, ownerId, project };
}

async function makeAgent(
  store: MemoryStore,
  ownerId: string,
  projectId: string,
  opts: { role?: string; status?: AgentRecord['status'] | string } = {},
): Promise<AgentRecord> {
  const agent = await store.createAgent(ownerId, {
    name: 'A-' + uuid(),
    slug: 'a-' + uuid(),
    role: opts.role ?? 'worker',
    status: (opts.status ?? 'active') as AgentRecord['status'],
    capabilities: [],
    maxConcurrentTasks: 1,
  });
  store.agentPermissions.push({ agentId: agent.id, projectId, resourceType: 'task', permission: 'execute' });
  return agent;
}

async function assignedTask(store: MemoryStore, ownerId: string, projectId: string, agentId: string, status: TaskRecord['status'] = 'queued'): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId, title: 'T-' + uuid(), status, agentId, riskLevel: 'low',
    inputs: { intent: 'execute test', environment: 'development', resource: 'task' },
  });
}

// Controllable ExecutionRunner that records the ActorContext (for prompt/reasoning
// injection assertions) and returns a successful outcome.
function stubRunner(): ExecutionRunner & { calls: Array<{ ctx: ActorContext; task: TaskRecord }> } {
  const calls: Array<{ ctx: ActorContext; task: TaskRecord }> = [];
  const runner: ExecutionRunner & { calls: typeof calls } = {
    calls,
    execute: async (task: TaskRecord, ctx: ActorContext, _history?: ConversationMessage[]): Promise<ExecutionOutcome> => {
      calls.push({ ctx, task });
      return { ok: true, output: { done: true }, cost: 0.001 };
    },
  };
  return runner;
}

function realRunner(store: Store) {
  const adapters = new Map<string, ProviderAdapter>([
    ['mock', {
      provider: 'mock', configured: () => true, supportsTools: () => true,
      complete: async (req: ProviderRequest): Promise<ProviderResponse> => ({
        provider: 'mock', model: req.model, text: 'Done.', usage: { inputTokens: 50, outputTokens: 20 },
      }),
    }],
  ]);
  const mg = new ModelGateway(adapters);
  const rg = new RuntimeGateway(new Map());
  store.models.push({ id: 'm-' + uuid(), provider: 'mock', name: 'mock', slug: 'mock', capability: { reasoning: 'medium', tools: true }, contextWindow: 128000, costPer1kInput: 0, costPer1kOutput: 0, status: 'active' });
  return createExecutionRunner({ store, modelGateway: mg, runtimeGateway: rg, toolDb: mockDb });
}

describe('Gate 40 — Specialist Registry', () => {
  it('01: at least one profile per target family', () => {
    const families = new Set(SPECIALISTS.map((p) => p.family));
    expect(families).toContain('leadership');
    expect(families).toContain('research');
    expect(families).toContain('design');
    expect(families).toContain('engineering');
    expect(families).toContain('quality');
    expect(families).toContain('security');
    expect(families).toContain('operations');
    expect(families).toContain('documentation');
    expect(families).toContain('commercial');
  });

  it('02: profiles never reference a specific agent id', () => {
    const json = JSON.stringify(SPECIALISTS);
    expect(json).not.toMatch(/agent[-_]?id/i);
    expect(json).not.toMatch(/"id"\s*:/i);
  });

  it('03: profiles never hardcode a model provider/name', () => {
    const json = JSON.stringify(SPECIALISTS);
    expect(json).not.toMatch(/gpt|claude|gemini|openai|anthropic|google|provider\s*[:,]/i);
  });

  it('04: profiles carry no permission class', () => {
    for (const p of SPECIALISTS) {
      expect((p as unknown as { permissions?: unknown }).permissions).toBeUndefined();
      expect((p as unknown as { grants?: unknown }).grants).toBeUndefined();
      expect((p as unknown as { authority?: unknown }).authority).toBeUndefined();
    }
  });

  it('05: slugs unique and role lookup works', () => {
    const slugs = SPECIALISTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const backend = getSpecialistProfile('backend-engineer');
    expect(backend).toBeTruthy();
    expect(getSpecialistProfileByRole(backend!.role)?.slug).toBe('backend-engineer');
    expect(getSpecialistProfileByRole('does-not-exist')).toBeUndefined();
    expect(getSpecialistProfile('nope')).toBeUndefined();
  });

  it('06: listSpecialistProfiles returns all profiles', () => {
    expect(listSpecialistProfiles().length).toBe(SPECIALISTS.length);
  });
});

describe('Gate 40 — Specialist System Prompt', () => {
  it('07: guardrails always present, profile body appended on top', () => {
    const p = buildSpecialistSystemPrompt('ag1', 'ow1', 'tk1', getSpecialistProfile('backend-engineer'));
    expect(p).toContain('bounded worker');
    expect(p).toContain('NOT grant arbitrary permissions');
    expect(p).toContain('independently authorized');
    expect(p).toContain('Never expose secrets');
    expect(p).toContain('Never self-assign');
    expect(p).toContain('Backend Engineer');
    expect(p).toMatch(/does NOT grant any\s+additional permission/);
  });

  it('08: no profile -> guardrail-only prompt (backward compatible)', () => {
    const p = buildSpecialistSystemPrompt('ag1', 'ow1', 'tk1', undefined);
    expect(p).toBe(specialistGuardrailPrompt('ag1', 'ow1', 'tk1'));
    expect(p).not.toMatch(/Specialist:/);
  });

  it('09: profile body never removes or contradicts guardrails', () => {
    for (const p of SPECIALISTS) {
      const full = buildSpecialistSystemPrompt('ag1', 'ow1', 'tk1', p);
      expect(full).toContain('bounded worker');
      expect(full).toContain('does NOT grant any');
      expect(full).toContain('independently authorized');
      expect(full).toContain('Never expose secrets');
    }
  });

  it('10: no secrets rendered in any specialist prompt', () => {
    for (const p of SPECIALISTS) {
      const full = buildSpecialistSystemPrompt('ag1', 'ow1', 'tk1', p);
      expect(full).not.toContain('sk-');
    }
  });
});

describe('Gate 40 — Model needs (provider-neutral)', () => {
  it('11: selection request is provider-neutral and maps thresholds', () => {
    const req = specialistModelSelectionRequest(getSpecialistProfile('backend-engineer')!);
    expect(req).toEqual({
      requirement: 'general',
      neededReasoning: 'high',
      neededTools: true,
      minContextWindow: 32000,
    });
    const json = JSON.stringify(req);
    expect(json).not.toMatch(/provider|gpt|claude|gemini|openai|anthropic/i);
  });

  it('12: modelNeeds.family reasoning flows into selection', () => {
    const ops = specialistModelSelectionRequest(getSpecialistProfile('operations-engineer')!);
    expect(ops.neededReasoning).toBe('low');
    const writer = specialistModelSelectionRequest(getSpecialistProfile('technical-writer')!);
    expect(writer.neededTools).toBe(true);
  });
});

describe('Gate 40 — Materialize specialist via existing createAgent', () => {
  it('13: materializes an AgentRecord through createAgent', async () => {
    const { store, ownerId } = await fixtures();
    const res = await materializeSpecialist(store, ownerId, 'qa-engineer');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const agent = await store.getAgent(ownerId, res.agentId);
    expect(agent).toBeTruthy();
    expect(agent!.role).toBe('qa-engineer');
    expect(agent!.name).toBe('QA Engineer');
    expect(agent!.description).toContain('test plans');
    expect(agent!.capabilities).toEqual(expect.arrayContaining(['quality-assurance']));
  });

  it('14: unknown profile -> error, no agent created', async () => {
    const { store, ownerId } = await fixtures();
    const before = (await store.listAgents(ownerId)).length;
    const res = await materializeSpecialist(store, ownerId, 'ghost-professional');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('unknown-specialist');
    expect((await store.listAgents(ownerId)).length).toBe(before);
  });

  it('15: materialization does NOT grant any permission', async () => {
    const { store, ownerId } = await fixtures();
    const res = await materializeSpecialist(store, ownerId, 'security-auditor');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await store.agentHasPermission(res.agentId, null, 'task', 'execute')).toBe(false);
  });
});

describe('Gate 40 — Agent execution wiring (specialization is prompt/suitability ONLY)', () => {
  it('16: matching specialist role injects prompt + reasoning into ActorContext', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId, project.id, { role: 'backend-engineer' });
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const runner = stubRunner();
    const r = await executeAssignedAgentTask({ store, execution: runner, ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(true);
    const call = runner.calls[0];
    expect(call.ctx.agentSystemPrompt).toContain('Backend Engineer');
    expect(call.ctx.agentSystemPrompt).toContain('bounded worker');
    expect(call.ctx.agentReasoning).toBe('high');
  });

  it('17: unmatched role keeps generic guardrail prompt and null reasoning', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId, project.id, { role: 'worker' });
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const runner = stubRunner();
    const r = await executeAssignedAgentTask({ store, execution: runner, ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(true);
    const call = runner.calls[0];
    expect(call.ctx.agentSystemPrompt).not.toContain('Specialist:');
    expect(call.ctx.agentReasoning).toBeNull();
  });

  it('18: specialization NEVER bypasses SecurityGuardian/ToolBroker authority path', async () => {
    // Real runner exercises the full SecurityGuardian/ToolBroker path. A
    // specialist role must NOT grant success on its own: with NO execute
    // permission the agent must be denied despite having a matching profile.
    const { store, ownerId, project } = await fixtures();
    const ag = await store.createAgent(ownerId, {
      name: 'A-' + uuid(), slug: 'a-' + uuid(), role: 'backend-engineer', status: 'active',
      capabilities: ['typescript'], maxConcurrentTasks: 1,
    });
    // NOTE: intentionally NO agentPermissions push.
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: realRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    // Authority must block it; specialization did not grant execution.
    expect(['authority_denied', 'permission_denied']).toContain(r.outcome);
  });

  it('19: specialization does not alter cross-owner isolation', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId, project.id, { role: 'security-auditor' });
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const otherOwner = 'owner-' + uuid();
    const r = await executeAssignedAgentTask({ store, execution: stubRunner(), ownerId: otherOwner, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
  });
});
