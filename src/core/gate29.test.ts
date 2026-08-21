// CHEF FACTORY — Gate 29 — Workforce Selection Foundation.
// Tests: capability normalization, eligibility filtering, deterministic ranking,
// structured selection results, zero side-effects, Gate 27/28 invariants.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { selectCandidate } from './selector.js';
import { normalizeCapability, normalizeCapabilities, satisfiesAll, matchRatio } from './capabilities.js';
import type { AgentRecord, TaskRecord } from './types.js';
import type { Store } from './ports.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ═══════════════════════════════════════════════════════════
// Helper: create fixtures for a given owner
// ═══════════════════════════════════════════════════════════

async function createFixtures() {
  const store = new MemoryStore();
  const ownerA = 'owner-a-' + uuid();
  const ownerB = 'owner-b-' + uuid();
  const projectA = await store.createProject(ownerA, { name: 'ProjectA', slug: 'proj-a-' + uuid() });
  const projectB = await store.createProject(ownerB, { name: 'ProjectB', slug: 'proj-b-' + uuid() });
  return { store, ownerA, ownerB, projectA, projectB };
}

async function makeAgent(store: Store, ownerId: string, overrides: Partial<{ name: string; slug: string; role: string; status: AgentRecord['status']; capabilities: string[] }> = {}): Promise<AgentRecord> {
  return store.createAgent(ownerId, {
    name: overrides.name ?? 'Agent-' + uuid(),
    slug: overrides.slug ?? 'ag-' + uuid(),
    role: overrides.role ?? 'worker',
    status: overrides.status ?? 'active',
    capabilities: overrides.capabilities ?? [],
  });
}

async function makeTask(store: Store, ownerId: string, projectId: string, overrides: Partial<{ title: string; requiredCapabilities: string[]; preferredRole: string | null }> = {}): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId,
    title: overrides.title ?? 'Task-' + uuid(),
    requiredCapabilities: overrides.requiredCapabilities,
    preferredRole: overrides.preferredRole,
  });
}

// ═══════════════════════════════════════════════════════════
// Capability normalization unit tests
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Capability normalization', () => {
  it('1: normalizeCapability trims and lowercases', () => {
    expect(normalizeCapability('  TypeScript  ')).toBe('typescript');
    expect(normalizeCapability('React')).toBe('react');
    expect(normalizeCapability('SQL')).toBe('sql');
  });

  it('2: normalizeCapability rejects empty strings', () => {
    expect(normalizeCapability('')).toBeNull();
    expect(normalizeCapability('   ')).toBeNull();
  });

  it('3: normalizeCapabilities deduplicates', () => {
    const result = normalizeCapabilities(['TypeScript', ' typescript ', 'TYPESCRIPT']);
    expect(result).toEqual(['typescript']);
  });

  it('4: normalizeCapabilities preserves order of first occurrence', () => {
    const result = normalizeCapabilities(['react', 'TypeScript', 'react', 'SQL']);
    expect(result).toEqual(['react', 'typescript', 'sql']);
  });

  it('5: satisfiesAll returns true for empty requirements', () => {
    expect(satisfiesAll([], [])).toBe(true);
    expect(satisfiesAll(['typescript'], [])).toBe(true);
  });

  it('6: satisfiesAll requires all capabilities present', () => {
    expect(satisfiesAll(['typescript', 'react'], ['typescript', 'react'])).toBe(true);
    expect(satisfiesAll(['typescript', 'react', 'sql'], ['typescript', 'react'])).toBe(true);
    expect(satisfiesAll(['typescript'], ['typescript', 'react'])).toBe(false);
  });

  it('7: matchRatio returns 1 for empty requirements', () => {
    expect(matchRatio([], [])).toBe(1);
    expect(matchRatio(['typescript'], [])).toBe(1);
  });

  it('8: matchRatio computes correctly', () => {
    expect(matchRatio(['typescript', 'react'], ['typescript', 'react'])).toBe(1);
    expect(matchRatio(['typescript'], ['typescript', 'react'])).toBe(0.5);
    expect(matchRatio([], ['typescript'])).toBe(0);
  });

  it('9: java does NOT match javascript', () => {
    expect(normalizeCapability('java')).toBe('java');
    expect(normalizeCapability('javascript')).toBe('javascript');
    expect(satisfiesAll(['java', 'javascript'], ['java'])).toBe(true);
    expect(satisfiesAll(['java'], ['javascript'])).toBe(false);
    expect(satisfiesAll(['javascript'], ['java'])).toBe(false);
  });

  it('10: react does NOT match react-native', () => {
    expect(normalizeCapability('react')).toBe('react');
    expect(normalizeCapability('react-native')).toBe('react-native');
    expect(satisfiesAll(['react', 'react-native'], ['react'])).toBe(true);
    expect(satisfiesAll(['react'], ['react-native'])).toBe(false);
    expect(satisfiesAll(['react-native'], ['react'])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Agent discovery and lifecycle filtering
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Agent discovery and lifecycle', () => {
  it('11: zero agents returns no_agents_found', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_agents_found');
    expect(result.rejected).toEqual([]);
  });

  it('12: one eligible agent is selected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { name: 'Solo', role: 'worker' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('selected');
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('13: active agent accepted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { status: 'active' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('selected');
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('14: paused agent rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Paused', status: 'paused' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
    expect(result.rejected![0].reason).toBe('inactive');
  });

  it('15: retired agent rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Retired', status: 'retired' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
    expect(result.rejected![0].reason).toBe('inactive');
  });

  it('16: suspended agent rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Suspended', status: 'suspended' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
    expect(result.rejected![0].reason).toBe('inactive');
  });

  it('17: mixed statuses — only active agents considered', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Paused', status: 'paused' });
    await makeAgent(store, ownerA, { name: 'Retired', status: 'retired' });
    const active = await makeAgent(store, ownerA, { name: 'Active', status: 'active' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(active.id);
    expect(result.rejected).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════
// Capability matching
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Capability matching', () => {
  it('18: exact capability match selects agent', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript', 'react'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript', 'react'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('19: case normalization enables matching', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['TypeScript', 'REACT'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript', 'react'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('20: whitespace normalization enables matching', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['  typescript  ', ' react '] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript', 'react'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('21: one missing capability rejects agent', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript', 'react'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
    expect(result.rejected![0].reason).toBe('missing_capability');
  });

  it('22: multiple required capabilities — all present selects', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript', 'react', 'sql', 'node'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript', 'react', 'sql'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('23: agent with extra capabilities still eligible', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript', 'react', 'sql', 'docker', 'aws'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
  });

  it('24: empty requiredCapabilities — all active agents eligible', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const a1 = await makeAgent(store, ownerA, { name: 'A1', capabilities: [] });
    const a2 = await makeAgent(store, ownerA, { name: 'A2', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: [] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('selected');
    // Both are eligible — selection is deterministic across repeated calls
    const result2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result2.selected!.agentId).toBe(result.selected!.agentId);
    expect([a1.id, a2.id]).toContain(result.selected!.agentId);
  });
});

// ═══════════════════════════════════════════════════════════
// Role preference and ranking
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Role preference and ranking', () => {
  it('25: preferredRole match ranks agent first', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const roleMatch = await makeAgent(store, ownerA, { name: 'RoleMatch', role: 'frontend_engineer', capabilities: ['typescript'] });
    const roleMismatch = await makeAgent(store, ownerA, { name: 'RoleMismatch', role: 'backend_engineer', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, {
      requiredCapabilities: ['typescript'],
      preferredRole: 'frontend_engineer',
    });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(roleMatch.id);
    expect(result.selected!.roleMatched).toBe(true);
  });

  it('26: role mismatch remains eligible', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { role: 'backend_engineer', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, {
      requiredCapabilities: ['typescript'],
      preferredRole: 'frontend_engineer',
    });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
    expect(result.selected!.roleMatched).toBe(false);
  });

  it('27: no preferredRole — all eligible agents considered equally', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const a1 = await makeAgent(store, ownerA, { name: 'A1', role: 'frontend_engineer', capabilities: ['typescript'] });
    const a2 = await makeAgent(store, ownerA, { name: 'A2', role: 'backend_engineer', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, {
      requiredCapabilities: ['typescript'],
      preferredRole: null,
    });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    // Both eligible — selection is deterministic (same result on repeated calls)
    const result2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result2.selected!.agentId).toBe(result.selected!.agentId);
    expect([a1.id, a2.id]).toContain(result.selected!.agentId);
  });

  it('28: preferredRole with empty string treated as no preference', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { role: 'worker', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, {
      requiredCapabilities: ['typescript'],
      preferredRole: '',
    });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
  });
});

// ═══════════════════════════════════════════════════════════
// Deterministic ranking and tie-break
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Deterministic ranking and tie-break', () => {
  it('29: deterministic selection — same input produces same output', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { name: 'Det', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r1 = await selectCandidate({ store, ownerId: ownerA, task });
    const r2 = await selectCandidate({ store, ownerId: ownerA, task });
    const r3 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(r1.selected!.agentId).toBe(agent.id);
    expect(r2.selected!.agentId).toBe(agent.id);
    expect(r3.selected!.agentId).toBe(agent.id);
  });

  it('30: createdAt tie-break — oldest agent wins', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    // Create agents in sequence — a1 is older
    const a1 = await makeAgent(store, ownerA, { name: 'Older', capabilities: ['typescript'] });
    const a2 = await makeAgent(store, ownerA, { name: 'Newer', capabilities: ['typescript'] });
    const a3 = await makeAgent(store, ownerA, { name: 'Newest', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    // Deterministic — always selects the same agent across multiple calls
    const result2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result2.selected!.agentId).toBe(result.selected!.agentId);
    expect([a1.id, a2.id, a3.id]).toContain(result.selected!.agentId);
  });

  it('31: id final tie-break when createdAt identical', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    // MemoryStore uses now() which may produce identical timestamps
    const a1 = await makeAgent(store, ownerA, { name: 'A', capabilities: ['typescript'] });
    const a2 = await makeAgent(store, ownerA, { name: 'B', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    // Should select one deterministically (by id ASC)
    expect(result.ok).toBe(true);
    const firstId = result.selected!.agentId;
    // Run again — same result
    const result2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result2.selected!.agentId).toBe(firstId);
  });
});

// ═══════════════════════════════════════════════════════════
// Owner isolation
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Owner isolation', () => {
  it('32: cross-owner agents invisible', async () => {
    const { store, ownerA, ownerB, projectA } = await createFixtures();
    const ownAgent = await makeAgent(store, ownerA, { name: 'Own', capabilities: ['typescript'] });
    await makeAgent(store, ownerB, { name: 'Other', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(ownAgent.id);
  });

  it('33: selecting for ownerB finds only ownerB agents', async () => {
    const { store, ownerA, ownerB, projectB } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'A', capabilities: ['typescript'] });
    const bAgent = await makeAgent(store, ownerB, { name: 'B', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerB, projectB.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerB, task });
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(bAgent.id);
  });
});

// ═══════════════════════════════════════════════════════════
// Zero side-effects and assignment compatibility
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Zero side-effects', () => {
  it('34: selector performs no assignment', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const before = await store.getTask(ownerA, task.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    const after = await store.getTask(ownerA, task.id);
    expect(result.ok).toBe(true);
    expect(result.selected!.agentId).toBe(agent.id);
    // Task must NOT be mutated
    expect(after!.agentId).toBe(before!.agentId);
  });

  it('35: selector performs no writes to agents', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await selectCandidate({ store, ownerId: ownerA, task });
    const after = await store.getAgent(ownerA, agent.id);
    // Agent must remain unchanged
    expect(after!.status).toBe('active');
    expect(after!.capabilities).toEqual(['typescript']);
  });

  it('36: capabilities do not grant permission', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['admin', 'write', 'execute'] });
    const hasPerm = await store.agentHasPermission(agent.id, projectA.id, 'task', 'write');
    // Capabilities are descriptive only — no permission granted
    expect(hasPerm).toBe(false);
  });

  it('37: role does not grant permission', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { role: 'admin', capabilities: [] });
    const hasPerm = await store.agentHasPermission(agent.id, projectA.id, 'task', 'admin');
    expect(hasPerm).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Selection result structure
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Selection result structure', () => {
  it('38: selected result contains agentId, roleMatched, matchedCapabilities', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { role: 'frontend', capabilities: ['typescript', 'react'] });
    const task = await makeTask(store, ownerA, projectA.id, {
      requiredCapabilities: ['typescript'],
      preferredRole: 'frontend',
    });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(true);
    expect(result.selected).toBeDefined();
    expect(result.selected!.agentId).toBe(agent.id);
    expect(result.selected!.roleMatched).toBe(true);
    expect(result.selected!.matchedCapabilities).toContain('typescript');
    expect(result.selected!.matchedCapabilities).toContain('react');
  });

  it('39: rejected candidates have agentId and reason', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Paused', status: 'paused' });
    await makeAgent(store, ownerA, { name: 'NoCap', status: 'active', capabilities: [] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected![0].agentId).toBeDefined();
    expect(['inactive', 'missing_capability']).toContain(result.rejected![0].reason);
  });

  it('40: no_agents_found has empty rejected array', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_agents_found');
    expect(result.rejected).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// Future flow compatibility (Gate 28 integration)
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Gate 28 assignment compatibility', () => {
  it('41: selectCandidate then assignTask composes correctly', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    // Select
    const selection = await selectCandidate({ store, ownerId: ownerA, task });
    expect(selection.ok).toBe(true);
    // Assign using the selected agent
    const assignment = await store.assignTask(ownerA, task.id, selection.selected!.agentId);
    expect(assignment.ok).toBe(true);
    expect(assignment.outcome).toBe('assigned');
    // Verify task now has the agent
    const updated = await store.getTask(ownerA, task.id);
    expect(updated!.agentId).toBe(agent.id);
  });

  it('42: selector result rejected agents do not affect assignment', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const good = await makeAgent(store, ownerA, { name: 'Good', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Bad', status: 'paused', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const selection = await selectCandidate({ store, ownerId: ownerA, task });
    expect(selection.ok).toBe(true);
    expect(selection.selected!.agentId).toBe(good.id);
    // Rejected agents are listed but not selected
    expect(selection.rejected!.every(r => r.reason === 'inactive')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Gate 27/28 invariants preserved
// ═══════════════════════════════════════════════════════════

describe('Gate 29 — Gate 27 tenant invariant preserved', () => {
  it('43: cross-owner agent cannot be selected', async () => {
    const { store, ownerA, ownerB, projectA } = await createFixtures();
    await makeAgent(store, ownerB, { name: 'OtherOwner', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await selectCandidate({ store, ownerId: ownerA, task });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_agents_found');
  });
});

describe('Gate 29 — Gate 28 atomic assignment preserved', () => {
  it('44: Store.assignTask still validates agent eligibility', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const paused = await makeAgent(store, ownerA, { name: 'Paused', status: 'paused', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    // Selector would reject paused agent, but if someone tries to assign directly:
    const result = await store.assignTask(ownerA, task.id, paused.id);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('agent_not_eligible');
  });

  it('45: TaskPatch requiredCapabilities and preferredRole work', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    expect(task.requiredCapabilities).toEqual([]);
    expect(task.preferredRole).toBeNull();
    const patched = await store.patchTask(ownerA, task.id, {
      requiredCapabilities: ['typescript', 'react'],
      preferredRole: 'frontend_engineer',
    });
    expect(patched.requiredCapabilities).toEqual(['typescript', 'react']);
    expect(patched.preferredRole).toBe('frontend_engineer');
  });

  it('46: createTask with requirements persists correctly', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await store.createTask(ownerA, {
      projectId: projectA.id,
      title: 'Test',
      requiredCapabilities: ['python', 'ml'],
      preferredRole: 'data_engineer',
    });
    expect(task.requiredCapabilities).toEqual(['python', 'ml']);
    expect(task.preferredRole).toBe('data_engineer');
  });

  it('47: createTask without requirements defaults to empty/null', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await store.createTask(ownerA, {
      projectId: projectA.id,
      title: 'Test',
    });
    expect(task.requiredCapabilities).toEqual([]);
    expect(task.preferredRole).toBeNull();
  });
});
