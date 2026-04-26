import { describe, it, expect } from 'vitest';
import { extract } from '../../src/analyzer/extractors.js';
import { detectLanguage, isBinary } from '../../src/analyzer/languages.js';

describe('extractors (TypeScript)', () => {
  it('extracts named exports from a TypeScript file correctly', () => {
    const src = `
export function foo() { return 1; }
export const bar = 2;
export class Baz {}
export type Q = string;
export interface I { x: number }
`;
    const r = extract(src, 'ts');
    const names = r.exports.map((e) => e.name).sort();
    expect(names).toEqual(['Baz', 'I', 'Q', 'bar', 'foo']);
  });

  it('extracts default export class name', () => {
    const r = extract('export default class Hello {}', 'ts');
    expect(r.exports.find((e) => e.kind === 'class')?.name).toBe('Hello');
  });

  it('handles files with no exports', () => {
    const r = extract('const x = 1;\nconsole.log(x);', 'ts');
    expect(r.exports).toEqual([]);
  });

  it('handles syntax errors gracefully (regex extractor never throws)', () => {
    expect(() => extract('export function {{{{ broken', 'ts')).not.toThrow();
  });

  it('captures imports', () => {
    const src = `import x from "./foo";\nimport { y } from "../bar";\nconst z = require('z');`;
    const r = extract(src, 'ts');
    expect(r.imports.sort()).toEqual(['../bar', './foo', 'z']);
  });

  it('JSDoc extraction returns first line, strips * and @param', () => {
    const src = `
/**
 * Does an important thing.
 * @param x the input
 */
export function doThing(x: number) { return x; }
`;
    const r = extract(src, 'ts');
    expect(r.exports[0]?.doc).toBe('Does an important thing.');
  });

  it('truncates files over 500 lines and reports loc', () => {
    const src = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const r = extract(src, 'ts');
    expect(r.truncated).toBe(true);
    expect(r.loc).toBe(600);
  });
});

describe('extractors (Python)', () => {
  it('extracts top-level def and class', () => {
    const src = `
def hello():
    pass

class World:
    pass

def _private():
    pass
`;
    const r = extract(src, 'py');
    const names = r.exports.map((e) => e.name).sort();
    expect(names).toEqual(['World', 'hello']);
  });

  it('captures docstrings as doc', () => {
    const src = `
def greet():
    """Say hello to the world."""
    return "hi"
`;
    const r = extract(src, 'py');
    expect(r.exports[0]?.doc).toBe('Say hello to the world.');
  });

  it('captures imports', () => {
    const src = `from os import path\nimport sys\n`;
    const r = extract(src, 'py');
    expect(r.imports.sort()).toEqual(['os', 'sys']);
  });
});

describe('extractors (Go/Rust)', () => {
  it('Go: only capitalized funcs are exported', () => {
    const src = `package x\nfunc PublicFn() {}\nfunc privateFn() {}\ntype Thing struct{}\n`;
    const r = extract(src, 'go');
    const names = r.exports.map((e) => e.name).sort();
    expect(names).toEqual(['PublicFn', 'Thing']);
  });

  it('Rust: only `pub` items are exported', () => {
    const src = `pub fn run() {}\nfn private() {}\npub struct S;\n`;
    const r = extract(src, 'rs');
    const names = r.exports.map((e) => e.name).sort();
    expect(names).toEqual(['S', 'run']);
  });
});

describe('languages.detectLanguage', () => {
  it('detects supported extensions', () => {
    expect(detectLanguage('a.ts')).toBe('ts');
    expect(detectLanguage('a.tsx')).toBe('tsx');
    expect(detectLanguage('a.js')).toBe('js');
    expect(detectLanguage('a.jsx')).toBe('jsx');
    expect(detectLanguage('a.py')).toBe('py');
    expect(detectLanguage('a.go')).toBe('go');
    expect(detectLanguage('a.rs')).toBe('rs');
  });

  it('returns unknown for unsupported types', () => {
    expect(detectLanguage('a.mdx')).toBe('unknown');
    expect(detectLanguage('a.graphql')).toBe('unknown');
    expect(detectLanguage('Dockerfile')).toBe('unknown');
  });
});

describe('languages.isBinary', () => {
  it('detects null byte in first 512 bytes', () => {
    const buf = Buffer.from([1, 2, 0, 4]);
    expect(isBinary(buf)).toBe(true);
  });

  it('text file is not binary', () => {
    expect(isBinary(Buffer.from('hello world'))).toBe(false);
  });
});
