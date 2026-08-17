import { describe, expect, it } from 'vitest';
import { GATE3_TOOLS, toOpenAITools, toAnthropicTools, toGoogleTools } from './index.js';
import type { ToolDefinition } from './types.js';

describe('Gate 3 — Tool Registry', () => {
  it('registers exactly 6 tools', () => {
    expect(GATE3_TOOLS.length).toBe(6);
  });

  it('each tool has required fields', () => {
    for (const tool of GATE3_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(tool.handler).toBeTypeOf('function');
      expect(['low', 'medium', 'high', 'critical']).toContain(tool.riskLevel);
      expect(tool.actionType).toBeTruthy();
    }
  });

  it('tool names match expected set', () => {
    const names = GATE3_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['create_project', 'create_task', 'list_projects', 'list_tasks', 'query_data', 'update_task']);
  });

  it('toOpenAITools produces correct format', () => {
    const openai = toOpenAITools(GATE3_TOOLS);
    expect(openai.length).toBe(6);
    for (const tool of openai) {
      expect(tool.type).toBe('function');
      const fn = tool.function as Record<string, unknown>;
      expect(fn.name).toBeTruthy();
      expect(fn.description).toBeTruthy();
      expect(fn.parameters).toBeTruthy();
    }
  });

  it('toAnthropicTools produces correct format', () => {
    const anthropic = toAnthropicTools(GATE3_TOOLS);
    expect(anthropic.length).toBe(6);
    for (const tool of anthropic) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeTruthy();
    }
  });

  it('toGoogleTools produces correct format', () => {
    const google = toGoogleTools(GATE3_TOOLS);
    expect(google.length).toBe(6);
    for (const tool of google) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      const params = tool.parameters as Record<string, unknown>;
      expect(params.type).toBe('OBJECT');
    }
  });

  it('create_project tool has correct action type', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'create_project');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('project_create');
    expect(tool!.riskLevel).toBe('medium');
  });

  it('list_projects tool is low risk', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'list_projects');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('read');
  });

  it('list_tasks tool is low risk', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'list_tasks');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('read');
  });

  it('create_task tool has correct action type', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'create_task');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('task_create');
    expect(tool!.riskLevel).toBe('medium');
  });

  it('update_task tool has correct action type', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'update_task');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('task_update');
    expect(tool!.riskLevel).toBe('medium');
  });

  it('query_data tool is low risk and read-only', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'query_data');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('data_query');
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.requiresApproval).toBe(false);
  });
});
