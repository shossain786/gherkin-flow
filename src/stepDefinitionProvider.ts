import * as vscode from 'vscode';
import * as fs from 'fs';

const STEP_RE = /^\s*(Given|When|Then|And|But|\*)\s+(.*)/i;
const ANNOTATION_RE_JAVA = /@(?:Given|When|Then|And|But)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
const ANNOTATION_RE_NODE_STR = /(?:@(?:Given|When|Then|And|But)\s*\(|(?:^|[^.\w])(?:Given|When|Then|And|But)\s*\()\s*(['"`])((?:[^'"`\\]|\\.)*)\2/gm;
const ANNOTATION_RE_NODE_RE  = /(?:@(?:Given|When|Then|And|But)\s*\(|(?:^|[^.\w])(?:Given|When|Then|And|But)\s*\()\s*\/([^/]+)\//gm;

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
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*.{java,ts,js}');
    this._watcher.onDidCreate(uri => this._reloadFile(uri));
    this._watcher.onDidChange(uri => this._reloadFile(uri));
    this._watcher.onDidDelete(uri => this._removeFile(uri));
    context.subscriptions.push(this._watcher);
  }

  async scan(): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/*.{java,ts,js}', '{**/node_modules/**,**/target/**,**/dist/**}');
    await Promise.all(uris.map(uri => this._reloadFile(uri)));
  }

  find(stepText: string): vscode.Location | undefined {
    for (const def of this._defs) {
      if (def.pattern.test(stepText)) { return def.location; }
    }
    return undefined;
  }

  getAllPatterns(): string[] {
    return [...new Set(this._defs.map(d => d.rawPattern))];
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
    const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
    const isNode = ext === 'ts' || ext === 'js';

    const push = (rawPattern: string, matchIndex: number, isRegex = false) => {
      const line = text.slice(0, matchIndex).split('\n').length - 1;
      try {
        const pattern = isRegex ? new RegExp(rawPattern, 'i') : cucumberExpressionToRegex(rawPattern);
        defs.push({ pattern, rawPattern, location: new vscode.Location(uri, new vscode.Range(line, 0, line, lines[line]?.length ?? 0)) });
      } catch { /* invalid regex — skip */ }
    };

    if (isNode) {
      ANNOTATION_RE_NODE_STR.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ANNOTATION_RE_NODE_STR.exec(text)) !== null) { push(m[2], m.index); }
      ANNOTATION_RE_NODE_RE.lastIndex = 0;
      while ((m = ANNOTATION_RE_NODE_RE.exec(text)) !== null)  { push(m[1], m.index, true); }
    } else {
      ANNOTATION_RE_JAVA.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ANNOTATION_RE_JAVA.exec(text)) !== null) { push(m[1], m.index); }
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
