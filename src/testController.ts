import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { parseFeatureFile } from './featureParser';
import { parseReport, ParsedReport, ParsedScenario } from './reportParser';
import { InlineDecorationProvider, FailedStep } from './inlineDecorationProvider';
import { detectProject, ProjectConfig, SpawnArgs } from './projectDetector';

const OUTLINE_PREFIX = '[OUTLINE]';

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
  private readonly featureItems   = new Map<string, vscode.TestItem>();
  private readonly scenarioTags   = new Map<string, string[]>();
  private readonly stepLines      = new Map<string, number>();
  // keyed featureUri → Map<itemId, TestItem> so partial runs merge instead of replace
  private readonly _failedScenarios = new Map<string, Map<string, vscode.TestItem>>();
  private readonly _lastStatus = new Map<string, 'passed' | 'failed'>();
  private readonly _onDidRunTests = new vscode.EventEmitter<vscode.Uri>();
  public  readonly onDidRunTests  = this._onDidRunTests.event;
  private readonly _onDidChangeRunning = new vscode.EventEmitter<boolean>();
  public  readonly onDidChangeRunning  = this._onDidChangeRunning.event;
  private _activeCts: vscode.CancellationTokenSource | undefined;
  private readonly decorations: InlineDecorationProvider;
  private readonly _configCache = new Map<string, ProjectConfig>();

  constructor(context: vscode.ExtensionContext, decorations: InlineDecorationProvider) {
    this.decorations = decorations;
    this.ctrl = vscode.tests.createTestController('gherkinFlow', 'Gherkin Flow');
    context.subscriptions.push(this.ctrl);

    this.ctrl.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      async (req, token) => {
        this._onDidChangeRunning.fire(true);
        try { await this._runHandler(req, token); }
        finally { this._onDidChangeRunning.fire(false); }
      },
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

    this._discoverAll();  // eager discovery on activation
  }

  public getConfig(uri: vscode.Uri): ProjectConfig {
    const dir = path.dirname(uri.fsPath);
    let cfg = this._configCache.get(dir);
    if (!cfg) { cfg = detectProject(dir); this._configCache.set(dir, cfg); }
    return cfg;
  }

  public get isRunning(): boolean { return this._activeCts !== undefined; }

  public stopRun(): void {
    this._activeCts?.cancel();
  }

  public getScenarioStatus(uri: vscode.Uri, name: string): 'passed' | 'failed' | undefined {
    return this._lastStatus.get(`${uri.fsPath}::${name}`);
  }

  public getFailedScenarios(uri: vscode.Uri): vscode.TestItem[] {
    return [...(this._failedScenarios.get(uri.fsPath)?.values() ?? [])];
  }

  public async rerunFailed(uri: vscode.Uri): Promise<void> {
    const failed = this.getFailedScenarios(uri);
    if (failed.length === 0) { return; }
    await this._launchRun(new vscode.TestRunRequest(failed));
  }

  // Public API for CodeLens
  public async runScenario(scenarioName: string, uri: vscode.Uri): Promise<void> {
    const config = this.getConfig(uri);
    const cwd = config.projectRoot;
    const featRel = path.relative(cwd, uri.fsPath).replace(/\\/g, '/');
    const featureItem = this.featureItems.get(uri.fsPath);
    if (!featureItem) { this._fallback(config.buildScenarioArgs(scenarioName, featRel), uri); return; }

    let target: vscode.TestItem | undefined;
    featureItem.children.forEach(child => {
      if (child.label === scenarioName) { target = child; return; }
      if (itemLevel(child) === 'outline') {
        child.children.forEach(example => {
          if (example.label === scenarioName) { target = example; }
        });
      }
    });

    if (!target) { this._fallback(config.buildScenarioArgs(scenarioName, featRel), uri); return; }
    await this._launchRun(new vscode.TestRunRequest([target]));
  }

  public async runFeature(uri: vscode.Uri): Promise<void> {
    const featureItem = this.featureItems.get(uri.fsPath);
    if (!featureItem) {
      const config = this.getConfig(uri);
      this._fallback(config.buildFeatureArgs(path.relative(config.projectRoot, uri.fsPath).replace(/\\/g, '/')), uri);
      return;
    }
    await this._launchRun(new vscode.TestRunRequest([featureItem]));
  }

  public async runByTag(tag: string, uri: vscode.Uri): Promise<void> {
    const config = this.getConfig(uri);

    // Collect all test items that carry this tag so we can mark them in Test Explorer.
    const tagged: vscode.TestItem[] = [];
    this.ctrl.items.forEach(featureItem => {
      featureItem.children.forEach(child => {
        const tags = this.scenarioTags.get(child.id) ?? [];
        if (tags.includes(tag)) { tagged.push(child); }
      });
    });

    if (tagged.length === 0) {
      // Feature files not yet loaded — fall back to terminal only.
      this._fallback(config.buildTagArgs(tag), uri);
      return;
    }

    const spawnArgs = config.buildTagArgs(tag);
    const request  = new vscode.TestRunRequest(tagged);
    await this._launchCustomRun(request, async (run, token) => {
      for (const item of tagged) { this._markStarted(run, item); }

      const cwd     = config.projectRoot;
      const quoted  = (s: string) => (/\s/.test(s) || s.startsWith('-D') || s.startsWith('-P'))
        ? `"${s.replace(/"/g, '\\"')}"` : s;
      const cmdStr  = [spawnArgs.file, ...spawnArgs.args].map(quoted).join(' ');
      run.appendOutput(`\r\n▶ ${cmdStr}\r\n\r\n`);

      await new Promise<void>(resolve => {
        const proc = spawn(cmdStr, [], { cwd, shell: true, env: { ...process.env } });
        token.onCancellationRequested(() => { proc.kill('SIGTERM'); resolve(); });
        proc.on('error', err => { run.appendOutput(`\r\nFailed to start: ${err.message}\r\n`); resolve(); });
        proc.stdout?.on('data', (c: Buffer) => run.appendOutput(c.toString().replace(/\r?\n/g, '\r\n')));
        proc.stderr?.on('data', (c: Buffer) => run.appendOutput(c.toString().replace(/\r?\n/g, '\r\n')));
        proc.on('close', () => {
          const reportPath = path.join(cwd, config.reportPath);
          const report = parseReport(reportPath);
          if (report.scenarios.size === 0 && !fs.existsSync(reportPath)) {
            vscode.window.showWarningMessage(
              `GherkinFlow: Report not found at "${config.reportPath}". Add the JSON reporter plugin to your Cucumber options.`
            );
          }

          const failures: vscode.TestItem[] = [];
          for (const item of tagged) { this._applyResults(run, item, report, failures); }

          // Merge failures and fire events per feature file
          const byFeature = new Map<string, vscode.TestItem[]>();
          for (const item of tagged) {
            const fp = item.uri!.fsPath;
            if (!byFeature.has(fp)) { byFeature.set(fp, []); }
            byFeature.get(fp)!.push(item);
          }
          for (const [fp, items] of byFeature) {
            if (!this._failedScenarios.has(fp)) { this._failedScenarios.set(fp, new Map()); }
            const featureFailures = this._failedScenarios.get(fp)!;
            for (const s of items) {
              if (failures.includes(s)) { featureFailures.set(s.id, s); }
              else                      { featureFailures.delete(s.id); }
            }
            // Apply inline decorations using the feature-level item so all
            // scenario results in the same file are written in one pass.
            const featureItem = this.featureItems.get(fp);
            if (featureItem) { this._applyInlineDecorations(featureItem, report); }
            this._onDidRunTests.fire(vscode.Uri.file(fp));
          }
          resolve();
        });
      });
    });
  }

  public dryRun(uri: vscode.Uri): void {
    const config = this.getConfig(uri);
    const featRel = path.relative(config.projectRoot, uri.fsPath).replace(/\\/g, '/');
    this._fallback(config.buildDryRunArgs(featRel), uri);
  }

  // Cancels any active run, then starts a new one — ensures only one run at a time.
  private async _launchRun(request: vscode.TestRunRequest): Promise<void> {
    if (this._activeCts) {
      this._activeCts.cancel();
      this._activeCts.dispose();
      this._activeCts = undefined;
    }
    const cts = new vscode.CancellationTokenSource();
    this._activeCts = cts;
    this._onDidChangeRunning.fire(true);
    try {
      await this._runHandler(request, cts.token);
    } finally {
      cts.dispose();
      this._activeCts = undefined;
      this._onDidChangeRunning.fire(false);
    }
  }

  private async _launchCustomRun(
    request: vscode.TestRunRequest,
    runner: (run: vscode.TestRun, token: vscode.CancellationToken) => Promise<void>
  ): Promise<void> {
    if (this._activeCts) {
      this._activeCts.cancel();
      this._activeCts.dispose();
      this._activeCts = undefined;
    }
    const cts = new vscode.CancellationTokenSource();
    this._activeCts = cts;
    this._onDidChangeRunning.fire(true);
    const run = this.ctrl.createTestRun(request);
    try {
      await runner(run, cts.token);
    } finally {
      run.end();
      cts.dispose();
      this._activeCts = undefined;
      this._onDidChangeRunning.fire(false);
    }
  }

  // --- Private ---

  private _discovered = false;
  private async _discoverAll(): Promise<void> {
    if (this._discovered) { return; }
    this._discovered = true;
    const uris = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');
    for (const uri of uris) { await this._loadFile(uri); }
  }

  private async _loadFile(uri: vscode.Uri): Promise<void> {
    this._deleteFile(uri);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const parsed = parseFeatureFile(doc);
      if (!parsed) { return; }

      const featureItem = this.ctrl.createTestItem(uri.fsPath, parsed.name, uri);
      featureItem.range = new vscode.Range(parsed.line, 0, parsed.line, 0);

      // Group outline-expanded scenarios under outline parent items
      const outlineItems    = new Map<string, vscode.TestItem>();
      const outlineCounters = new Map<string, number>();
      let scenarioIdx = 0;

      for (const scenario of parsed.scenarios) {
        const idxStr = String(scenarioIdx++).padStart(5, '0');
        if (scenario.outlineName) {
          // Ensure outline parent exists
          let outlineItem = outlineItems.get(scenario.outlineName);
          if (!outlineItem) {
            const outlineId = `${uri.fsPath}::${OUTLINE_PREFIX}${scenario.outlineName}`;
            outlineItem = this.ctrl.createTestItem(outlineId, scenario.outlineName, uri);
            outlineItem.description = 'Scenario Outline';
            outlineItem.sortText = idxStr;
            featureItem.children.add(outlineItem);
            outlineItems.set(scenario.outlineName, outlineItem);
            outlineCounters.set(scenario.outlineName, 0);
          }

          // Add the expanded example row under the outline
          const exampleIdx = outlineCounters.get(scenario.outlineName)!;
          outlineCounters.set(scenario.outlineName, exampleIdx + 1);
          const exampleId = `${uri.fsPath}::${OUTLINE_PREFIX}${scenario.outlineName}::${scenario.name}`;
          const exampleItem = this.ctrl.createTestItem(exampleId, scenario.name, uri);
          exampleItem.range = new vscode.Range(scenario.line, 0, scenario.line, 0);
          exampleItem.sortText = String(exampleIdx).padStart(5, '0');
          this._addSteps(exampleItem, exampleId, scenario.steps, uri);
          outlineItem.children.add(exampleItem);

        } else {
          // Regular scenario
          const scenarioId = `${uri.fsPath}::${scenario.name}`;
          const scenarioItem = this.ctrl.createTestItem(scenarioId, scenario.name, uri);
          scenarioItem.range = new vscode.Range(scenario.line, 0, scenario.line, 0);
          scenarioItem.sortText = idxStr;
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
      stepItem.sortText = String(i).padStart(5, '0');
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

      const config  = this.getConfig(item.uri!);
      const cwd     = config.projectRoot;
      const level   = itemLevel(item);
      this._markStarted(run, item);

      const featRel = path.relative(cwd, item.uri!.fsPath).replace(/\\/g, '/');
      let spawnArgs: SpawnArgs;
      switch (level) {
        case 'feature':
          spawnArgs = config.buildFeatureArgs(featRel);
          break;
        case 'outline':
          spawnArgs = config.buildScenarioArgs(outlineFilter(item.label), featRel);
          break;
        case 'example':
          spawnArgs = config.buildScenarioArgs(item.label, featRel);
          break;
        default:
          spawnArgs = config.buildScenarioArgs(item.label, featRel);
      }

      await this._execute(run, item, config, spawnArgs, token);
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
    config: ProjectConfig,
    spawnArgs: SpawnArgs,
    token: vscode.CancellationToken
  ): Promise<void> {
    const cwd = config.projectRoot;
    return new Promise(resolve => {
      // Quote args that contain spaces so the shell treats them as single tokens.
      const quoted = (s: string) => /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
      const cmdStr = [spawnArgs.file, ...spawnArgs.args].map(quoted).join(' ');
      run.appendOutput(`\r\n▶ ${cmdStr}\r\n\r\n`);
      const proc = spawn(cmdStr, [], { cwd, shell: true, env: { ...process.env } });
      token.onCancellationRequested(() => { proc.kill('SIGTERM'); resolve(); });
      proc.on('error', (err) => {
        run.appendOutput(`\r\nFailed to start process: ${err.message}\r\n`);
        resolve();
      });
      proc.stdout?.on('data', (c: Buffer) => run.appendOutput(c.toString().replace(/\r?\n/g, '\r\n')));
      proc.stderr?.on('data', (c: Buffer) => run.appendOutput(c.toString().replace(/\r?\n/g, '\r\n')));
      proc.on('close', () => {
        const reportPath = path.join(cwd, config.reportPath);
        const report = parseReport(reportPath);
        if (report.scenarios.size === 0 && !fs.existsSync(reportPath)) {
          vscode.window.showWarningMessage(
            `GherkinFlow: Report not found at "${config.reportPath}". Add the JSON reporter plugin to your Cucumber options.`
          );
        }
        const failures: vscode.TestItem[] = [];
        this._applyResults(run, item, report, failures);
        if (item.uri) {
          // Merge this run's results into the persistent failure map so that
          // running a single scenario doesn't wipe failures from other scenarios.
          const featureUri = item.uri.fsPath;
          if (!this._failedScenarios.has(featureUri)) {
            this._failedScenarios.set(featureUri, new Map());
          }
          const featureFailures = this._failedScenarios.get(featureUri)!;
          for (const s of this._collectScenarioItems(item)) {
            if (failures.includes(s)) { featureFailures.set(s.id, s); }
            else                      { featureFailures.delete(s.id); }
          }
          this._onDidRunTests.fire(item.uri);
          this._applyInlineDecorations(item, report);
        }
        resolve();
      });
    });
  }

  private _applyResults(run: vscode.TestRun, item: vscode.TestItem, report: ParsedReport, failures: vscode.TestItem[]): void {
    switch (itemLevel(item)) {
      case 'feature':
        item.children.forEach(child => {
          if (itemLevel(child) === 'outline') { this._applyOutline(run, child, report, failures); }
          else                                { this._applyScenario(run, child, report, failures); }
        });
        break;
      case 'outline':
        this._applyOutline(run, item, report, failures);
        break;
      case 'example':
      case 'scenario':
        this._applyScenario(run, item, report, failures);
        break;
    }
  }

  private _reportKey(item: vscode.TestItem): string {
    const featureItem = item.uri ? this.featureItems.get(item.uri.fsPath) : undefined;
    return featureItem ? `${featureItem.label}::${item.label}` : item.label;
  }

  private _applyOutline(run: vscode.TestRun, outlineItem: vscode.TestItem, report: ParsedReport, failures: vscode.TestItem[]): void {
    let failed = false;
    let totalMs = 0;

    outlineItem.children.forEach(exampleItem => {
      this._applyScenario(run, exampleItem, report, failures);
      const parsed = report.scenarios.get(this._reportKey(exampleItem));
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

  private _applyScenario(run: vscode.TestRun, item: vscode.TestItem, report: ParsedReport, failures: vscode.TestItem[]): void {
    const parsed = report.scenarios.get(this._reportKey(item));
    if (!parsed) { run.skipped(item); item.children.forEach(c => run.skipped(c)); return; }

    const stepItems: vscode.TestItem[] = [];
    item.children.forEach(c => stepItems.push(c));

    // Some Cucumber JSON reporters omit background steps from scenario elements.
    // If the JSON has fewer steps than our test items, offset so scenario steps align.
    const bgOffset = Math.max(0, stepItems.length - parsed.steps.length);

    stepItems.forEach((stepItem, idx) => {
      const stepResult = parsed.steps[idx - bgOffset];
      if (idx < bgOffset) { run.skipped(stepItem); return; }
      if (!stepResult) { run.skipped(stepItem); return; }

      const icon = stepResult.status === 'passed' ? '✓' : stepResult.status === 'failed' ? '✗' : '–';
      const dur  = stepResult.durationMs > 0 ? ` (${stepResult.durationMs}ms)` : '';
      let log = `${icon} ${stepResult.keyword} ${stepResult.name}${dur}\r\n`;
      if (stepResult.output && stepResult.output.length > 0) {
        log += stepResult.output.map(o => o.replace(/\r?\n/g, '\r\n')).join('\r\n') + '\r\n';
      }
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
      if (item.uri) { this._lastStatus.set(`${item.uri.fsPath}::${item.label}`, 'passed'); }
    } else if (parsed.overallStatus === 'failed') {
      const msg = new vscode.TestMessage(buildFailureMessage(parsed));
      if (item.uri && item.range) { msg.location = new vscode.Location(item.uri, item.range.start); }
      run.failed(item, msg, parsed.durationMs);
      failures.push(item);
      if (item.uri) { this._lastStatus.set(`${item.uri.fsPath}::${item.label}`, 'failed'); }
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

  private _terminal: vscode.Terminal | undefined;

  private _fallback(spawnArgs: SpawnArgs, uri: vscode.Uri): void {
    if (!this._terminal || this._terminal.exitStatus !== undefined) {
      this._terminal = vscode.window.createTerminal({ name: 'GherkinFlow', cwd: this.getConfig(uri).projectRoot });
    }
    this._terminal.show();
    // Quote args that contain spaces or start with -D/-P so PowerShell/cmd.exe
    // don't split system properties (e.g. -Dcucumber.features=...) at the dot.
    const quoted = (s: string) => (/\s/.test(s) || s.startsWith('-D') || s.startsWith('-P'))
      ? `"${s.replace(/"/g, '\\"')}"` : s;
    this._terminal.sendText([spawnArgs.file, ...spawnArgs.args].map(quoted).join(' '), true);
  }
}
