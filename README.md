<div align="center">

# repomap

### A stable context layer for your codebase. One file. Maximum LLM cache hits.

[![npm version](https://img.shields.io/npm/v/repomap-llm.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/repomap-llm)
[![npm downloads](https://img.shields.io/npm/dm/repomap-llm.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/repomap-llm)
[![CI](https://img.shields.io/github/actions/workflow/status/vraj00222/repomap/ci.yml?branch=main&style=flat-square)](https://github.com/vraj00222/repomap/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/repomap-llm.svg?style=flat-square&color=blue)](./LICENSE)
[![node](https://img.shields.io/node/v/repomap-llm.svg?style=flat-square&color=339933)](https://nodejs.org)

```bash
npx repomap-llm init
```

</div>

---

That single command generates a `REPOMAP.md` at your repo root, installs a `post-commit` hook that keeps it fresh, and gives every LLM you use a permanent, cache-friendly context prefix for your codebase.

<br />

## Why this exists

Every time you ask Claude / Cursor / Copilot for help, the model **re-reads your repo from scratch**. Context tokens get billed. Latency adds up. The same files get scanned hundreds of times per week.

`repomap-llm` writes one structured markdown file that describes your project — overview, tech, architecture, modules, dependencies, co-changes, recent activity — and orders sections from **most stable → most volatile**.

Drop it at the start of every system prompt. The inference engine's KV cache fires after the first call. Every subsequent request reuses the prefix.

> **Result**: ~90% cost reduction and ~80% latency reduction on repeated calls in the same repo.

<br />

## How it works

```
┌─────────────────────────────────────────────────┐
│  REPOMAP.md  (stable → volatile, top to bottom) │
├─────────────────────────────────────────────────┤
│  ## overview        ◄── cached forever          │
│  ## tech            ◄── cached across commits   │
│  ## architecture    ◄── cached across commits   │
│  ## patterns        ◄── cached across commits   │
│  ## modules         ◄── changes occasionally    │
│  ## dependencies    ◄── changes occasionally    │
│  ## co-changes      ◄── changes per commit      │
│  ## hot-zones       ◄── changes per commit      │
│  ## recent          ◄── changes per commit      │
└─────────────────────────────────────────────────┘
        │
        └─► When you commit, only the suffix changes.
            The KV cache stays warm across requests.
```

A `post-commit` git hook regenerates the file in the background after each commit. Zero manual upkeep.

<br />

## Commands

| command | what it does |
|---|---|
| `npx repomap-llm init` | First-time setup. Generates the file + installs the post-commit hook. |
| `npx repomap-llm` | Regenerate `REPOMAP.md` (default command). |
| `npx repomap-llm watch` | Auto-regenerate on file changes (debounced 800ms). |
| `npx repomap-llm status` | Show health: file age, token count, hook status. |

<br />

## What the output looks like

```yaml
---
repomap: 1.0
generated: 2026-04-26T08:13:59Z
repo: vraj00222/repomap
files: 17
tokens: ~1131
---

## overview
A stable context layer for your codebase. Built with TypeScript.
Contains 17 source files across the tracked directories.

## tech
- language: TypeScript
- framework: Next.js
- package_manager: npm
- test_runner: vitest
- node_version: >=18

## architecture
- `src/` — application source code
- `tests/` — test suites

## patterns
- file_naming: kebab-case
- module_style: ESM TypeScript

## modules
| path | exports | purpose | stability |
|---|---|---|---|
| `src/cli.ts` | `main` | CLI entry point | 5 |
| `src/analyzer/index.ts` | `analyzeRepo` | Walk the repo and parse files | 3 |
...

## dependencies
- `src/cli.ts` → `src/commands/init.ts`, `src/commands/generate.ts`
- `src/commands/init.ts` → `src/hooks/install.ts`

## co-changes
- `src/auth/login.ts` ↔ `src/auth/session.ts` (12 commits together)

## hot-zones
- `src/api/handler.ts` (8 commits)

## recent
| hash | author | message | files |
|---|---|---|---|
| abc1234 | jane | fix login redirect | 3 |
```

<br />

## Works with

<table>
<tr>
<td align="center" width="20%"><strong>Claude Code</strong><br /><sub>Reference via <code>@REPOMAP.md</code></sub></td>
<td align="center" width="20%"><strong>Cursor</strong><br /><sub>Drop into <code>.cursorrules</code></sub></td>
<td align="center" width="20%"><strong>Cline / Continue</strong><br /><sub>Include in system prompt</sub></td>
<td align="center" width="20%"><strong>Copilot Chat</strong><br /><sub><code>#file:REPOMAP.md</code></sub></td>
<td align="center" width="20%"><strong>Anything else</strong><br /><sub>It's just markdown</sub></td>
</tr>
</table>

<br />

## Configuration

Drop a `repomap.config.json` at your repo root, or add a `repomap` field to your `package.json`. Every option has a sensible default — only set what you want to override.

```json
{
  "include": ["src/**", "app/**", "lib/**"],
  "exclude": ["**/*.test.*", "**/node_modules/**"],
  "maxTokens": 8000,
  "maxFiles": 500,
  "stableThreshold": 2,
  "output": "REPOMAP.md",
  "languages": [],
  "coChangeLookback": 90,
  "commitFlag": false
}
```

<details>
<summary><strong>All options</strong></summary>

| option | default | description |
|---|---|---|
| `include` | `["src/**","app/**","lib/**","pages/**"]` | Globs of files to analyze |
| `exclude` | sensible defaults | Globs to skip (always skips `node_modules`, `dist`, `build`, `.next`, `__pycache__`) |
| `maxTokens` | `8000` | Token budget — volatile sections are dropped first when exceeded |
| `maxFiles` | `500` | Hard cap on files analyzed (prevents runaway on monorepos) |
| `stableThreshold` | `2` | Files with fewer commits in the lookback window count as "stable" |
| `output` | `REPOMAP.md` | Output filename |
| `languages` | auto | Subset of `["ts","js","py","go","rs"]`; empty = auto-detect |
| `coChangeLookback` | `90` | Days of git history used for the co-change graph and hot-zones |
| `commitFlag` | `false` | If `true`, `REPOMAP.md` is committed (not gitignored) |

</details>

<br />

## Install

```bash
# recommended
npx repomap-llm init

# global
npm install -g repomap-llm

# project-local
npm install --save-dev repomap-llm
```

Requires **Node ≥ 18**. Works on macOS, Linux, and Windows.

<br />

## FAQ

<details>
<summary><strong>Does it commit the file?</strong></summary>
By default, no — `REPOMAP.md` is added to `.gitignore`. Pass <code>--commit</code> to <code>init</code> if you want it tracked.
</details>

<details>
<summary><strong>What languages does it parse?</strong></summary>
TypeScript, JavaScript (incl. JSX/TSX), Python, Go, Rust. Other files are listed without export extraction.
</details>

<details>
<summary><strong>Does it work in monorepos?</strong></summary>
Yes. It detects pnpm/yarn/npm workspaces and lists packages in the architecture section.
</details>

<details>
<summary><strong>What happens on a brand-new repo with no commits?</strong></summary>
Co-changes and stability scores are skipped gracefully. Everything else still works.
</details>

<details>
<summary><strong>Is the regenerate slow?</strong></summary>
Typical run on a 500-file repo: under 1 second. Watch mode is debounced 800ms.
</details>

<br />

## Contributing

PRs welcome. The codebase is small and well-tested.

```bash
git clone https://github.com/vraj00222/repomap
cd repomap
npm install
npm test
```

<br />

## License

MIT © [vraj](https://github.com/vraj00222)

<div align="center">
<sub>Built for the era of LLM-augmented development.</sub>
</div>
