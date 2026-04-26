import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type { FileAnalysis } from '../types.js';
import type { RepomapConfig } from '../config.js';
import { detectLanguage, isBinary } from './languages.js';
import { extract } from './extractors.js';

export interface AnalyzeOptions {
  rootDir: string;
  config: RepomapConfig;
  /** When provided, only analyze files in this list (relative to rootDir). */
  changedFiles?: string[];
  onProgress?: (done: number, total: number, current: string) => void;
}

/**
 * Walk the repo, parse files, return per-file analyses.
 * Skips binaries, REPOMAP.md, and anything in exclude globs.
 */
export async function analyzeRepo(opts: AnalyzeOptions): Promise<FileAnalysis[]> {
  const { rootDir, config } = opts;
  const allFiles = await discoverFiles(rootDir, config);
  const target = opts.changedFiles
    ? allFiles.filter((f) => opts.changedFiles?.includes(f))
    : allFiles;
  const limited = target.slice(0, config.maxFiles);

  const out: FileAnalysis[] = [];
  let done = 0;
  for (const rel of limited) {
    done++;
    opts.onProgress?.(done, limited.length, rel);
    const abs = path.join(rootDir, rel);
    try {
      const buf = await fs.readFile(abs);
      if (isBinary(buf)) continue;
      const language = detectLanguage(rel);
      const source = buf.toString('utf8');
      const r = extract(source, language);
      out.push({
        path: normalizePath(rel),
        language,
        exports: r.exports,
        imports: r.imports,
        loc: r.loc,
        truncated: r.truncated,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** List repo files (relative paths) honoring include/exclude globs. */
export async function discoverFiles(rootDir: string, config: RepomapConfig): Promise<string[]> {
  const include = config.include.length > 0 ? config.include : ['**/*'];
  const exclude = [...config.exclude, 'REPOMAP.md', '.git/**'];
  const entries = await fg(include, {
    cwd: rootDir,
    ignore: exclude,
    dot: false,
    followSymbolicLinks: false,
    onlyFiles: true,
    suppressErrors: true,
  });
  if (entries.length === 0) {
    const fallback = await fg(['**/*'], {
      cwd: rootDir,
      ignore: exclude,
      dot: false,
      followSymbolicLinks: false,
      onlyFiles: true,
      suppressErrors: true,
    });
    return fallback.map(normalizePath).sort();
  }
  return entries.map(normalizePath).sort();
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
