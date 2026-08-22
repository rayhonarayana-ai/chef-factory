import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { SupabaseStore } from '../db/repo.js';
import { selectCandidate } from './selector.js';
import { placeTask } from './placement.js';
import type { AgentRecord } from './types.js';
import type { Store } from './ports.js';

const pool = new Pool({
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.dybyidtcyzgliupzzfhl',
  password: process.env.FACTORY_DB_PASSWORD!,
  ssl: { rejectUnauthorized: false },
  max: 20,
});

function createStore(): SupabaseStore {
  return new SupabaseStore(pool);
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let OWNER = '';
let PROJECT_ID = '';
const disposableAgentIds: string[] = [];
const disposableTaskIds: string[] = [];

beforeAll(async () => {
  const ownerRes = await pool.query('SELECT id FROM public.owners LIMIT 1');
  const existingOwner = ownerRes.rows[0]?.id;
  if (!existingOwner) throw new Error('No owner found in public.owners');
  OWNER = existingOwner;
  const res = await pool.query(
    'INSERT INTO public.projects (owner_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
    [OWNER, 'Gate31 Live Test', 'gate31-live-' + uuid()],
  );
  PROJECT_ID = res.rows[0].id;
});

function makePool(max = 1): Pool {
  return new Pool({
    host: 'aws-1-eu-west-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.dybyidtcyzgliupzzfhl',
    password: process.env.FACTORY_DB_PASSWORD!,
    ssl: { rejectUnauthorized: false },
    max,
  });
}

afterAll(async () => {
  for (const tid of disposableTaskIds) {
    await pool.query('DELETE FROM public.tasks WHERE id = $1 AND owner_id = $2', [tid, OWNER]).catch(() => {});
  }
  for (const aid of disposableAgentIds) {
    await pool.query('DELETE FROM public.agents WHERE id = $1 AND owner_id = $2', [aid, OWNER]).catch(() => {});
  }
  await pool.query('DELETE FROM public.projects WHERE owner_id = $1', [OWNER]).catch(() => {});
  await pool.end();
});

async function createAgent(s: Store, overrides: Partial<{ name: string; role: string; status: AgentRecord['status']; capabilities: string[]; maxConcurrentTasks: number }> = {}): Promise<AgentRecord> {
  const a = await s.createAgent(OWNER, {
    name: overrides.name ?? 'agent-' + uuid(),
    role: overrides.role ?? 'worker',
    status: overrides.status ?? 'active',
    capabilities: overrides.capabilities ?? [],
    maxConcurrentTasks: overrides.maxConcurrentTasks,
  });
  disposableAgentIds.push(a.id);
  return a;
}

async function createTask(s: Store, overrides: Partial<{ title: string; requiredCapabilities: string[]; preferredRole: string | null }> = {}) {
  const t = await s.createTask(OWNER, {
    projectId: PROJECT_ID,
    title: overrides.title ?? 'task-' + uuid(),
    requiredCapabilities: overrides.requiredCapabilities,
    preferredRole: overrides.preferredRole,
  });
  disposableTaskIds.push(t.id);
  return t;
}

// ===== Step 7: Live Store Parity =====
describe('Gate 31 Live - Step 7: Store Parity', () => {
  const s = createStore();
  it('A: default capacity = 1', async () => {
    const a = await createAgent(s, { name: 'default-cap' });
    expect(a.maxConcurrentTasks).toBe(1);
  });
  it('B: capacity=2', async () => {
    const a = await createAgent(s, { name: 'cap-2', maxConcurrentTasks: 2 });
    expect(a.maxConcurrentTasks).toBe(2);
  });
  it('C: capacity=0', async () => {
    const a = await createAgent(s, { name: 'cap-0', maxConcurrentTasks: 0 });
    expect(a.maxConcurrentTasks).toBe(0);
  });
  it('D: patch capacity 2 to 3', async () => {
    const a = await createAgent(s, { name: 'patch-cap', maxConcurrentTasks: 2 });
    const patched = await s.patchAgent(OWNER, a.id, { maxConcurrentTasks: 3 });
    expect(patched.maxConcurrentTasks).toBe(3);
  });
  it('E: negative rejected', async () => {
    await expect(s.createAgent(OWNER, { name: 'neg', maxConcurrentTasks: -1 })).rejects.toThrow();
  });
  it('F: fractional rejected', async () => {
    await expect(s.createAgent(OWNER, { name: 'frac', maxConcurrentTasks: 1.5 })).rejects.toThrow();
  });
});

// ===== Step 8: Live Batch Workload =====
describe('Gate 31 Live - Step 8: Batch Workload', () => {
  const s = createStore();
  it('workload counts assigned non-terminal, excludes terminal', async () => {
    const agent = await createAgent(s, { name: 'wl-agent', maxConcurrentTasks: 10 });
    const statuses = ['created', 'queued', 'running', 'completed', 'failed', 'cancelled'];
    for (const st of statuses) {
      const t = await createTask(s, { title: 'wl-' + st });
      await s.assignTaskIfUnassigned(OWNER, t.id, agent.id);
      if (st !== 'created') await s.patchTask(OWNER, t.id, { status: st });
    }
    const wl = await s.listAgentWorkload(OWNER);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a).toBeDefined();
    expect(a.assignedCount).toBe(3);
    expect(a.runningCount).toBe(1);
  });
  it('cross-owner workload hidden', async () => {
    const ownerRes = await pool.query('SELECT id FROM public.owners WHERE id != $1 LIMIT 1', [OWNER]);
    const otherOwner = ownerRes.rows[0]?.id;
    if (!otherOwner) { return; }
    const projIns = await pool.query('INSERT INTO public.projects (owner_id, name, slug) VALUES ($1,$2,$3) RETURNING id', [otherOwner, 'Other', 'oth-' + uuid()]);
    const otherProj = projIns.rows[0]?.id as string;
    const agRes = await pool.query('INSERT INTO public.agents (owner_id, name, slug, role, capabilities, status) VALUES ($1,$2,$3,\'worker\',\'[]\'::jsonb,\'active\') RETURNING id', [otherOwner, 'other-ag', 'oag-' + uuid()]);
    const otherAgId = agRes.rows[0]?.id as string;
    const tRes = await pool.query('INSERT INTO public.tasks (owner_id, project_id, title, status, agent_id) VALUES ($1,$2,\'otask\',\'created\',$3) RETURNING id', [otherOwner, otherProj, otherAgId]);
    const otherTid = tRes.rows[0]?.id as string;
    const wl = await s.listAgentWorkload(OWNER);
    expect(wl.find((w) => w.agentId === otherAgId)).toBeUndefined();
    await pool.query('DELETE FROM public.tasks WHERE id=$1', [otherTid]);
    await pool.query('DELETE FROM public.agents WHERE id=$1', [otherAgId]);
    await pool.query('DELETE FROM public.projects WHERE id=$1', [otherProj]);
  });
});

// ===== Step 9: Zero-Workload =====
describe('Gate 31 Live - Step 9: Zero-Workload Agent', () => {
  it('zero workload = available', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'zero-wl', maxConcurrentTasks: 2 });
    const task = await createTask(s, { title: 'zero-wl-task' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task });
    expect(sel.ok).toBe(true);
    const rejSelf = sel.rejected?.find((r) => r.agentId === agent.id);
    expect(rejSelf).toBeUndefined();
  });
});

// ===== Step 10: Selector Availability =====
describe('Gate 31 Live - Step 10: Selector Availability', () => {
  const s = createStore();
  it('A: active + below capacity -> eligible', async () => {
    const agent = await createAgent(s, { name: 'avail-a', maxConcurrentTasks: 1 });
    const task = await createTask(s, { title: 'avail-a-t' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task });
    expect(sel.ok).toBe(true);
  });
  it('B: active + at capacity -> unavailable', async () => {
    const agent = await createAgent(s, { name: 'avail-b', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'avail-b-t1' });
    await s.assignTaskIfUnassigned(OWNER, t1.id, agent.id);
    const t2 = await createTask(s, { title: 'avail-b-t2' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task: t2 });
    const rej = sel.rejected?.find((r) => r.agentId === agent.id);
    expect(rej?.reason).toBe('at_capacity');
  });
  it('C: capacity=0 -> unavailable', async () => {
    const agent = await createAgent(s, { name: 'avail-c', maxConcurrentTasks: 0 });
    const task = await createTask(s, { title: 'avail-c-t' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task });
    const rej = sel.rejected?.find((r) => r.agentId === agent.id);
    expect(rej?.reason).toBe('capacity_zero');
  });
  it('D: paused -> unavailable', async () => {
    const agent = await createAgent(s, { name: 'avail-d', status: 'paused' });
    const task = await createTask(s, { title: 'avail-d-t' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task });
    const rej = sel.rejected?.find((r) => r.agentId === agent.id);
    expect(rej?.reason).toBe('inactive');
  });
  it('E: retired -> unavailable', async () => {
    const agent = await createAgent(s, { name: 'avail-e', status: 'retired' });
    const task = await createTask(s, { title: 'avail-e-t' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task });
    const rej = sel.rejected?.find((r) => r.agentId === agent.id);
    expect(rej?.reason).toBe('inactive');
  });
  it('F: suspended -> unavailable', async () => {
    const agent = await createAgent(s, { name: 'avail-f', status: 'suspended' });
    const task = await createTask(s, { title: 'avail-f-t' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task });
    const rej = sel.rejected?.find((r) => r.agentId === agent.id);
    expect(rej?.reason).toBe('inactive');
  });
  it('SELECTION_HAS_SIDE_EFFECTS = NO', async () => {
    const s2 = createStore();
    const agent = await createAgent(s2, { name: 'readonly' });
    const task = await createTask(s2, { title: 'readonly-t' });
    const sel = await selectCandidate({ store: s2, ownerId: OWNER, task });
    expect(sel.ok).toBe(true);
    const t2 = await s2.getTask(OWNER, task.id);
    expect(t2!.agentId).toBeNull();
  });
});

// ===== Step 11: Utilization Ranking =====
describe('Gate 31 Live - Step 11: Utilization Ranking', () => {
  it('lower utilization preferred', async () => {
    const s = createStore();
    const existingAgents = await pool.query('SELECT id FROM public.agents WHERE owner_id = $1', [OWNER]);
    const excludeIds = existingAgents.rows.map((r) => r.id as string);
    const agA = await createAgent(s, { name: 'rank-busy', maxConcurrentTasks: 2 });
    const tBusy = await createTask(s, { title: 'rank-busy-t' });
    await s.assignTaskIfUnassigned(OWNER, tBusy.id, agA.id);
    const agB = await createAgent(s, { name: 'rank-idle', maxConcurrentTasks: 10 });
    const tIdle = await createTask(s, { title: 'rank-idle-t' });
    await s.assignTaskIfUnassigned(OWNER, tIdle.id, agB.id);
    const task = await createTask(s, { title: 'rank-test' });
    const sel = await selectCandidate({ store: s, ownerId: OWNER, task, excludeAgentIds: excludeIds });
    expect(sel.ok).toBe(true);
    expect(sel.selected!.agentId).toBe(agB.id);
  });
});

// ===== Step 12: agent_at_capacity =====
describe('Gate 31 Live - Step 12: agent_at_capacity contract', () => {
  it('agent_at_capacity is distinct retryable outcome', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'cap-test', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'cap-t1' });
    const r1 = await s.assignTaskIfUnassigned(OWNER, t1.id, agent.id);
    expect(r1.ok).toBe(true);
    expect(r1.outcome).toBe('assigned');
    const t2 = await createTask(s, { title: 'cap-t2' });
    const r2 = await s.assignTaskIfUnassigned(OWNER, t2.id, agent.id);
    expect(r2.ok).toBe(false);
    expect(r2.outcome).toBe('agent_at_capacity');
  });
});

// ===== Step 13-14: Live Capacity Race + Physical Concurrency =====
describe('Gate 31 Live - Step 13-14: Capacity Race', () => {
  it('concurrent placement: exactly one wins, no overflow', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'race-agent', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'race-t1' });
    const t2 = await createTask(s, { title: 'race-t2' });
    const p1 = makePool(1);
    const p2 = makePool(1);
    const s1 = new SupabaseStore(p1);
    const s2 = new SupabaseStore(p2);
    const [r1, r2] = await Promise.all([
      s1.assignTaskIfUnassigned(OWNER, t1.id, agent.id),
      s2.assignTaskIfUnassigned(OWNER, t2.id, agent.id),
    ]);
    const assigned = [r1, r2].filter((r) => r.ok && r.outcome === 'assigned');
    const atCap = [r1, r2].filter((r) => !r.ok && r.outcome === 'agent_at_capacity');
    expect(assigned.length).toBe(1);
    expect(atCap.length).toBe(1);
    const wl = await s.listAgentWorkload(OWNER);
    const w = wl.find((x) => x.agentId === agent.id)!;
    expect(w.assignedCount).toBe(1);
    await p1.end();
    await p2.end();
  });

  it('physical concurrency proven via pg_sleep overlap', async () => {
    const p1 = makePool(1);
    const p2 = makePool(1);
    const agent = await createAgent(createStore(), { name: 'sleep-agent', maxConcurrentTasks: 5 });
    const start = Date.now();
    const t1 = p1.query('BEGIN');
    const t2 = p2.query('BEGIN');
    await Promise.all([t1, t2]);
    await p1.query('SELECT id FROM public.agents WHERE id = $1 AND owner_id = $2 FOR UPDATE', [agent.id, OWNER]);
    const blocker = p1.query("SELECT pg_sleep(0.3)");
    const waiter = p2.query('SELECT id FROM public.agents WHERE id = $1 AND owner_id = $2 FOR UPDATE', [agent.id, OWNER]).then(() => 'unblocked');
    const [, wResult] = await Promise.all([blocker, waiter]);
    expect(wResult).toBe('unblocked');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(250);
    await p1.query('ROLLBACK');
    await p2.query('ROLLBACK');
    await p1.end();
    await p2.end();
  });
});

// ===== Step 15: Fallback Agent Retry =====
describe('Gate 31 Live - Step 15: Fallback Agent Retry', () => {
  it('agent fills -> other agent selected via placement', async () => {
    const s = createStore();
    const agA = await createAgent(s, { name: 'fb-a', maxConcurrentTasks: 1 });
    const agB = await createAgent(s, { name: 'fb-b', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'fb-t1' });
    const t2 = await createTask(s, { title: 'fb-t2' });
    const r1 = await placeTask({ store: s, ownerId: OWNER, taskId: t1.id, actorId: OWNER });
    expect(r1.ok).toBe(true);
    expect(r1.outcome).toBe('placed');
    const r2 = await placeTask({ store: s, ownerId: OWNER, taskId: t2.id, actorId: OWNER });
    expect(r2.ok).toBe(true);
    expect(r2.outcome).toBe('placed');
    expect(r1.selectedAgentId).not.toBe(r2.selectedAgentId);
  });
});

// ===== Step 16: Task Race vs Capacity Race =====
describe('Gate 31 Live - Step 16: Task vs Capacity Race', () => {
  it('same task race -> already_assigned', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'tr-agent', maxConcurrentTasks: 10 });
    const t = await createTask(s, { title: 'tr-task' });
    const p1 = makePool(1);
    const p2 = makePool(1);
    const s1 = new SupabaseStore(p1);
    const s2 = new SupabaseStore(p2);
    const [r1, r2] = await Promise.all([
      s1.assignTaskIfUnassigned(OWNER, t.id, agent.id),
      s2.assignTaskIfUnassigned(OWNER, t.id, agent.id),
    ]);
    const assigned = [r1, r2].filter((r) => r.ok && r.outcome === 'assigned');
    const already = [r1, r2].filter((r) => !r.ok && r.outcome === 'already_assigned');
    expect(assigned.length).toBe(1);
    expect(already.length).toBe(1);
    await p1.end();
    await p2.end();
  });
});

// ===== Step 17: Higher Contention =====
describe('Gate 31 Live - Step 17: Higher Contention', () => {
  it('2 agents cap 2, 10 tasks, max 4 placed, no overflow', async () => {
    const s = createStore();
    const agA = await createAgent(s, { name: 'hi-a', maxConcurrentTasks: 2 });
    const agB = await createAgent(s, { name: 'hi-b', maxConcurrentTasks: 2 });
    const tasks = [];
    for (let i = 0; i < 10; i++) tasks.push(await createTask(s, { title: 'hi-t' + i }));
    let placed = 0;
    const agents = [agA, agB];
    let agentIdx = 0;
    for (const t of tasks) {
      let assigned = false;
      for (let attempt = 0; attempt < agents.length; attempt++) {
        const ag = agents[(agentIdx + attempt) % agents.length]!;
        const r = await s.assignTaskIfUnassigned(OWNER, t.id, ag.id);
        if (r.ok && r.outcome === 'assigned') {
          placed++;
          agentIdx = (agentIdx + 1) % agents.length;
          assigned = true;
          break;
        }
      }
      void assigned;
    }
    expect(placed).toBeLessThanOrEqual(4);
    const wl = await s.listAgentWorkload(OWNER);
    for (const w of wl) {
      if (w.agentId !== agA.id && w.agentId !== agB.id) continue;
      const ag = await s.getAgent(OWNER, w.agentId);
      expect(w.assignedCount).toBeLessThanOrEqual(ag!.maxConcurrentTasks);
    }
  });
});

// ===== Step 18: Terminal Task Capacity Release =====
describe('Gate 31 Live - Step 18: Terminal Release', () => {
  it('completed frees capacity', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'rel-comp', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'rel-comp-t1' });
    await s.assignTaskIfUnassigned(OWNER, t1.id, agent.id);
    const t2 = await createTask(s, { title: 'rel-comp-t2' });
    const r2 = await s.assignTaskIfUnassigned(OWNER, t2.id, agent.id);
    expect(r2.ok).toBe(false);
    expect(r2.outcome).toBe('agent_at_capacity');
    await s.patchTask(OWNER, t1.id, { status: 'completed' });
    const r3 = await s.assignTaskIfUnassigned(OWNER, t2.id, agent.id);
    expect(r3.ok).toBe(true);
    expect(r3.outcome).toBe('assigned');
  });
  it('failed frees capacity', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'rel-fail', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'rel-fail-t1' });
    await s.assignTaskIfUnassigned(OWNER, t1.id, agent.id);
    await s.patchTask(OWNER, t1.id, { status: 'failed' });
    const t2 = await createTask(s, { title: 'rel-fail-t2' });
    const r = await s.assignTaskIfUnassigned(OWNER, t2.id, agent.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
  });
  it('cancelled frees capacity', async () => {
    const s = createStore();
    const agent = await createAgent(s, { name: 'rel-cancel', maxConcurrentTasks: 1 });
    const t1 = await createTask(s, { title: 'rel-cancel-t1' });
    await s.assignTaskIfUnassigned(OWNER, t1.id, agent.id);
    await s.patchTask(OWNER, t1.id, { status: 'cancelled' });
    const t2 = await createTask(s, { title: 'rel-cancel-t2' });
    const r = await s.assignTaskIfUnassigned(OWNER, t2.id, agent.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
  });
});
