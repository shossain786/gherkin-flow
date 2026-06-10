import * as vscode from 'vscode';
import { StepDefinitionIndex } from './stepDefinitionProvider';

const STEP_PREFIX_RE = /^\s*(Given|When|Then|And|But|\*)\s+/i;

const GHERKIN_KEYWORDS = [
  'Feature: ',
  'Rule: ',
  'Background:',
  'Scenario: ',
  'Scenario Outline: ',
  'Examples:',
  'Given ',
  'When ',
  'Then ',
  'And ',
  'But ',
];

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
    if (!prefixMatch) {
      return this.getKeywordCompletions(lineText, position);
    }

    const typedStart = prefixMatch[0].length;
    const typed = lineText.slice(typedStart).toLowerCase();
    const range = new vscode.Range(position.line, typedStart, position.line, position.character);

    return this._index.getAllPatterns()
      .filter(p => p.toLowerCase().includes(typed))
      .map(rawPattern => {
        const item = new vscode.CompletionItem(rawPattern, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(toSnippet(rawPattern));
        item.range = range;
        item.detail = 'GherkinFlow: step definition';
        return item;
      });
  }

  private getKeywordCompletions(lineText: string, position: vscode.Position): vscode.CompletionItem[] {
    const typed = lineText.match(/\S*$/)?.[0] ?? '';
    const range = new vscode.Range(position.line, position.character - typed.length, position.line, position.character);

    return GHERKIN_KEYWORDS
      .filter(kw => kw.trim().toLowerCase().startsWith(typed.toLowerCase()))
      .map(kw => {
        const item = new vscode.CompletionItem(kw.trim(), vscode.CompletionItemKind.Keyword);
        item.insertText = kw;
        item.range = range;
        item.detail = 'GherkinFlow: Gherkin keyword';
        return item;
      });
  }
}
