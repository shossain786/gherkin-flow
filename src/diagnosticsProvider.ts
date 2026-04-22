import * as vscode from 'vscode';
import { parseFeatureFile } from './featureParser';
import { StepDefinitionIndex } from './stepDefinitionProvider';

export class GherkinDiagnosticsProvider {
  private readonly _collection: vscode.DiagnosticCollection;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly _index: StepDefinitionIndex,
    context: vscode.ExtensionContext
  ) {
    this._collection = vscode.languages.createDiagnosticCollection('gherkinFlow');
    context.subscriptions.push(this._collection);

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(doc => this._update(doc)),
      vscode.workspace.onDidChangeTextDocument(e => this._update(e.document)),
      _index.onDidChange(() => this._updateAllDebounced())
    );
  }

  async initialScan(): Promise<void> {
    for (const doc of vscode.workspace.textDocuments) {
      this._update(doc);
    }
  }

  private _update(document: vscode.TextDocument): void {
    if (!document.fileName.endsWith('.feature')) { return; }

    const parsed = parseFeatureFile(document);
    if (!parsed) { this._collection.delete(document.uri); return; }

    const diagnostics: vscode.Diagnostic[] = [];
    const seen = new Set<number>();

    for (const scenario of parsed.scenarios) {
      for (const step of scenario.steps) {
        if (seen.has(step.line)) { continue; }
        seen.add(step.line);

        if (!this._index.find(step.text)) {
          const lineText = document.lineAt(step.line).text;
          const col = lineText.search(/\S/);
          const range = new vscode.Range(step.line, col < 0 ? 0 : col, step.line, lineText.length);
          const diag = new vscode.Diagnostic(
            range,
            `No step definition found for: "${step.keyword} ${step.text}"`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.source = 'GherkinFlow';
          diagnostics.push(diag);
        }
      }
    }

    this._collection.set(document.uri, diagnostics);
  }

  private _updateAllDebounced(): void {
    if (this._debounceTimer !== undefined) { clearTimeout(this._debounceTimer); }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      for (const doc of vscode.workspace.textDocuments) {
        this._update(doc);
      }
    }, 300);
  }
}
