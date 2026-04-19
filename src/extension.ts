import * as path from 'path';
import * as vscode from 'vscode';
import { GherkinTestController } from './testController';
import { StepDefinitionIndex, GherkinDefinitionProvider } from './stepDefinitionProvider';

const SCENARIO_REGEX = /^\s*(Scenario(?: Outline)?):\s*(.*)$/i;
const FEATURE_REGEX  = /^\s*Feature:\s*(.*)$/i;

const scenarioDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('testing.runAction'),
  backgroundColor: new vscode.ThemeColor('testing.coveredBackground'),
  overviewRulerColor: new vscode.ThemeColor('testing.runAction'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

function applyDecorations(editor: vscode.TextEditor): void {
  if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') { return; }
  const ranges: vscode.Range[] = [];
  for (let i = 0; i < editor.document.lineCount; i++) {
    const line = editor.document.lineAt(i);
    const match = line.text.match(SCENARIO_REGEX);
    if (match && match[2].trim().length > 0) { ranges.push(line.range); }
  }
  editor.setDecorations(scenarioDecoration, ranges);
}

function findScenarioAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  for (let i = position.line; i >= 0; i--) {
    const match = document.lineAt(i).text.match(SCENARIO_REGEX);
    if (match && match[2].trim().length > 0) { return match[2].trim(); }
  }
  return undefined;
}

class GherkinFlowCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const range = new vscode.Range(i, 0, i, line.text.length);

      if (FEATURE_REGEX.test(line.text)) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶️ Run Feature',
          command: 'gherkinFlow.runFeatureByUri',
          arguments: [document.uri]
        }));
      }

      const sm = line.text.match(SCENARIO_REGEX);
      if (sm && sm[2].trim().length > 0) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run Scenario',
          command: 'gherkinFlow.runScenarioByName',
          arguments: [sm[2].trim(), document.uri]
        }));
      }
    }
    return lenses;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const controller = new GherkinTestController(context);

  vscode.window.visibleTextEditors.forEach(applyDecorations);

  // Right-click: run scenario at cursor
  const runScenarioAtCursor = vscode.commands.registerTextEditorCommand(
    'gherkinFlow.runScenario',
    (editor) => {
      if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
        vscode.window.showErrorMessage('GherkinFlow: Only works with .feature files.');
        return;
      }
      const name = findScenarioAtPosition(editor.document, editor.selection.active);
      if (!name) {
        vscode.window.showErrorMessage('GherkinFlow: No Scenario found at cursor position.');
        return;
      }
      controller.runScenario(name, editor.document.uri);
    }
  );

  // Right-click: run entire feature file
  const runFeatureAtCursor = vscode.commands.registerTextEditorCommand(
    'gherkinFlow.runFeature',
    (editor) => {
      if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
        vscode.window.showErrorMessage('GherkinFlow: Only works with .feature files.');
        return;
      }
      controller.runFeature(editor.document.uri);
    }
  );

  // CodeLens: run scenario by name
  const runScenarioByName = vscode.commands.registerCommand(
    'gherkinFlow.runScenarioByName',
    (scenarioName: string, uri: vscode.Uri) => controller.runScenario(scenarioName, uri)
  );

  // CodeLens: run feature by URI
  const runFeatureByUri = vscode.commands.registerCommand(
    'gherkinFlow.runFeatureByUri',
    (uri: vscode.Uri) => controller.runFeature(uri)
  );

  const codeLens = vscode.languages.registerCodeLensProvider(
    { pattern: '**/*.feature' },
    new GherkinFlowCodeLensProvider()
  );

  const stepIndex = new StepDefinitionIndex(context);
  stepIndex.scan();
  const defProvider = vscode.languages.registerDefinitionProvider(
    { pattern: '**/*.feature' },
    new GherkinDefinitionProvider(stepIndex)
  );

  context.subscriptions.push(
    runScenarioAtCursor,
    runFeatureAtCursor,
    runScenarioByName,
    runFeatureByUri,
    codeLens,
    defProvider,
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) { applyDecorations(editor); }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) { applyDecorations(editor); }
    })
  );
}

export function deactivate() {}
