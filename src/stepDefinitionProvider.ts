import * as vscode from 'vscode';
import * as fs from 'fs';

const STEP_RE = /^\s*(Given|When|Then|And|But|\*)\s+(.*)/i;
const ANNOTATION_RE = /@(?:Given|When|Then|And|But)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

interface StepDefinition {
  pattern: RegExp;
  rawPattern: string;
  location: vscode.Location;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cucumberExpressionToRegex(pattern: string): RegExp {
  if (pattern.startsWith('^')) {
    return new RegExp(pattern, 'i');
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

export class StepDefinitionIndex {
  private _defs: StepDefinition[] = [];
  private _defsByFile = new Map<string, StepDefinition[]>();
  private _watcher: vscode.FileSystemWatcher;

  constructor(context: vscode.ExtensionContext) {
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
    this._watcher.onDidCreate(uri => this._reloadFile(uri));
    this._watcher.onDidChange(uri => this._reloadFile(uri));
    this._watcher.onDidDelete(uri => this._removeFile(uri));
    context.subscriptions.push(this._watcher);
  }

  async scan(): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/*.java', '{**/node_modules/**,**/target/**}');
    await Promise.all(uris.map(uri => this._reloadFile(uri)));
  }

  find(stepText: string): vscode.Location | undefined {
    for (const def of this._defs) {
      if (def.pattern.test(stepText)) { return def.location; }
    }
    return undefined;
  }

  private async _reloadFile(uri: vscode.Uri): Promise<void> {
    this._removeFile(uri);
    try {
      const text = fs.readFileSync(uri.fsPath, 'utf8');
      this._parseFile(uri, text);
    } catch {
      // unreadable — skip
    }
  }

  private _parseFile(uri: vscode.Uri, text: string): void {
    const defs: StepDefinition[] = [];
    const lines = text.split('\n');
    let match: RegExpExecArray | null;
    ANNOTATION_RE.lastIndex = 0;
    while ((match = ANNOTATION_RE.exec(text)) !== null) {
      const rawPattern = match[1];
      const charsBefore = text.slice(0, match.index);
      const line = charsBefore.split('\n').length - 1;
      try {
        defs.push({
          pattern: cucumberExpressionToRegex(rawPattern),
          rawPattern,
          location: new vscode.Location(uri, new vscode.Range(line, 0, line, lines[line]?.length ?? 0))
        });
      } catch {
        // invalid regex — skip
      }
    }
    if (defs.length > 0) {
      this._defsByFile.set(uri.fsPath, defs);
      this._defs.push(...defs);
    }
  }

  private _removeFile(uri: vscode.Uri): void {
    const existing = this._defsByFile.get(uri.fsPath);
    if (!existing) { return; }
    this._defs = this._defs.filter(d => !existing.includes(d));
    this._defsByFile.delete(uri.fsPath);
  }
}

export class GherkinDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly _index: StepDefinitionIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location | undefined {
    const line = document.lineAt(position.line).text;
    const match = line.match(STEP_RE);
    if (!match) { return undefined; }
    return this._index.find(match[2].trim());
  }
}
