// CHEF FACTORY — Gate 25 — Agent Identity, Definition & Registry Foundation.
// Proves agent domain contract, persistence, validation, and security invariants.

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import type { Store } from '../core/ports.js';
import type { AgentRecord, AgentDefinition, AgentPatch } from '../core/types.js';
import {
  isAgentStatus,
  isAgentRole,
  isAgentCapabilities,
} from '../core/runtimeGuard.js';

let store: Store;
const OWNER = 'owner-g25';

beforeEach(() => {
  store = new MemoryStore();
});

const DEF: AgentDefinition = {
  name: 'Test Agent',
  role: 'backend_engineer',
  description: 'A test agent',
  capabilities: ['code_review', 'testing'],
};

async function createAgent(overrides?: Partial<AgentDefinition>): Promise<AgentRecord> {
  return store.createAgent(OWNER, { ...DEF, ...overrides });
}

// ================================================================
// 1. Runtime Validation
// ================================================================

describe('Gate 25 — Runtime Guard Helpers', () => {
  describe('isAgentStatus', () => {
    it('accepts valid statuses', () => {
      expect(isAgentStatus('active')).toBe(true);
      expect(isAgentStatus('paused')).toBe(true);
      expect(isAgentStatus('retired')).toBe(true);
      expect(isAgentStatus('suspended')).toBe(true);
    });

    it('rejects invalid statuses', () => {
      expect(isAgentStatus('banana')).toBe(false);
      expect(isAgentStatus('')).toBe(false);
      expect(isAgentStatus('ACTIVE')).toBe(false);
      expect(isAgentStatus('active ')).toBe(false);
      expect(isAgentStatus(null)).toBe(false);
      expect(isAgentStatus(undefined)).toBe(false);
      expect(isAgentStatus(42)).toBe(false);
      expect(isAgentStatus('deleted')).toBe(false);
      expect(isAgentStatus('pending')).toBe(false);
    });
  });

  describe('isAgentRole', () => {
    it('accepts valid roles', () => {
      expect(isAgentRole('backend_engineer')).toBe(true);
      expect(isAgentRole('qa_engineer')).toBe(true);
      expect(isAgentRole('product_manager')).toBe(true);
      expect(isAgentRole('devops-engineer')).toBe(true);
      expect(isAgentRole('a')).toBe(true);
    });

    it('rejects invalid roles', () => {
      expect(isAgentRole('')).toBe(false);
      expect(isAgentRole('  ')).toBe(false);
      expect(isAgentRole(null)).toBe(false);
      expect(isAgentRole(undefined)).toBe(false);
      expect(isAgentRole(42)).toBe(false);
    });

    it('rejects overly long roles', () => {
      expect(isAgentRole('x'.repeat(65))).toBe(false);
    });

    it('accepts roles at max length', () => {
      expect(isAgentRole('x'.repeat(64))).toBe(true);
    });
  });

  describe('isAgentCapabilities', () => {
    it('accepts valid capability arrays', () => {
      expect(isAgentCapabilities([])).toBe(true);
      expect(isAgentCapabilities(['code_review'])).toBe(true);
      expect(isAgentCapabilities(['code_review', 'testing', 'deployment'])).toBe(true);
    });

    it('rejects invalid capability structures', () => {
      expect(isAgentCapabilities('banana')).toBe(false);
      expect(isAgentCapabilities(null)).toBe(false);
      expect(isAgentCapabilities(undefined)).toBe(false);
      expect(isAgentCapabilities([42])).toBe(false);
      expect(isAgentCapabilities([''])).toBe(false);
      expect(isAgentCapabilities(['  '])).toBe(false);
      expect(isAgentCapabilities([null])).toBe(false);
    });

    it('rejects overly long capability strings', () => {
      expect(isAgentCapabilities(['x'.repeat(129)])).toBe(false);
    });

    it('accepts capabilities at max length', () => {
      expect(isAgentCapabilities(['x'.repeat(128)])).toBe(true);
    });
  });
});

// ================================================================
// 2. Agent CRUD Lifecycle
// ================================================================

describe('Gate 25 — Agent CRUD Lifecycle', () => {
  describe('createAgent', () => {
    it('creates an agent with all fields', async () => {
      const agent = await createAgent();
      expect(agent.id).toBeTruthy();
      expect(agent.ownerId).toBe(OWNER);
      expect(agent.name).toBe('Test Agent');
      expect(agent.slug).toBe('test-agent');
      expect(agent.role).toBe('backend_engineer');
      expect(agent.description).toBe('A test agent');
      expect(agent.capabilities).toEqual(['code_review', 'testing']);
      expect(agent.status).toBe('active');
      expect(agent.createdAt).toBeTruthy();
      expect(agent.updatedAt).toBeTruthy();
    });

    it('auto-generates slug from name', async () => {
      const agent = await createAgent({ name: 'My Cool Agent!!!', slug: undefined });
      expect(agent.slug).toBe('my-cool-agent');
    });

    it('uses explicit slug when provided', async () => {
      const agent = await createAgent({ slug: 'custom-slug' });
      expect(agent.slug).toBe('custom-slug');
    });

    it('defaults status to active', async () => {
      const agent = await store.createAgent(OWNER, { name: 'A', role: 'r' });
      expect(agent.status).toBe('active');
    });

    it('defaults capabilities to empty array', async () => {
      const agent = await store.createAgent(OWNER, { name: 'A', role: 'r' });
      expect(agent.capabilities).toEqual([]);
    });

    it('defaults description to null', async () => {
      const agent = await store.createAgent(OWNER, { name: 'A', role: 'r' });
      expect(agent.description).toBeNull();
    });

    it('rejects duplicate slug within same owner', async () => {
      await createAgent({ slug: 'my-agent' });
      await expect(createAgent({ slug: 'my-agent' })).rejects.toThrow(/slug.*already exists/i);
    });

    it('allows same slug for different owners', async () => {
      await createAgent({ slug: 'shared-slug' });
      const agent2 = await store.createAgent('other-owner', { name: 'Other', role: 'r', slug: 'shared-slug' });
      expect(agent2.slug).toBe('shared-slug');
      expect(agent2.ownerId).toBe('other-owner');
    });
  });

  describe('getAgent', () => {
    it('returns agent by id', async () => {
      const created = await createAgent();
      const fetched = await store.getAgent(OWNER, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe(created.name);
    });

    it('returns null for non-existent agent', async () => {
      const result = await store.getAgent(OWNER, 'non-existent-id');
      expect(result).toBeNull();
    });

    it('respects owner isolation', async () => {
      const created = await createAgent();
      const result = await store.getAgent('other-owner', created.id);
      expect(result).toBeNull();
    });
  });

  describe('listAgents', () => {
    it('returns empty array when no agents', async () => {
      const agents = await store.listAgents(OWNER);
      expect(agents).toEqual([]);
    });

    it('returns all agents for owner', async () => {
      await createAgent({ name: 'Agent A', slug: 'agent-a' });
      await createAgent({ name: 'Agent B', slug: 'agent-b' });
      const agents = await store.listAgents(OWNER);
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name).sort()).toEqual(['Agent A', 'Agent B']);
    });

    it('returns full AgentRecord with all fields', async () => {
      await createAgent();
      const agents = await store.listAgents(OWNER);
      const agent = agents[0]!;
      expect(agent.id).toBeTruthy();
      expect(agent.ownerId).toBe(OWNER);
      expect(agent.name).toBe('Test Agent');
      expect(agent.slug).toBe('test-agent');
      expect(agent.role).toBe('backend_engineer');
      expect(agent.capabilities).toEqual(['code_review', 'testing']);
      expect(agent.status).toBe('active');
      expect(agent.createdAt).toBeTruthy();
      expect(agent.updatedAt).toBeTruthy();
    });

    it('does not return agents from other owners', async () => {
      await createAgent({ name: 'Mine', slug: 'mine' });
      await store.createAgent('other-owner', { name: 'Theirs', role: 'r', slug: 'theirs' });
      const agents = await store.listAgents(OWNER);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe('Mine');
    });
  });

  describe('patchAgent', () => {
    it('patches name', async () => {
      const created = await createAgent();
      const patched = await store.patchAgent(OWNER, created.id, { name: 'New Name' });
      expect(patched.name).toBe('New Name');
      expect(patched.role).toBe('backend_engineer');
    });

    it('patches role', async () => {
      const created = await createAgent();
      const patched = await store.patchAgent(OWNER, created.id, { role: 'qa_engineer' });
      expect(patched.role).toBe('qa_engineer');
      expect(patched.name).toBe('Test Agent');
    });

    it('patches status', async () => {
      const created = await createAgent();
      const patched = await store.patchAgent(OWNER, created.id, { status: 'paused' });
      expect(patched.status).toBe('paused');
    });

    it('patches capabilities', async () => {
      const created = await createAgent();
      const patched = await store.patchAgent(OWNER, created.id, { capabilities: ['new_cap'] });
      expect(patched.capabilities).toEqual(['new_cap']);
    });

    it('patches description to null', async () => {
      const created = await createAgent();
      const patched = await store.patchAgent(OWNER, created.id, { description: null });
      expect(patched.description).toBeNull();
    });

    it('partial patch preserves untouched fields', async () => {
      const created = await createAgent({ name: 'Original', role: 'backend_engineer', capabilities: ['cap1'] });
      const patched = await store.patchAgent(OWNER, created.id, { name: 'Changed' });
      expect(patched.name).toBe('Changed');
      expect(patched.role).toBe('backend_engineer');
      expect(patched.capabilities).toEqual(['cap1']);
      expect(patched.slug).toBe('original');
      expect(patched.status).toBe('active');
      expect(patched.description).toBe('A test agent');
    });

    it('updates updatedAt timestamp', async () => {
      const created = await createAgent();
      const patched = await store.patchAgent(OWNER, created.id, { name: 'Updated' });
      expect(patched.updatedAt >= created.updatedAt).toBe(true);
    });

    it('throws for non-existent agent', async () => {
      await expect(store.patchAgent(OWNER, 'non-existent', { name: 'X' })).rejects.toThrow(/not found/i);
    });

    it('throws on empty patch', async () => {
      const created = await createAgent();
      await expect(store.patchAgent(OWNER, created.id, {})).rejects.toThrow();
    });
  });
});

// ================================================================
// 3. Security Invariants
// ================================================================

describe('Gate 25 — Security: Existence ≠ Permission', () => {
  it('creating an agent does NOT grant it permissions', async () => {
    const agent = await createAgent();
    const hasPermission = await store.agentHasPermission(agent.id, null, 'tasks', 'read');
    expect(hasPermission).toBe(false);
  });

  it('setting a role does NOT grant authority', async () => {
    const agent = await createAgent({ role: 'admin' });
    const hasPermission = await store.agentHasPermission(agent.id, null, 'tasks', 'write');
    expect(hasPermission).toBe(false);
  });

  it('setting capabilities does NOT bypass RBAC', async () => {
    const agent = await createAgent({ capabilities: ['admin', 'superuser', 'execute'] });
    const hasPermission = await store.agentHasPermission(agent.id, null, 'tasks', 'execute');
    expect(hasPermission).toBe(false);
  });

  it('changing status to active does NOT auto-grant permissions', async () => {
    const agent = await createAgent({ status: 'paused' });
    await store.patchAgent(OWNER, agent.id, { status: 'active' });
    const hasPermission = await store.agentHasPermission(agent.id, null, 'tasks', 'read');
    expect(hasPermission).toBe(false);
  });
});

describe('Gate 25 — Security: Self-Escalation Defense', () => {
  it('agent record exists but cannot self-modify via store', async () => {
    const agent = await createAgent({ role: 'viewer' });
    const fetched = await store.getAgent(OWNER, agent.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.role).toBe('viewer');
    expect(fetched!.status).toBe('active');
  });

  it('capabilities are descriptive, not authoritative', async () => {
    const agent = await createAgent({ capabilities: ['approve', 'admin', 'deploy'] });
    const perm1 = await store.agentHasPermission(agent.id, null, 'tasks', 'approve');
    const perm2 = await store.agentHasPermission(agent.id, null, 'projects', 'admin');
    const perm3 = await store.agentHasPermission(agent.id, null, 'tasks', 'write');
    expect(perm1).toBe(false);
    expect(perm2).toBe(false);
    expect(perm3).toBe(false);
  });

  it('role is descriptive, not a permission grant', async () => {
    const agent = await createAgent({ role: 'owner' });
    const perm = await store.agentHasPermission(agent.id, null, 'tasks', 'admin');
    expect(perm).toBe(false);
  });
});

// ================================================================
// 4. Domain Contract Validation
// ================================================================

describe('Gate 25 — AgentRecord Contract', () => {
  it('AgentRecord has all required fields', async () => {
    const agent = await createAgent();
    const keys: (keyof AgentRecord)[] = [
      'id', 'ownerId', 'name', 'slug', 'role', 'description',
      'capabilities', 'status', 'createdAt', 'updatedAt',
    ];
    for (const key of keys) {
      expect(agent).toHaveProperty(key);
    }
  });

  it('capabilities is always an array of strings', async () => {
    const agent = await createAgent({ capabilities: ['a', 'b', 'c'] });
    expect(Array.isArray(agent.capabilities)).toBe(true);
    agent.capabilities.forEach((c) => expect(typeof c).toBe('string'));
  });

  it('status is a valid AgentStatus value', async () => {
    const agent = await createAgent();
    expect(isAgentStatus(agent.status)).toBe(true);
  });

  it('timestamps are ISO strings', async () => {
    const agent = await createAgent();
    expect(new Date(agent.createdAt).toISOString()).toBe(agent.createdAt);
    expect(new Date(agent.updatedAt).toISOString()).toBe(agent.updatedAt);
  });
});

describe('Gate 25 — AgentDefinition Contract', () => {
  it('accepts minimal definition (name + role only)', async () => {
    const agent = await store.createAgent(OWNER, { name: 'Minimal', role: 'r' });
    expect(agent.name).toBe('Minimal');
    expect(agent.role).toBe('r');
    expect(agent.capabilities).toEqual([]);
    expect(agent.description).toBeNull();
    expect(agent.status).toBe('active');
  });

  it('accepts full definition', async () => {
    const agent = await createAgent({
      name: 'Full',
      slug: 'full-agent',
      role: 'qa_engineer',
      description: 'QA specialist',
      capabilities: ['testing', 'review'],
      status: 'paused',
    });
    expect(agent.name).toBe('Full');
    expect(agent.slug).toBe('full-agent');
    expect(agent.role).toBe('qa_engineer');
    expect(agent.description).toBe('QA specialist');
    expect(agent.capabilities).toEqual(['testing', 'review']);
    expect(agent.status).toBe('paused');
  });
});
