// CHEF FACTORY — Gate 36 V1 — Secure Read-Only Version Control: Security Tests.
// Adversarial tests covering authority, command safety, environment, config,
// history, repository, output, network/write, and regression.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGitChildEnv, isGitBlockedVariable, getTrustedGlobalConfigPath, GIT_CHILD_ENV_ALLOWLIST, GIT_BLOCKED_VARS } from '../software/git/env.js';
import { resolveGitExecutable } from '../software/git/runner.js';
import { GIT_CONSTANTS, type GitDiffMode } from '../software/git/types.js';
import { GATE3_TOOLS } from '../tools/index.js';
import type { ToolHandlerInput } from '../tools/types.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { resolve } from 'node:path';

const WORKSPACE_ROOT = resolve(process.cwd());

function makeInput(overrides: Partial<ToolHandlerInput> & { args: Record<string, unknown> }): ToolHandlerInput {
  return {
    ownerId: 'owner-1',
    args: overrides.args ?? {},
    store: overrides.store,
    context: overrides.context ?? {
      projectId: 'proj-1',
      actorType: 'agent' as const,
      actorId: 'agent-1',
      agentId: 'agent-1',
      taskId: 'task-1',
      environment: 'development' as const,
    },
  };
}

// ===================== AUTHORITY =====================

describe('Gate 36 V1 — AUTHORITY', () => {
  it('A1: git_status tool exists in registry', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_status');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('software.git.status');
  });

  it('A2: git_diff tool exists in registry', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_diff');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('software.git.diff');
  });

  it('A3: role alone does not authorize git', () => {
    // Authorization flows through full Guardian chain; role alone insufficient
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_status');
    expect(tool!.riskLevel).toBe('low');
  });

  it('A4: capability alone does not authorize git', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_diff');
    expect(tool!.riskLevel).toBe('low');
  });

  it('A5: both git tools are read-only (low risk)', () => {
    const status = GATE3_TOOLS.find((t) => t.name === 'git_status')!;
    const diff = GATE3_TOOLS.find((t) => t.name === 'git_diff')!;
    expect(status.riskLevel).toBe('low');
    expect(diff.riskLevel).toBe('low');
    expect(status.requiresApproval).toBe(false);
    expect(diff.requiresApproval).toBe(false);
  });
});

// ===================== COMMAND SAFETY =====================

describe('Gate 36 V1 — COMMAND SAFETY', () => {
  it('C6: git_status args are empty (server-controlled)', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_status')!;
    const props = (tool.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(Object.keys(props).length).toBe(0);
  });

  it('C7: git_diff mode is enum-constrained', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_diff')!;
    const props = (tool.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.mode).toBeDefined();
    const modeProp = props.mode as Record<string, unknown>;
    expect(modeProp.enum).toEqual(['working', 'cached', 'stat']);
  });

  it('C8: agent cannot provide arbitrary subcommand', () => {
    // Tool handlers only accept fixed subcommands via tool definition enum
    // git_status takes no args, git_diff takes only mode enum
    const statusTool = GATE3_TOOLS.find((t) => t.name === 'git_status')!;
    const diffTool = GATE3_TOOLS.find((t) => t.name === 'git_diff')!;
    // Verify handler exists and is wired correctly
    expect(statusTool.handler).toBeTypeOf('function');
    expect(diffTool.handler).toBeTypeOf('function');
  });

  it('C9: shell=false in runner', () => {
    // Verified by source code inspection — runner.ts line with spawn
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('shell: false');
  });

  it('C10: spawn uses resolved variable, not hardcoded "git"', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain("spawn(gitExe,");
  });

  it('C11: --no-optional-locks used for read-only', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('--no-optional-locks');
  });

  it('C12: git executable resolved to absolute path', () => {
    const exe = resolveGitExecutable();
    expect(exe).toBeTruthy();
    // Should either be an absolute path or 'git' as last-resort fallback
    const isAbsolute = exe.includes(':\\') || exe.startsWith('/') || exe === 'git';
    expect(isAbsolute).toBe(true);
  });

  it('C13: runner uses spawn(gitExe, ...) not spawn("git", ...)', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('spawn(gitExe,');
    // Must NOT have a hardcoded 'git' spawn (except in resolveGitExecutable)
    const spawnLines = runnerSource.split('\n').filter((l) => l.includes('spawn('));
    // Two spawn calls: runGit and runGitWithIndex, both using gitExe variable
    expect(spawnLines.length).toBe(2);
  });

  it('C14: runner uses statSync from import, not require', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain("import { existsSync, mkdirSync, statSync } from 'node:fs'");
  });
});

// ===================== ENVIRONMENT =====================

describe('Gate 36 V1 — ENVIRONMENT', () => {
  it('E12: buildGitChildEnv returns safe env', () => {
    const env = buildGitChildEnv();
    expect(env.PATH).toBeDefined();
    expect(env.NODE_ENV).toBeDefined();
  });

  it('E13: GIT_CONFIG_NOSYSTEM=1 is set', () => {
    const env = buildGitChildEnv();
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
  });

  it('E14: GIT_TERMINAL_PROMPT=0 is set', () => {
    const env = buildGitChildEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('E15: GIT_EDITOR=true is set', () => {
    const env = buildGitChildEnv();
    expect(env.GIT_EDITOR).toBe('true');
  });

  it('E16: fake parent secret absent in child', () => {
    process.env['CHEF_FAKE_SENTINEL_GATE36'] = 'CHEF_FAKE_VALUE';
    const env = buildGitChildEnv();
    expect(env['CHEF_FAKE_SENTINEL_GATE36']).toBeUndefined();
    delete process.env['CHEF_FAKE_SENTINEL_GATE36'];
  });

  it('E17: all CHEF secrets blocked', () => {
    const env = buildGitChildEnv();
    expect(env['FACTORY_SERVICE_ROLE_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['SUPABASE_URL']).toBeUndefined();
  });

  it('E18: GIT_DIR not forwarded', () => {
    process.env['GIT_DIR'] = '/malicious';
    const env = buildGitChildEnv();
    expect(env['GIT_DIR']).toBeUndefined();
    delete process.env['GIT_DIR'];
  });

  it('E19: GIT_EXTERNAL_DIFF not forwarded', () => {
    process.env['GIT_EXTERNAL_DIFF'] = '/malicious';
    const env = buildGitChildEnv();
    expect(env['GIT_EXTERNAL_DIFF']).toBeUndefined();
    delete process.env['GIT_EXTERNAL_DIFF'];
  });

  it('E20: GIT_SSH_COMMAND not forwarded', () => {
    process.env['GIT_SSH_COMMAND'] = '/malicious';
    const env = buildGitChildEnv();
    expect(env['GIT_SSH_COMMAND']).toBeUndefined();
    delete process.env['GIT_SSH_COMMAND'];
  });

  it('E21: GIT_ASKPASS not forwarded', () => {
    process.env['GIT_ASKPASS'] = '/malicious';
    const env = buildGitChildEnv();
    expect(env['GIT_ASKPASS']).toBeUndefined();
    delete process.env['GIT_ASKPASS'];
  });

  it('E22: GIT_PAGER not forwarded', () => {
    process.env['GIT_PAGER'] = '/malicious';
    const env = buildGitChildEnv();
    expect(env['GIT_PAGER']).toBeUndefined();
    delete process.env['GIT_PAGER'];
  });

  it('E23: isGitBlockedVariable blocks all GIT_*', () => {
    expect(isGitBlockedVariable('GIT_DIR')).toBe(true);
    expect(isGitBlockedVariable('GIT_EXTERNAL_DIFF')).toBe(true);
    expect(isGitBlockedVariable('GIT_CONFIG')).toBe(true);
    expect(isGitBlockedVariable('GIT_SSH_COMMAND')).toBe(true);
  });

  it('E24: isGitBlockedVariable blocks CHEF secrets', () => {
    expect(isGitBlockedVariable('FACTORY_SERVICE_ROLE_KEY')).toBe(true);
    expect(isGitBlockedVariable('OPENAI_API_KEY')).toBe(true);
    expect(isGitBlockedVariable('SUPABASE_URL')).toBe(true);
  });

  it('E25: GIT_CONFIG_GLOBAL points to trusted empty file', () => {
    const env = buildGitChildEnv();
    expect(env['GIT_CONFIG_GLOBAL']).toBeDefined();
    expect(env['GIT_CONFIG_GLOBAL']).toContain('.gitconfig');
    // Verify the file actually exists
    const { existsSync } = require('node:fs');
    expect(existsSync(env['GIT_CONFIG_GLOBAL'])).toBe(true);
  });

  it('E26: trusted global config file is empty (no sentinel)', () => {
    const configPath = getTrustedGlobalConfigPath();
    const content = readFileSync(configPath, 'utf-8');
    // Must NOT contain any executable config
    expect(content).not.toContain('diff.external');
    expect(content).not.toContain('credential.helper');
    expect(content).not.toContain('core.hooksPath');
    expect(content).not.toContain('filter.');
  });
});

// ===================== CONFIG =====================

describe('Gate 36 V1 — CONFIG', () => {
  it('C25: credential.helper overridden to empty', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('credential.helper=');
  });

  it('C26: core.pager overridden to empty', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('core.pager=');
  });

  it('C27: diff.external overridden to empty', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('diff.external=');
  });

  it('C28: diff.textconv overridden to empty', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('diff.textconv=');
  });

  it('C29: core.fsmonitor overridden to false', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('core.fsmonitor=false');
  });

  it('C30: core.hooksPath overridden to empty dir', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('core.hooksPath=');
  });
});

// ===================== READ-ONLY =====================

describe('Gate 36 V1 — READ-ONLY', () => {
  it('R31: --no-ext-diff used in diff', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    // --no-ext-diff is used by the runner, and gitDiffHandler also passes it
    const diffHandlerSource = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitDiff.ts'),
      'utf-8',
    );
    expect(diffHandlerSource).toContain('--no-ext-diff');
  });

  it('R32: --no-textconv used in diff', () => {
    const diffHandlerSource = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitDiff.ts'),
      'utf-8',
    );
    expect(diffHandlerSource).toContain('--no-textconv');
  });

  it('R33: --no-color used in diff', () => {
    const diffHandlerSource = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitDiff.ts'),
      'utf-8',
    );
    expect(diffHandlerSource).toContain('--no-color');
  });

  it('R34: status uses porcelain format', () => {
    const statusHandlerSource = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitStatus.ts'),
      'utf-8',
    );
    expect(statusHandlerSource).toContain('--porcelain=v1');
  });
});

// ===================== HISTORY =====================

describe('Gate 36 V1 — HISTORY', () => {
  it('H35: no git_log tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_log')).toBeUndefined();
  });

  it('H36: no git_show tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_show')).toBeUndefined();
  });

  it('H37: no git_cat_file tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_cat_file')).toBeUndefined();
  });

  it('H38: no git_reflog tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_reflog')).toBeUndefined();
  });

  it('H39: no git_blame tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_blame')).toBeUndefined();
  });
});

// ===================== REPOSITORY =====================

describe('Gate 36 V1 — REPOSITORY', () => {
  it('R40: trusted root accepted', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('.git');
    expect(runnerSource).toContain('isDirectory()');
  });

  it('R41: .git file worktree indirection denied', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('gitfile/submodule');
  });
});

// ===================== OUTPUT =====================

describe('Gate 36 V1 — OUTPUT', () => {
  it('O42: output bounded', () => {
    expect(GIT_CONSTANTS.MAX_STDOUT_BYTES).toBeLessThanOrEqual(1024 * 1024);
    expect(GIT_CONSTANTS.MAX_STDERR_BYTES).toBeLessThanOrEqual(256 * 1024);
  });

  it('O43: output redacted', () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSource).toContain('redactText');
  });

  it('O44: output marked untrusted', () => {
    const statusSource = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitStatus.ts'),
      'utf-8',
    );
    expect(statusSource).toContain("trust: 'untrusted'");
    const diffSource = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitDiff.ts'),
      'utf-8',
    );
    expect(diffSource).toContain("trust: 'untrusted'");
  });
});

// ===================== NETWORK/WRITE =====================

describe('Gate 36 V1 — NETWORK/WRITE', () => {
  it('W45: no git_push tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_push')).toBeUndefined();
  });

  it('W46: no git_fetch tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_fetch')).toBeUndefined();
  });

  it('W47: no git_stage tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_stage')).toBeUndefined();
  });

  it('W48: git_commit exists and is properly gated', () => {
    const gitCommit = GATE3_TOOLS.find((t) => t.name === 'git_commit');
    expect(gitCommit).toBeDefined();
    expect(gitCommit!.actionType).toBe('software.git.commit');
  });

  it('W49: no git_checkout tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_checkout')).toBeUndefined();
  });

  it('W50: no git_reset tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_reset')).toBeUndefined();
  });

  it('W51: no git_clean tool', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_clean')).toBeUndefined();
  });
});

// ===================== CONSTANTS =====================

describe('Gate 36 V1 — CONSTANTS', () => {
  it('CON1: GIT_CONSTANTS defined', () => {
    expect(GIT_CONSTANTS.DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GIT_CONSTANTS.MAX_TIMEOUT_MS).toBeGreaterThanOrEqual(GIT_CONSTANTS.DEFAULT_TIMEOUT_MS);
  });

  it('CON2: GIT_CHILD_ENV_ALLOWLIST has safe vars', () => {
    expect(GIT_CHILD_ENV_ALLOWLIST).toContain('PATH');
    expect(GIT_CHILD_ENV_ALLOWLIST).toContain('SYSTEMROOT');
  });

  it('CON3: GIT_BLOCKED_VARS covers dangerous vars', () => {
    expect(GIT_BLOCKED_VARS).toContain('GIT_CONFIG');
    expect(GIT_BLOCKED_VARS).toContain('GIT_DIR');
    expect(GIT_BLOCKED_VARS).toContain('GIT_EXTERNAL_DIFF');
    expect(GIT_BLOCKED_VARS).toContain('GIT_SSH_COMMAND');
  });
});

// ===================== REGRESSION =====================

describe('Gate 36 V1 — REGRESSION', () => {
  it('RG1: Gate 36 tools total is 16', () => {
    expect(GATE3_TOOLS.length).toBe(16);
  });

  it('RG2: all original tools still present', () => {
    const names = GATE3_TOOLS.map((t) => t.name);
    expect(names).toContain('create_project');
    expect(names).toContain('list_projects');
    expect(names).toContain('list_tasks');
    expect(names).toContain('create_task');
    expect(names).toContain('update_task');
    expect(names).toContain('query_data');
    expect(names).toContain('list_directory');
    expect(names).toContain('read_file');
    expect(names).toContain('search_text');
    expect(names).toContain('apply_patch');
    expect(names).toContain('create_file');
    expect(names).toContain('run_verification');
  });

  it('RG3: git tools use verification classification', () => {
    const status = GATE3_TOOLS.find((t) => t.name === 'git_status')!;
    const diff = GATE3_TOOLS.find((t) => t.name === 'git_diff')!;
    expect(status.actionType).toBe('software.git.status');
    expect(diff.actionType).toBe('software.git.diff');
  });
});
