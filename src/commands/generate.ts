import fs from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import Table from 'cli-table3';
import chalk from 'chalk';
import { loadConfig } from '../config.js';
import { analyzeRepo } from '../analyzer/index.js';
import { buildGitGraph, findGitRoot } from '../analyzer/graph.js';
import { synthesize } from '../synthesize.js';
import { renderRepomap } from '../writer/index.js';
import { RepomapError } from '../types.js';
import { success, warn, info } from '../ui.js';

export interface GenerateOptions {
  cwd?: string;
  maxTokens?: number;
  silent?: boolean;
  output?: string;
}

export interface GenerateResult {
  outputPath: string;
  tokens: number;
  files: number;
  truncated: boolean;
  droppedSections: string[];
  durationMs: number;
}

/** `repomap generate` — full or incremental regeneration. */
export async function runGenerate(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const cwd = opts.cwd ?? process.cwd();
  const root = (await findGitRoot(cwd)) ?? cwd;
  const config = await loadConfig(root);
  if (opts.maxTokens) config.maxTokens = opts.maxTokens;
  if (opts.output) config.output = opts.output;

  const start = Date.now();
  const spinner = opts.silent
    ? null
    : ora({ text: 'Scanning repository…', prefixText: chalk.dim('repomap') }).start();

  let modules;
  try {
    modules = await analyzeRepo({
      rootDir: root,
      config,
      onProgress: (done, total) => {
        if (spinner) spinner.text = `Analyzing ${done}/${total} files…`;
      },
    });
  } catch (err) {
    if (spinner) spinner.fail('Analysis failed');
    throw err;
  }

  if (spinner) spinner.text = 'Reading git history…';
  const graph = await buildGitGraph({ rootDir: root, lookbackDays: config.coChangeLookback });

  if (spinner) spinner.text = 'Rendering REPOMAP.md…';
  const data = await synthesize({
    rootDir: root,
    modules,
    meta: graph.meta,
    coChanges: graph.coChanges,
    stability: graph.stability,
    hotZones: graph.hotZones,
    recent: graph.recent,
  });

  const result = renderRepomap(data, { maxTokens: config.maxTokens });
  const outputPath = path.resolve(root, config.output);
  await fs.writeFile(outputPath, result.content, 'utf8');

  const duration = Date.now() - start;
  if (spinner) spinner.succeed(`REPOMAP.md written (${result.tokens} tokens, ${modules.length} files)`);

  if (!opts.silent) {
    if (result.truncated) {
      warn(
        `Output exceeded ${config.maxTokens} tokens — dropped: ${result.droppedSections.join(', ')}`,
      );
    }
    const table = new Table({
      head: [chalk.bold('metric'), chalk.bold('value')],
      style: { head: [], border: ['gray'] },
    });
    table.push(
      ['files scanned', String(modules.length)],
      ['tokens', `~${result.tokens}`],
      ['repo', data.meta.name],
      ['output', path.relative(cwd, outputPath) || config.output],
      ['duration', `${duration}ms`],
    );
    console.log(table.toString());
    success(`Done in ${(duration / 1000).toFixed(2)}s`);
  } else {
    info(`Generated ${outputPath} (${result.tokens} tokens)`);
  }

  if (modules.length === 0) {
    warn('No source files matched include globs — REPOMAP.md will be sparse.');
  }

  if (!data.meta.hasGit) {
    throw new RepomapError('NO_GIT', 'Not a git repository.');
  }

  return {
    outputPath,
    tokens: result.tokens,
    files: modules.length,
    truncated: result.truncated,
    droppedSections: result.droppedSections,
    durationMs: duration,
  };
}
