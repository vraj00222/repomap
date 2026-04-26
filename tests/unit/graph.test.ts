import { describe, it, expect } from 'vitest';
import {
  parseLog,
  computeCoChanges,
  computeStability,
  computeHotZones,
} from '../../src/analyzer/graph.js';

const SEP = '<<<COMMIT>>>';

function mkLog(entries: Array<{ hash: string; files: string[]; date?: number }>): string {
  return entries
    .map((e) => `${SEP}${e.hash}|alice|msg|${Math.floor((e.date ?? Date.now()) / 1000)}\n${e.files.join('\n')}`)
    .join('\n');
}

describe('parseLog', () => {
  it('parses commits and file lists', () => {
    const raw = mkLog([
      { hash: 'a1', files: ['src/x.ts', 'src/y.ts'] },
      { hash: 'b2', files: ['src/x.ts'] },
    ]);
    const out = parseLog(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.hash).toBe('a1');
    expect(out[0]?.files).toEqual(['src/x.ts', 'src/y.ts']);
  });

  it('returns empty for empty input', () => {
    expect(parseLog('')).toEqual([]);
  });
});

describe('computeCoChanges', () => {
  it('builds co-change pairs and dedupes', () => {
    const commits = parseLog(
      mkLog([
        { hash: 'a', files: ['x.ts', 'y.ts'] },
        { hash: 'b', files: ['x.ts', 'y.ts'] },
        { hash: 'c', files: ['x.ts', 'y.ts'] },
      ]),
    );
    const out = computeCoChanges(commits);
    expect(out).toHaveLength(1);
    expect(out[0]?.count).toBe(3);
    // alphabetized
    expect(out[0]?.a).toBe('x.ts');
    expect(out[0]?.b).toBe('y.ts');
  });

  it('returns empty array when nothing co-changes', () => {
    const commits = parseLog(mkLog([{ hash: 'a', files: ['only.ts'] }]));
    expect(computeCoChanges(commits)).toEqual([]);
  });

  it('skips node_modules paths', () => {
    const commits = parseLog(
      mkLog([
        { hash: 'a', files: ['src/x.ts', 'node_modules/foo/bar.js'] },
        { hash: 'b', files: ['src/x.ts', 'node_modules/foo/bar.js'] },
      ]),
    );
    const out = computeCoChanges(commits);
    expect(out).toEqual([]);
  });

  it('returns empty array on empty git log', () => {
    expect(computeCoChanges([])).toEqual([]);
  });
});

describe('computeStability', () => {
  it('file with high commits gets high score', () => {
    const counts = new Map([
      ['hot.ts', 50],
      ['cold.ts', 1],
    ]);
    const out = computeStability(counts);
    expect(out.get('hot.ts')?.score).toBeGreaterThan(out.get('cold.ts')?.score ?? 0);
  });

  it('file with 100+ commits scores 5', () => {
    const counts = new Map([['mega.ts', 200]]);
    expect(computeStability(counts).get('mega.ts')?.score).toBe(5);
  });

  it('returns empty map for empty input', () => {
    expect(computeStability(new Map()).size).toBe(0);
  });
});

describe('computeHotZones', () => {
  it('only includes commits within window', () => {
    const now = Date.now();
    const old = now - 30 * 86400_000;
    const commits = parseLog(
      mkLog([
        { hash: 'a', files: ['recent.ts'], date: now - 1000 },
        { hash: 'b', files: ['old.ts'], date: old },
      ]),
    );
    const hot = computeHotZones(commits, 14);
    const paths = hot.map((h) => h.path);
    expect(paths).toContain('recent.ts');
    expect(paths).not.toContain('old.ts');
  });

  it('sorts by commit count desc', () => {
    const commits = parseLog(
      mkLog([
        { hash: 'a', files: ['hot.ts'] },
        { hash: 'b', files: ['hot.ts'] },
        { hash: 'c', files: ['cool.ts'] },
      ]),
    );
    const hot = computeHotZones(commits, 30);
    expect(hot[0]?.path).toBe('hot.ts');
  });
});
