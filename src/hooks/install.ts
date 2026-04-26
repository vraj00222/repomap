import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER = '# repomap-llm: auto-regenerate REPOMAP.md';
const HOOK_BODY = [
  '',
  MARKER,
  'if command -v npx >/dev/null 2>&1; then',
  '  npx --no-install repomap-llm generate >/dev/null 2>&1 || true',
  'fi',
  '',
].join('\n');

export interface InstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  hookPath: string;
}

/**
 * Install (or detect) the post-commit hook. Idempotent: appends only when our
 * marker is missing. Never overwrites an existing user hook.
 */
export async function installPostCommitHook(rootDir: string): Promise<InstallResult> {
  const hooksDir = path.join(rootDir, '.git', 'hooks');
  await fs.mkdir(hooksDir, { recursive: true }).catch(() => undefined);
  const hookPath = path.join(hooksDir, 'post-commit');

  let existing = '';
  try {
    existing = await fs.readFile(hookPath, 'utf8');
  } catch {
    /* no existing hook */
  }

  if (existing.includes(MARKER)) {
    return { installed: false, alreadyPresent: true, hookPath };
  }

  let next: string;
  if (existing.trim()) {
    next = existing.replace(/\s*$/, '\n') + HOOK_BODY;
  } else {
    next = `#!/bin/sh\n${HOOK_BODY}`;
  }
  await fs.writeFile(hookPath, next, 'utf8');
  await fs.chmod(hookPath, 0o755);
  return { installed: true, alreadyPresent: false, hookPath };
}

/** True if our marker is in the post-commit hook. */
export async function isHookInstalled(rootDir: string): Promise<boolean> {
  const hookPath = path.join(rootDir, '.git', 'hooks', 'post-commit');
  try {
    const content = await fs.readFile(hookPath, 'utf8');
    return content.includes(MARKER);
  } catch {
    return false;
  }
}
