#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runGenerate } from './commands/generate.js';
import { runWatch } from './commands/watch.js';
import { runStatus } from './commands/status.js';
import { RepomapError } from './types.js';
import { error as logError } from './ui.js';

const program = new Command();

program
  .name('repomap')
  .description('Generate a stable REPOMAP.md context file for any codebase.')
  .version('0.1.0')
  .helpOption('-h, --help', 'Show help')
  .addHelpText(
    'after',
    `
Examples:
  $ npx repomap-llm init             First-time setup: generate + install commit hook
  $ npx repomap-llm                  Regenerate REPOMAP.md
  $ npx repomap-llm watch            Auto-regenerate on file changes
  $ npx repomap-llm status           Show health of REPOMAP.md and hook
`,
  );

program
  .command('init')
  .description('Scaffold REPOMAP.md and install post-commit hook')
  .option('--no-hook', 'Skip post-commit hook installation')
  .option('--commit', 'Commit REPOMAP.md instead of gitignoring it')
  .action(async (opts: { hook: boolean; commit: boolean }) => {
    await runInit({ installHook: opts.hook, commit: opts.commit });
  });

program
  .command('generate', { isDefault: true })
  .description('Generate REPOMAP.md (default command)')
  .option('--max-tokens <n>', 'Override token budget', (v) => parseInt(v, 10))
  .option('-o, --output <path>', 'Override output filename')
  .action(async (opts: { maxTokens?: number; output?: string }) => {
    await runGenerate({ ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}), ...(opts.output ? { output: opts.output } : {}) });
  });

program
  .command('watch')
  .description('Watch the repo and regenerate REPOMAP.md on changes')
  .option('--debounce <ms>', 'Debounce window', (v) => parseInt(v, 10), 800)
  .action(async (opts: { debounce: number }) => {
    await runWatch({ debounceMs: opts.debounce });
    // Block forever
    await new Promise(() => undefined);
  });

program
  .command('status')
  .description('Show REPOMAP.md and hook health')
  .action(async () => {
    await runStatus();
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof RepomapError) {
      logError(err.message);
      if (process.env['DEBUG']?.includes('repomap')) console.error(err.stack);
      process.exit(1);
    }
    logError(err instanceof Error ? err.message : String(err));
    if (process.env['DEBUG']?.includes('repomap')) console.error(err);
    process.exit(1);
  }
}

void main();
