// Pure step-pattern logic — deliberately free of any `vscode` import so it can be
// unit-tested outside the extension host.

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mirrors Cucumber-JVM's own ExpressionFactory heuristic for deciding whether an
 * annotation string is a regular expression or a Cucumber Expression.
 *
 * Cucumber treats the string as a regex when it is anchored at either end, is
 * written script-style (/.../), or contains a parenthesised group that is not
 * plain prose. Anything else is a Cucumber Expression.
 *
 * Getting this wrong is what produced "No step definition found" for patterns
 * like `POST isteği (?:atılır|gönderilir|yapılır)$` — anchored only at the end,
 * so the old `startsWith('^')` test missed it and the whole pattern was escaped
 * into a literal. (gherkin-flow#1)
 */
export function looksLikeRegex(pattern: string): boolean {
  if (pattern.startsWith('^') || pattern.endsWith('$')) { return true; }
  if (/^\/.*\/$/.test(pattern)) { return true; }

  // A Cucumber Expression's own constructs are not regex signals.
  if (/\{[^}]*\}/.test(pattern)) { return false; }

  // Optional text `(s)` and alternation `a/b` are Cucumber Expression syntax;
  // a group containing regex metacharacters is not.
  const groups = pattern.match(/\(([^)]*)\)/g);
  if (groups) {
    for (const g of groups) {
      const inner = g.slice(1, -1);
      if (inner.startsWith('?')) { return true; }          // (?:...) (?=...) (?!...)
      if (/[|\\\[\]+*{}]/.test(inner)) { return true; }
      if (!/^[a-zA-Z]*$/.test(inner)) { return true; }     // not plain optional text
    }
  }

  // Bare regex metacharacters outside any group.
  return /\\[dwsSDWbB]|\[[^\]]+\]|\.\*|\.\+|\\\./.test(pattern);
}

export function cucumberExpressionToRegex(pattern: string): RegExp {
  if (looksLikeRegex(pattern)) {
    // Anchor only where the author did not; an unanchored regex should still
    // match the whole step, as Cucumber requires.
    const body = pattern.replace(/^\^/, '').replace(/\$$/, '');
    return new RegExp(`^${body}$`, 'i');
  }
  const tokenRe = /\{([^}]*)\}/g;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(pattern)) !== null) {
    result += escapeRegex(pattern.slice(last, m.index));
    const token = m[1].toLowerCase();
    if (token === 'string')                          { result += `(?:"[^"]*"|'[^']*')`; }
    else if (token === 'int' || token === 'long' ||
             token === 'short' || token === 'byte' ||
             token === 'biginteger')                 { result += `-?\\d+`; }
    else if (token === 'float' || token === 'double'||
             token === 'bigdecimal')                 { result += `-?\\d+\\.?\\d*`; }
    else if (token === 'word')                       { result += `\\S+`; }
    else                                             { result += `.*`; }
    last = m.index + m[0].length;
  }
  result += escapeRegex(pattern.slice(last));
  return new RegExp(`^${result}$`, 'i');
}
