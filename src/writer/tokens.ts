/**
 * Rough cl100k-style token estimator. char_count / 4 for ASCII-heavy text,
 * adjusted for high-byte content (CJK, emoji) which packs more tokens per char.
 *
 * Accuracy goal: ±15% vs. real tiktoken on typical source code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let asciiChars = 0;
  let highChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) asciiChars++;
    else highChars++;
  }
  // ASCII: ~4 chars/token. High-byte (CJK): ~1.2 chars/token.
  const tokens = asciiChars / 4 + highChars / 1.2;
  return Math.max(0, Math.floor(tokens));
}

/** Diagnostic: returns token-per-char ratio. >6 means likely CJK-heavy. */
export function tokenRatio(text: string): number {
  if (!text) return 0;
  return estimateTokens(text) / text.length;
}
