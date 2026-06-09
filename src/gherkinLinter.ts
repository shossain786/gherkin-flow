import * as vscode from 'vscode';
import { parseFeatureFile, FeatureScenario, FeatureStep } from './featureParser';

const SOURCE = 'GherkinFlow';

// Step text patterns that suggest UI implementation details leaking into Gherkin
const UI_DETAIL_RE = /\b(click(?:ed|ing)?|tap(?:ped|ping)?|button|checkbox|dropdown|CSS\s+selector|XPath|xpath|html\s+element|input\s+field|scroll\s+to|right[\s-]?click)\b/i;

// Steps that read like developer jargon rather than business language
const DEV_JARGON_RE = /\b(API|endpoint|HTTP|JSON|SQL|query|database|DOM|element\s+id|class\s+name|locator)\b/i;

const QUOTED_VALUE_RE = /\b"([^"]{3,})"/g;   // quoted strings of ≥ 3 chars

const BACKGROUND_LINE_RE = /^\s*Background:/i;
const AND_BUT_RE         = /^(And|But)$/i;

// Maximum background steps before GF009 fires
const MAX_BACKGROUND_STEPS = 4;

// Minimum scenarios that must share a literal before GF010 fires
const GF010_THRESHOLD = 3;

export class GherkinLinter {
  private readonly _collection: vscode.DiagnosticCollection;

  constructor(context: vscode.ExtensionContext) {
    this._collection = vscode.languages.createDiagnosticCollection('gherkinFlowLint');
    context.subscriptions.push(this._collection);

    vscode.workspace.onDidOpenTextDocument(doc  => this._lint(doc),  null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(e  => this._lint(e.document), null, context.subscriptions);
    vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri), null, context.subscriptions);

    // Re-lint when the user changes lint.disable in settings
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gherkinflow.lint')) {
        vscode.workspace.textDocuments.forEach(doc => this._lint(doc));
      }
    }, null, context.subscriptions);

    vscode.workspace.textDocuments.forEach(doc => this._lint(doc));
  }

  private _lint(doc: vscode.TextDocument): void {
    if (!doc.fileName.endsWith('.feature')) { return; }
    const feature = parseFeatureFile(doc);
    if (!feature) { this._collection.delete(doc.uri); return; }

    const disabled = new Set<string>(
      vscode.workspace.getConfiguration('gherkinflow').get<string[]>('lint.disable', [])
    );

    const diags: vscode.Diagnostic[] = [];

    // ── GF008: Feature file with no scenarios ───────────────────────────────
    if (feature.scenarios.length === 0) {
      diags.push(this._diag(doc, feature.line,
        'Feature has no scenarios — add at least one Scenario or Scenario Outline.',
        vscode.DiagnosticSeverity.Warning, 'GF008'));
    }

    // ── GF009: Background with too many steps ───────────────────────────────
    if (feature.backgroundSteps.length > MAX_BACKGROUND_STEPS) {
      const bgLine = this._findBackgroundLine(doc);
      diags.push(this._diag(doc, bgLine,
        `Background has ${feature.backgroundSteps.length} steps — keep it to ${MAX_BACKGROUND_STEPS} or fewer. ` +
        'A long Background often means the feature is doing too much.',
        vscode.DiagnosticSeverity.Warning, 'GF009'));
    }

    // ── GF010: Same quoted literal in ≥ 3 scenarios (suggest Outline) ───────
    // Map from literal value → Set of scenario names that contain it
    const literalScenarios = new Map<string, Set<string>>();
    // Map from literal value → first step occurrence per scenario (for highlighting)
    const literalFirstStep = new Map<string, Map<string, FeatureStep>>();
    const checkedOutlines10 = new Set<string>();

    for (const s of feature.scenarios) {
      const scenarioKey = s.outlineName ?? s.name;
      if (s.outlineName && checkedOutlines10.has(s.outlineName)) { continue; }
      if (s.outlineName) { checkedOutlines10.add(s.outlineName); }

      for (const step of s.steps) {
        let m: RegExpExecArray | null;
        QUOTED_VALUE_RE.lastIndex = 0;
        while ((m = QUOTED_VALUE_RE.exec(step.text)) !== null) {
          const val = m[1];
          if (/^\d+$/.test(val)) { continue; } // skip pure numbers
          if (!literalScenarios.has(val)) { literalScenarios.set(val, new Set()); }
          const prevSize = literalScenarios.get(val)!.size;
          literalScenarios.get(val)!.add(scenarioKey);
          // Record the first step where this literal appears in this scenario
          if (prevSize < literalScenarios.get(val)!.size) {
            if (!literalFirstStep.has(val)) { literalFirstStep.set(val, new Map()); }
            literalFirstStep.get(val)!.set(scenarioKey, step);
          }
        }
      }
    }

    for (const [val, scenarioSet] of literalScenarios) {
      if (scenarioSet.size >= GF010_THRESHOLD) {
        for (const step of literalFirstStep.get(val)?.values() ?? []) {
          diags.push(this._diag(doc, step.line,
            `"${val}" appears in ${scenarioSet.size} scenarios — consider a Scenario Outline with an Examples table to avoid repeating this value.`,
            vscode.DiagnosticSeverity.Hint, 'GF010'));
        }
      }
    }

    // ── GF001: Duplicate scenario names ─────────────────────────────────────
    const names = new Map<string, number>();
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

    // ── GF002: Scenario Outline with only one example row ───────────────────
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
    for (const [outlineName, count] of outlineExampleCounts) {
      if (count === 1) {
        const line = outlineFirstLine.get(outlineName) ?? 0;
        diags.push(this._diag(doc, line,
          `Scenario Outline "${outlineName}" has only one example row — use a plain Scenario instead.`,
          vscode.DiagnosticSeverity.Warning, 'GF002'));
      }
    }

    // ── Per-scenario rules ───────────────────────────────────────────────────
    const checkedOutlines = new Set<string>();
    for (const s of feature.scenarios) {
      if (s.outlineName) {
        if (checkedOutlines.has(s.outlineName)) { continue; }
        checkedOutlines.add(s.outlineName);
      }
      this._lintScenario(doc, s, feature.backgroundSteps.length, diags);
    }

    // Apply the disable filter in one place
    this._collection.set(doc.uri, diags.filter(d => !disabled.has(d.code as string)));
  }

  private _lintScenario(
    doc: vscode.TextDocument,
    s: FeatureScenario,
    bgStepCount: number,
    diags: vscode.Diagnostic[]
  ): void {
    const scenarioLine = s.outlineLine ?? s.line;
    const ownSteps     = s.steps.slice(bgStepCount);   // strip background steps

    const keywords = s.steps.map(st => st.keyword.trim().toLowerCase());
    const hasThen  = keywords.some(k => k === 'then');
    const hasWhen  = keywords.some(k => k === 'when');

    // ── GF003: No Then ──────────────────────────────────────────────────────
    if (!hasThen && s.steps.length > 0) {
      diags.push(this._diag(doc, scenarioLine,
        `Scenario "${s.name}" has no Then step — every scenario should assert an expected outcome.`,
        vscode.DiagnosticSeverity.Warning, 'GF003'));
    }

    // ── GF004: No When ──────────────────────────────────────────────────────
    if (!hasWhen && s.steps.length > 0) {
      diags.push(this._diag(doc, scenarioLine,
        `Scenario "${s.name}" has no When step — every scenario should describe a clear action.`,
        vscode.DiagnosticSeverity.Warning, 'GF004'));
    }

    // ── GF005: Too many steps ───────────────────────────────────────────────
    if (s.steps.length > 8) {
      diags.push(this._diag(doc, scenarioLine,
        `Scenario "${s.name}" has ${s.steps.length} steps — consider splitting it into smaller, focused scenarios (recommended: ≤8 steps).`,
        vscode.DiagnosticSeverity.Warning, 'GF005'));
    }

    // ── GF006: UI detail in step text ───────────────────────────────────────
    for (const step of s.steps) {
      const m = step.text.match(UI_DETAIL_RE);
      if (m) {
        diags.push(this._diag(doc, step.line,
          `Step may leak UI detail ("${m[0]}") — describe what the user does, not how the UI works.`,
          vscode.DiagnosticSeverity.Hint, 'GF006'));
      }
    }

    // ── GF007: Developer jargon in step text ────────────────────────────────
    for (const step of s.steps) {
      if (UI_DETAIL_RE.test(step.text)) { continue; }
      const m = step.text.match(DEV_JARGON_RE);
      if (m) {
        diags.push(this._diag(doc, step.line,
          `Step contains technical jargon ("${m[0]}") — Gherkin should be readable by non-technical stakeholders.`,
          vscode.DiagnosticSeverity.Hint, 'GF007'));
      }
    }

    // ── GF011: And/But as first own step ────────────────────────────────────
    const firstOwn = ownSteps[0];
    if (firstOwn && AND_BUT_RE.test(firstOwn.keyword.trim())) {
      diags.push(this._diag(doc, firstOwn.line,
        `"${firstOwn.keyword.trim()}" cannot be the first step in a scenario — use Given, When, or Then to open.`,
        vscode.DiagnosticSeverity.Error, 'GF011'));
    }
  }

  private _findBackgroundLine(doc: vscode.TextDocument): number {
    for (let i = 0; i < doc.lineCount; i++) {
      if (BACKGROUND_LINE_RE.test(doc.lineAt(i).text)) { return i; }
    }
    return 0;
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
