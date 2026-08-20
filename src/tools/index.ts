// CHEF FACTORY — Gate 3 → Gate 6 — Tool registry exports.
// Gate 3: 5 initial tools. Gate 6: adds query_data for Data Intelligence.

export { createProjectHandler } from './create-project.js';
export { listProjectsHandler } from './list-projects.js';
export { listTasksHandler } from './list-tasks.js';
export { createTaskHandler } from './create-task.js';
export { updateTaskHandler } from './update-task.js';
export { queryDataHandler } from './query-data.js';

import type { ToolDefinition } from './types.js';
import { createProjectHandler } from './create-project.js';
import { listProjectsHandler } from './list-projects.js';
import { listTasksHandler } from './list-tasks.js';
import { createTaskHandler } from './create-task.js';
import { updateTaskHandler } from './update-task.js';
import { QUERY_DATA_TOOL, queryDataHandler } from './query-data.js';

export const GATE3_TOOLS: ToolDefinition[] = [
  {
    name: 'create_project',
    description: 'Create a new project with name, slug, and optional description',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project display name' },
        slug: { type: 'string', description: 'URL-friendly identifier (auto-generated from name if not provided)' },
        description: { type: 'string', description: 'Project description' },
      },
      required: ['name'],
    },
    riskLevel: 'medium',
    actionType: 'project_create',
    requiresApproval: false,
    handler: createProjectHandler,
  },
  {
    name: 'list_projects',
    description: 'List all projects owned by the current user',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    riskLevel: 'low',
    actionType: 'read',
    requiresApproval: false,
    handler: listProjectsHandler,
  },
  {
    name: 'list_tasks',
    description: 'List tasks in a project, optionally filtered by status',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The ID of the project to list tasks for' },
        status: { type: 'string', description: 'Filter by task status', enum: ['created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval'] },
      },
      required: ['project_id'],
    },
    riskLevel: 'low',
    actionType: 'read',
    requiresApproval: false,
    handler: listTasksHandler,
  },
  {
    name: 'create_task',
    description: 'Create a new task in a project with title and optional description',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The ID of the project to add the task to' },
        title: { type: 'string', description: 'The title of the task' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Task priority', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['project_id', 'title'],
    },
    riskLevel: 'medium',
    actionType: 'task_create',
    requiresApproval: false,
    handler: createTaskHandler,
  },
  {
    name: 'update_task',
    description: 'Update a task status, title, or description',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task to update' },
        title: { type: 'string', description: 'New title' },
        status: { type: 'string', description: 'New status', enum: ['created', 'queued', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval'] },
        priority: { type: 'string', description: 'New priority', enum: ['low', 'medium', 'high', 'critical'] },
        description: { type: 'string', description: 'New description' },
      },
      required: ['task_id'],
    },
    riskLevel: 'medium',
    actionType: 'task_update',
    requiresApproval: false,
    handler: updateTaskHandler,
  },
  // Gate 6 — Data Intelligence: query_data tool
  {
    ...QUERY_DATA_TOOL,
    handler: queryDataHandler,
  },
];

/** Convert a ToolDefinition to OpenAI tools format. */
export function toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Convert a ToolDefinition to Anthropic tools format. */
export function toAnthropicTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Convert a ToolDefinition to Google function declarations format. */
export function toGoogleTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: convertToGoogleParams(t.parameters as Record<string, unknown>),
  }));
}

function convertToGoogleParams(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (schema.type) result.type = String(schema.type).toUpperCase();
  if (schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    result.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, convertToGoogleParamValue(v)]),
    );
  }
  if (schema.required) result.required = schema.required;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  return result;
}

function convertToGoogleParamValue(param: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (param.type) result.type = String(param.type).toUpperCase();
  if (param.description) result.description = param.description;
  if (param.enum) result.enum = param.enum;
  return result;
}
