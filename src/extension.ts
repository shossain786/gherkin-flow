import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

const SCENARIO_REGEX = /^\s*(Scenario(?: Outline)?):\s*(.*)$/i;

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
  if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
    return;
  }
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

function buildCommand(scenarioName: string, workspaceFolder: string): string {
  const useGradleWrapper = existsSync(workspaceFolder, 'gradlew');
  const useGradle = existsSync(workspaceFolder, 'gradle');
  const useMavenWrapper = existsSync(workspaceFolder, 'mvnw');
  const useMaven = existsSync(workspaceFolder, 'pom.xml');

  const safeName = scenarioName.replace(/"/g, '\\"');
  const gradleArg = `"-Pcucumber.filter.name=${safeName}"`;
  const mavenArg = `"-Dcucumber.filter.name=${safeName}"`;

  if (useGradleWrapper) { return `./gradlew test ${gradleArg}`; }
  if (useGradle)        { return `gradle test ${gradleArg}`; }
  if (useMavenWrapper)  { return `./mvnw test ${mavenArg}`; }
  if (useMaven)         { return `mvn test ${mavenArg}`; }

  return `mvn test ${mavenArg}`;
}

function executeScenario(scenarioName: string, uri: vscode.Uri): void {
  const workspaceFolder = getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('GherkinFlow: Could not determine the workspace root.');
    return;
  }
  const command = buildCommand(scenarioName, workspaceFolder.uri.fsPath);
  const terminal = vscode.window.createTerminal({ name: 'GherkinFlow', cwd: workspaceFolder.uri.fsPath });
  terminal.show();
  terminal.sendText(command, true);
  vscode.window.showInformationMessage(`GherkinFlow: Running "${scenarioName}"`);
}

class GherkinFlowCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const match = line.text.match(SCENARIO_REGEX);
      if (match && match[2].trim().length > 0) {
        const scenarioName = match[2].trim();
        const range = new vscode.Range(i, 0, i, line.text.length);
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run Scenario',
          command: 'gherkinFlow.runScenarioByName',
          arguments: [scenarioName, document.uri]
        }));
      }
    }
    return lenses;
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Apply decorations to already-open editors
  vscode.window.visibleTextEditors.forEach(applyDecorations);

  const runAtCursor = vscode.commands.registerTextEditorCommand('gherkinFlow.runScenario', (editor) => {
    if (!editor) {
      vscode.window.showErrorMessage('GherkinFlow: No active editor found.');
      return;
    }
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

  const runByName = vscode.commands.registerCommand(
    'gherkinFlow.runScenarioByName',
    (scenarioName: string, uri: vscode.Uri) => executeScenario(scenarioName, uri)
  );

  const codeLens = vscode.languages.registerCodeLensProvider(
    { pattern: '**/*.feature' },
    new GherkinFlowCodeLensProvider()
  );

  context.subscriptions.push(
    runAtCursor,
    runByName,
    codeLens,
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) { applyDecorations(editor); }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        applyDecorations(editor);
      }
    })
  );
}

export function deactivate() {}
