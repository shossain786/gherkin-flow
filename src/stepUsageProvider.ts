import * as path from 'path';
import * as vscode from 'vscode';
import { parseFeatureFile } from './featureParser';
import { StepDefinitionIndex } from './stepDefinitionProvider';

export class StepUsageIndex {
  private _stepTexts: string[] = [];
  private readonly _watcher: vscode.FileSystemWatcher;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _debounce: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    this._watcher.onDidCreate(() => this._scheduleRescan());
    this._watcher.onDidChange(() => this._scheduleRescan());
    this._watcher.onDidDelete(() => this._scheduleRescan());
    context.subscriptions.push(this._watcher, this._onDidChange);
  }

  async scan(): Promise<void> {
    await this._rescan();
  }

  countUsages(pattern: RegExp): number {
    let n = 0;
    for (const t of this._stepTexts) { if (pattern.test(t)) { n++; } }
    return n;
  }

  private _scheduleRescan(): void {
    if (this._debounce !== undefined) { clearTimeout(this._debounce); }
    this._debounce = setTimeout(() => {
      this._debounce = undefined;
      this._rescan();
    }, 400);
  }

  private async _rescan(): Promise<void> {
    const texts: string[] = [];
    const seen = new Set<string>();
    const uris = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');

    for (const uri of uris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const parsed = parseFeatureFile(doc);
        if (!parsed) { continue; }
        for (const scenario of parsed.scenarios) {
          for (const step of scenario.steps) {
            const key = `${uri.fsPath}:${step.line}`;
            if (!seen.has(key)) { seen.add(key); texts.push(step.text); }
          }
        }
      } catch { /* skip */ }
    }

    this._stepTexts = texts;
    this._onDidChange.fire();
  }
}

export class StepUsageCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onChange.event;

  constructor(
    private readonly _stepIndex: StepDefinitionIndex,
    private readonly _usageIndex: StepUsageIndex
  ) {
    _usageIndex.onDidChange(() => this._onChange.fire());
    _stepIndex.onDidChange(() => this._onChange.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const ext = path.extname(document.fileName).toLowerCase();
    if (!['.java', '.ts', '.js'].includes(ext)) { return []; }

    const defs = this._stepIndex.getDefsForFile(document.uri.fsPath);
    if (defs.length === 0) { return []; }

    return defs.map(def => {
      const count = this._usageIndex.countUsages(def.pattern);
      const range = new vscode.Range(def.line, 0, def.line, 0);
      const title = count === 0
        ? '$(warning) Unused step'
        : `$(references) Used in ${count} step${count !== 1 ? 's' : ''}`;
      return new vscode.CodeLens(range, { title, command: '' });
    });
  }
}
