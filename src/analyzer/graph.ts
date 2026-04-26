import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  CoChangePair,
  HotZone,
  RecentCommit,
  RepoMeta,
  StabilityScore,
} from '../types.js';

interface GitGraph {
  meta: RepoMeta;
  coChanges: CoChangePair[];
  stability: Map<string, StabilityScore>;
  hotZones: HotZone[];
  recent: RecentCommit[];
}

export interface GraphOptions {
  rootDir: string;
  lookbackDays: number;
  hotZoneDays?: number;
}

const SEPARATOR = '<<<COMMIT>>>';

/** Build co-change pairs, stability scores, recent commits and hot zones. */
export async function buildGitGraph(opts: GraphOptions): Promise<GitGraph> {
  const { rootDir, lookbackDays } = opts;
  const hotDays = opts.hotZoneDays ?? 14;
  const git = simpleGit({ baseDir: rootDir });
  const meta = await collectMeta(git, rootDir);

  if (!meta.hasGit || meta.commitCount === 0) {
    return {
      meta,
      coChanges: [],
      stability: new Map(),
      hotZones: [],
      recent: [],
    };
  }

  const log = await readLog(git, lookbackDays);
  const coChanges = computeCoChanges(log.commits);
  const stability = computeStability(log.fileCommitCounts);
  const hotZones = computeHotZones(log.commits, hotDays);
  const recent = log.recent;

  return { meta, coChanges, stability, hotZones, recent };
}

async function collectMeta(git: SimpleGit, rootDir: string): Promise<RepoMeta> {
  const dirName = path.basename(rootDir);
  let hasGit = false;
  let commitCount = 0;
  let remote: string | undefined;
  try {
    await git.revparse(['--git-dir']);
    hasGit = true;
  } catch {
    return { name: dirName, rootDir, hasGit: false, commitCount: 0 };
  }
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    remote = origin?.refs.fetch || origin?.refs.push;
  } catch {
    /* no remotes */
  }
  try {
    const c = await git.raw(['rev-list', '--count', 'HEAD']);
    commitCount = parseInt(c.trim(), 10) || 0;
  } catch {
    commitCount = 0;
  }
  return {
    name: deriveRepoName(remote, dirName),
    rootDir,
    hasGit,
    commitCount,
    ...(remote ? { remote } : {}),
  };
}

function deriveRepoName(remote: string | undefined, fallback: string): string {
  if (!remote) return fallback;
  const m = remote.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m?.[1] ?? fallback;
}

interface LogEntry {
  hash: string;
  author: string;
  message: string;
  date: number;
  files: string[];
}

async function readLog(
  git: SimpleGit,
  lookbackDays: number,
): Promise<{
  commits: LogEntry[];
  fileCommitCounts: Map<string, number>;
  recent: RecentCommit[];
}> {
  const since = `${lookbackDays}.days.ago`;
  let raw: string;
  try {
    raw = await git.raw([
      'log',
      `--since=${since}`,
      '--name-only',
      '--no-merges',
      `--format=${SEPARATOR}%H|%an|%s|%ct`,
      '-n',
      '1000',
    ]);
  } catch {
    return { commits: [], fileCommitCounts: new Map(), recent: [] };
  }

  const commits = parseLog(raw);
  const fileCommitCounts = new Map<string, number>();
  for (const c of commits) {
    for (const f of c.files) {
      if (shouldIgnoreFile(f)) continue;
      fileCommitCounts.set(f, (fileCommitCounts.get(f) ?? 0) + 1);
    }
  }

  // recent commits: top 5 by date desc — query separately so it's independent of lookback
  let recent: RecentCommit[] = [];
  try {
    const rawRecent = await git.raw([
      'log',
      '-n',
      '5',
      '--no-merges',
      `--format=${SEPARATOR}%H|%an|%s|%ct`,
      '--name-only',
    ]);
    recent = parseLog(rawRecent).map((c) => ({
      hash: c.hash.slice(0, 7),
      author: c.author,
      message: clamp(c.message, 60),
      filesChanged: c.files.length,
    }));
  } catch {
    /* leave empty */
  }

  return { commits, fileCommitCounts, recent };
}

export function parseLog(raw: string): LogEntry[] {
  if (!raw.trim()) return [];
  const chunks = raw.split(SEPARATOR).filter((c) => c.trim());
  const out: LogEntry[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const header = lines[0] ?? '';
    const [hash, author, message, ts] = header.split('|');
    if (!hash) continue;
    const files = lines.slice(1).map((l) => l.trim()).filter(Boolean);
    out.push({
      hash,
      author: author ?? '',
      message: message ?? '',
      date: parseInt(ts ?? '0', 10) * 1000,
      files,
    });
  }
  return out;
}

function shouldIgnoreFile(f: string): boolean {
  return (
    f.startsWith('node_modules/') ||
    f.includes('/node_modules/') ||
    f === 'REPOMAP.md' ||
    f.startsWith('dist/') ||
    f.startsWith('build/') ||
    f.startsWith('.git/')
  );
}

export function computeCoChanges(commits: LogEntry[]): CoChangePair[] {
  const pairs = new Map<string, number>();
  for (const c of commits) {
    const files = c.files.filter((f) => !shouldIgnoreFile(f));
    if (files.length < 2 || files.length > 20) continue; // skip noisy "huge" commits
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i] ?? '';
        const b = files[j] ?? '';
        if (!a || !b || a === b) continue;
        const [x, y] = a < b ? [a, b] : [b, a];
        const key = `${x}|||${y}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const out: CoChangePair[] = [];
  for (const [key, count] of pairs) {
    if (count < 2) continue;
    const [a, b] = key.split('|||');
    if (!a || !b) continue;
    out.push({ a, b, count });
  }
  out.sort((p, q) => q.count - p.count || p.a.localeCompare(q.a));
  return out.slice(0, 10);
}

export function computeStability(
  fileCommitCounts: Map<string, number>,
): Map<string, StabilityScore> {
  const out = new Map<string, StabilityScore>();
  if (fileCommitCounts.size === 0) return out;
  const counts = [...fileCommitCounts.values()].sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 1;
  for (const [path, commits] of fileCommitCounts) {
    out.set(path, { path, commits, score: bucket(commits, median) });
  }
  return out;
}

function bucket(commits: number, median: number): 1 | 2 | 3 | 4 | 5 {
  if (commits === 0) return 1;
  if (commits >= 100) return 5;
  const ratio = commits / Math.max(median, 1);
  if (ratio < 0.4) return 1;
  if (ratio < 0.8) return 2;
  if (ratio < 1.5) return 3;
  if (ratio < 3) return 4;
  return 5;
}

export function computeHotZones(commits: LogEntry[], days: number): HotZone[] {
  const cutoff = Date.now() - days * 86400_000;
  const counts = new Map<string, number>();
  for (const c of commits) {
    if (c.date < cutoff) continue;
    for (const f of c.files) {
      if (shouldIgnoreFile(f)) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  const out = [...counts.entries()]
    .map(([path, commits]) => ({ path, commits }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path));
  return out.slice(0, 15);
}

function clamp(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/** Used by status command to detect a brand-new repo gracefully. */
export async function repoHasCommits(rootDir: string): Promise<boolean> {
  try {
    const git = simpleGit({ baseDir: rootDir });
    const c = await git.raw(['rev-list', '--count', 'HEAD']);
    return parseInt(c.trim(), 10) > 0;
  } catch {
    return false;
  }
}

/** Walk up from cwd to find the nearest git repo root. */
export async function findGitRoot(start: string): Promise<string | null> {
  let dir = path.resolve(start);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const stat = await fs.stat(path.join(dir, '.git'));
      if (stat.isDirectory() || stat.isFile()) return dir;
    } catch {
      /* not here */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Files changed (working tree + staged) since last commit, relative paths. */
export async function changedFilesSinceHead(rootDir: string): Promise<string[]> {
  try {
    const git = simpleGit({ baseDir: rootDir });
    const status = await git.status();
    const all = new Set<string>();
    for (const f of status.files) all.add(f.path.replace(/\\/g, '/'));
    return [...all];
  } catch {
    return [];
  }
}
