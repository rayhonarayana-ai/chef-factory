// CHEF FACTORY — Gate 1 → Gate 3 — API handlers.
// Thin JSON layer over the Core + Store. Every handler operates in the verified
// owner session scope. Explanations are returned — "Done." is never the whole story.
// Gate 3: Added conversation context to chat, conversation CRUD endpoints.

import type { IncomingMessage } from 'node:http';
import type { Store } from '../core/ports.js';
import { CommandPipeline, type ActorContext } from '../core/pipeline.js';
import { resolveApproval, validateNewApproval, isExpired } from '../core/approval.js';
import { transitionTask } from '../core/taskEngine.js';
import { validatePreference } from '../core/pos.js';
import { passportSummary } from '../core/passport.js';
import type { ApprovalStatus, TaskStatus } from '../core/types.js';
import type { ExecutionRunner } from '../core/pipeline.js';
import type { AuthService, SessionOwner } from './auth.js';
import { redactForLog } from './redact.js';
import { computeSecurityHealth, rlsHealthFromProbe, DEFAULT_HEALTH_CHECKS } from '../core/security/health.js';
import { validateIncidentInput } from '../core/security/incidents.js';
import { ConversationService } from '../core/conversation.js';

export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
  owner: SessionOwner;
  raw: IncomingMessage;
}

export type HandlerResult = { status: number; json: unknown };

export class Api {
  private readonly conversations: ConversationService;

  constructor(
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly pipeline: CommandPipeline,
    private readonly execution: ExecutionRunner,
  ) {
    this.conversations = new ConversationService(store);
  }

  async handle(req: ApiRequest): Promise<HandlerResult> {
    const { method, path, params, owner } = req;
    const json = (req.body ?? {}) as Record<string, unknown>;
    const actorCtx = (): ActorContext => ({ ownerId: owner.id, actorId: owner.id, actorType: 'owner' });

    switch (`${method} ${path}`) {
      case 'GET /api/me':
        return this.ok({ id: owner.id, email: owner.email });

      // ----- Chat / command pipeline (Gate 3: conversation context) -----
      case 'POST /api/chat': {
        const command = typeof json.command === 'string' ? json.command : '';
        if (!command.trim()) return { status: 400, json: { error: 'command is required' } };
        const conversationId = typeof json.conversation_id === 'string' ? json.conversation_id : null;

        // Resolve or create conversation
        let convId = conversationId;
        if (convId) {
          const existing = await this.conversations.getConversation(owner.id, convId);
          if (!existing) {
            // Invalid conversation_id → create new
            const conv = await this.conversations.createConversation({ ownerId: owner.id });
            convId = conv.id;
          }
        } else {
          const conv = await this.conversations.createConversation({ ownerId: owner.id });
          convId = conv.id;
        }

        // Append user message
        await this.conversations.appendMessage({
          conversationId: convId,
          ownerId: owner.id,
          role: 'user',
          content: command,
        });

        // Gate 4: Load conversation history for multi-turn LLM context
        const historyMessages = await this.conversations.loadHistory(owner.id, convId, 20);
        const conversationHistory = historyMessages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant' | 'tool',
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          ...(m.name ? { name: m.name } : {}),
        }));

        // Run pipeline with conversation history
        const result = await this.pipeline.run(actorCtx(), command, conversationHistory);

        // Gate 19 (OD32): Append tool results to conversation
        if (result.toolMessages && result.toolMessages.length > 0) {
          for (const tm of result.toolMessages) {
            await this.conversations.appendMessage({
              conversationId: convId,
              ownerId: owner.id,
              role: 'tool',
              content: tm.content,
              toolCallId: tm.tool_call_id,
              name: tm.name,
            });
          }
        }

        // Append assistant response
        const responseText = typeof result.explanation?.decision === 'string' ? result.explanation.decision : JSON.stringify(result);
        await this.conversations.appendMessage({
          conversationId: convId,
          ownerId: owner.id,
          role: 'assistant',
          content: responseText,
        });

        return this.ok({ ...result, conversation_id: convId });
      }

      // ----- Gate 3: Conversation endpoints -----
      case 'GET /api/conversations': {
        const status = typeof json.status === 'string' ? json.status : 'active';
        const limit = typeof json.limit === 'number' ? Math.min(100, Math.max(1, json.limit)) : 50;
        const offset = typeof json.offset === 'number' ? Math.max(0, json.offset) : 0;
        const conversations = await this.conversations.listConversations(owner.id, { status, limit, offset });
        return this.ok({ conversations });
      }
      case 'GET /api/conversations/:conversationId': {
        const convId = params.conversationId;
        if (!convId) return { status: 400, json: { error: 'conversationId required' } };
        const conv = await this.conversations.getConversation(owner.id, convId);
        if (!conv) return { status: 404, json: { error: 'conversation not found' } };
        const messages = await this.conversations.loadHistory(owner.id, convId, 100);
        return this.ok({ conversation: conv, messages });
      }
      case 'DELETE /api/conversations/:conversationId': {
        const convId = params.conversationId;
        if (!convId) return { status: 400, json: { error: 'conversationId required' } };
        const archived = await this.conversations.archiveConversation(owner.id, convId);
        if (!archived) return { status: 404, json: { error: 'conversation not found' } };
        return this.ok({ ok: true });
      }

      // ----- Projects -----
      case 'GET /api/projects': {
        const projects = await this.store.listProjects(owner.id);
        return this.ok({ projects });
      }
      case 'POST /api/projects': {
        const name = typeof json.name === 'string' ? json.name.trim() : '';
        const slug = typeof json.slug === 'string' ? json.slug.trim() : '';
        if (!name || !slug) return { status: 400, json: { error: 'name and slug are required' } };
        const project = await this.store.createProject(owner.id, { name, slug, description: typeof json.description === 'string' ? json.description : undefined });
        await this.store.recordAudit({
          actorType: 'owner', actorId: owner.id, action: 'project.created',
          projectId: project.id, environmentId: null, resourceType: 'project', resourceId: project.id,
          authorizationResult: 'auto', correlationId: null, taskId: null,
          metadata: { slug },
        });
        return this.ok({ project });
      }

      // ----- Passport -----
      case 'GET /api/passports': {
        if (!params.projectId) return { status: 400, json: { error: 'projectId required' } };
        const passport = await this.store.getPassport(owner.id, params.projectId);
        if (!passport) return { status: 404, json: { error: 'passport not found' } };
        return this.ok({ passport, summary: passportSummary(passport) });
      }
      case 'PUT /api/passports': {
        if (!params.projectId) return { status: 400, json: { error: 'projectId required' } };
        const patch = (json.patch ?? {}) as Record<string, unknown>;
        const passport = await this.store.upsertPassport(owner.id, params.projectId, patch);
        return this.ok({ passport });
      }

      // ----- Agents -----
      case 'GET /api/agents': {
        const agents = await this.store.listAgents(owner.id);
        return this.ok({ agents });
      }

      // ----- Tasks -----
      case 'GET /api/tasks': {
        const tasks = await this.store.listTasks(owner.id, {
          projectId: typeof json.projectId === 'string' ? json.projectId : undefined,
          status: typeof json.status === 'string' ? (json.status as TaskStatus) : undefined,
        });
        return this.ok({ tasks });
      }

      // ----- Approvals -----
      case 'GET /api/approvals': {
        const approvals = await this.store.listApprovals(owner.id, {
          projectId: typeof json.projectId === 'string' ? json.projectId : undefined,
          status: typeof json.status === 'string' ? (json.status as ApprovalStatus) : undefined,
        });
        return this.ok({ approvals });
      }
      case 'POST /api/approvals/decision': {
        const approvalId = params.approvalId;
        if (!approvalId) return { status: 400, json: { error: 'approvalId required' } };
        const decision = typeof json.decision === 'string' ? json.decision : '';
        const reason = typeof json.reason === 'string' ? json.reason : '';
        if (!['approved', 'rejected', 'denied'].includes(decision)) {
          return { status: 400, json: { error: 'decision must be approved|rejected|denied' } };
        }
        const approval = await this.store.getApproval(owner.id, approvalId);
        if (!approval) return { status: 404, json: { error: 'approval not found' } };
        if (isExpired(approval)) {
          await this.store.patchApproval(owner.id, approvalId, {
            status: 'expired',
            decidedAt: new Date().toISOString(),
          });
          return { status: 409, json: { error: 'approval has expired' } };
        }
        const { approval: resolved, error } = resolveApproval({
          approval,
          status: decision as 'approved' | 'rejected' | 'denied',
          decision: reason || decision,
          decidedBy: owner.id,
        });
        if (error) return { status: 409, json: { error } };
        await this.store.patchApproval(owner.id, approvalId, {
          status: resolved.status,
          decision: resolved.decision,
          decisionReason: resolved.decisionReason,
          decidedBy: resolved.decidedBy,
          decidedAt: resolved.decidedAt,
        });
        let task = null;
        if (approval.taskId) {
          const current = await this.store.getTask(owner.id, approval.taskId);
          if (current) {
            const target = resolved.status === 'approved' ? 'queued' : 'cancelled';
            const t = transitionTask(current, target);
            if (t.transitioned) {
              task = await this.store.patchTask(owner.id, approval.taskId, {
                status: t.task.status,
                error: resolved.status === 'approved' ? null : { message: `approval ${resolved.status}` },
              });
            }
          }
        }
        await this.store.recordAudit({
          actorType: 'owner', actorId: owner.id, action: `approval.${resolved.status}`,
          projectId: approval.projectId, environmentId: null, resourceType: 'approval', resourceId: approvalId,
          authorizationResult: 'require_approval', correlationId: null, taskId: approval.taskId ?? null,
          metadata: { reason },
        });
        return this.ok({ approval: resolved, task });
      }

      // ----- Costs -----
      case 'GET /api/costs': {
        const projects = await this.store.listProjects(owner.id);
        const totals: Array<{ projectId: string; name: string; cost: number; budget: Awaited<ReturnType<Store['projectBudget']>> }> = [];
        for (const p of projects) {
          totals.push({ projectId: p.id, name: p.name, cost: await this.store.totalCost(owner.id, p.id), budget: await this.store.projectBudget(owner.id, p.id) });
        }
        return this.ok({ costs: totals, total: await this.store.totalCost(owner.id) });
      }

      // ----- Audit -----
      case 'GET /api/audit': {
        const events = await this.queryAudit(owner.id, json);
        return this.ok({ audit: events });
      }

      // ----- Daily status -----
      case 'GET /api/status': {
        const status = await this.store.dailyStatus(owner.id);
        return this.ok({ status });
      }

      // ----- POS preferences -----
      case 'GET /api/prefs': {
        const prefs = await this.store.getPreferences(owner.id);
        return this.ok({ prefs });
      }
      case 'PUT /api/prefs': {
        const category = typeof json.category === 'string' ? json.category : '';
        const key = typeof json.key === 'string' ? json.key : '';
        const value = json.value;
        const error = validatePreference({ category, key, value });
        if (error) return { status: 400, json: { error } };
        await this.store.setPreference(owner.id, category, key, value);
        const prefs = await this.store.getPreferences(owner.id);
        return this.ok({ prefs });
      }

      // ----- Registries -----
      case 'GET /api/models': {
        return this.ok({ models: await this.store.listModels(owner.id) });
      }
      case 'GET /api/runtimes': {
        return this.ok({ runtimes: await this.store.listRuntimes(owner.id) });
      }

      // ----- Decision Journal -----
      case 'GET /api/decisions': {
        return this.ok({ decisions: await this.store.listDecisions(owner.id) });
      }

      // ----- Gate 2 — Security Guardian -----
      case 'GET /api/security/health': {
        let probe = null;
        let probeError: string | null = null;
        try {
          probe = await this.store.rlsProbe(owner.id);
        } catch (e) {
          probeError = String(e);
        }
        const lockdown = await this.store.activeLockdown(owner.id);
        const checks = DEFAULT_HEALTH_CHECKS({});
        checks.push(rlsHealthFromProbe(probe, probeError));
        const health = computeSecurityHealth(checks, lockdown !== null);
        return this.ok({ health, lockdown });
      }

      case 'GET /api/security/events': {
        const events = await this.store.listSecurityEvents(owner.id, {
          eventType: typeof json.eventType === 'string' ? json.eventType : undefined,
          severity: typeof json.severity === 'string' ? json.severity : undefined,
          limit: typeof json.limit === 'number' ? Math.min(500, Math.max(1, json.limit)) : 100,
        });
        return this.ok({ events });
      }

      case 'GET /api/security/incidents': {
        const incidents = await this.store.listIncidents(owner.id, {
          status: typeof json.status === 'string' ? json.status : undefined,
          limit: typeof json.limit === 'number' ? Math.min(500, Math.max(1, json.limit)) : 100,
        });
        return this.ok({ incidents });
      }
      case 'POST /api/security/incidents': {
        const title = typeof json.title === 'string' ? json.title.trim() : '';
        const error = validateIncidentInput({ title });
        if (error) return { status: 400, json: { error } };
        const incident = await this.store.createIncident(owner.id, {
          title,
          description: typeof json.description === 'string' ? json.description : undefined,
          eventIds: Array.isArray(json.eventIds) ? (json.eventIds as string[]) : [],
          openedBy: owner.id,
        });
        return this.ok({ incident });
      }

      case 'GET /api/security/critical-actions': {
        return this.ok({ version: 1, criticalActions: await this.store.listCriticalActions(owner.id) });
      }

      case 'GET /api/security/lockdown': {
        const lockdown = await this.store.activeLockdown(owner.id);
        return this.ok({ lockdown });
      }
      case 'POST /api/security/lockdown': {
        const reason = typeof json.reason === 'string' ? json.reason.trim() : '';
        if (!reason) return { status: 400, json: { error: 'reason is required' } };
        const scope = typeof json.scope === 'string' && json.scope.trim() ? json.scope.trim() : 'all';
        const lockdown = await this.store.activateLockdown(owner.id, { scope, reason, activatedBy: owner.id, actorType: 'owner' });
        await this.store.recordAudit({
          actorType: 'owner', actorId: owner.id, action: 'security.lockdown_activated',
          projectId: null, environmentId: null, resourceType: 'security', resourceId: lockdown.lockdownId,
          authorizationResult: 'deny', correlationId: null, taskId: null,
          metadata: { scope, reason },
        });
        return this.ok({ lockdown });
      }
      case 'POST /api/security/lockdown/release': {
        const lockdownId = typeof json.lockdownId === 'string' ? json.lockdownId : '';
        const reason = typeof json.reason === 'string' ? json.reason.trim() : '';
        if (!lockdownId) return { status: 400, json: { error: 'lockdownId is required' } };
        if (!reason) return { status: 400, json: { error: 'release reason is required' } };
        const released = await this.store.releaseLockdown(owner.id, lockdownId, { releasedBy: owner.id, actorType: 'owner', reason });
        if (!released) return { status: 404, json: { error: 'lockdown not found' } };
        await this.store.recordAudit({
          actorType: 'owner', actorId: owner.id, action: 'security.lockdown_released',
          projectId: null, environmentId: null, resourceType: 'security', resourceId: lockdownId,
          authorizationResult: 'auto', correlationId: null, taskId: null,
          metadata: { reason },
        });
        return this.ok({ lockdown: released });
      }

      default:
        return { status: 404, json: { error: `not found: ${method} ${path}` } };
    }
  }

  private async queryAudit(ownerId: string, json: Record<string, unknown>) {
    const limit = typeof json.limit === 'number' ? Math.min(200, Math.max(1, json.limit)) : 50;
    const rows = await this.store.queryAudit(ownerId, { limit });
    return rows.map((r) => redactForLog(JSON.parse(JSON.stringify(r))));
  }

  private ok(json: unknown): HandlerResult {
    return { status: 200, json };
  }
}
