// CHEF FACTORY — Gate 1 — Basic Proactive Monitoring + Daily Status.
// Deterministic aggregation over the Store; drives the Daily Status screen.

import type { DailyStatus, ProjectHealth } from './types.js';
import type { Store } from './ports.js';

export interface MonitorOptions {
  alertsThreshold?: number; // blocked + failures before "attention"
}

export class Monitor {
  constructor(
    private readonly store: Store,
    private readonly opts: MonitorOptions = {},
  ) {}

  async dailyStatus(ownerId: string): Promise<DailyStatus> {
    const [projects, tasks, approvals, totalCost, generatedAt] = await Promise.all([
      this.store.listProjects(ownerId),
      this.store.listTasks(ownerId),
      this.store.listApprovals(ownerId),
      this.store.totalCost(ownerId),
      Promise.resolve(new Date().toISOString()),
    ]);

    const threshold = this.opts.alertsThreshold ?? 3;
    const projectHealth: ProjectHealth[] = [];
    const alerts: string[] = [];

    for (const project of projects) {
      const ptasks = tasks.filter((t) => t.projectId === project.id);
      const activeTasks = ptasks.filter((t) => ['queued', 'running', 'needs_approval', 'created'].includes(t.status)).length;
      const blockedTasks = ptasks.filter((t) => t.status === 'paused').length;
      const failures = ptasks.filter((t) => t.status === 'failed').length;
      const pendingApprovals = approvals.filter((a) => a.projectId === project.id && a.status === 'pending').length;
      const cost = await this.store.totalCost(ownerId, project.id);

      const attention = blockedTasks + failures;
      const health: ProjectHealth['health'] =
        failures > 0 ? 'critical' : attention >= threshold ? 'attention' : 'healthy';

      projectHealth.push({ projectId: project.id, projectName: project.name, activeTasks, blockedTasks, failures, pendingApprovals, cost, health });

      if (failures > 0) alerts.push(`Project "${project.name}" has ${failures} failed task(s) — review required.`);
      if (blockedTasks > 0) alerts.push(`Project "${project.name}" has ${blockedTasks} blocked task(s).`);
      if (pendingApprovals > 0) alerts.push(`Project "${project.name}" has ${pendingApprovals} pending approval(s).`);
    }

    const decisionsRequired = approvals
      .filter((a) => a.status === 'pending')
      .map((a) => `Approval ${a.action}${a.projectId ? '' : ''} requires decision.`);

    const pendingApprovalsTotal = approvals.filter((a) => a.status === 'pending').length;
    const activeTasksTotal = tasks.filter((t) => ['queued', 'running', 'needs_approval', 'created'].includes(t.status)).length;
    const blockedTasksTotal = tasks.filter((t) => t.status === 'paused').length;
    const failuresTotal = tasks.filter((t) => t.status === 'failed').length;

    return {
      generatedAt,
      projects: projectHealth,
      activeTasks: activeTasksTotal,
      blockedTasks: blockedTasksTotal,
      failures: failuresTotal,
      pendingApprovals: pendingApprovalsTotal,
      cost: totalCost,
      alerts,
      decisionsRequired,
    };
  }
}
