import * as vscode from 'vscode';

const FEATURE_RE    = /^\s*Feature\s*:/i;
const SCENARIO_RE   = /^\s*(Scenario(?:\s+Outline)?|Background)\s*:/i;
const STEP_RE       = /^\s*(Given|When|Then|And|But|\*)\s/i;
const EXAMPLES_RE   = /^\s*Examples\s*:/i;
const TABLE_ROW_RE  = /^\s*\|/;
const TAG_RE        = /^\s*@/;
const DOCSTRING_RE  = /^\s*"""/;
const COMMENT_RE    = /^\s*#/;

type Indent = 0 | 2 | 4 | 6;

export class GherkinFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    const edits: vscode.TextEdit[] = [];

    // Resolved target indent for each line index; undefined = preserve as-is (blank lines)
    const targets: (Indent | null)[] = [];

    let featureSeen   = false;
    let inDocString   = false;
    let afterExamples = false;  // next table rows are Examples rows (6 sp), not step tables
    let inScenario    = false;  // inside a scenario/background block

    // Buffer tag line indices until we know what they precede
    let pendingTagLines: number[] = [];

    const flushTags = (indent: Indent) => {
      for (const idx of pendingTagLines) { targets[idx] = indent; }
      pendingTagLines = [];
    };

    for (let i = 0; i < document.lineCount; i++) {
      const raw = document.lineAt(i).text;
      const trimmed = raw.trim();

      // Always preserve blank lines
      if (trimmed === '') {
        targets.push(null);
        continue;
      }

      // DocString toggle — content inside is re-indented uniformly at 6
      if (DOCSTRING_RE.test(raw)) {
        targets.push(6);
        inDocString = !inDocString;
        continue;
      }
      if (inDocString) {
        targets.push(6);
        continue;
      }

      // Comment — indent same as whatever context we're in
      if (COMMENT_RE.test(raw)) {
        if (!featureSeen) { targets.push(0); }
        else if (!inScenario) { targets.push(2); }
        else { targets.push(4); }
        continue;
      }

      // Feature
      if (FEATURE_RE.test(raw)) {
        flushTags(0);
        targets.push(0);
        featureSeen = true;
        inScenario = false;
        afterExamples = false;
        continue;
      }

      // Scenario / Scenario Outline / Background
      if (SCENARIO_RE.test(raw)) {
        flushTags(2);
        targets.push(2);
        inScenario = true;
        afterExamples = false;
        continue;
      }

      // Steps
      if (STEP_RE.test(raw)) {
        flushTags(4);
        targets.push(4);
        afterExamples = false;
        continue;
      }

      // Examples keyword
      if (EXAMPLES_RE.test(raw)) {
        flushTags(4);
        targets.push(4);
        afterExamples = true;
        continue;
      }

      // Table rows
      if (TABLE_ROW_RE.test(raw)) {
        targets.push(6);
        // afterExamples stays true until a non-table line resets it
        continue;
      }

      // Tags — buffer; we'll know the indent when we see the next keyword
      if (TAG_RE.test(raw)) {
        pendingTagLines.push(i);
        targets.push(0);  // placeholder, will be overwritten by flushTags
        continue;
      }

      // Anything else (Rule:, free-form text, etc.) — keep relative to context
      targets.push(featureSeen ? (inScenario ? 4 : 2) : 0);
    }

    // Flush any trailing tags (shouldn't happen in valid files, but be safe)
    flushTags(featureSeen ? 2 : 0);

    // Build TextEdits
    for (let i = 0; i < document.lineCount; i++) {
      const target = targets[i];
      if (target === null) { continue; }  // blank line — leave alone

      const raw = document.lineAt(i).text;
      const trimmed = raw.trim();
      if (trimmed === '') { continue; }

      const currentIndent = raw.length - raw.trimStart().length;
      if (currentIndent === target) { continue; }

      const range = new vscode.Range(i, 0, i, currentIndent);
      edits.push(vscode.TextEdit.replace(range, ' '.repeat(target)));
    }

    return edits;
  }
}
