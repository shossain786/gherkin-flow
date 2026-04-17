import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

const SCENARIO_REGEX = /^\s*(Scenario(?: Outline)?):\s*(.*)$/i;

function escapeShellArg(value: string): string {
  const escaped = value.replace(/(["\\$`])/g, '\\$1');
  return `"${escaped}"`;
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

function getWorkspaceFolder(document: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
}

function existsSync(workspaceFolder: string, fileName: string): boolean {
  return fs.existsSync(path.join(workspaceFolder, fileName));
}

function buildCommand(scenarioName: string, workspaceFolder: string): string {
  const useGradleWrapper = existsSync(workspaceFolder, 'gradlew');
  const useGradle = existsSync(workspaceFolder, 'gradle');
  const useMavenWrapper = existsSync(workspaceFolder, 'mvnw');
  const useMaven = existsSync(workspaceFolder, 'pom.xml');

  const escapedName = escapeShellArg(scenarioName);
  const gradleArg = `-Pcucumber.filter.name=${escapedName}`;
  const mavenArg = `-Dcucumber.filter.name=${escapedName}`;

  if (useGradleWrapper) {
    return `./gradlew test ${gradleArg}`;
  }
  if (useGradle) {
    return `gradle test ${gradleArg}`;
  }
  if (useMavenWrapper) {
    return `./mvnw test ${mavenArg}`;
  }
  if (useMaven) {
    return `mvn test ${mavenArg}`;
  }

  return `mvn test ${mavenArg}`;
}

function showError(message: string): void {
  vscode.window.showErrorMessage(`GherkinFlow: ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerTextEditorCommand('gherkinFlow.runScenario', async (editor) => {
    if (!editor) {
      showError('No active editor found.');
      return;
    }

    const document = editor.document;
    if (path.extname(document.fileName).toLowerCase() !== '.feature') {
      showError('This command only works with .feature files.');
      return;
    }

    const position = editor.selection.active;
    const scenarioName = findScenarioAtPosition(document, position);
    if (!scenarioName) {
      showError('Could not detect a Scenario at the cursor position. Place the cursor inside a Scenario block.');
      return;
    }

    const workspaceFolder = getWorkspaceFolder(document);
    if (!workspaceFolder) {
      showError('Could not determine the workspace root to run the command.');
      return;
    }

    const command = buildCommand(scenarioName, workspaceFolder.uri.fsPath);

    const terminal = vscode.window.createTerminal({
      name: 'GherkinFlow',
      cwd: workspaceFolder.uri.fsPath
    });
    terminal.show();
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(`Running Cucumber scenario: ${scenarioName}`);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // noop
}
