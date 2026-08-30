// CHEF FACTORY — Gate 1 — ToolBroker (boundary).
// Every external action passes: Authority → Project → Environment → Risk →
// Approval → ToolBroker → Audit. Raw unrestricted tools are never exposed to
// agents. No full browser automation in Gate 1.

import type { AutonomyLevel, RiskLevel, ToolCallRequest, ToolCallResult } from '../core/types.js';
import { redactText } from '../core/redact.js';

export interface Tool {
  name: string;
  action: string; // audit action label
  minRisk: RiskLevel; // maximum risk this tool may handle
  /** The operation creates an approval request rather than performing the protected action. */
  approvalRequest?: boolean;
  /** The handler independently verifies a durable approved decision before acting. */
  approvalBound?: boolean;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export interface ToolBrokerContext {
  decision: AutonomyLevel;
  approved: boolean; // explicit approval granted when required
  securityGuard?: (request: ToolCallRequest) => Promise<SecurityHookResult>;
  /** G5-01: When false, broker validates only (authority + security) without executing tool.run(). */
  execute?: boolean;
}

export interface SecurityHookResult {
  allowed: boolean;
  decision?: string; // security decision label (deny, require_approval, ...)
  reason?: string;
  evidence?: string[];
}

export class ToolBroker {
  constructor(private readonly tools: Map<string, Tool> = new Map()) {}

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  async call(request: ToolCallRequest, ctx: ToolBrokerContext): Promise<ToolCallResult> {
    const tool = this.tools.get(request.tool);
    if (!tool) {
      return { ok: false, tool: request.tool, action: 'tool.call', outcome: 'tool_not_found', metadata: {} };
    }
    if (ctx.decision === 'deny') {
      return { ok: false, tool: request.tool, action: tool.action, outcome: 'denied_by_authority', metadata: {} };
    }
    // A request must be able to create the approval it needs. A bound execution is
    // safe only because its handler verifies the linked durable approval itself.
    if (ctx.decision === 'require_approval' && !ctx.approved && !tool.approvalRequest && !tool.approvalBound) {
      return { ok: false, tool: request.tool, action: tool.action, outcome: 'requires_approval', metadata: {} };
    }
    // risk ranking check
    const rank = (r: RiskLevel): number => (r === 'low' ? 0 : r === 'medium' ? 1 : r === 'high' ? 2 : 3);
    if (rank(request.risk) > rank(tool.minRisk)) {
      return { ok: false, tool: request.tool, action: tool.action, outcome: 'tool_risk_exceeded', metadata: { allowed: tool.minRisk, requested: request.risk } };
    }
    // Gate 2 — Security Guardian hook (optional; may only be more restrictive)
    if (ctx.securityGuard) {
      const result = await ctx.securityGuard(request);
      if (!result.allowed) {
        return {
          ok: false,
          tool: request.tool,
          action: tool.action,
          outcome: 'denied_by_security',
          metadata: { decision: result.decision ?? 'deny', reason: result.reason ?? 'security policy', evidence: result.evidence ?? [] },
        };
      }
    }

    // G5-01: When execute=false, broker validates only — caller executes the handler.
    if (ctx.execute === false) {
      return { ok: true, tool: request.tool, action: tool.action, outcome: 'executed', metadata: {} };
    }

    try {
      const result = await tool.run(request.args);
      return { ok: true, tool: request.tool, action: tool.action, outcome: 'executed', metadata: { result: safeSummary(result) } };
    } catch (e) {
      return { ok: false, tool: request.tool, action: tool.action, outcome: 'failed', metadata: { error: String(e) } };
    }
  }
}

// Never reflect secrets into audit metadata.
function safeSummary(value: unknown): unknown {
  const raw = JSON.stringify(value);
  if (!raw) return null;
  const redacted = redactText(raw);
  return redacted.length > 2000 ? redacted.slice(0, 2000) + '…(truncated)' : JSON.parse(redacted);
}
