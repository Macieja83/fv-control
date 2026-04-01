/** Classic DP Levenshtein distance (for fuzzy invoice number comparison). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const ca = a[i - 1]!;
      const cb = b[j - 1]!;
      const cost = ca === cb ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

export function normalizedLevenshteinSimilarity(a: string, b: string): number {
  const d = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - d / maxLen;
}
