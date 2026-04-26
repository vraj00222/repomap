import type { RepomapData, FileAnalysis } from '../types.js';
import { estimateTokens } from './tokens.js';
import { SECTION_ORDER, DROP_ORDER } from './tiers.js';

export interface RenderOptions {
  maxTokens: number;
}

export interface RenderResult {
  content: string;
  tokens: number;
  truncated: boolean;
  droppedSections: string[];
}

/**
 * Render a RepomapData object to the final REPOMAP.md string.
 * Sections are emitted in stable→volatile order. If the result exceeds
 * maxTokens, volatile sections are dropped one at a time from the end.
 */
export function renderRepomap(data: RepomapData, opts: RenderOptions): RenderResult {
  const sections = new Map<string, string>();
  for (const spec of SECTION_ORDER) {
    sections.set(spec.id, renderSection(spec.id, data));
  }

  const dropped: string[] = [];
  let body = assemble(sections, data);
  let tokens = estimateTokens(body);

  for (const id of DROP_ORDER) {
    if (tokens <= opts.maxTokens) break;
    if (!sections.has(id)) continue;
    sections.delete(id);
    dropped.push(id);
    body = assemble(sections, data);
    tokens = estimateTokens(body);
  }

  return {
    content: body,
    tokens,
    truncated: dropped.length > 0,
    droppedSections: dropped,
  };
}

function assemble(sections: Map<string, string>, data: RepomapData): string {
  // Frontmatter goes last in computation but first in output: we need a token
  // estimate to put in the frontmatter, but the frontmatter itself adds tokens.
  // Approximate by computing body tokens, writing the frontmatter, then
  // re-stringifying — small over/undershoot is fine.
  const bodyParts: string[] = [];
  for (const spec of SECTION_ORDER) {
    const s = sections.get(spec.id);
    if (s === undefined) continue;
    bodyParts.push(s);
  }
  const body = bodyParts.join('\n\n');
  const provisionalTokens = estimateTokens(body) + 60; // ~frontmatter cost
  const frontmatter = renderFrontmatter(data, provisionalTokens);
  return `${frontmatter}\n\n${body}\n`;
}

function renderFrontmatter(data: RepomapData, tokens: number): string {
  const lines = [
    '---',
    'repomap: 1.0',
    `generated: ${data.generatedAt}`,
    `repo: ${escapeYaml(data.meta.name)}`,
    `files: ${data.modules.length}`,
    `tokens: ~${tokens}`,
    '---',
  ];
  return lines.join('\n');
}

function escapeYaml(s: string): string {
  if (/[:#&*!|>'"%@`]/.test(s) || s.includes('\n')) {
    return JSON.stringify(s);
  }
  return s;
}

function renderSection(id: string, data: RepomapData): string {
  switch (id) {
    case 'overview':
      return `## overview\n${data.overview.trim() || '_no overview available_'}`;
    case 'tech':
      return renderTech(data);
    case 'architecture':
      return renderArchitecture(data);
    case 'patterns':
      return renderPatterns(data);
    case 'modules':
      return renderModules(data);
    case 'dependencies':
      return renderDependencies(data);
    case 'co-changes':
      return renderCoChanges(data);
    case 'hot-zones':
      return renderHotZones(data);
    case 'recent':
      return renderRecent(data);
    default:
      return '';
  }
}

function renderTech(data: RepomapData): string {
  const out: string[] = ['## tech'];
  const t = data.tech;
  const rows: Array<[string, string | undefined]> = [
    ['language', t.language],
    ['framework', t.framework],
    ['package_manager', t.packageManager],
    ['test_runner', t.testRunner],
    ['node_version', t.nodeVersion],
  ];
  for (const [k, v] of rows) {
    if (v) out.push(`- ${k}: ${v}`);
  }
  if (out.length === 1) out.push('- _no tech metadata detected_');
  return out.join('\n');
}

function renderArchitecture(data: RepomapData): string {
  const out: string[] = ['## architecture'];
  if (data.architecture.length === 0) {
    out.push('- _flat layout — no top-level subdirectories detected_');
    return out.join('\n');
  }
  for (const a of data.architecture) {
    out.push(`- \`${a.dir}/\` — ${a.purpose}`);
  }
  return out.join('\n');
}

function renderPatterns(data: RepomapData): string {
  const out: string[] = ['## patterns'];
  if (data.patterns.length === 0) {
    out.push('- _no conventions detected_');
    return out.join('\n');
  }
  for (const p of data.patterns) {
    out.push(`- ${p.name}: ${p.value}`);
  }
  return out.join('\n');
}

function renderModules(data: RepomapData): string {
  const out: string[] = ['## modules', '', '| path | exports | purpose | stability |', '|---|---|---|---|'];
  if (data.modules.length === 0) {
    return '## modules\n_no source files analyzed_';
  }
  for (const m of data.modules) {
    const exportsStr = summarizeExports(m);
    const purpose = bestPurpose(m);
    const stab = data.stability.get(m.path)?.score ?? '-';
    out.push(`| \`${m.path}\` | ${exportsStr} | ${escapeCell(purpose)} | ${stab} |`);
  }
  return out.join('\n');
}

function summarizeExports(m: FileAnalysis): string {
  if (m.exports.length === 0) return '_none_';
  const names = m.exports.slice(0, 6).map((e) => `\`${e.name}\``).join(', ');
  const more = m.exports.length > 6 ? ` +${m.exports.length - 6}` : '';
  return names + more;
}

function bestPurpose(m: FileAnalysis): string {
  const docExport = m.exports.find((e) => e.doc);
  if (docExport?.doc) return clamp(docExport.doc, 60);
  // fall back to filename-derived hint
  const base = m.path.split('/').pop() ?? m.path;
  return clamp(base.replace(/\.[^.]+$/, ''), 60);
}

function renderDependencies(data: RepomapData): string {
  const out: string[] = ['## dependencies'];
  if (data.dependencies.length === 0) {
    out.push('_no internal imports detected_');
    return out.join('\n');
  }
  for (const d of data.dependencies) {
    if (d.to.length === 0) continue;
    const targets = d.to.slice(0, 6).map((t) => `\`${t}\``).join(', ');
    const more = d.to.length > 6 ? ` (+${d.to.length - 6})` : '';
    out.push(`- \`${d.from}\` → ${targets}${more}`);
  }
  if (out.length === 1) out.push('_no internal imports detected_');
  return out.join('\n');
}

function renderCoChanges(data: RepomapData): string {
  const out: string[] = ['## co-changes'];
  if (data.coChanges.length === 0) {
    out.push('_not enough git history to compute co-change pairs_');
    return out.join('\n');
  }
  for (const p of data.coChanges) {
    out.push(`- \`${p.a}\` ↔ \`${p.b}\` (${p.count} commits together)`);
  }
  return out.join('\n');
}

function renderHotZones(data: RepomapData): string {
  const out: string[] = ['## hot-zones'];
  if (data.hotZones.length === 0) {
    out.push('_no recently changed files_');
    return out.join('\n');
  }
  for (const h of data.hotZones) {
    out.push(`- \`${h.path}\` (${h.commits} commits)`);
  }
  return out.join('\n');
}

function renderRecent(data: RepomapData): string {
  const out: string[] = ['## recent'];
  if (data.recent.length === 0) {
    out.push('_no commits found_');
    return out.join('\n');
  }
  out.push('', '| hash | author | message | files |', '|---|---|---|---|');
  for (const c of data.recent) {
    out.push(`| \`${c.hash}\` | ${escapeCell(c.author)} | ${escapeCell(c.message)} | ${c.filesChanged} |`);
  }
  return out.join('\n');
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function clamp(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
