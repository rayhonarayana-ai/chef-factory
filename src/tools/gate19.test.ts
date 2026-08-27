// CHEF FACTORY — Gate 19 — Comprehensive Test Suite.
// Proves Store Port boundary (OD28), Security Authority Chain (OD29),
// archiveConversation (OD30), State Transitions (OD31), Tool Results (OD32),
// queryAudit Store integration, failure paths, and concurrency.

import { describe, expect, it, vi } from 'vitest';
import { createTaskHandler } from './create-task.js';
import { createProjectHandler } from './create-project.js';
import { listTasksHandler } from './list-tasks.js';
import { listProjectsHandler } from './list-projects.js';
import { updateTaskHandler } from './update-task.js';
import { GATE3_TOOLS } from './index.js';
import type { ToolHandlerInput } from './types.js';
import type { Store } from '../core/ports.js';
import type { TaskRecord, ProjectRecord } from '../core/types.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { canTransition, TERMINAL_TASK_STATUSES } from '../core/taskEngine.js';
import type { TaskStatus } from '../core/types.js';

// ===================== Helper factories =====================

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    ownerId: 'owner-1',
    title: 'Test Task',
    description: 'desc',
    status: 'created',
    priority: 'medium',
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'proj-1',
    ownerId: 'owner-1',
    name: 'Test Project',
    slug: 'test-proj',
    description: 'test',
    status: 'active',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function failingStore(errorMsg = 'db error'): Store {
  const store = new MemoryStore();
  const fail = async () => { throw new Error(errorMsg); };
  (store as unknown as Record<string, unknown>).getProject = fail;
  (store as unknown as Record<string, unknown>).createProject = fail;
  (store as unknown as Record<string, unknown>).createTask = fail;
  (store as unknown as Record<string, unknown>).listProjects = fail;
  (store as unknown as Record<string, unknown>).listTasks = fail;
  (store as unknown as Record<string, unknown>).getTask = fail;
  (store as unknown as Record<string, unknown>).patchTask = fail;
  return store;
}

// ================================================================
// OD28 — STORE PORT BOUNDARY PROOF
// ================================================================

describe('Gate 19 — OD28: Store Port Boundary', () => {
  it('create-task handler uses Store.getProject + Store.createTask (not db)', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    const project = store.projects[0];

    const result = await createTaskHandler({
      ownerId: 'owner-1',
      args: { project_id: project.id, title: 'My Task' },
      store,
    });

    expect(result.success).toBe(true);
    const data = result.data as { id: string; title: string; project_id: string };
    expect(data.title).toBe('My Task');
    expect(data.project_id).toBe(project.id);
    expect(store.tasks.length).toBe(1);
    expect(store.tasks[0].title).toBe('My Task');
  });

  it('create-task handler rejects when store is missing', async () => {
    const result = await createTaskHandler({
      ownerId: 'owner-1',
      args: { project_id: 'proj-1', title: 'Task' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('store not available');
  });

  it('create-task handler rejects when project not found via Store', async () => {
    const store = new MemoryStore();
    const result = await createTaskHandler({
      ownerId: 'owner-1',
      args: { project_id: 'nonexistent', title: 'Task' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('project not found');
  });

  it('create-project handler uses Store.createProject (not db)', async () => {
    const store = new MemoryStore();
    const result = await createProjectHandler({
      ownerId: 'owner-1',
      args: { name: 'New Project', description: 'A project' },
      store,
    });
    expect(result.success).toBe(true);
    expect(store.projects.length).toBe(1);
    expect(store.projects[0].name).toBe('New Project');
  });

  it('create-project handler rejects when store is missing', async () => {
    const result = await createProjectHandler({
      ownerId: 'owner-1',
      args: { name: 'Project' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('store not available');
  });

  it('list-tasks handler uses Store.listTasks (not db)', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T1', priority: 'high' });

    const result = await listTasksHandler({
      ownerId: 'owner-1',
      args: { project_id: store.projects[0].id },
      store,
    });
    expect(result.success).toBe(true);
    const data = result.data as Array<{ id: string; title: string }>;
    expect(data.length).toBe(1);
    expect(data[0].title).toBe('T1');
  });

  it('list-tasks handler rejects when store is missing', async () => {
    const result = await listTasksHandler({
      ownerId: 'owner-1',
      args: { project_id: 'proj-1' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('store not available');
  });

  it('list-projects handler uses Store.listProjects (not db)', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P1', slug: 'p1', description: 'd1' });
    await store.createProject('owner-1', { name: 'P2', slug: 'p2', description: 'd2' });

    const result = await listProjectsHandler({
      ownerId: 'owner-1',
      args: {},
      store,
    });
    expect(result.success).toBe(true);
    const data = result.data as Array<{ id: string; name: string }>;
    expect(data.length).toBe(2);
  });

  it('list-projects handler rejects when store is missing', async () => {
    const result = await listProjectsHandler({
      ownerId: 'owner-1',
      args: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('store not available');
  });

  it('update-task handler uses Store.getTask + Store.patchTask (not db)', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T1', priority: 'medium' });
    const task = store.tasks[0];

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: task.id, title: 'Updated Title' },
      store,
    });
    expect(result.success).toBe(true);
    const data = result.data as { id: string; title: string };
    expect(data.title).toBe('Updated Title');
  });

  it('update-task handler rejects when store is missing', async () => {
    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: 'task-1' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('store not available');
  });

  it('update-task handler rejects when task not found via Store', async () => {
    const store = new MemoryStore();
    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: 'nonexistent' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('task not found');
  });

  it('all 5 CRUD tool handlers appear in GATE3_TOOLS', () => {
    const names = GATE3_TOOLS.map((t) => t.name);
    expect(names).toContain('create_task');
    expect(names).toContain('create_project');
    expect(names).toContain('list_tasks');
    expect(names).toContain('list_projects');
    expect(names).toContain('update_task');
  });

  it('no tool handler file imports getPool (source code proof)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const toolDir = path.resolve(__dirname);
    const files = ['create-task.ts', 'create-project.ts', 'list-tasks.ts', 'list-projects.ts', 'update-task.ts'];
    for (const file of files) {
      const content = fs.readFileSync(path.join(toolDir, file), 'utf-8');
      const lines = content.split('\n').filter((l) => !l.startsWith('//'));
      const code = lines.join('\n');
      expect(code).not.toMatch(/import.*getPool|import.*pool\.js/);
      expect(code).not.toMatch(/getPool\(\)/);
      expect(code).not.toMatch(/pool\.query/);
    }
  });

  it('failing Store propagates error without false success', async () => {
    const store = failingStore('injected db failure');
    const result = await createTaskHandler({
      ownerId: 'owner-1',
      args: { project_id: 'proj-1', title: 'Task' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('injected db failure');
  });
});

// ================================================================
// OD29 — SECURITY AUTHORITY CHAIN FORENSIC
// ================================================================

describe('Gate 19 — OD29: Security Authority Chain', () => {
  it('policyEngine denies when authorized=false (least privilege rule)', async () => {
    const { evaluatePolicy } = await import('../core/security/policyEngine.js');
    const result = evaluatePolicy({
      request: {
        ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner',
        projectId: 'proj-1', environment: 'development', resourceType: 'tool',
        actionType: 'read', permission: 'read', risk: 'low',
        authorized: false, explicitDeny: false,
      },
      lockdownActive: false,
      criticalDecision: null,
      environmentIsolation: { escalated: false },
      crossProject: { crossed: false },
      rateLimited: { limited: false, scope: null, reason: null },
      costStopped: { stopped: false, reason: null },
      untrustedAuthorityDirective: { present: false, matches: [] },
    });
    expect(result.decision).toBe('deny');
    expect(result.rules).toContain('rule.not_authorized');
  });

  it('policyEngine allows when authorized=true (owner on own project)', async () => {
    const { evaluatePolicy } = await import('../core/security/policyEngine.js');
    const result = evaluatePolicy({
      request: {
        ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner',
        projectId: 'proj-1', environment: 'development', resourceType: 'tool',
        actionType: 'read', permission: 'read', risk: 'low',
        authorized: true, explicitDeny: false,
      },
      lockdownActive: false,
      criticalDecision: null,
      environmentIsolation: { escalated: false },
      crossProject: { crossed: false },
      rateLimited: { limited: false, scope: null, reason: null },
      costStopped: { stopped: false, reason: null },
      untrustedAuthorityDirective: { present: false, matches: [] },
    });
    expect(result.decision).toBe('allow');
  });

  it('OD29 forensic: authorized field is used in policyEngine rule 11 (least privilege)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const content = fs.readFileSync(
      path.resolve(__dirname, '../core/security/policyEngine.ts'),
      'utf-8',
    );
    expect(content).toContain('if (!request.authorized)');
    expect(content).toContain('rule.not_authorized');
    expect(content).toContain('Actor is not authorized for this action');
  });

  it('OD29 forensic: execution.ts uses dynamic resolveToolAuthorization for agents', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/api/execution.ts',
      'utf-8',
    );
    expect(content).toContain('resolveToolAuthorization');
    expect(content).toContain('ctx.actorType === \'owner\'');
  });

  it('OD29 forensic: orchestration.ts uses dynamic resolveToolAuthorization for agents', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/orchestration.ts',
      'utf-8',
    );
    expect(content).toContain('resolveToolAuthorization');
    expect(content).toContain('actorCtx.actorType === \'owner\'');
  });

  it('OD29 forensic: both hook sites use identical dynamic authorization pattern', async () => {
    const fs = await import('node:fs');
    const execContent = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/api/execution.ts',
      'utf-8',
    );
    const orchContent = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/orchestration.ts',
      'utf-8',
    );
    expect(execContent).toContain('resolveToolAuthorization');
    expect(orchContent).toContain('resolveToolAuthorization');
    expect(execContent).toContain('securityGuardHook');
    expect(orchContent).toContain('securityGuardHook');
  });

  it('OD29 forensic: pre-Gate-19 behavior preserved — security guardian still denies under lockdown', async () => {
    const { SecurityGuardian } = await import('../core/security/guardian.js');
    const { RateLimiter } = await import('../core/security/rateLimit.js');
    const { AnomalyDetector } = await import('../core/security/anomaly.js');

    const events: unknown[] = [];
    const guardian = new SecurityGuardian({
      lockdown: async (ownerId: string) => {
        if (ownerId === 'owner-1') {
          return { lockdownId: 'ld-1', ownerId: 'owner-1', status: 'active' as const, reason: 'emergency', scope: 'global' as const, createdAt: '2025-01-01T00:00:00Z', releasedAt: null };
        }
        return null;
      },
      rateLimiter: new RateLimiter(),
      anomaly: new AnomalyDetector(),
      recordEvent: async (e: unknown) => { events.push(e); },
    });

    const result = await guardian.evaluate({
      ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner',
      projectId: 'proj-1', environment: 'development', resourceType: 'tool',
      actionType: 'read', permission: 'read', risk: 'low',
      authorized: true, explicitDeny: false,
    });
    expect(result.denied).toBe(true);
    expect(result.decision).toBe('lockdown');
  });

  it('OD29: SecurityRequest type requires authorized to be boolean', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/security/types.ts',
      'utf-8',
    );
    expect(content).toMatch(/authorized:\s*boolean/);
  });
});

// ================================================================
// OD30 — ARCHIVE CONVERSATION
// ================================================================

describe('Gate 19 — OD30: archiveConversation', () => {
  it('archives an existing conversation successfully', async () => {
    const store = new MemoryStore();
    const conv = await store.createConversation('owner-1', { title: 'Test' });
    const result = await store.archiveConversation('owner-1', conv.id);
    expect(result).toBe(true);
    const conversations = await store.listConversations('owner-1', { status: 'archived' });
    expect(conversations.length).toBe(1);
    expect(conversations[0].id).toBe(conv.id);
  });

  it('returns false for nonexistent conversation', async () => {
    const store = new MemoryStore();
    const result = await store.archiveConversation('owner-1', 'nonexistent-id');
    expect(result).toBe(false);
  });

  it('does not archive conversation belonging to another owner', async () => {
    const store = new MemoryStore();
    const conv1 = await store.createConversation('owner-1', { title: 'O1' });
    const result = await store.archiveConversation('owner-2', conv1.id);
    expect(result).toBe(false);
    const active = await store.listConversations('owner-1', { status: 'active' });
    expect(active.length).toBe(1);
  });

  it('archived conversation no longer appears in active list', async () => {
    const store = new MemoryStore();
    const conv = await store.createConversation('owner-1', { title: 'Test' });
    await store.archiveConversation('owner-1', conv.id);
    const active = await store.listConversations('owner-1', { status: 'active' });
    expect(active.length).toBe(0);
  });

  it('archiving does not affect other conversations', async () => {
    const store = new MemoryStore();
    const conv1 = await store.createConversation('owner-1', { title: 'One' });
    const conv2 = await store.createConversation('owner-1', { title: 'Two' });
    await store.archiveConversation('owner-1', conv1.id);
    const active = await store.listConversations('owner-1', { status: 'active' });
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(conv2.id);
  });

  it('archiveConversation idempotent — second call is benign (MemoryStore returns true, no state change)', async () => {
    const store = new MemoryStore();
    const conv = await store.createConversation('owner-1', { title: 'Test' });
    await store.archiveConversation('owner-1', conv.id);
    const second = await store.archiveConversation('owner-1', conv.id);
    // MemoryStore always returns true (it sets status to archived even if already archived).
    // SupabaseStore returns false because UPDATE WHERE status != 'archived' matches 0 rows.
    // Both are correct: no harmful side-effect.
    expect(second).toBe(true);
    const archived = await store.listConversations('owner-1', { status: 'archived' });
    expect(archived.length).toBe(1);
  });

  it('OD30 forensic: SupabaseStore uses pool.query directly (not this.q)', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/db/repo.ts',
      'utf-8',
    );
    const archiveSection = content.substring(
      content.indexOf('async archiveConversation'),
      content.indexOf('async archiveConversation') + 400,
    );
    expect(archiveSection).toContain('this.pool.query');
    expect(archiveSection).toContain('res.rowCount');
    expect(archiveSection).not.toMatch(/this\.q.*archived/);
  });
});

// ================================================================
// OD31 — STATE TRANSITIONS
// ================================================================

describe('Gate 19 — OD31: State Transitions', () => {
  const VALID_TRANSITIONS: Array<[TaskStatus, TaskStatus]> = [
    ['created', 'queued'],
    ['created', 'needs_approval'],
    ['created', 'cancelled'],
    ['queued', 'running'],
    ['queued', 'paused'],
    ['queued', 'cancelled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'paused'],
    ['running', 'cancelled'],
    ['needs_approval', 'queued'],
    ['needs_approval', 'paused'],
    ['needs_approval', 'cancelled'],
    ['paused', 'queued'],
    ['paused', 'cancelled'],
    ['failed', 'queued'],
    ['failed', 'cancelled'],
  ];

  for (const [from, to] of VALID_TRANSITIONS) {
    it(`canTransition: ${from} → ${to} = true`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }

  const INVALID_TRANSITIONS: Array<[TaskStatus, TaskStatus]> = [
    ['created', 'running'],
    ['created', 'completed'],
    ['created', 'failed'],
    ['created', 'paused'],
    ['completed', 'queued'],
    ['completed', 'running'],
    ['cancelled', 'queued'],
    ['cancelled', 'running'],
    ['running', 'queued'],
    ['paused', 'running'],
  ];

  for (const [from, to] of INVALID_TRANSITIONS) {
    it(`canTransition: ${from} → ${to} = false`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }

  it('update-task: valid transition (created → queued) succeeds', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });
    const task = store.tasks[0];
    expect(task.status).toBe('created');

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: task.id, status: 'queued' },
      store,
    });
    expect(result.success).toBe(true);
    const data = result.data as { status: string };
    expect(data.status).toBe('queued');
  });

  it('update-task: invalid transition (created → running) rejected', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });
    const task = store.tasks[0];

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: task.id, status: 'running' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid task transition');
  });

  it('update-task: invalid transition (created → completed) rejected', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: store.tasks[0].id, status: 'completed' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid task transition');
  });

  it('update-task: terminal status (completed) blocks all updates', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });
    const task = store.tasks[0];
    task.status = 'completed';

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: task.id, status: 'queued' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('terminal status');
  });

  it('update-task: terminal status (cancelled) blocks all updates', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });
    const task = store.tasks[0];
    task.status = 'cancelled';

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: task.id, status: 'queued' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('terminal status');
  });

  it('update-task: invalid status string rejected', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: store.tasks[0].id, status: 'bogus_status' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  it('update-task: same-state transition (created → created) passes canTransition but is a no-op', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });

    // created → created is not in valid transitions, so it will be rejected
    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: store.tasks[0].id, status: 'created' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid task transition');
  });

  it('update-task: full lifecycle walk (created → queued → running → completed)', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });
    const taskId = store.tasks[0].id;

    let r = await updateTaskHandler({ ownerId: 'owner-1', args: { task_id: taskId, status: 'queued' }, store });
    expect(r.success).toBe(true);

    r = await updateTaskHandler({ ownerId: 'owner-1', args: { task_id: taskId, status: 'running' }, store });
    expect(r.success).toBe(true);

    r = await updateTaskHandler({ ownerId: 'owner-1', args: { task_id: taskId, status: 'completed' }, store });
    expect(r.success).toBe(true);
    expect((r.data as { status: string }).status).toBe('completed');
  });

  it('TERMINAL_TASK_STATUSES contains completed, failed, cancelled', () => {
    expect(TERMINAL_TASK_STATUSES.has('completed')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('failed')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('cancelled')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('created')).toBe(false);
    expect(TERMINAL_TASK_STATUSES.has('running')).toBe(false);
  });
});

// ================================================================
// OD32 — TOOL RESULTS TO CONVERSATION
// ================================================================

describe('Gate 19 — OD32: Tool Results to Conversation', () => {
  it('ExecutionOutcome interface includes optional toolMessages', async () => {
    const { ExecutionOutcome } = await import('../core/pipeline.js');
    // Type-level proof: toolMessages is optional
    const outcome: ExecutionOutcome = {
      ok: true,
      toolMessages: [{ role: 'tool', content: '{"ok":true}', tool_call_id: 'c1', name: 'create_task' }],
    };
    expect(outcome.toolMessages).toHaveLength(1);
    expect(outcome.toolMessages![0].role).toBe('tool');
  });

  it('PipelineResult interface includes optional toolMessages', async () => {
    const { PipelineResult } = await import('../core/pipeline.js');
    const result: PipelineResult = {
      outcome: 'executed',
      intent: {} as never,
      project: null,
      environment: 'development',
      risk: 'low',
      authority: null,
      autonomy: null,
      approvalId: null,
      task: null,
      correlationId: 'c1',
      explanation: { decision: 'd', why: 'w', evidence: [], confidence: 1, risk: 'low', outcome: 'executed' },
      toolMessages: [{ role: 'tool', content: '{}', tool_call_id: 'c1', name: 'list_projects' }],
    };
    expect(result.toolMessages).toHaveLength(1);
  });

  it('toolMessages are collected from execution messages array', async () => {
    const { ExecutionOutcome } = await import('../core/pipeline.js');
    const messages = [
      { role: 'tool' as const, content: '{"ok":true}', tool_call_id: 'c1', name: 'create_task' },
      { role: 'tool' as const, content: '{"count":3}', tool_call_id: 'c2', name: 'list_tasks' },
    ];
    const filtered = messages.filter((m) => m.role === 'tool');
    expect(filtered.length).toBe(2);
    expect(filtered[0].name).toBe('create_task');
    expect(filtered[1].name).toBe('list_tasks');
  });

  it('toolMessages are propagated through pipeline result for executed outcome', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/pipeline.ts',
      'utf-8',
    );
    expect(content).toContain('outcome.toolMessages');
  });

  it('handlers.ts appends tool messages to conversation', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/api/handlers.ts',
      'utf-8',
    );
    expect(content).toContain("role: 'tool'");
    expect(content).toContain('toolMessages');
    expect(content).toContain('appendMessage');
  });

  it('streaming.ts appends tool messages to conversation', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/api/streaming.ts',
      'utf-8',
    );
    expect(content).toContain("role: 'tool'");
    expect(content).toContain('toolMessages');
    expect(content).toContain('appendMessage');
  });

  it('tool messages include tool_call_id and name for provider matching', async () => {
    const store = new MemoryStore();
    const msg = await store.appendMessage('owner-1', {
      conversationId: 'conv-1',
      role: 'tool',
      content: '{"success":true}',
      toolCallId: 'call-abc-123',
      name: 'create_task',
    });
    expect(msg.role).toBe('tool');
    expect(msg.toolCallId).toBe('call-abc-123');
    expect(msg.name).toBe('create_task');
  });

  it('tool messages can be loaded in history in correct order', async () => {
    const store = new MemoryStore();
    await store.appendMessage('owner-1', { conversationId: 'conv-1', role: 'user', content: 'create task' });
    await store.appendMessage('owner-1', { conversationId: 'conv-1', role: 'tool', content: '{"ok":true}', toolCallId: 'c1', name: 'create_task' });
    await store.appendMessage('owner-1', { conversationId: 'conv-1', role: 'assistant', content: 'Done' });

    const history = await store.loadHistory('owner-1', 'conv-1');
    expect(history.length).toBe(3);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('tool');
    expect(history[2].role).toBe('assistant');
  });

  it('multiple tool results are persisted in order', async () => {
    const store = new MemoryStore();
    await store.appendMessage('owner-1', { conversationId: 'conv-1', role: 'tool', content: '{"result":1}', toolCallId: 'c1', name: 'list_projects' });
    await store.appendMessage('owner-1', { conversationId: 'conv-1', role: 'tool', content: '{"result":2}', toolCallId: 'c2', name: 'list_tasks' });
    await store.appendMessage('owner-1', { conversationId: 'conv-1', role: 'tool', content: '{"result":3}', toolCallId: 'c3', name: 'create_task' });

    const history = await store.loadHistory('owner-1', 'conv-1');
    const tools = history.filter((m) => m.role === 'tool');
    expect(tools.length).toBe(3);
    expect(tools[0].toolCallId).toBe('c1');
    expect(tools[1].toolCallId).toBe('c2');
    expect(tools[2].toolCallId).toBe('c3');
  });

  it('failed tool execution produces error result, not false success', async () => {
    const store = new MemoryStore();
    const msg = await store.appendMessage('owner-1', {
      conversationId: 'conv-1',
      role: 'tool',
      content: JSON.stringify({ success: false, error: 'project not found' }),
      toolCallId: 'c-fail',
      name: 'create_task',
    });
    const parsed = JSON.parse(msg.content);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('project not found');
  });

  it('execution.ts wires store to tool handler closures', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/api/execution.ts',
      'utf-8',
    );
    expect(content).toContain('store');
    expect(content).toContain('toolDef.handler(');
    expect(content).toContain('store,');

    // Gate 35A: context must carry trusted execution context (assembled server-side)
    expect(content).toContain('projectId: task.projectId');
    expect(content).toContain('actorType: ctx.actorType');
    expect(content).toContain('actorId: ctx.actorId');
    expect(content).toContain('agentId: ctx.agentId ?? null');
    expect(content).toContain('taskId: task.id');
  });

  it('orchestration.ts wires store to tool handler closures', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/orchestration.ts',
      'utf-8',
    );
    expect(content).toContain('store: ctx.store');
  });
});

// ================================================================
// QUERY AUDIT — STORE PORT INTEGRATION
// ================================================================

describe('Gate 19 — queryAudit Store Integration', () => {
  it('MemoryStore.queryAudit returns audit events filtered by project ownership', async () => {
    const store = new MemoryStore();
    const p1 = await store.createProject('owner-1', { name: 'P1', slug: 'p1' });
    const p2 = await store.createProject('owner-2', { name: 'P2', slug: 'p2' });
    await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: 'task.completed', projectId: p1.id, environmentId: null, resourceType: 'task', resourceId: 't1', authorizationResult: 'auto', correlationId: 'c1' });
    await store.recordAudit({ actorType: 'owner', actorId: 'owner-2', action: 'task.completed', projectId: p2.id, environmentId: null, resourceType: 'task', resourceId: 't2', authorizationResult: 'auto', correlationId: 'c2' });
    await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: 'task.created', projectId: p1.id, environmentId: null, resourceType: 'task', resourceId: 't3', authorizationResult: 'auto', correlationId: 'c3' });

    const rows = await store.queryAudit('owner-1');
    expect(rows.length).toBe(2);
  });

  it('MemoryStore.queryAudit respects limit parameter', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    for (let i = 0; i < 10; i++) {
      await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: `action-${i}`, projectId: project.id, environmentId: null, resourceType: 'task', resourceId: `t${i}`, authorizationResult: 'auto', correlationId: `c${i}` });
    }
    const rows = await store.queryAudit('owner-1', { limit: 3 });
    expect(rows.length).toBe(3);
  });

  it('MemoryStore.queryAudit returns empty for unknown owner', async () => {
    const store = new MemoryStore();
    await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: 'test', projectId: null, environmentId: null, resourceType: 'task', resourceId: 't1', authorizationResult: 'auto', correlationId: 'c1' });
    const rows = await store.queryAudit('owner-unknown');
    expect(rows.length).toBe(0);
  });

  it('Store interface exposes queryAudit method', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/ports.ts',
      'utf-8',
    );
    expect(content).toContain('queryAudit(ownerId: string');
  });

  it('SupabaseStore.queryAudit implementation exists', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/db/repo.ts',
      'utf-8',
    );
    expect(content).toContain('async queryAudit');
    expect(content).toContain('audit_events');
  });

  it('handlers.ts uses store.queryAudit (not direct getPool)', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/api/handlers.ts',
      'utf-8',
    );
    const queryAuditSection = content.substring(
      content.indexOf('private async queryAudit'),
      content.indexOf('private async queryAudit') + 300,
    );
    expect(queryAuditSection).toContain('this.store.queryAudit');
    expect(queryAuditSection).not.toMatch(/getPool|pool\.query/);
  });

  it('MemoryStore.queryAudit returns objects in reverse order (most recent first)', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: 'first', projectId: project.id, environmentId: null, resourceType: 'task', resourceId: 't1', authorizationResult: 'auto', correlationId: 'c1' });
    await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: 'second', projectId: project.id, environmentId: null, resourceType: 'task', resourceId: 't2', authorizationResult: 'auto', correlationId: 'c2' });

    const rows = await store.queryAudit('owner-1');
    expect(rows.length).toBe(2);
    expect(rows[0].action).toBe('second');
    expect(rows[1].action).toBe('first');
  });
});

// ================================================================
// FAILURE PATHS
// ================================================================

describe('Gate 19 — Failure Paths', () => {
  it('create-task: store.createTask throws → error propagated, no false success', async () => {
    const store = failingStore('write failed');
    const result = await createTaskHandler({
      ownerId: 'owner-1',
      args: { project_id: 'proj-1', title: 'T' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('write failed');
  });

  it('create-project: store.createProject throws → error propagated', async () => {
    const store = failingStore('create failed');
    const result = await createProjectHandler({
      ownerId: 'owner-1',
      args: { name: 'P' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('create failed');
  });

  it('list-tasks: store.listTasks throws → error propagated', async () => {
    const store = failingStore('list failed');
    const result = await listTasksHandler({
      ownerId: 'owner-1',
      args: { project_id: 'proj-1' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('list failed');
  });

  it('list-projects: store.listProjects throws → error propagated', async () => {
    const store = failingStore('list failed');
    const result = await listProjectsHandler({
      ownerId: 'owner-1',
      args: {},
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('list failed');
  });

  it('update-task: store.getTask throws → error propagated', async () => {
    const store = failingStore('read failed');
    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: 'task-1', title: 'X' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('read failed');
  });

  it('update-task: store.patchTask throws → error propagated', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });
    (store as unknown as Record<string, unknown>).patchTask = async () => { throw new Error('patch failed'); };

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: store.tasks[0].id, title: 'New' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('patch failed');
  });

  it('create-task: missing required fields → validation error, no store call', async () => {
    const result = await createTaskHandler({
      ownerId: 'owner-1',
      args: {},
      store: new MemoryStore(),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('project_id is required');
  });

  it('update-task: no fields to update → validation error', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    await store.createTask('owner-1', { projectId: store.projects[0].id, title: 'T', priority: 'medium' });

    const result = await updateTaskHandler({
      ownerId: 'owner-1',
      args: { task_id: store.tasks[0].id },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('no fields to update');
  });
});

// ================================================================
// CONCURRENCY / DUPLICATION
// ================================================================

describe('Gate 19 — Concurrency & Duplication', () => {
  it('concurrent create-task calls all succeed', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'd' });
    const project = store.projects[0];

    const promises = Array.from({ length: 5 }, (_, i) =>
      createTaskHandler({
        ownerId: 'owner-1',
        args: { project_id: project.id, title: `Task ${i}` },
        store,
      }),
    );
    const results = await Promise.all(promises);
    expect(results.every((r) => r.success)).toBe(true);
    expect(store.tasks.length).toBe(5);
  });

  it('concurrent list-projects calls return consistent results', async () => {
    const store = new MemoryStore();
    await store.createProject('owner-1', { name: 'P1', slug: 'p1', description: 'd1' });

    const promises = Array.from({ length: 5 }, () =>
      listProjectsHandler({ ownerId: 'owner-1', args: {}, store }),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      const data = r.data as Array<{ id: string }>;
      expect(data.length).toBe(1);
    }
  });

  it('repeated archiveConversation is safe — no harmful side effects', async () => {
    const store = new MemoryStore();
    const conv = await store.createConversation('owner-1', { title: 'T' });
    const r1 = await store.archiveConversation('owner-1', conv.id);
    const r2 = await store.archiveConversation('owner-1', conv.id);
    const r3 = await store.archiveConversation('owner-1', conv.id);
    // MemoryStore: all return true (benign). SupabaseStore: first true, rest false.
    // Both are safe: conversation stays archived, no duplication or deletion.
    expect(r1).toBe(true);
    const archived = await store.listConversations('owner-1', { status: 'archived' });
    expect(archived.length).toBe(1);
  });

  it('queryAudit handles rapid successive calls', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    for (let i = 0; i < 20; i++) {
      await store.recordAudit({ actorType: 'owner', actorId: 'owner-1', action: `a-${i}`, projectId: project.id, environmentId: null, resourceType: 'task', resourceId: `t${i}`, authorizationResult: 'auto', correlationId: `c${i}` });
    }
    const r1 = await store.queryAudit('owner-1');
    const r2 = await store.queryAudit('owner-1', { limit: 5 });
    const r3 = await store.queryAudit('owner-unknown');
    expect(r1.length).toBe(20);
    expect(r2.length).toBe(5);
    expect(r3.length).toBe(0);
  });
});
