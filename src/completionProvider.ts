import * as vscode from 'vscode';
import { StepDefinitionIndex } from './stepDefinitionProvider';

const STEP_PREFIX_RE = /^\s*(Given|When|Then|And|But|\*)\s+/i;

function toSnippet(rawPattern: string): string {
  if (rawPattern.startsWith('^')) {
    return rawPattern.replace(/^\^|\$$/, '');
  }
  let i = 0;
  return rawPattern.replace(/\{([^}]*)\}/g, (_, name) => {
    i++;
    return `\${${i}:${name || 'value'}}`;
  });
}

export class GherkinCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly _index: StepDefinitionIndex) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position.line).text.substring(0, position.character);
    const prefixMatch = lineText.match(STEP_PREFIX_RE);
    if (!prefixMatch) { return []; }

    const typed = lineText.slice(prefixMatch[0].length).toLowerCase();

    return this._index.getAllPatterns()
      .filter(p => p.toLowerCase().startsWith(typed))
      .map(rawPattern => {
        const item = new vscode.CompletionItem(rawPattern, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(toSnippet(rawPattern));
        item.detail = 'GherkinFlow: step definition';
        return item;
      });
  }
}
