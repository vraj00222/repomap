import type { FileExport, Language } from '../types.js';

const MAX_DOC_LEN = 80;
const MAX_LINES = 500;

interface ExtractResult {
  exports: FileExport[];
  imports: string[];
  loc: number;
  truncated: boolean;
}

/** Public entry: pick the right extractor for the language. */
export function extract(source: string, language: Language): ExtractResult {
  const allLines = source.split(/\r?\n/);
  const truncated = allLines.length > MAX_LINES;
  const lines = truncated ? allLines.slice(0, MAX_LINES) : allLines;
  const limited = lines.join('\n');
  const loc = allLines.length;

  switch (language) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return { ...extractJsLike(limited, lines), loc, truncated };
    case 'py':
      return { ...extractPython(limited, lines), loc, truncated };
    case 'go':
      return { ...extractGo(limited, lines), loc, truncated };
    case 'rs':
      return { ...extractRust(limited, lines), loc, truncated };
    default:
      return { exports: [], imports: [], loc, truncated };
  }
}

// ---------- JS/TS ----------

function extractJsLike(
  source: string,
  lines: string[],
): { exports: FileExport[]; imports: string[] } {
  const exports: FileExport[] = [];
  const imports = new Set<string>();

  // imports
  const importRe = /^\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynImportRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [importRe, requireRe, dynImportRe]) {
    for (const m of source.matchAll(re)) {
      if (m[1]) imports.add(m[1]);
    }
  }

  // export default class/function/identifier
  const defaultRe = /^\s*export\s+default\s+(?:async\s+)?(class|function|const|let|var)?\s*([A-Za-z_$][\w$]*)?/gm;
  for (const m of source.matchAll(defaultRe)) {
    const name = m[2] ?? 'default';
    const kind = m[1] === 'class' ? 'class' : m[1] === 'function' ? 'function' : 'default';
    exports.push({ name, kind, doc: docAbove(lines, source, m.index ?? 0) });
  }

  // named exports: export (async) function|class|const|let|var|type|interface NAME
  const namedRe =
    /^\s*export\s+(?:async\s+)?(function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(namedRe)) {
    const kind = mapKind(m[1] ?? '');
    if (m[2]) exports.push({ name: m[2], kind, doc: docAbove(lines, source, m.index ?? 0) });
  }

  // export { a, b as c }
  const groupRe = /^\s*export\s*\{([^}]+)\}/gm;
  for (const m of source.matchAll(groupRe)) {
    if (!m[1]) continue;
    for (const part of m[1].split(',')) {
      const cleaned = part.trim().split(/\s+as\s+/)[1] ?? part.trim().split(/\s+as\s+/)[0];
      if (cleaned && /^[A-Za-z_$][\w$]*$/.test(cleaned)) {
        exports.push({ name: cleaned, kind: 'other' });
      }
    }
  }

  return { exports: dedupeExports(exports), imports: [...imports] };
}

function mapKind(raw: string): FileExport['kind'] {
  switch (raw) {
    case 'function':
      return 'function';
    case 'class':
      return 'class';
    case 'const':
    case 'let':
    case 'var':
      return 'const';
    case 'type':
      return 'type';
    case 'interface':
      return 'interface';
    case 'enum':
      return 'other';
    default:
      return 'other';
  }
}

// ---------- Python ----------

function extractPython(
  source: string,
  lines: string[],
): { exports: FileExport[]; imports: string[] } {
  const exports: FileExport[] = [];
  const imports = new Set<string>();

  for (const m of source.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) {
    if (m[1]) imports.add(m[1]);
  }
  for (const m of source.matchAll(/^\s*import\s+([.\w]+)/gm)) {
    if (m[1]) imports.add(m[1]);
  }

  // top-level def / class (no leading whitespace)
  for (const m of source.matchAll(/^(def|class)\s+([A-Za-z_]\w*)/gm)) {
    if (!m[2] || m[2].startsWith('_')) continue;
    const kind = m[1] === 'class' ? 'class' : 'function';
    exports.push({ name: m[2], kind, doc: pyDocstring(lines, m.index ?? 0, source) });
  }

  return { exports: dedupeExports(exports), imports: [...imports] };
}

// ---------- Go ----------

function extractGo(
  source: string,
  _lines: string[],
): { exports: FileExport[]; imports: string[] } {
  const exports: FileExport[] = [];
  const imports = new Set<string>();

  for (const m of source.matchAll(/import\s+"([^"]+)"/g)) {
    if (m[1]) imports.add(m[1]);
  }
  for (const m of source.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
    const block = m[1] ?? '';
    for (const im of block.matchAll(/"([^"]+)"/g)) {
      if (im[1]) imports.add(im[1]);
    }
  }
  // exported = capitalized func/type
  for (const m of source.matchAll(/^func(?:\s*\([^)]*\))?\s+([A-Z]\w*)/gm)) {
    if (m[1]) exports.push({ name: m[1], kind: 'function' });
  }
  for (const m of source.matchAll(/^type\s+([A-Z]\w*)\s+(struct|interface|\w+)/gm)) {
    if (m[1])
      exports.push({ name: m[1], kind: m[2] === 'interface' ? 'interface' : 'type' });
  }
  return { exports: dedupeExports(exports), imports: [...imports] };
}

// ---------- Rust ----------

function extractRust(
  source: string,
  _lines: string[],
): { exports: FileExport[]; imports: string[] } {
  const exports: FileExport[] = [];
  const imports = new Set<string>();

  for (const m of source.matchAll(/^\s*use\s+([\w:]+)/gm)) {
    if (m[1]) imports.add(m[1].split('::')[0] ?? m[1]);
  }
  for (const m of source.matchAll(/^\s*pub\s+(fn|struct|enum|trait|type|const)\s+([A-Za-z_]\w*)/gm)) {
    if (!m[2]) continue;
    const kindRaw = m[1] ?? '';
    const kind: FileExport['kind'] =
      kindRaw === 'fn'
        ? 'function'
        : kindRaw === 'struct' || kindRaw === 'enum'
          ? 'class'
          : kindRaw === 'trait'
            ? 'interface'
            : kindRaw === 'type'
              ? 'type'
              : 'const';
    exports.push({ name: m[2], kind });
  }
  return { exports: dedupeExports(exports), imports: [...imports] };
}

// ---------- helpers ----------

function dedupeExports(arr: FileExport[]): FileExport[] {
  const seen = new Set<string>();
  const out: FileExport[] = [];
  for (const e of arr) {
    const key = `${e.kind}:${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function docAbove(lines: string[], source: string, index: number): string | undefined {
  const lineNum = source.slice(0, index).split('\n').length - 1;
  // Walk upward from lineNum-1 collecting JSDoc-style block.
  let i = lineNum - 1;
  if (i < 0) return undefined;
  // single-line // comment immediately above
  const single = lines[i]?.match(/^\s*\/\/\s?(.*)$/);
  if (single?.[1]) return clamp(single[1]);
  // JSDoc /** ... */ block
  if (!lines[i]?.match(/\*\//)) return undefined;
  while (i >= 0 && !lines[i]?.match(/^\s*\/\*\*/)) i--;
  if (i < 0) return undefined;
  // Find first meaningful line inside the block
  for (let j = i; j < lineNum; j++) {
    const raw = lines[j] ?? '';
    const stripped = raw
      .replace(/^\s*\/\*\*\s?/, '')
      .replace(/^\s*\*\/?\s?/, '')
      .replace(/\*\/\s*$/, '')
      .trim();
    if (!stripped) continue;
    if (stripped.startsWith('@')) continue; // skip @param/@returns/etc
    return clamp(stripped);
  }
  return undefined;
}

function pyDocstring(lines: string[], index: number, source: string): string | undefined {
  const lineNum = source.slice(0, index).split('\n').length - 1;
  const next = lines[lineNum + 1] ?? '';
  const m = next.match(/^\s*("""|''')\s*(.*)$/);
  if (!m) return undefined;
  const tail = (m[2] ?? '').replace(/("""|''').*$/, '').trim();
  if (tail) return clamp(tail);
  // multi-line: first non-empty after triple quote, strip any closing quote
  for (let j = lineNum + 2; j < Math.min(lineNum + 20, lines.length); j++) {
    const t = (lines[j] ?? '').trim();
    if (t) return clamp(t.replace(/("""|''').*$/, '').trim());
  }
  return undefined;
}

function clamp(s: string): string {
  if (s.length <= MAX_DOC_LEN) return s;
  return s.slice(0, MAX_DOC_LEN - 1) + '…';
}
