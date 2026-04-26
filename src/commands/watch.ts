import chokidar from 'chokidar';
import path from 'node:path';
import chalk from 'chalk';
import { findGitRoot } from '../analyzer/graph.js';
import { loadConfig } from '../config.js';
import { runGenerate } from './generate.js';
import { RepomapError } from '../types.js';
import { info, success, warn, error as logError } from '../ui.js';

export interface WatchOptions {
  cwd?: string;
  debounceMs?: number;
}

/** `repomap watch` — debounced regeneration on file changes. */
export async function runWatch(opts: WatchOptions = {}): Promise<() => Promise<void>> {
  const cwd = opts.cwd ?? process.cwd();
  const root = await findGitRoot(cwd);
  if (!root) {
    throw new RepomapError('NO_GIT_ROOT', 'Not inside a git repository.');
  }
  const config = await loadConfig(root);
  const debounceMs = opts.debounceMs ?? 800;

  const patterns = config.include.map((p) => path.join(root, p));
  const ignored = [
    /node_modules/,
    /\.git\//,
    /dist\//,
    /build\//,
    new RegExp(`${config.output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  ];

  const watcher = chokidar.watch(patterns, {
    ignored,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  let timer: NodeJS.Timeout | null = null;
  let pending = false;
  let running = false;

  const trigger = (changedFile: string): void => {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) return;
      running = true;
      info(`${chalk.cyan('↻')} ${path.relative(root, changedFile)} changed — regenerating…`);
      try {
        const r = await runGenerate({ cwd: root, silent: true });
        success(`Regenerated (${r.tokens} tokens, ${r.files} files, ${r.durationMs}ms)`);
      } catch (err) {
        logError(`Regeneration failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        running = false;
        if (pending) {
          pending = false;
        }
      }
    }, debounceMs);
  };

  watcher.on('change', trigger);
  watcher.on('add', trigger);
  watcher.on('unlink', trigger);
  watcher.on('error', (err) => warn(`watcher: ${err}`));

  info(`Watching ${patterns.length} pattern(s). Press Ctrl-C to stop.`);

  // SIGINT handler returns the close function for clean shutdown.
  const close = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
  process.once('SIGINT', () => {
    void close().then(() => {
      info('watcher stopped');
      process.exit(0);
    });
  });

  return close;
}
