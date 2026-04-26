/**
 * Shared types for repomap. Kept dependency-free so tests can import freely.
 */

export type Language = 'ts' | 'tsx' | 'js' | 'jsx' | 'py' | 'go' | 'rs' | 'unknown';

export interface FileExport {
  name: string;
  kind: 'function' | 'class' | 'const' | 'type' | 'interface' | 'default' | 'other';
  doc?: string;
}

export interface FileAnalysis {
  path: string;
  language: Language;
  exports: FileExport[];
  imports: string[];
  loc: number;
  truncated: boolean;
}

export interface CoChangePair {
  a: string;
  b: string;
  count: number;
}

export interface StabilityScore {
  path: string;
  commits: number;
  score: 1 | 2 | 3 | 4 | 5;
}

export interface RecentCommit {
  hash: string;
  author: string;
  message: string;
  filesChanged: number;
}

export interface HotZone {
  path: string;
  commits: number;
}

export interface RepoMeta {
  name: string;
  remote?: string;
  rootDir: string;
  hasGit: boolean;
  commitCount: number;
}

export interface TechInfo {
  language?: string;
  framework?: string;
  packageManager?: string;
  testRunner?: string;
  nodeVersion?: string;
}

export interface RepomapData {
  meta: RepoMeta;
  overview: string;
  tech: TechInfo;
  architecture: Array<{ dir: string; purpose: string }>;
  modules: FileAnalysis[];
  stability: Map<string, StabilityScore>;
  dependencies: Array<{ from: string; to: string[] }>;
  coChanges: CoChangePair[];
  patterns: Array<{ name: string; value: string }>;
  hotZones: HotZone[];
  recent: RecentCommit[];
  generatedAt: string;
}

export class RepomapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RepomapError';
  }
}
