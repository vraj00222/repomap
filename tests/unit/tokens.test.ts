import { describe, it, expect } from 'vitest';
import { estimateTokens, tokenRatio } from '../../src/writer/tokens.js';

describe('tokens.estimate', () => {
  it('empty string → 0 tokens', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('400-char ASCII string → approximately 100 tokens (±15%)', () => {
    const s = 'a'.repeat(400);
    const t = estimateTokens(s);
    expect(t).toBeGreaterThanOrEqual(85);
    expect(t).toBeLessThanOrEqual(115);
  });

  it('Chinese text → higher token-per-char ratio', () => {
    const s = '你好世界'.repeat(50);
    const ratio = tokenRatio(s);
    expect(ratio).toBeGreaterThan(0.5);
  });

  it('returns integer, never float', () => {
    const t = estimateTokens('hello world this is a test of the token estimator');
    expect(Number.isInteger(t)).toBe(true);
  });

  it('larger text → more tokens (monotonic)', () => {
    expect(estimateTokens('aaaa')).toBeLessThan(estimateTokens('aaaaaaaa'));
  });
});
