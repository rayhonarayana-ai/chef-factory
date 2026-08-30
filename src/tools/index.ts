// CHEF FACTORY — Gate 3 → Gate 6 → Gate 35A → Gate 36 V1 → Gate 36 V2 — Tool registry exports.
// Gate 3: 5 initial tools. Gate 6: adds query_data for Data Intelligence.
// Gate 35A: adds 5 secure software-engineering tools.
// Gate 36 V1: adds git_status and git_diff for secure read-only version control.
// Gate 36 V2: adds git_prepare_commit and git_commit for controlled staging and verified commit.

export { createProjectHandler } from './create-project.js';
export { listProjectsHandler } from './list-projects.js';
export { listTasksHandler } from './list-tasks.js';
export { createTaskHandler } from './create-task.js';
export { updateTaskHandler } from './update-task.js';
export { queryDataHandler } from './query-data.js';
export { listDirectoryHandler } from '../software/tools/listDirectory.js';
export { readFileHandler } from '../software/tools/readFile.js';
export { searchTextHandler } from '../software/tools/searchText.js';
export { applyPatchHandler } from '../software/tools/applyPatch.js';
export { createFileHandler } from '../software/tools/createFile.js';
export { runVerificationHandler } from '../software/tools/runVerification.js';
export { gitStatusHandler } from '../software/tools/gitStatus.js';
export { gitDiffHandler } from '../software/tools/gitDiff.js';
export { gitPrepareCommitHandler } from '../software/tools/gitPrepareCommit.js';
export { gitCommitHandler } from '../software/tools/gitCommit.js';

import type { ToolDefinition } from './types.js';
import { createProjectHandler } from './create-project.js';
import { listProjectsHandler } from './list-projects.js';
import { listTasksHandler } from './list-tasks.js';
import { createTaskHandler } from './create-task.js';
import { updateTaskHandler } from './update-task.js';
import { QUERY_DATA_TOOL, queryDataHandler } from './query-data.js';
import { listDirectoryHandler } from '../software/tools/listDirectory.js';
import { readFileHandler } from '../software/tools/readFile.js';
import { searchTextHandler } from '../software/tools/searchText.js';
import { applyPatchHandler } from '../software/tools/applyPatch.js';
import { createFileHandler } from '../software/tools/createFile.js';
import { runVerificationHandler } from '../software/tools/runVerification.js';
import { gitStatusHandler } from '../software/tools/gitStatus.js';
import { gitDiffHandler } from '../software/tools/gitDiff.js';
import { gitPrepareCommitHandler } from '../software/tools/gitPrepareCommit.js';
import { gitCommitHandler } from '../software/tools/gitCommit.js';

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
  // Gate 35A — Secure Software Engineering Tools
  {
    name: 'list_directory',
    description: 'List files and directories within the approved project workspace. Returns bounded results with protected paths omitted.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within workspace (default: workspace root)' },
        depth: { type: 'number', description: 'Recursion depth (default: 1, max: 5)' },
      },
      required: [],
    },
    riskLevel: 'low' as const,
    actionType: 'software.file.read',
    requiresApproval: false,
    handler: listDirectoryHandler,
  },
  {
    name: 'search_text',
    description: 'Search file contents within the approved project workspace using regex. Protected paths excluded. Results bounded.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Relative directory to search within (default: workspace root)' },
        maxResults: { type: 'number', description: 'Maximum results to return (default: 50, max: 50)' },
      },
      required: ['query'],
    },
    riskLevel: 'low' as const,
    actionType: 'software.file.search',
    requiresApproval: false,
    handler: searchTextHandler,
  },
  {
    name: 'read_file',
    description: 'Read a text source file within the approved project workspace. Protected paths denied. Binary files rejected. Output marked untrusted.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within workspace' },
        offset: { type: 'number', description: 'Line number to start reading from (0-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
    riskLevel: 'low' as const,
    actionType: 'software.file.read',
    requiresApproval: false,
    handler: readFileHandler,
  },
  {
    name: 'apply_patch',
    description: 'Replace file content with new content. Requires expectedContentHash for CAS. Advisory-locked. Pre-write DLP enforced. Returns conflict if file was modified since last read.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within workspace' },
        patch: { type: 'string', description: 'Complete new file content' },
        expectedContentHash: { type: 'string', description: 'SHA-256 hash of current file content (from read_file)' },
      },
      required: ['path', 'patch', 'expectedContentHash'],
    },
    riskLevel: 'medium' as const,
    actionType: 'software.file.write',
    requiresApproval: false,
    handler: applyPatchHandler,
  },
  {
    name: 'create_file',
    description: 'Create a new file within the approved project workspace. Exclusive creation — fails if file already exists. DLP enforced.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within workspace' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
    riskLevel: 'medium' as const,
    actionType: 'software.file.write',
    requiresApproval: false,
    handler: createFileHandler,
  },
  // Gate 35B — Safe Verification Execution
  {
    name: 'run_verification',
    description: 'Run a structured verification operation on the project workspace. Agent selects operation only (test, typecheck, build). All execution details resolved server-side. No shell access.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Verification operation to run', enum: ['test', 'typecheck', 'build'] },
        filter: { type: 'string', description: 'Optional test filter pattern (test operation only). Alphanumeric, slashes, dots, dashes allowed.' },
      },
      required: ['operation'],
    },
    riskLevel: 'medium' as const,
    actionType: 'software.verification.execute',
    requiresApproval: false,
    handler: runVerificationHandler,
  },
  // Gate 36 V1 — Secure Read-Only Version Control
  {
    name: 'git_status',
    description: 'Show the working tree status of the project repository. Returns porcelain-format output with file change summary. Read-only — does not modify the index or working tree.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    riskLevel: 'low' as const,
    actionType: 'software.git.status',
    requiresApproval: false,
    handler: gitStatusHandler,
  },
  {
    name: 'git_diff',
    description: 'Show differences in the project repository. Agent selects mode only (working, cached, stat). All flags resolved server-side. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'Diff mode', enum: ['working', 'cached', 'stat'] },
      },
      required: [],
    },
    riskLevel: 'low' as const,
    actionType: 'software.git.diff',
    requiresApproval: false,
    handler: gitDiffHandler,
  },
  // Gate 36 V2 — Controlled Staging and Verified Commit
  {
    name: 'git_prepare_commit',
    description: 'Prepare a commit by validating file attribution, computing fingerprints, running DLP, and creating an approval for human review. Operates under repo-level lock. Staging is internal — no agent-visible git_stage.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message (3-500 chars)' },
      },
      required: ['message'],
    },
    riskLevel: 'high' as const,
    actionType: 'software.git.stage',
    requiresApproval: false,
    approvalRequest: true,
    handler: gitPrepareCommitHandler,
  },
  {
    name: 'git_commit',
    description: 'Execute a human-approved commit using temp index. Revalidates all state, stages via alternate GIT_INDEX_FILE, commits. No push.',
    parameters: {
      type: 'object',
      properties: {
        approval_id: { type: 'string', description: 'ID of the approved git_prepare_commit approval' },
      },
      required: ['approval_id'],
    },
    riskLevel: 'critical' as const,
    actionType: 'software.git.commit',
    requiresApproval: false,
    approvalBound: true,
    handler: gitCommitHandler,
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
