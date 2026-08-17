import { describe, expect, it } from 'vitest';
import { ToolBroker, type Tool } from './toolBroker.js';
import type { ToolCallRequest } from '../core/types.js';

const SHELL: Tool = { name: 'shell', action: 'tool.shell', minRisk: 'medium', run: async (args) => ({ out: String(args.cmd ?? '') }) };
const MONEY: Tool = { name: 'transfer', action: 'tool.transfer', minRisk: 'low', run: async () => ({ moved: true }) };

function request(over: Partial<ToolCallRequest> = {}): ToolCallRequest {
  return {
    tool: 'shell', args: {}, actorId: 'owner-1', actorType: 'owner', projectId: 'p1', environment: 'development', risk: 'medium', ...over,
  };
}

describe('ToolBroker (boundary for external actions)', () => {
  it('executes a registered low-risk tool under AUTO', async () => {
    const b = new ToolBroker(new Map([[SHELL.name, SHELL]]));
    const r = await b.call(request({ risk: 'low' }), { decision: 'auto', approved: false });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('executed');
  });

  it('denies under explicit DENY (authority always wins)', async () => {
    const b = new ToolBroker(new Map([[SHELL.name, SHELL]]));
    const r = await b.call(request(), { decision: 'deny', approved: false });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('denied_by_authority');
  });

  it('blocks tools that require approval until approved', async () => {
    const b = new ToolBroker(new Map([[MONEY.name, MONEY]]));
    const r = await b.call(request({ tool: 'transfer', risk: 'low' }), { decision: 'require_approval', approved: false });
    expect(r.outcome).toBe('requires_approval');
    const ok = await b.call(request({ tool: 'transfer', risk: 'low' }), { decision: 'require_approval', approved: true });
    expect(ok.outcome).toBe('executed');
  });

  it('refuses calls beyond the tool risk ceiling', async () => {
    const b = new ToolBroker(new Map([[SHELL.name, SHELL]]));
    const r = await b.call(request({ risk: 'critical' }), { decision: 'auto', approved: true });
    expect(r.outcome).toBe('tool_risk_exceeded');
  });

  it('returns tool_not_found for unknown tools (no silent no-op)', async () => {
    const b = new ToolBroker(new Map());
    const r = await b.call(request({ tool: 'nope' }), { decision: 'auto', approved: true });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('tool_not_found');
  });

  it('never reflects full args into audit metadata beyond a truncated summary', async () => {
    const big: Tool = { name: 'big', action: 'tool.big', minRisk: 'low', run: async () => ({ secret: 'sk-super-secret', blob: 'x'.repeat(5000) }) };
    const b = new ToolBroker(new Map([[big.name, big]]));
    const r = await b.call(request({ tool: 'big', risk: 'low' }), { decision: 'auto', approved: true });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('sk-super-secret');
    expect(JSON.stringify(r).length).toBeLessThan(3000);
  });
});
