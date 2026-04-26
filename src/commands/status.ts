import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import { findGitRoot } from '../analyzer/graph.js';
import { loadConfig } from '../config.js';
import { isHookInstalled } from '../hooks/install.js';
import { estimateTokens } from '../writer/tokens.js';
import { RepomapError } from '../types.js';
import { warn } from '../ui.js';

const STALE_HOURS = 24;

/** `repomap status` — show health of REPOMAP.md and hook. */
export async function runStatus(cwd?: string): Promise<void> {
  const dir = cwd ?? process.cwd();
  const root = await findGitRoot(dir);
  if (!root) throw new RepomapError('NO_GIT_ROOT', 'Not inside a git repository.');

  const config = await loadConfig(root);
  const outputPath = path.resolve(root, config.output);

  let exists = false;
  let tokens = 0;
  let mtime = 0;
  let fileCount = 0;
  try {
    const stat = await fs.stat(outputPath);
    exists = true;
    mtime = stat.mtimeMs;
    const content = await fs.readFile(outputPath, 'utf8');
    tokens = estimateTokens(content);
    const m = content.match(/^files:\s*(\d+)/m);
    fileCount = m?.[1] ? parseInt(m[1], 10) : 0;
  } catch {
    /* no file */
  }

  const hookOn = await isHookInstalled(root);
  const ageHours = exists ? (Date.now() - mtime) / 3_600_000 : Infinity;
  const stale = ageHours > STALE_HOURS;

  const table = new Table({
    head: [chalk.bold('check'), chalk.bold('status')],
    style: { head: [], border: ['gray'] },
  });
  table.push(
    ['REPOMAP.md exists', exists ? chalk.green('yes') : chalk.red('no')],
    ['file count', exists ? String(fileCount) : '—'],
    ['tokens', exists ? `~${tokens}` : '—'],
    ['last generated', exists ? `${ageHours.toFixed(1)}h ago` : '—'],
    ['stale (>24h)', exists ? (stale ? chalk.yellow('yes') : chalk.green('no')) : '—'],
    ['post-commit hook', hookOn ? chalk.green('installed') : chalk.yellow('missing')],
  );
  console.log(table.toString());

  if (!exists) {
    warn('No REPOMAP.md found. Run `npx repomap-llm init` to create one.');
  } else if (stale) {
    warn('REPOMAP.md is stale. Run `npx repomap-llm` to refresh.');
  } else if (!hookOn) {
    warn('Post-commit hook missing. Run `npx repomap-llm init` to install it.');
  }
}
