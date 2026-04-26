import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import path from 'node:path';
import { execa } from 'execa';
import { setupFixture, rmDir, runCli } from './helpers.js';

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

describe('repomap status', () => {
  it('warns when no REPOMAP.md exists yet', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    const r = await runCli(['status'], dir);
    expect(r.exitCode).toBe(0);
    const combined = `${r.stdout}\n${r.stderr}`;
    expect(combined).toMatch(/no REPOMAP|init/i);
  });

  it('reports healthy state after init', async () => {
    const dir = await setupFixture('nextjs-app');
    cleanup.push(dir);
    await runCli(['init'], dir);
    const r = await runCli(['status'], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/installed/);
  });
});
