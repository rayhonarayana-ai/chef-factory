import { describe, expect, it } from 'vitest';
import { GATE3_TOOLS, toOpenAITools, toAnthropicTools, toGoogleTools } from './index.js';
import type { ToolDefinition } from './types.js';

describe('Gate 3 — Tool Registry', () => {
  it('registers exactly 14 tools (6 core + 5 workspace/software + 1 verification + 2 git)', () => {
    expect(GATE3_TOOLS.length).toBe(14);
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
    expect(names).toEqual([
      'apply_patch',
      'create_file',
      'create_project',
      'create_task',
      'git_diff',
      'git_status',
      'list_directory',
      'list_projects',
      'list_tasks',
      'query_data',
      'read_file',
      'run_verification',
      'search_text',
      'update_task',
    ]);
  });

  it('toOpenAITools produces correct format', () => {
    const openai = toOpenAITools(GATE3_TOOLS);
    expect(openai.length).toBe(14);
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
    expect(anthropic.length).toBe(14);
    for (const tool of anthropic) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeTruthy();
    }
  });

  it('toGoogleTools produces correct format', () => {
    const google = toGoogleTools(GATE3_TOOLS);
    expect(google.length).toBe(14);
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

  // Gate 35A — workspace/software tools
  it('list_directory tool is low risk and read-only', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'list_directory');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('software.file.read');
    expect(tool!.requiresApproval).toBe(false);
  });

  it('read_file tool is low risk and read-only', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'read_file');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('software.file.read');
    expect(tool!.requiresApproval).toBe(false);
  });

  it('search_text tool is low risk and read-only', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'search_text');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('software.file.search');
    expect(tool!.requiresApproval).toBe(false);
  });

  it('apply_patch tool is medium risk (per Gate 35A spec: approval enforced at Guardian layer)', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'apply_patch');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('medium');
    expect(tool!.actionType).toBe('software.file.write');
  });

  it('create_file tool is medium risk (per Gate 35A spec: approval enforced at Guardian layer)', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'create_file');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('medium');
    expect(tool!.actionType).toBe('software.file.write');
  });

  // Gate 35B — Safe Verification Execution
  it('run_verification tool is medium risk', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'run_verification');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('medium');
    expect(tool!.actionType).toBe('software.verification.execute');
  });

  // Gate 36 V1 — Secure Read-Only Version Control
  it('git_status tool is low risk and read-only', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_status');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('software.git.status');
    expect(tool!.requiresApproval).toBe(false);
  });

  it('git_diff tool is low risk and read-only', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_diff');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.actionType).toBe('software.git.diff');
    expect(tool!.requiresApproval).toBe(false);
  });
});
