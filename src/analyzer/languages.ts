import path from 'node:path';
import type { Language } from '../types.js';

const EXT_MAP: Record<string, Language> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'py',
  '.pyi': 'py',
  '.go': 'go',
  '.rs': 'rs',
};

/** Detect language from file extension. Returns 'unknown' for unhandled types. */
export function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MAP[ext] ?? 'unknown';
}

/** True if a buffer looks binary (null byte in first 512 bytes). */
export function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 512);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
