import { z } from 'zod';
import { cosmiconfig } from 'cosmiconfig';
import { RepomapError } from './types.js';

/**
 * Config schema. Every field has a default so partial configs work.
 * Defaults documented inline — do not change without updating SPEC.md.
 */
export const ConfigSchema = z.object({
  // Globs of files to include. Sensible defaults cover most JS/TS/Python projects.
  include: z.array(z.string()).default(['src/**', 'app/**', 'lib/**', 'pages/**']),
  // Globs to exclude. node_modules/dist/build/test files always skipped.
  exclude: z
    .array(z.string())
    .default([
      '**/*.test.*',
      '**/*.spec.*',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/__pycache__/**',
    ]),
  // Token budget for the output. Volatile sections drop first when over.
  maxTokens: z.number().int().positive().default(8000),
  // Hard cap on files analyzed. Prevents runaway on monorepos.
  maxFiles: z.number().int().positive().default(500),
  // Files with fewer than this many commits in coChangeLookback are "stable".
  stableThreshold: z.number().int().positive().default(2),
  // Output filename, written at repo root.
  output: z.string().default('REPOMAP.md'),
  // Languages to parse. Empty = auto-detect from file extensions.
  languages: z.array(z.string()).default([]),
  // Days of git history used for co-change graph and hot-zones.
  coChangeLookback: z.number().int().positive().default(90),
  // If true, REPOMAP.md is committed (not gitignored).
  commitFlag: z.boolean().default(false),
});

export type RepomapConfig = z.infer<typeof ConfigSchema>;

/**
 * Load config from cosmiconfig (repomap.config.{ts,js,json}, package.json#repomap, .repomaprc).
 * Returns defaults merged with any user overrides.
 */
export async function loadConfig(searchFrom: string): Promise<RepomapConfig> {
  const explorer = cosmiconfig('repomap', {
    searchPlaces: [
      'package.json',
      '.repomaprc',
      '.repomaprc.json',
      'repomap.config.json',
      'repomap.config.js',
    ],
  });
  try {
    const result = await explorer.search(searchFrom);
    const raw = result?.config ?? {};
    return ConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new RepomapError(
        'INVALID_CONFIG',
        `Invalid config: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    throw err;
  }
}

/** Default config without I/O — used by tests and CLI flag overrides. */
export function defaultConfig(): RepomapConfig {
  return ConfigSchema.parse({});
}
