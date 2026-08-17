// CHEF FACTORY — Gate 1 — Command / Intent Layer.
// Deterministic parser. Ambiguity is surfaced as status='ambiguous' or 'unknown'
// with the missing pieces listed — it is NEVER converted into fabricated certainty.

import type { ActionVerb, EnvironmentName, ParsedIntent } from './types.js';

const VERBS: Record<ActionVerb, string[]> = {
  read: ['read', 'show', 'view', 'open'],
  write: ['write', 'edit', 'modify', 'update', 'change'],
  create: ['create', 'new', 'add', 'start', 'begin'],
  update: ['update', 'edit', 'change', 'modify', 'set'],
  delete: ['delete', 'remove', 'destroy', 'drop', 'archive'],
  execute: ['execute', 'run', 'launch', 'do', 'perform', 'build'],
  deploy: ['deploy', 'release', 'publish', 'ship'],
  approve: ['approve', 'authorize', 'accept', 'confirm'],
  reject: ['reject', 'decline', 'deny', 'refuse'],
  cancel: ['cancel', 'abort', 'stop', 'kill'],
  plan: ['plan', 'design', 'architect', 'propose', 'outline'],
  research: ['research', 'investigate', 'analyze', 'explore', 'find'],
  ask: ['ask', 'what', 'how', 'why', 'which', 'who', 'where', 'when', 'help', '?' ],
  list: ['list', 'ls'],
  status: ['status', 'health', 'report', 'state'],
  unknown: [],
};

const RESOURCES: Record<string, string> = {
  task: 'task',
  tasks: 'task',
  project: 'project',
  projects: 'project',
  agent: 'agent',
  agents: 'agent',
  approval: 'approval',
  approvals: 'approval',
  approve: 'approval',
  model: 'model',
  models: 'model',
  runtime: 'runtime',
  runtimes: 'runtime',
  passport: 'passport',
  cost: 'cost',
  costs: 'cost',
  audit: 'audit',
  preference: 'preference',
  preferences: 'preference',
  decision: 'decision',
  decisions: 'decision',
  deploy: 'deploy',
  deployment: 'deploy',
  credit: 'credit',
  funding: 'credit',
  money: 'credit',
  transfer: 'credit',
  contract: 'contract',
  legal: 'legal',
  account: 'account',
  security: 'security',
  access: 'access',
  secret: 'secret',
  keys: 'secret',
};

// Action verbs that require a concrete resource to proceed.
const ACTION_VERBS = new Set<ActionVerb>(['write', 'create', 'update', 'delete', 'execute', 'deploy', 'approve', 'reject', 'cancel']);

function norm(input: string): string {
  return input.toLowerCase().replace(/[.,!?;:()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectVerb(tokens: string[], rawNorm: string): ActionVerb {
  for (const [verb, keywords] of Object.entries(VERBS)) {
    if (verb === 'unknown') continue;
    for (const kw of keywords) {
      if (kw === '?' ) {
        if (rawNorm.includes(kw)) return verb as ActionVerb;
      } else if (tokens.includes(kw)) {
        return verb as ActionVerb;
      }
    }
  }
  return 'unknown';
}

function detectResource(tokens: string[]): { resource: string | null; count: number } {
  let resource: string | null = null;
  let count = 0;
  for (const t of tokens) {
    const r = RESOURCES[t];
    if (r && r !== resource) {
      resource = r;
      count++;
    }
  }
  return { resource, count };
}

function detectProject(rawNorm: string): string | null {
  const at = rawNorm.match(/@([a-z0-9][a-z0-9-_]*)/);
  if (at) return at[1]!;
  const m = rawNorm.match(/(?:^|\s)(?:in|for|on|under)\s+([a-z0-9][a-z0-9-_]*)/);
  if (m) return m[1]!;
  const p = rawNorm.match(/project\s+([a-z0-9][a-z0-9-_]*)/);
  if (p) return p[1]!;
  return null;
}

function detectEnvironment(tokens: string[]): EnvironmentName | null {
  if (tokens.includes('production') || tokens.includes('prod')) return 'production';
  if (tokens.includes('staging') || tokens.includes('stage')) return 'staging';
  if (tokens.includes('development') || tokens.includes('dev')) return 'development';
  return null;
}

const STOP = new Set([
  'in', 'for', 'on', 'under', 'project', 'task', 'agent', 'approval', 'model',
  'runtime', 'passport', 'cost', 'audit', 'preference', 'decision', 'deploy',
  'production', 'prod', 'staging', 'stage', 'development', 'dev', 'the', 'a', 'an',
  'and', 'please', 'my', 'me', 'now', 'to', 'new', 'all', 'of', 'with',
]);

function detectTarget(rawNorm: string, tokens: string[], project: string | null, environment: EnvironmentName | null): string | null {
  const quoted = rawNorm.match(/"([^"]+)"/);
  if (quoted) return quoted[1]!.trim();
  const verbWords = new Set<string>();
  for (const kw of Object.values(VERBS).flat()) verbWords.add(kw);
  const meaningful = tokens.filter(
    (c) =>
      !STOP.has(c) &&
      !verbWords.has(c) &&
      !RESOURCES[c] &&
      c !== project &&
      c !== environment &&
      !c.startsWith('@'),
  );
  return meaningful.length > 0 ? meaningful.join(' ') : null;
}

export function parseIntent(raw: string): ParsedIntent {
  const normalized = norm(raw);
  if (!normalized) {
    return {
      status: 'unknown',
      verb: 'unknown',
      resource: null,
      project: null,
      environment: null,
      target: null,
      confidence: 'low',
      missing: ['command text'],
      normalized,
    };
  }
  const tokens = normalized.split(' ');
  const verb = detectVerb(tokens, normalized);
  const { resource, count: resourceCount } = detectResource(tokens);
  const project = detectProject(normalized);
  const environment = detectEnvironment(tokens);
  const target = detectTarget(normalized, tokens, project, environment);

  const missing: string[] = [];
  if (verb === 'unknown') missing.push('action verb');
  if (ACTION_VERBS.has(verb) && !resource) missing.push('resource');
  if (resource === 'task' && !project) missing.push('project (task is project-scoped)');
  if (verb === 'deploy' && !environment) missing.push('environment (deployment requires explicit environment)');

  const ambiguous = resourceCount > 1;
  const status: ParsedIntent['status'] =
    verb === 'unknown' || missing.length > 0 ? 'unknown' : ambiguous ? 'ambiguous' : 'resolved';

  return {
    status,
    verb,
    resource,
    project,
    environment,
    target,
    confidence: status === 'resolved' ? 'high' : 'low',
    missing,
    normalized,
  };
}
