import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FileAnalysis,
  RepomapData,
  TechInfo,
  HotZone,
  RecentCommit,
  CoChangePair,
  StabilityScore,
  RepoMeta,
} from './types.js';

export interface SynthesizeInput {
  rootDir: string;
  modules: FileAnalysis[];
  meta: RepoMeta;
  coChanges: CoChangePair[];
  stability: Map<string, StabilityScore>;
  hotZones: HotZone[];
  recent: RecentCommit[];
}

/** Build the full RepomapData object from analyzer + git outputs. */
export async function synthesize(input: SynthesizeInput): Promise<RepomapData> {
  const tech = await detectTech(input.rootDir);
  const overview = await buildOverview(input.rootDir, input.meta.name, tech, input.modules);
  const architecture = await buildArchitecture(input.rootDir);
  const patterns = detectPatterns(input.modules);
  const dependencies = buildDependencyGraph(input.modules);

  return {
    meta: input.meta,
    overview,
    tech,
    architecture,
    modules: input.modules,
    stability: input.stability,
    dependencies,
    coChanges: input.coChanges,
    patterns,
    hotZones: input.hotZones,
    recent: input.recent,
    generatedAt: new Date().toISOString(),
  };
}

async function detectTech(rootDir: string): Promise<TechInfo> {
  const tech: TechInfo = {};
  const pkgJson = await readJson(path.join(rootDir, 'package.json'));
  if (pkgJson) {
    tech.language = inferLanguage(pkgJson, rootDir);
    tech.framework = inferFramework(pkgJson);
    tech.testRunner = inferTestRunner(pkgJson);
    tech.packageManager = await inferPm(rootDir);
  }
  // Python markers
  if (!pkgJson) {
    if (await exists(path.join(rootDir, 'pyproject.toml')) || await exists(path.join(rootDir, 'requirements.txt'))) {
      tech.language = 'Python';
    }
    if (await exists(path.join(rootDir, 'go.mod'))) tech.language = 'Go';
    if (await exists(path.join(rootDir, 'Cargo.toml'))) tech.language = 'Rust';
  }
  // Node version
  for (const f of ['.nvmrc', '.node-version']) {
    const v = await readText(path.join(rootDir, f));
    if (v) {
      tech.nodeVersion = v.trim();
      break;
    }
  }
  if (!tech.nodeVersion && pkgJson?.engines?.node) tech.nodeVersion = pkgJson.engines.node;
  return tech;
}

function inferLanguage(pkg: PackageJson, _rootDir: string): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['typescript']) return 'TypeScript';
  return 'JavaScript';
}

function inferFramework(pkg: PackageJson): string | undefined {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['next']) return 'Next.js';
  if (deps['nuxt']) return 'Nuxt';
  if (deps['remix']) return 'Remix';
  if (deps['@remix-run/react']) return 'Remix';
  if (deps['astro']) return 'Astro';
  if (deps['svelte']) return 'Svelte';
  if (deps['vue']) return 'Vue';
  if (deps['react']) return 'React';
  if (deps['express']) return 'Express';
  if (deps['fastify']) return 'Fastify';
  if (deps['hono']) return 'Hono';
  return undefined;
}

function inferTestRunner(pkg: PackageJson): string | undefined {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['vitest']) return 'vitest';
  if (deps['jest']) return 'jest';
  if (deps['mocha']) return 'mocha';
  if (deps['playwright']) return 'playwright';
  return undefined;
}

async function inferPm(rootDir: string): Promise<string | undefined> {
  if (await exists(path.join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(rootDir, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(rootDir, 'bun.lockb')) || await exists(path.join(rootDir, 'bun.lock'))) return 'bun';
  if (await exists(path.join(rootDir, 'package-lock.json'))) return 'npm';
  return undefined;
}

async function buildOverview(
  rootDir: string,
  repoName: string,
  tech: TechInfo,
  modules: FileAnalysis[],
): Promise<string> {
  const pkg = await readJson<PackageJson>(path.join(rootDir, 'package.json'));
  const desc = pkg?.description?.trim();
  const readme = await readText(path.join(rootDir, 'README.md'));
  const readmeLine = firstParagraph(readme ?? '');

  const parts: string[] = [];
  if (desc) parts.push(desc);
  else if (readmeLine) parts.push(readmeLine);
  else parts.push(`${repoName} repository.`);

  const techBits: string[] = [];
  if (tech.language) techBits.push(tech.language);
  if (tech.framework) techBits.push(tech.framework);
  if (techBits.length) parts.push(`Built with ${techBits.join(' + ')}.`);
  if (modules.length) parts.push(`Contains ${modules.length} source files across the tracked directories.`);

  return parts.join(' ');
}

function firstParagraph(s: string): string | null {
  if (!s) return null;
  const lines = s.split(/\r?\n/);
  // skip headings, badges, blank lines
  const para: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (para.length) break;
      continue;
    }
    if (l.startsWith('#')) continue;
    if (l.startsWith('[![') || l.startsWith('![')) continue;
    if (l.startsWith('<') && l.endsWith('>')) continue;
    para.push(l);
    if (para.length >= 3) break;
  }
  if (!para.length) return null;
  const joined = para.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > 320 ? joined.slice(0, 317) + '…' : joined;
}

async function buildArchitecture(
  rootDir: string,
): Promise<Array<{ dir: string; purpose: string }>> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
    .map((e) => e.name)
    .sort();

  const guesses: Record<string, string> = {
    src: 'application source code',
    app: 'application routes/pages',
    pages: 'route components',
    lib: 'shared utilities and helpers',
    components: 'UI components',
    server: 'server-side code',
    api: 'API endpoints',
    public: 'static assets',
    tests: 'test suites',
    test: 'test suites',
    docs: 'documentation',
    scripts: 'build/dev scripts',
    cli: 'command-line entry points',
    packages: 'workspace packages',
    apps: 'workspace applications',
    config: 'configuration files',
    types: 'type declarations',
    hooks: 'reusable hooks/handlers',
    utils: 'utility functions',
    db: 'database layer',
    migrations: 'database migrations',
  };
  return dirs.slice(0, 12).map((d) => ({
    dir: d,
    purpose: guesses[d] ?? 'project module',
  }));
}

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.git',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  'out',
]);

function detectPatterns(modules: FileAnalysis[]): Array<{ name: string; value: string }> {
  if (modules.length === 0) return [];
  let camel = 0;
  let kebab = 0;
  let snake = 0;
  for (const m of modules) {
    const base = (m.path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    if (!base) continue;
    if (/[A-Z]/.test(base) && /[a-z]/.test(base) && !base.includes('-') && !base.includes('_')) camel++;
    else if (base.includes('-')) kebab++;
    else if (base.includes('_')) snake++;
  }
  const total = camel + kebab + snake;
  const out: Array<{ name: string; value: string }> = [];
  if (total > 0) {
    const winner = [
      ['camelCase/PascalCase', camel],
      ['kebab-case', kebab],
      ['snake_case', snake],
    ].sort((a, b) => (b[1] as number) - (a[1] as number))[0];
    if (winner) out.push({ name: 'file_naming', value: winner[0] as string });
  }
  // module style
  const tsCount = modules.filter((m) => m.language === 'ts' || m.language === 'tsx').length;
  const jsCount = modules.filter((m) => m.language === 'js' || m.language === 'jsx').length;
  if (tsCount + jsCount > 0) {
    out.push({
      name: 'module_style',
      value: tsCount >= jsCount ? 'ESM TypeScript' : 'ESM JavaScript',
    });
  }
  return out;
}

function buildDependencyGraph(modules: FileAnalysis[]): Array<{ from: string; to: string[] }> {
  const knownPaths = new Set(modules.map((m) => m.path));
  const out: Array<{ from: string; to: string[] }> = [];
  for (const m of modules) {
    const resolved: string[] = [];
    for (const imp of m.imports) {
      if (!imp.startsWith('.') && !imp.startsWith('/')) continue;
      const base = resolveRelative(m.path, imp);
      if (!base) continue;
      const hit = expandCandidates(base).find((c) => knownPaths.has(c));
      if (hit) resolved.push(hit);
    }
    const filtered = resolved.filter((p) => !isSameDirIndex(m.path, p));
    if (filtered.length) {
      out.push({ from: m.path, to: dedupe(filtered) });
    }
  }
  return out;
}

function resolveRelative(fromFile: string, importPath: string): string | null {
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const stripped = importPath.replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/, '');
  const candidate = path.posix.normalize(path.posix.join(dir, stripped));
  // Caller filters against the known-paths set, so just return the bare
  // candidate. It will match if the import points to a file by name; index/
  // extension resolution is handled by trying common suffixes upstream.
  return candidate || null;
}

/** Generate likely concrete paths for a relative import. */
function expandCandidates(c: string): string[] {
  const out: string[] = [c];
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
  for (const e of exts) {
    out.push(c + e);
    out.push(`${c}/index${e}`);
  }
  return out;
}

function isSameDirIndex(from: string, to: string): boolean {
  const fromDir = from.split('/').slice(0, -1).join('/');
  const toBase = to.split('/').pop() ?? '';
  return to.startsWith(fromDir + '/') && /^index\.(t|j)sx?$/.test(toBase);
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ---------- helpers ----------

interface PackageJson {
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  workspaces?: string[] | { packages: string[] };
}

async function readJson<T = PackageJson>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
