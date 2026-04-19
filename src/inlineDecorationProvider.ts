import * as vscode from 'vscode';

export interface FailedStep { line: number; error: string; }

export class InlineDecorationProvider {
  private readonly _type: vscode.TextEditorDecorationType;
  private readonly _failures = new Map<string, FailedStep[]>();

  constructor(context: vscode.ExtensionContext) {
    this._type = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('testing.message.error.lineBackground'),
      after: {
        color: new vscode.ThemeColor('testing.message.error.decorationForeground'),
        margin: '0 0 0 2em',
        fontStyle: 'italic',
      }
    });
    context.subscriptions.push(this._type);
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(e => { if (e) { this._applyToEditor(e); } })
    );
  }

  setFailures(uri: vscode.Uri, failures: FailedStep[]): void {
    this._failures.set(uri.fsPath, failures);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.fsPath === uri.fsPath) { this._applyToEditor(editor); }
    }
  }

  clearFailures(uri: vscode.Uri): void {
    this._failures.delete(uri.fsPath);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.fsPath === uri.fsPath) { editor.setDecorations(this._type, []); }
    }
  }

  private _applyToEditor(editor: vscode.TextEditor): void {
    const failures = this._failures.get(editor.document.uri.fsPath);
    if (!failures?.length) { return; }
    const decorations: vscode.DecorationOptions[] = failures.map(f => ({
      range: new vscode.Range(f.line, 0, f.line, 0),
      renderOptions: {
        after: { contentText: `  ← ${f.error.split('\n')[0].substring(0, 100)}` }
      }
    }));
    editor.setDecorations(this._type, decorations);
  }
}
