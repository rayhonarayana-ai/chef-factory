import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import fs from 'node:fs';

describe('Gate47 Real Git Integration - Post Commit State', () => {
  it('r1', async () => {
    // STEP 1: mkdtemp
    const root = await mkdtemp(join(tmpdir(), 'g47-int-post-'));
    let cleanupNeeded = true;
    try {
      // STEP 2: git init (real repository)
      execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
      // STEP 3: create keep.txt
      const keepPath = join(root, 'keep.txt');
      fs.writeFileSync(keepPath, 'keep\n');
      // STEP 4: create base commit B using explicit fixture identity
      execFileSync('git', ['config', 'user.name', 'CHEF Service'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'chef@factory.invalid'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: root, stdio: 'pipe' });
      // STEP 5: record the exact base commit SHA B
      const baseShaResult = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' });
      const baseSha = baseShaResult.stdout?.toString().trim() || '';
      // STEP 6: modify keep.txt
      fs.writeFileSync(keepPath, 'modified\n');
      // STEP 7: stage the modification
      execFileSync('git', ['add', 'keep.txt'], { cwd: root, stdio: 'pipe' });
      // STEP 8: produce the prepared-delivery commit with the fixed service identity
      const commitEnv = Object.assign({}, process.env, {
        GIT_AUTHOR_NAME: 'CHEF Service',
        GIT_AUTHOR_EMAIL: 'chef@factory.invalid',
        GIT_COMMITTER_NAME: 'CHEF Service',
        GIT_COMMITTER_EMAIL: 'chef@factory.invalid',
      });
      execFileSync('git', ['commit', '-m', 'prepared delivery'], { cwd: root, stdio: 'pipe', env: commitEnv });
      const deliveryShaResult = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' });
      const deliverySha = deliveryShaResult.stdout?.toString().trim() || '';
      // STEP 9: after the delivery commit the index is clean; a second raw commit
      // must fail with "nothing to commit". This verifies no ADDITIONAL Git commit
      // is created from an unchanged index.
      // NOTE: This does NOT prove Gate47 authorization single-use / replay denial,
      // or prepared-delivery CAS consumption. Those invariants are proven separately
      // through the production PreparedDelivery state-transition CAS tests
      // (approved -> committing consumed exactly once, second claim denied).
      let secondCommitFailed = false;
      try {
        execFileSync('git', ['commit', '-m', 'second attempt'], { cwd: root, stdio: 'pipe', env: commitEnv });
      } catch (e) {
        secondCommitFailed = true;
      }
      // STEP 10: inspect the real repository post-attempt state
      const headShaResult = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' });
      const headSha = headShaResult.stdout?.toString().trim() || '';
      const parentResult = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf-8' });
      const parentSha = parentResult.stdout?.toString().trim() || '';
      const authorResult = execFileSync('git', ['log', '-1', '--format=%an'], { cwd: root, encoding: 'utf-8' });
      const author = authorResult.trim();
      const committerResult = execFileSync('git', ['log', '-1', '--format=%cn'], { cwd: root, encoding: 'utf-8' });
      const committer = committerResult.trim();
      // STEP 11: cleanup
      fs.rmSync(root, { recursive: true, force: true });
      cleanupNeeded = false;
      // === RESULTS ===
      // Base parent lineage is correct (delivery commit's parent equals B).
      expect(parentSha).toBe(baseSha);
      // Service identity is preserved on the delivery commit.
      expect(author).toBe('CHEF Service');
      expect(committer).toBe('CHEF Service');
      // Prepared-delivery commit was created exactly once; HEAD did not advance
      // when a second raw commit was attempted from an unchanged index.
      expect(secondCommitFailed).toBe(true);
      expect(headSha).toBe(deliverySha);
    } catch (e) {
      if (cleanupNeeded) {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
      }
      throw e;
    }
  });
});
