import * as vscode from 'vscode';
import { parseFeatureFile, FeatureScenario } from './featureParser';

const SOURCE = 'GherkinFlow';

// Keywords whose presence after only And/But indicates a structural issue
const GIVEN_RE = /^\s*(Given|And|But|\*)/i;
const WHEN_RE  = /^\s*(When|And|But|\*)/i;
const THEN_RE  = /^\s*(Then|And|But|\*)/i;

// Step text patterns that suggest UI implementation details leaking into Gherkin
const UI_DETAIL_RE = /\b(click(?:ed|ing)?|tap(?:ped|ping)?|button|checkbox|dropdown|CSS\s+selector|XPath|xpath|html\s+element|input\s+field|scroll\s+to|right[\s-]?click)\b/i;

// Steps that read like developer jargon rather than business language
const DEV_JARGON_RE = /\b(API|endpoint|HTTP|JSON|SQL|query|database|DOM|element\s+id|class\s+name|locator)\b/i;

export class GherkinLinter {
  private readonly _collection: vscode.DiagnosticCollection;

  constructor(context: vscode.ExtensionContext) {
    this._collection = vscode.languages.createDiagnosticCollection('gherkinFlowLint');
    context.subscriptions.push(this._collection);

    vscode.workspace.onDidOpenTextDocument(doc  => this._lint(doc),  null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(e  => this._lint(e.document), null, context.subscriptions);
    vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri), null, context.subscriptions);

    // Lint all already-open feature files on activation
    vscode.workspace.textDocuments.forEach(doc => this._lint(doc));
  }

  private _lint(doc: vscode.TextDocument): void {
    if (!doc.fileName.endsWith('.feature')) { return; }
    const feature = parseFeatureFile(doc);
    if (!feature) { this._collection.delete(doc.uri); return; }

    const diags: vscode.Diagnostic[] = [];

    // ── Rule: duplicate scenario names within the same feature ──────────────
    const names = new Map<string, number>();  // name → first line
    for (const s of feature.scenarios) {
      const key = s.name.toLowerCase();
      if (names.has(key)) {
        diags.push(this._diag(doc, s.line,
          `Duplicate scenario name "${s.name}" — each scenario in a feature must have a unique name.`,
          vscode.DiagnosticSeverity.Error, 'GF001'));
      } else {
        names.set(key, s.line);
      }
    }

    // Track Scenario Outline example counts to detect single-row outlines
    const outlineExampleCounts = new Map<string, number>();
    const outlineFirstLine     = new Map<string, number>();
    for (const s of feature.scenarios) {
      if (s.outlineName) {
        outlineExampleCounts.set(s.outlineName, (outlineExampleCounts.get(s.outlineName) ?? 0) + 1);
        if (!outlineFirstLine.has(s.outlineName) && s.outlineLine !== undefined) {
          outlineFirstLine.set(s.outlineName, s.outlineLine);
        }
      }
    }

    // ── Rule: Scenario Outline with only one example row ────────────────────
    for (const [outlineName, count] of outlineExampleCounts) {
      if (count === 1) {
        const line = outlineFirstLine.get(outlineName) ?? 0;
        diags.push(this._diag(doc, line,
          `Scenario Outline "${outlineName}" has only one example row — use a plain Scenario instead.`,
          vscode.DiagnosticSeverity.Warning, 'GF002'));
      }
    }

    // Per-scenario rules (skip expanded outline duplicates — check the first occurrence only)
    const checkedOutlines = new Set<string>();
    for (const s of feature.scenarios) {
      if (s.outlineName) {
        if (checkedOutlines.has(s.outlineName)) { continue; }
        checkedOutlines.add(s.outlineName);
      }
      this._lintScenario(doc, s, diags);
    }

    this._collection.set(doc.uri, diags);
  }

  private _lintScenario(
    doc: vscode.TextDocument,
    s: FeatureScenario,
    diags: vscode.Diagnostic[]
  ): void {
    // The line to highlight for scenario-level issues
    const scenarioLine = s.outlineLine ?? s.line;

    // Exclude background steps (steps before the scenario's own steps)
    // They are already in s.steps but we can't easily separate them here,
    // so we check for the presence of Given/When/Then among ALL steps.
    const keywords = s.steps.map(st => st.keyword.trim().toLowerCase());
    const hasGiven = keywords.some(k => k === 'given');
    const hasWhen  = keywords.some(k => k === 'when');
    const hasThen  = keywords.some(k => k === 'then');

    // ── Rule: no Then ───────────────────────────────────────────────────────
    if (!hasThen && s.steps.length > 0) {
      diags.push(this._diag(doc, scenarioLine,
        `Scenario "${s.name}" has no Then step — every scenario should assert an expected outcome.`,
        vscode.DiagnosticSeverity.Warning, 'GF003'));
    }

    // ── Rule: no When ───────────────────────────────────────────────────────
    if (!hasWhen && s.steps.length > 0) {
      diags.push(this._diag(doc, scenarioLine,
        `Scenario "${s.name}" has no When step — every scenario should describe a clear action.`,
        vscode.DiagnosticSeverity.Warning, 'GF004'));
    }

    // ── Rule: too many steps ────────────────────────────────────────────────
    if (s.steps.length > 8) {
      diags.push(this._diag(doc, scenarioLine,
        `Scenario "${s.name}" has ${s.steps.length} steps — consider splitting it into smaller, focused scenarios (recommended: ≤8 steps).`,
        vscode.DiagnosticSeverity.Warning, 'GF005'));
    }

    // ── Rule: UI implementation detail in step text ─────────────────────────
    for (const step of s.steps) {
      const m = step.text.match(UI_DETAIL_RE);
      if (m) {
        diags.push(this._diag(doc, step.line,
          `Step may leak UI detail ("${m[0]}") — describe what the user does, not how the UI works.`,
          vscode.DiagnosticSeverity.Hint, 'GF006'));
      }
    }

    // ── Rule: developer jargon in step text ─────────────────────────────────
    for (const step of s.steps) {
      if (UI_DETAIL_RE.test(step.text)) { continue; } // already flagged above
      const m = step.text.match(DEV_JARGON_RE);
      if (m) {
        diags.push(this._diag(doc, step.line,
          `Step contains technical jargon ("${m[0]}") — Gherkin should be readable by non-technical stakeholders.`,
          vscode.DiagnosticSeverity.Hint, 'GF007'));
      }
    }
  }

  private _diag(
    doc: vscode.TextDocument,
    lineIndex: number,
    message: string,
    severity: vscode.DiagnosticSeverity,
    code: string
  ): vscode.Diagnostic {
    const line  = doc.lineAt(Math.min(lineIndex, doc.lineCount - 1));
    const range = new vscode.Range(line.lineNumber, line.firstNonWhitespaceCharacterIndex,
                                   line.lineNumber, line.text.trimEnd().length);
    const d = new vscode.Diagnostic(range, message, severity);
    d.source = SOURCE;
    d.code   = code;
    return d;
  }
}
