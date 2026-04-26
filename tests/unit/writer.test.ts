import { describe, it, expect } from 'vitest';
import { renderRepomap } from '../../src/writer/index.js';
import type { RepomapData } from '../../src/types.js';

function mkData(over: Partial<RepomapData> = {}): RepomapData {
  return {
    meta: { name: 'demo', rootDir: '/tmp/demo', hasGit: true, commitCount: 1 },
    overview: 'A demo repository.',
    tech: { language: 'TypeScript', framework: 'Next.js' },
    architecture: [{ dir: 'src', purpose: 'application source code' }],
    modules: [
      { path: 'src/a.ts', language: 'ts', exports: [{ name: 'foo', kind: 'function' }], imports: [], loc: 10, truncated: false },
    ],
    stability: new Map(),
    dependencies: [],
    coChanges: [],
    patterns: [{ name: 'file_naming', value: 'kebab-case' }],
    hotZones: [],
    recent: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('renderRepomap', () => {
  it('output contains all required sections in correct order', () => {
    const r = renderRepomap(mkData(), { maxTokens: 99999 });
    const order = ['## overview', '## tech', '## architecture', '## patterns', '## modules', '## dependencies', '## co-changes', '## hot-zones', '## recent'];
    let last = -1;
    for (const s of order) {
      const idx = r.content.indexOf(s);
      expect(idx, `missing: ${s}`).toBeGreaterThan(-1);
      expect(idx, `out of order: ${s}`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('stable sections appear before volatile sections', () => {
    const r = renderRepomap(mkData(), { maxTokens: 99999 });
    expect(r.content.indexOf('## overview')).toBeLessThan(r.content.indexOf('## recent'));
  });

  it('YAML frontmatter present and parseable shape', () => {
    const r = renderRepomap(mkData(), { maxTokens: 99999 });
    expect(r.content.startsWith('---\nrepomap: 1.0')).toBe(true);
    expect(r.content).toMatch(/files: 1/);
    expect(r.content).toMatch(/tokens: ~\d+/);
  });

  it('truncates volatile sections when over budget', () => {
    const big = mkData({
      modules: Array.from({ length: 200 }, (_, i) => ({
        path: `src/file${i}.ts`,
        language: 'ts' as const,
        exports: [{ name: `fn${i}`, kind: 'function' as const }],
        imports: [],
        loc: 50,
        truncated: false,
      })),
      hotZones: Array.from({ length: 15 }, (_, i) => ({ path: `src/file${i}.ts`, commits: i })),
      recent: Array.from({ length: 5 }, (_, i) => ({
        hash: `abc${i}`.padEnd(7, '0'),
        author: 'a',
        message: 'm',
        filesChanged: 1,
      })),
    });
    const r = renderRepomap(big, { maxTokens: 200 });
    expect(r.truncated).toBe(true);
    expect(r.droppedSections.length).toBeGreaterThan(0);
    expect(r.droppedSections[0]).toBe('recent');
  });

  it('handles zero-file repo without crashing', () => {
    const r = renderRepomap(mkData({ modules: [] }), { maxTokens: 9999 });
    expect(r.content).toContain('## overview');
    expect(r.content).toContain('_no source files analyzed_');
  });

  it('escapes special chars in markdown table cells', () => {
    const r = renderRepomap(
      mkData({
        recent: [{ hash: 'abcdef0', author: 'al|ice', message: 'fix | thing', filesChanged: 1 }],
      }),
      { maxTokens: 9999 },
    );
    expect(r.content).toContain('al\\|ice');
    expect(r.content).toContain('fix \\| thing');
  });

  it('two consecutive renders with identical data produce identical stable prefix', () => {
    const data = mkData();
    const a = renderRepomap(data, { maxTokens: 9999 });
    const b = renderRepomap(data, { maxTokens: 9999 });
    // Compare everything before the volatile sections
    const cut = (s: string): string => s.slice(0, s.indexOf('## modules'));
    expect(cut(a.content)).toBe(cut(b.content));
  });
});
