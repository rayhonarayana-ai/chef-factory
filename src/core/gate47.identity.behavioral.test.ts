import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TRUSTED_SERVICE_IDENTITY } from '../software/git/runner.js';

describe('Gate47 Repo-Local Identity Override - Behavioral', () => {
  it('repo-local identity overridden by service identity via -c flags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chef-g47-idoverride-'));
    try {
      await mkdir(join(root, 'src'));
      await execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });

      await writeFile(join(root, 'src', 'test.ts'), 'test\n');
      await execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
      await execFileSync('git', ['-c', `user.name=${TRUSTED_SERVICE_IDENTITY.authorName}`, '-c', `user.email=${TRUSTED_SERVICE_IDENTITY.authorEmail}`, 'commit', '-m', 'test'], { cwd: root, stdio: 'ignore' });

      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
      const authorName = execFileSync('git', ['log', '--format=%an', '-s', sha], { cwd: root, encoding: 'utf-8' }).trim();
      const authorEmail = execFileSync('git', ['log', '--format=%ae', '-s', sha], { cwd: root, encoding: 'utf-8' }).trim();
      const committerName = execFileSync('git', ['log', '--format=%cn', '-s', sha], { cwd: root, encoding: 'utf-8' }).trim();
      const committerEmail = execFileSync('git', ['log', '--format=%ce', '-s', sha], { cwd: root, encoding: 'utf-8' }).trim();

      expect(authorName).toBe(TRUSTED_SERVICE_IDENTITY.authorName);
      expect(authorEmail).toBe(TRUSTED_SERVICE_IDENTITY.authorEmail);
      expect(committerName).toBe(TRUSTED_SERVICE_IDENTITY.committerName);
      expect(committerEmail).toBe(TRUSTED_SERVICE_IDENTITY.committerEmail);
      expect(authorName).not.toBe('Human Owner');
      expect(authorEmail).not.toBe('human@example.test');
      expect(committerName).not.toBe('Human Owner');
      expect(committerEmail).not.toBe('human@example.test');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});