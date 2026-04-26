import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import { findGitRoot } from '../analyzer/graph.js';
import { installPostCommitHook } from '../hooks/install.js';
import { runGenerate } from './generate.js';
import { RepomapError } from '../types.js';
import { success, warn } from '../ui.js';

export interface InitOptions {
  cwd?: string;
  installHook?: boolean;
  commit?: boolean;
}

/** `repomap init` — first run + hook install + gitignore wiring. */
export async function runInit(opts: InitOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const root = await findGitRoot(cwd);
  if (!root) {
    throw new RepomapError(
      'NO_GIT_ROOT',
      'Not inside a git repository. Run `git init` first, then `repomap init`.',
    );
  }

  const result = await runGenerate({ cwd: root, silent: true });

  let hookInstalled = false;
  let hookAlreadyPresent = false;
  if (opts.installHook !== false) {
    const r = await installPostCommitHook(root);
    hookInstalled = r.installed;
    hookAlreadyPresent = r.alreadyPresent;
  }

  // .gitignore handling
  const ignorePath = path.join(root, '.gitignore');
  if (!opts.commit) {
    await ensureGitignoreEntry(ignorePath, 'REPOMAP.md');
  }

  const table = new Table({
    head: [chalk.bold('step'), chalk.bold('result')],
    style: { head: [], border: ['gray'] },
  });
  table.push(
    ['REPOMAP.md', `${result.tokens} tokens · ${result.files} files`],
    ['hook installed', hookInstalled ? 'yes' : hookAlreadyPresent ? 'already present' : 'skipped'],
    ['gitignore', opts.commit ? 'committed' : 'REPOMAP.md ignored'],
    ['duration', `${result.durationMs}ms`],
  );
  console.log(table.toString());
  success('repomap is ready. REPOMAP.md will refresh on every commit.');
  if (opts.commit) {
    warn('REPOMAP.md will be committed — git diffs will get noisy on every change.');
  }
}

async function ensureGitignoreEntry(filePath: string, entry: string): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    /* no .gitignore yet */
  }
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry)) return;
  const next = (content ? content.replace(/\s*$/, '\n') : '') + `${entry}\n`;
  await fs.writeFile(filePath, next, 'utf8');
}
