import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { parseFeatureFile } from './featureParser';
import { parseReport, ParsedReport, ParsedScenario } from './reportParser';

const IS_WIN = process.platform === 'win32';
const REPORT_RELATIVE = path.join('target', 'cucumber-report.json');

// --- Build tool helpers ---

function existsIn(dir: string, file: string): boolean {
  return fs.existsSync(path.join(dir, file));
}

function detectExecutable(cwd: string): { exe: string; isGradle: boolean } {
  if (IS_WIN && existsIn(cwd, 'gradlew.bat')) { return { exe: 'gradlew.bat', isGradle: true  }; }
  if (!IS_WIN && existsIn(cwd, 'gradlew'))    { return { exe: './gradlew',   isGradle: true  }; }
  if (existsIn(cwd, 'gradle'))                { return { exe: 'gradle',      isGradle: true  }; }
  if (IS_WIN && existsIn(cwd, 'mvnw.cmd'))    { return { exe: 'mvnw.cmd',    isGradle: false }; }
  if (!IS_WIN && existsIn(cwd, 'mvnw'))       { return { exe: './mvnw',      isGradle: false }; }
  return { exe: 'mvn', isGradle: false };
}

function buildScenarioCmd(name: string, cwd: string): string {
  const { exe, isGradle } = detectExecutable(cwd);
  const safe = name.replace(/"/g, '\\"');
  const arg = isGradle ? `"-Pcucumber.filter.name=${safe}"` : `"-Dcucumber.filter.name=${safe}"`;
  return `${exe} test ${arg}`;
}

function buildFeatureCmd(relativePath: string, cwd: string): string {
  const { exe, isGradle } = detectExecutable(cwd);
  const safe = relativePath.replace(/"/g, '\\"');
  const arg = isGradle ? `"-Pcucumber.features=${safe}"` : `"-Dcucumber.features=${safe}"`;
  return `${exe} test ${arg}`;
}

function getWorkspacePath(uri: vscode.Uri): string {
  const ws = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  return ws?.uri.fsPath ?? path.dirname(uri.fsPath);
}

// ID structure:  feature=filePath | scenario=filePath::name | step=filePath::scenarioName::idx
function itemLevel(item: vscode.TestItem): 'feature' | 'scenario' | 'step' {
  const count = (item.id.match(/::/g) ?? []).length;
  if (count === 0) { return 'feature'; }
  if (count === 1) { return 'scenario'; }
  return 'step';
}

// --- Formatters ---

function buildFailureMessage(scenario: ParsedScenario): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**Scenario:** ${scenario.name}\n\n`);
  md.appendMarkdown(`| | Step | Duration |\n|---|---|---|\n`);
  for (const step of scenario.steps) {
    const icon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '–';
    const dur  = step.durationMs > 0 ? `${step.durationMs}ms` : '';
    const name = step.name.replace(/\|/g, '\\|');
    md.appendMarkdown(`| ${icon} | \`${step.keyword} ${name}\` | ${dur} |\n`);
  }
  const failedStep = scenario.steps.find(s => s.status === 'failed');
  if (failedStep?.errorMessage) {
    const msg = failedStep.errorMessage.split('\n').slice(0, 8).join('\n');
    md.appendMarkdown(`\n**Error:**\n\`\`\`\n${msg}\n\`\`\`\n`);
  }
  return md;
}

// --- GherkinTestController ---

export class GherkinTestController {
  private readonly ctrl: vscode.TestController;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly featureItems = new Map<string, vscode.TestItem>();

  constructor(context: vscode.ExtensionContext) {
    this.ctrl = vscode.tests.createTestController('gherkinFlow', 'Gherkin Flow');
    context.subscriptions.push(this.ctrl);

    this.ctrl.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (req, token) => this._runHandler(req, token),
      true
    );

    this.ctrl.resolveHandler = async (item) => {
      if (!item) { await this._discoverAll(); }
    };

    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    this.watcher.onDidCreate(uri => this._loadFile(uri));
    this.watcher.onDidChange(uri => this._loadFile(uri));
    this.watcher.onDidDelete(uri => this._deleteFile(uri));
    context.subscriptions.push(this.watcher);

    this._discoverAll();
  }

  // Public API for CodeLens
  public async runScenario(scenarioName: string, uri: vscode.Uri): Promise<void> {
    const featureItem = this.featureItems.get(uri.fsPath);
    if (!featureItem) {
      this._fallback(buildScenarioCmd(scenarioName, getWorkspacePath(uri)), uri);
      return;
    }
    let target: vscode.TestItem | undefined;
    featureItem.children.forEach(child => {
      if (child.label === scenarioName) { target = child; }
    });
    if (!target) {
      this._fallback(buildScenarioCmd(scenarioName, getWorkspacePath(uri)), uri);
      return;
    }
    await this._runHandler(
      new vscode.TestRunRequest([target]),
      new vscode.CancellationTokenSource().token
    );
  }

  public async runFeature(uri: vscode.Uri): Promise<void> {
    const featureItem = this.featureItems.get(uri.fsPath);
    if (!featureItem) {
      const cwd = getWorkspacePath(uri);
      this._fallback(buildFeatureCmd(path.relative(cwd, uri.fsPath).replace(/\\/g, '/'), cwd), uri);
      return;
    }
    await this._runHandler(
      new vscode.TestRunRequest([featureItem]),
      new vscode.CancellationTokenSource().token
    );
  }

  // --- Private ---

  private async _discoverAll(): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');
    for (const uri of uris) { await this._loadFile(uri); }
  }

  private async _loadFile(uri: vscode.Uri): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const parsed = parseFeatureFile(doc);
      if (!parsed) { return; }

      this.ctrl.items.delete(uri.fsPath);
      const featureItem = this.ctrl.createTestItem(uri.fsPath, parsed.name, uri);
      featureItem.range = new vscode.Range(parsed.line, 0, parsed.line, 0);

      for (const scenario of parsed.scenarios) {
        const scenarioId = `${uri.fsPath}::${scenario.name}`;
        const scenarioItem = this.ctrl.createTestItem(scenarioId, scenario.name, uri);
        scenarioItem.range = new vscode.Range(scenario.line, 0, scenario.line, 0);

        // Add each step as a child TestItem
        for (let i = 0; i < scenario.steps.length; i++) {
          const step = scenario.steps[i];
          const stepId = `${scenarioId}::${i}`;
          const label  = `${step.keyword} ${step.text}`;
          const stepItem = this.ctrl.createTestItem(stepId, label, uri);
          stepItem.range = new vscode.Range(step.line, 0, step.line, 0);
          scenarioItem.children.add(stepItem);
        }

        featureItem.children.add(scenarioItem);
      }

      this.ctrl.items.add(featureItem);
      this.featureItems.set(uri.fsPath, featureItem);
    } catch {
      // ignore unreadable files
    }
  }

  private _deleteFile(uri: vscode.Uri): void {
    this.ctrl.items.delete(uri.fsPath);
    this.featureItems.delete(uri.fsPath);
  }

  private async _runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.ctrl.createTestRun(request);
    const toRun: vscode.TestItem[] = [];

    // Collect only feature/scenario level items to run (not individual steps)
    const collect = (item: vscode.TestItem) => {
      const level = itemLevel(item);
      if (level === 'step') { return; }
      toRun.push(item);
    };

    if (request.include) {
      request.include.forEach(collect);
    } else {
      this.ctrl.items.forEach(collect);
    }

    for (const item of toRun) {
      if (token.isCancellationRequested) { break; }

      const cwd = getWorkspacePath(item.uri!);
      const level = itemLevel(item);

      // Mark everything under this item as started
      this._markStarted(run, item);

      const command = level === 'feature'
        ? buildFeatureCmd(path.relative(cwd, item.uri!.fsPath).replace(/\\/g, '/'), cwd)
        : buildScenarioCmd(item.label, cwd);

      await this._execute(run, item, cwd, command, token);
    }

    run.end();
  }

  private _markStarted(run: vscode.TestRun, item: vscode.TestItem): void {
    run.started(item);
    item.children.forEach(child => this._markStarted(run, child));
  }

  private async _execute(
    run: vscode.TestRun,
    item: vscode.TestItem,
    cwd: string,
    command: string,
    token: vscode.CancellationToken
  ): Promise<void> {
    return new Promise(resolve => {
      run.appendOutput(`\r\n\u25b6 ${command}\r\n\r\n`);

      const proc = spawn(command, [], { cwd, shell: true, env: { ...process.env } });

      token.onCancellationRequested(() => { proc.kill(); resolve(); });

      proc.stdout?.on('data', (chunk: Buffer) => {
        run.appendOutput(chunk.toString().replace(/\r?\n/g, '\r\n'));
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        run.appendOutput(chunk.toString().replace(/\r?\n/g, '\r\n'));
      });

      proc.on('close', () => {
        const report = parseReport(path.join(cwd, REPORT_RELATIVE));
        this._applyResults(run, item, report);
        resolve();
      });
    });
  }

  private _applyResults(run: vscode.TestRun, item: vscode.TestItem, report: ParsedReport): void {
    const level = itemLevel(item);
    if (level === 'feature') {
      item.children.forEach(scenarioItem => this._applyScenario(run, scenarioItem, report));
    } else if (level === 'scenario') {
      this._applyScenario(run, item, report);
    }
  }

  private _applyScenario(run: vscode.TestRun, item: vscode.TestItem, report: ParsedReport): void {
    const parsed = report.scenarios.get(item.label);
    if (!parsed) {
      run.skipped(item);
      item.children.forEach(c => run.skipped(c));
      return;
    }

    // Apply per-step results
    const stepItems: vscode.TestItem[] = [];
    item.children.forEach(c => stepItems.push(c));

    stepItems.forEach((stepItem, idx) => {
      const stepResult = parsed.steps[idx];
      if (!stepResult) { run.skipped(stepItem); return; }

      const location = (stepItem.uri && stepItem.range)
        ? new vscode.Location(stepItem.uri, stepItem.range.start)
        : undefined;

      // Associate output with this specific step — visible when step is clicked in Test Results
      const icon = stepResult.status === 'passed' ? '✓' : stepResult.status === 'failed' ? '✗' : '–';
      const dur  = stepResult.durationMs > 0 ? ` (${stepResult.durationMs}ms)` : '';
      let stepLog = `${icon} ${stepResult.keyword} ${stepResult.name}${dur}\r\n`;
      if (stepResult.errorMessage) {
        stepLog += `\r\n${stepResult.errorMessage.replace(/\r?\n/g, '\r\n')}\r\n`;
      }
      run.appendOutput(stepLog, location, stepItem);

      if (stepResult.status === 'passed') {
        run.passed(stepItem, stepResult.durationMs);
      } else if (stepResult.status === 'failed') {
        const msg = new vscode.TestMessage(stepResult.errorMessage ?? 'Step failed');
        if (location) { msg.location = location; }
        run.failed(stepItem, msg, stepResult.durationMs);
      } else {
        run.skipped(stepItem);
      }
    });

    // Scenario-level status
    if (parsed.overallStatus === 'passed') {
      run.passed(item, parsed.durationMs);
    } else if (parsed.overallStatus === 'failed') {
      const msg = new vscode.TestMessage(buildFailureMessage(parsed));
      if (item.uri && item.range) {
        msg.location = new vscode.Location(item.uri, item.range.start);
      }
      run.failed(item, msg, parsed.durationMs);
    } else {
      run.skipped(item);
    }
  }

  private _fallback(command: string, uri: vscode.Uri): void {
    const terminal = vscode.window.createTerminal({ name: 'GherkinFlow', cwd: getWorkspacePath(uri) });
    terminal.show();
    terminal.sendText(command, true);
  }
}
