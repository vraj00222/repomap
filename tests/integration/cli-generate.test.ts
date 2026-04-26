import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { setupFixture, rmDir, runCli, readRepomap } from './helpers.js';

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

describe('repomap generate', () => {
  it('produces a valid REPOMAP.md with all required sections on the Next.js fixture', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    const r = await runCli(['generate'], dir);
    expect(r.exitCode).toBe(0);
    const out = await readRepomap(dir);
    for (const section of [
      '## overview',
      '## tech',
      '## architecture',
      '## modules',
      '## dependencies',
      '## co-changes',
      '## hot-zones',
      '## recent',
      '## patterns',
    ]) {
      expect(out, `missing section: ${section}`).toContain(section);
    }
  });

  it('detects Next.js as the framework', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['generate'], dir);
    const out = await readRepomap(dir);
    expect(out).toMatch(/framework: Next\.js/);
  });

  it('stable sections are byte-identical between two consecutive runs', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['generate'], dir);
    const a = await readRepomap(dir);
    await runCli(['generate'], dir);
    const b = await readRepomap(dir);
    const stable = (s: string): string => s.slice(s.indexOf('## overview'), s.indexOf('## modules'));
    expect(stable(a)).toBe(stable(b));
  });

  it('--max-tokens truncates and exits 0', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    const r = await runCli(['generate', '--max-tokens', '50'], dir);
    expect(r.exitCode).toBe(0);
    const combined = `${r.stdout}\n${r.stderr}`;
    expect(combined).toMatch(/dropped|exceeded|truncat/i);
  });

  it('Python-only repo: tech section says Python', async () => {
    const dir = await setupFixture('python-app');
    cleanup.push(dir);
    const r = await runCli(['generate'], dir);
    expect(r.exitCode).toBe(0);
    const out = await readRepomap(dir);
    expect(out).toMatch(/language: Python/);
  });

  it('monorepo: lists workspace packages in architecture', async () => {
    const dir = await setupFixture('monorepo');
    cleanup.push(dir);
    await runCli(['generate'], dir);
    const out = await readRepomap(dir);
    expect(out).toMatch(/`packages\/`/);
  });

  it('detects added file on second run (incremental update)', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['generate'], dir);
    await fs.writeFile(path.join(dir, 'src', 'lib', 'extra.ts'), 'export const NEW = true;\n');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '-q', '-m', 'add extra'], { cwd: dir });
    await runCli(['generate'], dir);
    const out = await readRepomap(dir);
    expect(out).toContain('src/lib/extra.ts');
  });

  it('removes deleted file from modules section on next run', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['generate'], dir);
    await fs.unlink(path.join(dir, 'src', 'lib', 'greet.ts'));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '-q', '-m', 'rm greet'], { cwd: dir });
    await runCli(['generate'], dir);
    const out = await readRepomap(dir);
    // Hot-zones may still reference historical files (correct behavior).
    // Modules section reflects only files currently on disk.
    const modulesSection = out.slice(out.indexOf('## modules'), out.indexOf('## dependencies'));
    expect(modulesSection).not.toContain('src/lib/greet.ts');
  });
});
