// CHEF FACTORY — Gate 1 — OpenCode Zen Runtime Adapter (boundary).
// OpenCode Zen may be used as a runtime adapter. It is NOT the Factory brain.
// This adapter only becomes active when the opencode CLI is present and the
// execution path is provided via environment. Never auto-executes production work.

import type { RuntimeAdapter, RuntimeExecutionRequest, RuntimeExecutionResult } from '../runtimeGateway.js';

export function createOpenCodeZenAdapter(opts: { cliPath?: string | null; enabled?: boolean } = {}): RuntimeAdapter {
  const cli = opts.cliPath ?? process.env['FACTORY_OPENCODE_CLI'] ?? null;
  const enabled = opts.enabled ?? false;
  return {
    runtimeName: 'opencode-zen',
    available(): boolean {
      return enabled && Boolean(cli);
    },
    async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
      if (!enabled || !cli) {
        return {
          runtime: 'opencode-zen',
          ok: false,
          output: '',
          error: 'opencode-zen adapter not enabled (boundary only in Gate 1)',
          durationMs: 0,
          estimatedCost: 0,
        };
      }
      const started = Date.now();
      try {
        const { spawn } = await import('node:child_process');
        const output = await new Promise<string>((resolve, reject) => {
          const child = spawn(cli, ['run', request.command], {
            cwd: request.projectPath ?? undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
          });
          let out = '';
          let err = '';
          child.stdout?.on('data', (d) => (out += String(d)));
          child.stderr?.on('data', (d) => (err += String(d)));
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve(out);
            else reject(new Error(err || `exit code ${code}`));
          });
        });
        const durationMs = Date.now() - started;
        return {
          runtime: 'opencode-zen',
          ok: true,
          output,
          error: null,
          durationMs,
          estimatedCost: (durationMs / 3600000) * (request.runtime.costPerHour || 0),
        };
      } catch (e) {
        return {
          runtime: 'opencode-zen',
          ok: false,
          output: '',
          error: String(e),
          durationMs: Date.now() - started,
          estimatedCost: 0,
        };
      }
    },
  };
}
