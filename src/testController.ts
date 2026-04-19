import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { parseFeatureFile } from './featureParser';
import { parseReport, ParsedReport, ParsedScenario } from './reportParser';
import { InlineDecorationProvider, FailedStep } from './inlineDecorationProvider';

const IS_WIN = process.platform === 'win32';
const REPORT_RELATIVE = path.join('target', 'cucumber-report.json');
const OUTLINE_PREFIX = '[OUTLINE]';

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

function buildTagCmd(tag: string, cwd: string): string {
  const { exe, isGradle } = detectExecutable(cwd);
  const safe = tag.replace(/"/g, '\\"');
  const arg = isGradle ? `"-Pcucumber.filter.tags=${safe}"` : `"-Dcucumber.filter.tags=${safe}"`;
  return `${exe} test ${arg}`;
}

function getWorkspacePath(uri: vscode.Uri): string {
  const ws = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  return ws?.uri.fsPath ?? path.dirname(uri.fsPath);
}

// ID scheme:
//   feature  → filePath
//   scenario → filePath::name
//   step     → filePath::name::idx
//   outline  → filePath::[OUTLINE]name
//   example  → filePath::[OUTLINE]name::expandedName
//   ex-step  → filePath::[OUTLINE]name::expandedName::idx

type ItemLevel = 'feature' | 'scenario' | 'step' | 'outline' | 'example';

function itemLevel(item: vscode.TestItem): ItemLevel {
  const parts = item.id.split('::');
  if (parts.length === 1) { return 'feature'; }
  const isOutlineBranch = parts[1].startsWith(OUTLINE_PREFIX);
  if (parts.length === 2) { return isOutlineBranch ? 'outline' : 'scenario'; }
  if (parts.length === 3) { return isOutlineBranch ? 'example' : 'step'; }
  return 'step'; // length 4 = step under example row
}

// Build a regex filter from an outline name by stripping <param> tokens
function outlineFilter(outlineName: string): string {
  return outlineName.replace(/\s*<[^>]+>/g, '').trim();
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
  private readonly scenarioTags  = new Map<string, string[]>();
  private readonly stepLines     = new Map<string, number>(); // stepItemId → line
  private readonly decorations: InlineDecorationProvider;

  constructor(context: vscode.ExtensionContext, decorations: InlineDecorationProvider) {
    this.decorations = decorations;
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
    if (!featureItem) { this._fallback(buildScenarioCmd(scenarioName, getWorkspacePath(uri)), uri); return; }

    let target: vscode.TestItem | undefined;
    // Search direct children (regular scenarios) and outline children (example rows)
    featureItem.children.forEach(child => {
      if (child.label === scenarioName) { target = child; return; }
      if (itemLevel(child) === 'outline') {
        child.children.forEach(example => {
          if (example.label === scenarioName) { target = example; }
        });
      }
    });

    if (!target) { this._fallback(buildScenarioCmd(scenarioName, getWorkspacePath(uri)), uri); return; }
    await this._runHandler(new vscode.TestRunRequest([target]), new vscode.CancellationTokenSource().token);
  }

  public async runFeature(uri: vscode.Uri): Promise<void> {
    const featureItem = this.featureItems.get(uri.fsPath);
    if (!featureItem) {
      const cwd = getWorkspacePath(uri);
      this._fallback(buildFeatureCmd(path.relative(cwd, uri.fsPath).replace(/\\/g, '/'), cwd), uri);
      return;
    }
    await this._runHandler(new vscode.TestRunRequest([featureItem]), new vscode.CancellationTokenSource().token);
  }

  public runByTag(tag: string, uri: vscode.Uri): void {
    this._fallback(buildTagCmd(tag, getWorkspacePath(uri)), uri);
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

      // Group outline-expanded scenarios under outline parent items
      const outlineItems = new Map<string, vscode.TestItem>();

      for (const scenario of parsed.scenarios) {
        if (scenario.outlineName) {
          // Ensure outline parent exists
          let outlineItem = outlineItems.get(scenario.outlineName);
          if (!outlineItem) {
            const outlineId = `${uri.fsPath}::${OUTLINE_PREFIX}${scenario.outlineName}`;
            outlineItem = this.ctrl.createTestItem(outlineId, scenario.outlineName, uri);
            outlineItem.description = 'Scenario Outline';
            featureItem.children.add(outlineItem);
            outlineItems.set(scenario.outlineName, outlineItem);
          }

          // Add the expanded example row under the outline
          const exampleId = `${uri.fsPath}::${OUTLINE_PREFIX}${scenario.outlineName}::${scenario.name}`;
          const exampleItem = this.ctrl.createTestItem(exampleId, scenario.name, uri);
          exampleItem.range = new vscode.Range(scenario.line, 0, scenario.line, 0);
          this._addSteps(exampleItem, exampleId, scenario.steps, uri);
          outlineItem.children.add(exampleItem);

        } else {
          // Regular scenario
          const scenarioId = `${uri.fsPath}::${scenario.name}`;
          const scenarioItem = this.ctrl.createTestItem(scenarioId, scenario.name, uri);
          scenarioItem.range = new vscode.Range(scenario.line, 0, scenario.line, 0);
          this._addSteps(scenarioItem, scenarioId, scenario.steps, uri);
          if (scenario.tags.length > 0) { this.scenarioTags.set(scenarioId, scenario.tags); }
          featureItem.children.add(scenarioItem);
        }
      }

      this.ctrl.items.add(featureItem);
      this.featureItems.set(uri.fsPath, featureItem);
    } catch {
      // ignore unreadable files
    }
  }

  private _addSteps(
    parent: vscode.TestItem,
    parentId: string,
    steps: { keyword: string; text: string; line?: number }[],
    uri: vscode.Uri
  ): void {
    steps.forEach((step, i) => {
      const id = `${parentId}::${i}`;
      const stepItem = this.ctrl.createTestItem(id, `${step.keyword} ${step.text}`, uri);
      if (step.line !== undefined) { this.stepLines.set(id, step.line); }
      parent.children.add(stepItem);
    });
  }

  private _deleteFile(uri: vscode.Uri): void {
    this.ctrl.items.delete(uri.fsPath);
    this.featureItems.delete(uri.fsPath);
    for (const key of this.scenarioTags.keys()) {
      if (key.startsWith(uri.fsPath)) { this.scenarioTags.delete(key); }
    }
    for (const key of this.stepLines.keys()) {
      if (key.startsWith(uri.fsPath)) { this.stepLines.delete(key); }
    }
  }

  private async _runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.ctrl.createTestRun(request);
    const toRun: vscode.TestItem[] = [];

    const collect = (item: vscode.TestItem) => {
      if (itemLevel(item) === 'step') { return; }
      toRun.push(item);
    };

    if (request.include) { request.include.forEach(collect); }
    else                 { this.ctrl.items.forEach(collect); }

    for (const item of toRun) {
      if (token.isCancellationRequested) { break; }

      const cwd = getWorkspacePath(item.uri!);
      const level = itemLevel(item);
      this._markStarted(run, item);

      let command: string;
      switch (level) {
        case 'feature':
          command = buildFeatureCmd(path.relative(cwd, item.uri!.fsPath).replace(/\\/g, '/'), cwd);
          break;
        case 'outline':
          command = buildScenarioCmd(outlineFilter(item.label), cwd);
          break;
        case 'example':
          command = buildScenarioCmd(item.label, cwd);
          break;
        default: // scenario
          command = buildScenarioCmd(item.label, cwd);
      }

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
      proc.stdout?.on('data', (c: Buffer) => run.appendOutput(c.toString().replace(/\r?\n/g, '\r\n')));
      proc.stderr?.on('data', (c: Buffer) => run.appendOutput(c.toString().replace(/\r?\n/g, '\r\n')));
      proc.on('close', () => {
        const report = parseReport(path.join(cwd, REPORT_RELATIVE));
        this._applyResults(run, item, report);
        if (item.uri) { this._applyInlineDecorations(item, report); }
        resolve();
      });
    });
  }

  private _applyResults(run: vscode.TestRun, item: vscode.TestItem, report: ParsedReport): void {
    switch (itemLevel(item)) {
      case 'feature':
        item.children.forEach(child => {
          if (itemLevel(child) === 'outline') { this._applyOutline(run, child, report); }
          else                                { this._applyScenario(run, child, report); }
        });
        break;
      case 'outline':
        this._applyOutline(run, item, report);
        break;
      case 'example':
      case 'scenario':
        this._applyScenario(run, item, report);
        break;
    }
  }

  private _applyOutline(run: vscode.TestRun, outlineItem: vscode.TestItem, report: ParsedReport): void {
    let failed = false;
    let totalMs = 0;

    outlineItem.children.forEach(exampleItem => {
      this._applyScenario(run, exampleItem, report);
      const parsed = report.scenarios.get(exampleItem.label);
      if (parsed) {
        totalMs += parsed.durationMs;
        if (parsed.overallStatus !== 'passed') { failed = true; }
      }
    });

    if (failed) {
      run.failed(outlineItem, new vscode.TestMessage('One or more examples failed'), totalMs);
    } else {
      run.passed(outlineItem, totalMs);
    }
  }

  private _applyScenario(run: vscode.TestRun, item: vscode.TestItem, report: ParsedReport): void {
    const parsed = report.scenarios.get(item.label);
    if (!parsed) { run.skipped(item); item.children.forEach(c => run.skipped(c)); return; }

    const stepItems: vscode.TestItem[] = [];
    item.children.forEach(c => stepItems.push(c));

    stepItems.forEach((stepItem, idx) => {
      const stepResult = parsed.steps[idx];
      if (!stepResult) { run.skipped(stepItem); return; }

      const icon = stepResult.status === 'passed' ? '✓' : stepResult.status === 'failed' ? '✗' : '–';
      const dur  = stepResult.durationMs > 0 ? ` (${stepResult.durationMs}ms)` : '';
      let log = `${icon} ${stepResult.keyword} ${stepResult.name}${dur}\r\n`;
      if (stepResult.errorMessage) {
        log += `\r\n${stepResult.errorMessage.replace(/\r?\n/g, '\r\n')}\r\n`;
      }
      run.appendOutput(log, undefined, stepItem);

      if (stepResult.status === 'passed')      { run.passed(stepItem, stepResult.durationMs); }
      else if (stepResult.status === 'failed') { run.failed(stepItem, new vscode.TestMessage(stepResult.errorMessage ?? 'Step failed'), stepResult.durationMs); }
      else                                     { run.skipped(stepItem); }
    });

    if (parsed.overallStatus === 'passed') {
      run.passed(item, parsed.durationMs);
    } else if (parsed.overallStatus === 'failed') {
      const msg = new vscode.TestMessage(buildFailureMessage(parsed));
      if (item.uri && item.range) { msg.location = new vscode.Location(item.uri, item.range.start); }
      run.failed(item, msg, parsed.durationMs);
    } else {
      run.skipped(item);
    }
  }

  private _collectScenarioItems(item: vscode.TestItem): vscode.TestItem[] {
    const level = itemLevel(item);
    if (level === 'scenario' || level === 'example') { return [item]; }
    const result: vscode.TestItem[] = [];
    item.children.forEach(child => result.push(...this._collectScenarioItems(child)));
    return result;
  }

  private _applyInlineDecorations(item: vscode.TestItem, report: ParsedReport): void {
    if (!item.uri) { return; }
    const failures: FailedStep[] = [];

    for (const scenarioItem of this._collectScenarioItems(item)) {
      const parsed = report.scenarios.get(scenarioItem.label);
      if (!parsed) { continue; }
      const stepItems: vscode.TestItem[] = [];
      scenarioItem.children.forEach(c => stepItems.push(c));
      stepItems.forEach((stepItem, idx) => {
        const stepResult = parsed.steps[idx];
        if (stepResult?.status === 'failed' && stepResult.errorMessage) {
          const line = this.stepLines.get(stepItem.id);
          if (line !== undefined) { failures.push({ line, error: stepResult.errorMessage }); }
        }
      });
    }

    this.decorations.clearFailures(item.uri);
    if (failures.length > 0) { this.decorations.setFailures(item.uri, failures); }
  }

  private _fallback(command: string, uri: vscode.Uri): void {
    const terminal = vscode.window.createTerminal({ name: 'GherkinFlow', cwd: getWorkspacePath(uri) });
    terminal.show();
    terminal.sendText(command, true);
  }
}
