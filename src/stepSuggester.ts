import * as vscode from 'vscode';
import { StepDefinitionIndex } from './stepDefinitionProvider';

export interface StepSuggestion {
  rawPattern: string;
  location: vscode.Location;
  similarity: number;
}

// Minimal stop-word list — only filler articles/pronouns, not verbs like
// "should"/"have" which carry real meaning in Gherkin step text.
const STOP = new Set(['i', 'a', 'an', 'the', 'my', 'this', 'that']);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/\{[^}]+\}/g, ' ')   // strip {string}, {int}, …
      .replace(/["']/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) { return 0; }
  let shared = 0;
  for (const w of a) { if (b.has(w)) { shared++; } }
  return shared / (a.size + b.size - shared);
}

/**
 * Return up to `maxResults` step definitions whose raw pattern is
 * semantically similar to `stepText` but does NOT already match it.
 * Results are sorted by similarity descending.
 */
export function findSimilarSteps(
  stepText: string,
  index: StepDefinitionIndex,
  maxResults = 3,
  threshold = 0.3
): StepSuggestion[] {
  const tokens = tokenize(stepText);
  if (tokens.size === 0) { return []; }

  // Deduplicate by rawPattern — keep the highest-similarity occurrence
  const best = new Map<string, StepSuggestion>();

  for (const def of index.getAllDefs()) {
    if (def.pattern.test(stepText)) { continue; }   // already matches
    const sim = jaccard(tokens, tokenize(def.rawPattern));
    if (sim < threshold) { continue; }
    const existing = best.get(def.rawPattern);
    if (!existing || sim > existing.similarity) {
      best.set(def.rawPattern, { rawPattern: def.rawPattern, location: def.location, similarity: sim });
    }
  }

  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}

/**
 * Fill a pattern's parameter slots using values extracted from the original
 * step text so the replacement feels natural.
 *
 * "I enter {string} and {string}" + original "I enter admin and secret"
 *   → 'I enter "admin" and "secret"'  (reuses original quoted values if present)
 */
export function fillPattern(originalText: string, pattern: string): string {
  const quotedStrings = [...originalText.matchAll(/"([^"]*)"|'([^']*)'/g)]
    .map(m => m[1] ?? m[2] ?? '');
  const numbers = [...originalText.matchAll(/\b(\d+(?:\.\d+)?)\b/g)]
    .map(m => m[1]);

  let si = 0, ni = 0;

  return pattern
    .replace(/\{string\}/gi,
      () => `"${quotedStrings[si++] ?? ''}"`)
    .replace(/\{int\}|\{long\}|\{short\}|\{byte\}|\{biginteger\}/gi, () => {
      const v = numbers.find((n, idx) => idx >= ni && !n.includes('.'));
      ni++;
      return v ?? '0';
    })
    .replace(/\{float\}|\{double\}|\{bigdecimal\}/gi,
      () => numbers[ni++] ?? '0.0')
    .replace(/\{word\}/gi, () => 'word')
    .replace(/\{[^}]+\}/gi, () => '""');
}
