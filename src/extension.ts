import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

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
    if (match && match[2].trim().length > 0) {
      ranges.push(line.range);
    }
  }
  editor.setDecorations(scenarioDecoration, ranges);
}

function findScenarioAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  for (let lineIndex = position.line; lineIndex >= 0; lineIndex--) {
    const lineText = document.lineAt(lineIndex).text;
    const match = lineText.match(SCENARIO_REGEX);
    if (match && match[2].trim().length > 0) {
      return match[2].trim();
    }
  }
  return undefined;
}

function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
}

function existsSync(workspaceFolder: string, fileName: string): boolean {
  return fs.existsSync(path.join(workspaceFolder, fileName));
}

function buildScenarioCommand(scenarioName: string, workspaceFolder: string): string {
  const safeName = scenarioName.replace(/"/g, '\\"');
  const gradleArg = `"-Pcucumber.filter.name=${safeName}"`;
  const mavenArg  = `"-Dcucumber.filter.name=${safeName}"`;

  if (existsSync(workspaceFolder, 'gradlew'))  { return `./gradlew test ${gradleArg}`; }
  if (existsSync(workspaceFolder, 'gradle'))   { return `gradle test ${gradleArg}`; }
  if (existsSync(workspaceFolder, 'mvnw'))     { return `./mvnw test ${mavenArg}`; }
  return `mvn test ${mavenArg}`;
}

function buildFeatureCommand(featurePath: string, workspaceFolder: string): string {
  const safePath   = featurePath.replace(/"/g, '\\"');
  const gradleArg  = `"-Pcucumber.features=${safePath}"`;
  const mavenArg   = `"-Dcucumber.features=${safePath}"`;

  if (existsSync(workspaceFolder, 'gradlew'))  { return `./gradlew test ${gradleArg}`; }
  if (existsSync(workspaceFolder, 'gradle'))   { return `gradle test ${gradleArg}`; }
  if (existsSync(workspaceFolder, 'mvnw'))     { return `./mvnw test ${mavenArg}`; }
  return `mvn test ${mavenArg}`;
}

function runInTerminal(command: string, cwd: string): void {
  const terminal = vscode.window.createTerminal({ name: 'GherkinFlow', cwd });
  terminal.show();
  terminal.sendText(command, true);
}

function executeScenario(scenarioName: string, uri: vscode.Uri): void {
  const ws = getWorkspaceFolder(uri);
  if (!ws) { vscode.window.showErrorMessage('GherkinFlow: Could not determine the workspace root.'); return; }
  runInTerminal(buildScenarioCommand(scenarioName, ws.uri.fsPath), ws.uri.fsPath);
  vscode.window.showInformationMessage(`GherkinFlow: Running scenario "${scenarioName}"`);
}

function executeFeature(uri: vscode.Uri): void {
  const ws = getWorkspaceFolder(uri);
  if (!ws) { vscode.window.showErrorMessage('GherkinFlow: Could not determine the workspace root.'); return; }
  const relativePath = path.relative(ws.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
  runInTerminal(buildFeatureCommand(relativePath, ws.uri.fsPath), ws.uri.fsPath);
  vscode.window.showInformationMessage(`GherkinFlow: Running feature "${path.basename(uri.fsPath)}"`);
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

      const scenarioMatch = line.text.match(SCENARIO_REGEX);
      if (scenarioMatch && scenarioMatch[2].trim().length > 0) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run Scenario',
          command: 'gherkinFlow.runScenarioByName',
          arguments: [scenarioMatch[2].trim(), document.uri]
        }));
      }
    }

    return lenses;
  }
}

export function activate(context: vscode.ExtensionContext) {
  vscode.window.visibleTextEditors.forEach(applyDecorations);

  // Right-click: run scenario at cursor
  const runScenarioAtCursor = vscode.commands.registerTextEditorCommand('gherkinFlow.runScenario', (editor) => {
    if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
      vscode.window.showErrorMessage('GherkinFlow: This command only works with .feature files.');
      return;
    }
    const scenarioName = findScenarioAtPosition(editor.document, editor.selection.active);
    if (!scenarioName) {
      vscode.window.showErrorMessage('GherkinFlow: No Scenario found at cursor position.');
      return;
    }
    executeScenario(scenarioName, editor.document.uri);
  });

  // Right-click: run entire feature file
  const runFeatureAtCursor = vscode.commands.registerTextEditorCommand('gherkinFlow.runFeature', (editor) => {
    if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
      vscode.window.showErrorMessage('GherkinFlow: This command only works with .feature files.');
      return;
    }
    executeFeature(editor.document.uri);
  });

  // CodeLens: run scenario by name
  const runScenarioByName = vscode.commands.registerCommand(
    'gherkinFlow.runScenarioByName',
    (scenarioName: string, uri: vscode.Uri) => executeScenario(scenarioName, uri)
  );

  // CodeLens: run feature by URI
  const runFeatureByUri = vscode.commands.registerCommand(
    'gherkinFlow.runFeatureByUri',
    (uri: vscode.Uri) => executeFeature(uri)
  );

  const codeLens = vscode.languages.registerCodeLensProvider(
    { pattern: '**/*.feature' },
    new GherkinFlowCodeLensProvider()
  );

  context.subscriptions.push(
    runScenarioAtCursor,
    runFeatureAtCursor,
    runScenarioByName,
    runFeatureByUri,
    codeLens,
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
