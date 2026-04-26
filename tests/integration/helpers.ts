import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.resolve(ROOT, 'dist', 'cli.js');

/** Copy a fixture into a fresh tmpdir, init git, return the dir. */
export async function setupFixture(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `repomap-${name}-`));
  const src = path.resolve(ROOT, 'tests', 'fixtures', name);
  await copyDir(src, dir);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return dir;
}

/** Make a tmpdir with a git repo but no commits. */
export async function setupEmptyGitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repomap-empty-'));
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  return dir;
}

/** Make a tmpdir that is NOT a git repo. */
export async function setupNonGitDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'repomap-nogit-'));
}

export async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === '.gitkeep') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

export async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

export async function runCli(args: string[], cwd: string): Promise<RunResult> {
  try {
    const r = await execa('node', [CLI, ...args], { cwd, reject: false });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; exitCode?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.exitCode };
  }
}

export async function readRepomap(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, 'REPOMAP.md'), 'utf8');
}
