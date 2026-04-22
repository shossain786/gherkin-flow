import * as vscode from 'vscode';

export class WatchManager {
  private readonly _watched = new Set<string>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _stepDebounce: ReturnType<typeof setTimeout> | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly _runScenario: (name: string, uri: vscode.Uri) => Promise<void>
  ) {
    context.subscriptions.push(
      this._onDidChange,
      vscode.workspace.onDidSaveTextDocument(doc => this._onSave(doc))
    );
  }

  isWatched(scenarioName: string, uri: vscode.Uri): boolean {
    return this._watched.has(this._key(scenarioName, uri));
  }

  toggle(scenarioName: string, uri: vscode.Uri): void {
    const key = this._key(scenarioName, uri);
    if (this._watched.has(key)) { this._watched.delete(key); }
    else { this._watched.add(key); }
    this._onDidChange.fire();
  }

  get watchedCount(): number { return this._watched.size; }

  private _key(scenarioName: string, uri: vscode.Uri): string {
    return `${uri.fsPath}::${scenarioName}`;
  }

  private _onSave(doc: vscode.TextDocument): void {
    if (this._watched.size === 0) { return; }

    if (doc.uri.fsPath.endsWith('.feature')) {
      // Re-run watched scenarios in this specific feature file immediately
      for (const key of this._watched) {
        const sep = key.indexOf('::');
        if (sep === -1) { continue; }
        const filePath = key.slice(0, sep);
        const name = key.slice(sep + 2);
        if (filePath === doc.uri.fsPath) {
          this._runScenario(name, doc.uri);
        }
      }
      return;
    }

    if (/\.(java|ts|js)$/.test(doc.uri.fsPath)) {
      // Step file changed — debounce re-runs to avoid thrashing during rapid saves
      if (this._stepDebounce !== undefined) { clearTimeout(this._stepDebounce); }
      this._stepDebounce = setTimeout(() => {
        this._stepDebounce = undefined;
        const byFile = new Map<string, string[]>();
        for (const key of this._watched) {
          const sep = key.indexOf('::');
          if (sep === -1) { continue; }
          const filePath = key.slice(0, sep);
          const name = key.slice(sep + 2);
          if (!byFile.has(filePath)) { byFile.set(filePath, []); }
          byFile.get(filePath)!.push(name);
        }
        for (const [filePath, names] of byFile) {
          const uri = vscode.Uri.file(filePath);
          for (const name of names) { this._runScenario(name, uri); }
        }
      }, 600);
    }
  }
}
