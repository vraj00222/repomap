# repomap — one-shot build prompt for Claude Code

## GOAL
Build and publish a production-quality npm CLI package called `repomap`.
It reads a codebase and writes a structured `REPOMAP.md` file that gives
any LLM instant, full context about the repo — with zero repetition,
zero re-reading, and maximum KV cache hit rate.

## WHAT IT DOES IN PLAIN TERMS
Every time a dev asks an LLM to help with their code, the model
re-reads the whole repo from scratch. repomap writes a single file
that acts as the permanent, stable context prefix. Put it at the
top of every system prompt, and the inference engine's KV cache
fires on every subsequent request — 90 % cost cut, 80 % latency cut.
The file is committed to the repo, auto-refreshed on every git commit,
and structured so the most stable content is always at the top
(maximizing prefix stability = maximizing cache hits).

## TECH STACK
- Language: TypeScript (ESM, strict mode, no `any`)
- Runtime: Node.js ≥ 18
- Parser: tree-sitter + tree-sitter-typescript, tree-sitter-javascript,
          tree-sitter-python (lazy-load per language detected)
- Git: simple-git
- CLI UX: chalk v5, ora v8, cli-table3
- Config: cosmiconfig (reads repomap.config.ts / .json / package.json#repomap)
- File watching: chokidar v4
- Tests: vitest (unit) + execa (CLI integration tests)
- Bundler: tsup (produces dist/cli.js with shebang)
- Linting: eslint + @typescript-eslint, prettier
- CI: GitHub Actions (test + publish on tag push)

## FILE STRUCTURE
```
repomap/
├── src/
│   ├── cli.ts           # entry point, commander setup
│   ├── commands/
│   │   ├── init.ts      # `repomap init` — scaffold + install hook
│   │   ├── generate.ts  # `repomap` / `repomap generate` — core
│   │   ├── watch.ts     # `repomap watch` — chokidar loop
│   │   └── status.ts    # `repomap status` — health check
│   ├── analyzer/
│   │   ├── index.ts     # orchestrates per-file analysis
│   │   ├── languages.ts # language detection by extension
│   │   ├── treesitter.ts # tree-sitter parse helpers
│   │   └── graph.ts     # co-change graph from git log
│   ├── writer/
│   │   ├── index.ts     # renders RepomapFile → REPOMAP.md
│   │   ├── tiers.ts     # splits output into stable/volatile tiers
│   │   └── tokens.ts    # rough token count estimator (cl100k)
│   ├── hooks/
│   │   └── install.ts   # writes .git/hooks/post-commit
│   ├── config.ts        # config schema (zod)
│   └── types.ts         # shared types
├── tests/
│   ├── unit/
│   │   ├── analyzer.test.ts
│   │   ├── graph.test.ts
│   │   ├── writer.test.ts
│   │   └── tokens.test.ts
│   ├── integration/
│   │   ├── cli-init.test.ts
│   │   ├── cli-generate.test.ts
│   │   ├── cli-watch.test.ts
│   │   └── incremental.test.ts
│   └── fixtures/
│       ├── nextjs-app/    # realistic Next.js fixture
│       ├── monorepo/      # pnpm workspace fixture
│       ├── empty-repo/    # edge case
│       └── large-repo/    # 500+ file stress fixture (generated)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .github/workflows/ci.yml
```

## REPOMAP.md OUTPUT FORMAT
The file MUST follow this exact section order (most stable → least stable,
so the KV cache prefix is maximally consistent across runs):

```
---
repomap: 1.0
generated: <ISO timestamp>
repo: <git remote origin or dirname>
files: <count>
tokens: ~<estimated token count>
---

## overview
<2–4 sentence description inferred from package.json, README first paragraph,
and directory names. Never copy-paste — always synthesize.>

## tech
<key: value pairs — language, framework, package manager, test runner,
node version if found in .nvmrc / .node-version>

## architecture
<one entry per top-level directory, format: `dirname/` — what lives here (≤12 words)>

## modules
<per-module table: path | exports | purpose (≤8 words) | stability score>
Stability score = 1 (changes rarely) → 5 (changes every commit)

## dependencies
<import graph: which files import which, rendered as adjacency list.
Only non-trivial edges — skip node_modules, skip same-dir index re-exports>

## co-changes
<top 10 file pairs that changed together in the last 90 days git log.
Format: fileA ↔ fileB (N commits together)>
This is the "if you touch X, remember to touch Y" section.

## patterns
<detected conventions: naming (camelCase/kebab/etc), error handling style,
state management pattern, auth pattern if any>

## hot-zones
<files changed in the last 14 days, with commit count>

## recent
<last 5 commits: hash (7) | author | message (≤60 chars) | files changed>
---
```

## CLI COMMANDS AND UX

### `npx repomap init`
- Detects git root (walk up from cwd, error if none found)
- Shows animated spinner: "Scanning repository…"
- Runs full generate on first run
- Installs .git/hooks/post-commit (appends, never overwrites existing hooks)
- Adds REPOMAP.md to .gitignore by default UNLESS --commit flag passed
- Prints success summary table: files scanned | tokens | hook installed
- Exits 0

### `npx repomap` (or `npx repomap generate`)
- Spinner: "Analyzing [n] files…" with live file count
- Diff-aware: reads git status, only re-analyzes changed files
- Reads existing REPOMAP.md, merges stable sections, rewrites volatile ones
- Prints diff summary: sections updated | token delta (+/-) | time taken
- Exits 0

### `npx repomap watch`
- Watches src/** with chokidar, debounces 800ms
- On change: prints "↻ [filename] changed — regenerating…" then spinner
- Never blocks terminal (streams status lines, not full output)

### `npx repomap status`
- Shows: last generated time | token count | file count | hook status
- Warns if REPOMAP.md is stale (>24h since last commit touched tracked files)
- Prints suggested action if stale

### `npx repomap --help`
- Clean, compact usage block. No walls of text.
- Example commands shown inline.

## CONFIG SCHEMA (repomap.config.ts or package.json#repomap)
```ts
{
  include: string[]          // glob patterns, default ["src/**", "app/**", "lib/**"]
  exclude: string[]          // default ["**/*.test.*","**/node_modules/**","dist/**"]
  maxTokens: number          // default 8000 — trim output if over limit
  maxFiles: number           // default 500
  stableThreshold: number    // commits/90d below this = stable, default 2
  output: string             // default "REPOMAP.md"
  languages: string[]        // ["ts","js","py","go","rs"] — auto-detect if omitted
  coChangeLookback: number   // days of git log for co-change graph, default 90
  commitFlag: boolean        // include REPOMAP.md in commits, default false
}
```

## ANALYZER REQUIREMENTS
- tree-sitter must be lazy-loaded per language (no startup cost for unused parsers)
- Extract from each file: default export, named exports, top-level imports,
  JSDoc/docstring of exported functions (first line only, ≤80 chars)
- Stability score: computed from `git log --follow -n 999 --format="%H" -- <file>`
  count divided into 5 buckets relative to repo median
- Co-change graph: `git log --name-only --format="%H" -n 1000 --since=90.days.ago`
  parsed to build co-occurrence matrix, emit top 10 pairs only
- Token estimator: character_count / 4 (cl100k approximation), accurate ±15%
- Tiered output: stable sections (overview, tech, architecture, patterns) written
  first so they form the invariant cache prefix. Volatile sections (hot-zones,
  recent, co-changes) written last so only the suffix invalidates on each commit.

## UNIT TEST CASES (vitest)

### analyzer.test.ts
- ✓ extracts named exports from a TypeScript file correctly
- ✓ extracts default export class name
- ✓ handles files with no exports (returns empty array, no throw)
- ✓ handles syntax errors gracefully (logs warning, skips file)
- ✓ detects language from extension: .ts .tsx .js .jsx .py .go .rs
- ✓ returns unknown for .mdx, .graphql (no crash)
- ✓ lazy-loads only the parser for the detected language
- ✓ JSDoc extraction: returns first line only, strips `*` and `@param` lines
- ✓ skips binary files (detected by null byte in first 512 bytes)
- ✓ handles symlinks without infinite loops

### graph.test.ts
- ✓ builds co-change pairs from mock git log output correctly
- ✓ deduplicates pairs (A↔B same as B↔A)
- ✓ returns empty array when git log has no entries (new repo)
- ✓ respects lookback window — commits outside 90 days are excluded
- ✓ handles repos with only 1 commit (no pairs possible)
- ✓ does not include node_modules paths in co-change pairs
- ✓ stability score: file with 0 changes scores 1, file with 100+ scores 5

### writer.test.ts
- ✓ output contains all required sections in correct order
- ✓ stable sections appear before volatile sections
- ✓ token count in frontmatter matches tokens.estimate() result
- ✓ truncates to maxTokens when output exceeds limit (drops volatile sections first)
- ✓ YAML frontmatter is valid and parseable
- ✓ module table rows are tab-separated, no broken alignment
- ✓ handles zero-file repo (writes overview only, no crash)
- ✓ handles repo with 1 file
- ✓ escapes markdown special chars in file paths (backtick wrapping)

### tokens.test.ts
- ✓ empty string → 0 tokens
- ✓ 400-char ASCII string → approximately 100 tokens (±15%)
- ✓ Chinese/Japanese text → higher ratio (logged as warning if ratio >6)
- ✓ returns integer, never float

## INTEGRATION TEST CASES (execa + tmp dirs)

### cli-init.test.ts
- ✓ `repomap init` in a fresh git repo exits 0
- ✓ REPOMAP.md is created after init
- ✓ .git/hooks/post-commit exists and is executable after init
- ✓ Running init twice does not duplicate the hook line
- ✓ Init outside a git repo exits 1 with clear error message
- ✓ Init in a repo with no commits still works (empty git log edge case)
- ✓ --no-hook flag skips hook installation

### cli-generate.test.ts
- ✓ `repomap generate` on nextjs-app fixture produces valid REPOMAP.md
- ✓ All 8 sections present in output
- ✓ Token count in frontmatter within 20% of actual wc -w estimate
- ✓ Stable sections (overview, tech) identical between two consecutive runs
  with no file changes (proves cache prefix stability)
- ✓ Modifying one file and re-running only updates volatile sections
- ✓ --max-tokens 2000 flag truncates output, exits 0, prints warning
- ✓ Large repo (500 files) completes in under 10 seconds
- ✓ Monorepo fixture: detects workspace packages, lists them in architecture section
- ✓ Python-only repo: uses tree-sitter-python, not tree-sitter-typescript

### cli-watch.test.ts
- ✓ `repomap watch` starts without error
- ✓ Modifying a watched file triggers regeneration within 2 seconds
- ✓ SIGINT exits cleanly (no orphaned chokidar watchers)

### incremental.test.ts
- ✓ First run: full analysis (all files touched)
- ✓ Second run: only changed files re-analyzed (verified via spy on analyzer)
- ✓ Deleted file: removed from REPOMAP.md in next run
- ✓ Renamed file: old entry gone, new entry present
- ✓ Config change: forces full re-analysis

## EDGE CASES TO HANDLE EXPLICITLY
- Repo with no src/ or app/ dir (fall back to scanning all non-excluded files)
- File with 10,000+ lines (parse first 500 lines only, add "(truncated)" note)
- Circular imports (detect cycle, log warning, include both files anyway)
- Binary files (.png, .pdf, .woff) — skip silently
- Monorepo (pnpm/yarn workspaces) — detect and list packages in architecture
- Git repo with no remote origin — use dirname as repo name
- Windows paths (backslash) — normalize to forward slash in output
- Files with no extension — attempt heuristic detection (shebang line)
- REPOMAP.md itself — always excluded from analysis
- Empty git log (brand new repo with 1 commit) — skip co-changes section gracefully
- Missing tree-sitter native bindings — fall back to regex-based export extraction
  with a printed warning (never hard crash)

## TERMINAL UX — NON-NEGOTIABLES
- All spinners via ora with a clear prefix: "repomap" in dim color
- Success lines: chalk.green("✓") prefix
- Warning lines: chalk.yellow("⚠") prefix
- Error lines: chalk.red("✗") prefix, then exit(1)
- Progress for large repos: show "Analyzing file 47/312…" live
- Final summary: cli-table3 table, no raw console.log dumps
- Respect NO_COLOR env var and --no-color flag (chalk handles this automatically)
- Never print stack traces to end users — only in DEBUG=repomap mode
- Total run time printed at end: "Done in 1.2s"
- No emoji beyond ✓ ⚠ ✗ ↻ — keep it professional

## CODE QUALITY NON-NEGOTIABLES
- Zero `any` in TypeScript. Use `unknown` + type guards.
- All async functions have explicit return types.
- Errors are typed (custom RepomapError class with code: string field).
- No process.exit() outside cli.ts top level — throw RepomapError instead.
- Every public function has a JSDoc comment.
- Named exports only — no default exports except in cli.ts entry.
- Functions >40 lines get split.
- No global mutable state — pass config/context explicitly.
- All file I/O through a thin fs abstraction so tests can inject a mock fs.

## PACKAGE.JSON REQUIREMENTS
```json
{
  "name": "repomap",
  "version": "0.1.0",
  "type": "module",
  "bin": { "repomap": "./dist/cli.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=18" },
  "keywords": ["llm", "context", "codebase", "kv-cache", "claude", "cursor"],
  "scripts": {
    "build": "tsup src/cli.ts --format esm --dts --clean",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src tests",
    "prepublishOnly": "npm run lint && npm run test && npm run build"
  }
}
```

## README REQUIREMENTS
- Hero: one sentence, one command (`npx repomap init`), one GIF (create with
  vhs or terminalizer showing the spinner and final table output)
- "How it works" section: explain the KV cache prefix stability idea in ≤5 lines
- Config reference: auto-generated from zod schema via zod-to-json-schema
- "Works with": Claude Code, Cursor, Cline, Continue, GitHub Copilot
- Badge row: npm version | license | test status

## SHIP ORDER
1. Scaffold package, tsconfig, vitest config
2. Types and config schema (zod)
3. Analyzer core (tree-sitter + fallback)
4. Git graph module (co-changes + stability)
5. Writer (REPOMAP.md renderer with tier ordering)
6. CLI commands (init, generate, watch, status)
7. Hook installer
8. Unit tests (all passing)
9. Fixture repos + integration tests (all passing)
10. README + GIF
11. `npm publish --dry-run` to verify bundle
12. Confirm `npx repomap init` works end-to-end in a fresh clone

Start at step 1. Do not move to the next step until the current
step's tests pass. Ask no clarifying questions — make sensible
defaults and document them in config.ts with inline comments.
