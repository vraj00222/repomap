import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import {
  setupFixture,
  setupNonGitDir,
  setupEmptyGitRepo,
  rmDir,
  runCli,
} from './helpers.js';

beforeAll(async () => {
  await execa('npm', ['run', 'build'], { cwd: path.resolve(import.meta.dirname, '..', '..') });
});

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) {
    const d = cleanup.pop();
    if (d) await rmDir(d);
  }
});

describe('repomap init', () => {
  it('exits 0 in a fresh git repo and creates REPOMAP.md', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    const r = await runCli(['init'], dir);
    expect(r.exitCode).toBe(0);
    const exists = await fs
      .stat(path.join(dir, 'REPOMAP.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('installs an executable post-commit hook', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['init'], dir);
    const hookPath = path.join(dir, '.git', 'hooks', 'post-commit');
    const stat = await fs.stat(hookPath);
    expect(stat.isFile()).toBe(true);
    // executable bit
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('running init twice does not duplicate the hook line', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['init'], dir);
    await runCli(['init'], dir);
    const content = await fs.readFile(path.join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    const matches = content.match(/repomap-llm: auto-regenerate REPOMAP\.md/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('exits 1 with clear message when not in a git repo', async () => {
    const dir = await setupNonGitDir();
    cleanup.push(dir);
    const r = await runCli(['init'], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/git repository/i);
  });

  it('works in a git repo with no commits', async () => {
    const dir = await setupEmptyGitRepo();
    cleanup.push(dir);
    // make at least one source file so analyzer has something to do
    await fs.writeFile(path.join(dir, 'index.ts'), 'export const x = 1;\n');
    const r = await runCli(['init'], dir);
    expect(r.exitCode).toBe(0);
  });

  it('--no-hook flag skips hook installation', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    const r = await runCli(['init', '--no-hook'], dir);
    expect(r.exitCode).toBe(0);
    const hookExists = await fs
      .stat(path.join(dir, '.git', 'hooks', 'post-commit'))
      .then(() => true)
      .catch(() => false);
    expect(hookExists).toBe(false);
  });

  it('adds REPOMAP.md to .gitignore by default', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['init'], dir);
    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8').catch(() => '');
    expect(ignore).toMatch(/^REPOMAP\.md$/m);
  });

  it('--commit flag does NOT add to .gitignore', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['init', '--commit'], dir);
    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8').catch(() => '');
    expect(ignore).not.toMatch(/^REPOMAP\.md$/m);
  });
});
