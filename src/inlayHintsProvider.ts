import * as vscode from 'vscode';
import { StepDefinitionIndex } from './stepDefinitionProvider';

const STEP_RE  = /^\s*(Given|When|Then|And|But|\*)\s+(.*)/i;
const TOKEN_RE = /\{([^}]*)\}/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenLabel(raw: string): string {
  const t = raw.toLowerCase();
  if (t === 'string')                                              { return 'string'; }
  if (['int','long','short','byte','biginteger'].includes(t))      { return 'int'; }
  if (['float','double','bigdecimal'].includes(t))                 { return 'float'; }
  if (t === 'word')                                                { return 'word'; }
  return 'any';
}

interface CapturingPattern {
  re: RegExp;
  labels: string[];
}

function buildCapturingPattern(rawPattern: string): CapturingPattern | undefined {
  // Raw regex patterns (start with ^) don't have named Cucumber tokens — skip them.
  if (rawPattern.startsWith('^')) { return undefined; }

  const labels: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(rawPattern)) !== null) {
    result += escapeRegex(rawPattern.slice(last, m.index));
    const t = m[1].toLowerCase();
    labels.push(tokenLabel(m[1]));

    if (t === 'string') {
      result += `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
    } else if (['int','long','short','byte','biginteger'].includes(t)) {
      result += `(-?\\d+)`;
    } else if (['float','double','bigdecimal'].includes(t)) {
      result += `(-?\\d+\\.?\\d*)`;
    } else if (t === 'word') {
      result += `(\\S+)`;
    } else {
      result += `(.*?)`;
    }
    last = m.index + m[0].length;
  }

  if (labels.length === 0) { return undefined; }
  result += escapeRegex(rawPattern.slice(last));

  try {
    return { re: new RegExp(`^${result}$`, 'i'), labels };
  } catch {
    return undefined;
  }
}

export class GherkinInlayHintsProvider implements vscode.InlayHintsProvider {
  constructor(private readonly _index: StepDefinitionIndex) {}

  provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    const hints: vscode.InlayHint[] = [];

    for (let i = range.start.line; i <= range.end.line; i++) {
      const lineText = document.lineAt(i).text;
      const stepMatch = lineText.match(STEP_RE);
      if (!stepMatch) { continue; }

      const stepText = stepMatch[2].trim();
      const def = this._index.findDef(stepText);
      if (!def) { continue; }

      const cap = buildCapturingPattern(def.rawPattern);
      if (!cap) { continue; }

      const capMatch = cap.re.exec(stepText);
      if (!capMatch) { continue; }

      // Offset where the step text (after keyword) starts in the full line
      const stepOffset = lineText.indexOf(stepText);

      let searchFrom = 0;
      for (let g = 0; g < cap.labels.length; g++) {
        const captured = capMatch[g + 1];
        if (captured === undefined) { continue; }

        const idx = stepText.indexOf(captured, searchFrom);
        if (idx === -1) { continue; }

        const col = stepOffset + idx + captured.length;
        const hint = new vscode.InlayHint(
          new vscode.Position(i, col),
          `: ${cap.labels[g]}`,
          vscode.InlayHintKind.Type
        );
        hints.push(hint);
        searchFrom = idx + captured.length;
      }
    }

    return hints;
  }
}
