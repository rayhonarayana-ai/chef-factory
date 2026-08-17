import { describe, expect, it } from 'vitest';
import { parseIntent } from './intent.js';

describe('Command/Intent Layer (deterministic)', () => {
  it('resolves a scoped create-task command', () => {
    const i = parseIntent('create task "write the report" in chef-hq');
    expect(i.status).toBe('resolved');
    expect(i.verb).toBe('create');
    expect(i.resource).toBe('task');
    expect(i.project).toBe('chef-hq');
    expect(i.target).toBe('write the report');
    expect(i.missing).toHaveLength(0);
  });

  it('resolves an informational status command without a resource', () => {
    const i = parseIntent('status');
    expect(i.status).toBe('resolved');
    expect(i.verb).toBe('status');
    expect(i.resource).toBeNull();
  });

  it('resolves list projects', () => {
    const i = parseIntent('list projects');
    expect(i.status).toBe('resolved');
    expect(i.verb).toBe('list');
    expect(i.resource).toBe('project');
  });

  it('does NOT fabricate certainty on empty command', () => {
    const i = parseIntent('');
    expect(i.status).toBe('unknown');
    expect(i.missing).toContain('command text');
  });

  it('does NOT fabricate certainty on gibberish verb', () => {
    const i = parseIntent('blorpt the quarkfizzle');
    expect(i.status).toBe('unknown');
    expect(i.missing).toContain('action verb');
  });

  it('flags a project-scoped action missing its project', () => {
    const i = parseIntent('create task "do something"');
    expect(i.status).toBe('unknown');
    expect(i.missing).toContain('project (task is project-scoped)');
  });

  it('flags deployment without an explicit environment', () => {
    const i = parseIntent('deploy the app in chef-hq');
    expect(i.status).toBe('unknown');
    expect(i.missing).toContain('environment (deployment requires explicit environment)');
  });

  it('flags ambiguous multi-resource commands', () => {
    const i = parseIntent('list tasks and projects');
    expect(i.status).toBe('ambiguous');
    expect(i.verb).toBe('list');
  });

  it('detects explicit environment', () => {
    const i = parseIntent('execute migration in chef-hq production');
    expect(i.environment).toBe('production');
    expect(i.project).toBe('chef-hq');
  });

  it('detects @project shorthand', () => {
    const i = parseIntent('status in @chef-hq');
    expect(i.project).toBe('chef-hq');
  });

  it('does not treat the project slug as the target', () => {
    const i = parseIntent('create task in chef-hq');
    expect(i.target).toBeNull();
  });
});
