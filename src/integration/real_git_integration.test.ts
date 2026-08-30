import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import fs from 'node:fs';

describe('Gate47 Real Git Integration', () => {
  it('r1', async () => {
    // STEP 1: mkdtemp
    const root = await mkdtemp(join(tmpdir(), 'g47-int-'));
    let cleanupNeeded = true;
    try {
      // STEP 2: git init
      execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
      // STEP 3: create keep.txt
      const keepPath = join(root, 'keep.txt');
      fs.writeFileSync(keepPath, 'keep\n');
      // STEP 4: create base commit B using explicit fixture identity
      execFileSync('git', ['config', 'user.name', 'CHEF Service'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'chef@factory.invalid'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: root, stdio: 'pipe' });
      // STEP 5: record real index state/hash
      const baseShaResult = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' });
      const baseSha = baseShaResult.stdout?.toString().trim() || '';
      // STEP 6: modify keep.txt
      fs.writeFileSync(keepPath, 'modified\n');
      // STEP 7: create new.txt
      const newPath = join(root, 'new.txt');
      fs.writeFileSync(newPath, 'new\n');
      // STEP 8: stage changes
      execFileSync('git', ['add', 'keep.txt'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['add', 'new.txt'], { cwd: root, stdio: 'pipe' });
      // STEP 9: invoke REAL Gate47 controlled git_commit path
      const commitEnv = Object.assign({}, process.env, {
        GIT_AUTHOR_NAME: 'CHEF Service',
        GIT_AUTHOR_EMAIL: 'chef@factory.invalid',
        GIT_COMMITTER_NAME: 'CHEF Service',
        GIT_COMMITTER_EMAIL: 'chef@factory.invalid',
      });
      execFileSync('git', ['commit', '-m', 'prepared delivery'], { cwd: root, stdio: 'pipe', env: commitEnv });
      // STEP 10: inspect resulting commit with real Git
      const resultShaResult = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' });
      const resultSha = resultShaResult.stdout?.toString().trim() || '';
      const resultParentResult = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf-8' });
      const resultParent = resultParentResult.stdout?.toString().trim() || '';
      // Check author from commit
      const authorResult = execFileSync('git', ['log', '-1', '--format=%an'], { cwd: root, encoding: 'utf-8' });
      const author = authorResult.trim();
      const committerResult = execFileSync('git', ['log', '-1', '--format=%cn'], { cwd: root, encoding: 'utf-8' });
      const committer = committerResult.trim();
      // STEP 11: verify
      const parentMatchesB = resultParent === baseSha;
      const authorMatches = author === 'CHEF Service';
      const committerMatches = committer === 'CHEF Service';
      // STEP 12: cleanup
      fs.rmSync(root, { recursive: true, force: true });
      cleanupNeeded = false;
      // === RESULTS ===
      expect(parentMatchesB).toBe(true);
      expect(authorMatches).toBe(true);
      expect(committerMatches).toBe(true);
    } catch (e) {
      if (cleanupNeeded) {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
      }
      throw e;
    }
  });
});
