import * as vscode from 'vscode';
import * as path from 'path';
import { StepDefinitionIndex } from './stepDefinitionProvider';
import { GherkinTestController } from './testController';

interface Def { rawPattern: string; pattern: RegExp; }

interface AffectedScenario {
  featureUri: vscode.Uri;
  scenarioName: string;
  featureName: string;
  item?: vscode.TestItem;
}

export class ImpactAnalyzer {
  // Baseline snapshot of patterns per step file, keyed by lowercase fsPath.
  // Built once from the initial scan, then kept up-to-date after every change.
  // Diffing this against the post-change index tells us exactly what moved.
  private readonly _baseline = new Map<string, Def[]>();

  constructor(
    private readonly _index: StepDefinitionIndex,
    private readonly _controller: GherkinTestController,
    context: vscode.ExtensionContext
  ) {
    // Seed the baseline from the already-completed initial scan so the very
    // first user-triggered change has something meaningful to diff against.
    for (const filePath of _index.getDefinitionFiles()) {
      this._baseline.set(filePath.toLowerCase(), _index.getDefsForFile(filePath));
    }

    // The index fires onDidChange(uri) AFTER it has reloaded the file.
    // At that point getDefsForFile returns the NEW state, while _baseline
    // still holds the PREVIOUS state — exactly the diff we need.
    _index.onDidChange(uri => {
      if (!uri) { return; }
      const key  = uri.fsPath.toLowerCase();
      const old  = this._baseline.get(key) ?? [];
      const next = _index.getDefsForFile(uri.fsPath);

      // Always keep baseline current so the next change diffs from here.
      this._baseline.set(key, next);

      void this._analyze(uri, old, next);
    });
  }

  private async _analyze(uri: vscode.Uri, oldDefs: Def[], newDefs: Def[]): Promise<void> {
    const newRaw = new Set(newDefs.map(d => d.rawPattern));
    const oldRaw = new Set(oldDefs.map(d => d.rawPattern));

    const removed = oldDefs.filter(d => !newRaw.has(d.rawPattern));
    const added   = newDefs.filter(d => !oldRaw.has(d.rawPattern));
    if (removed.length === 0 && added.length === 0) { return; }

    const changedPatterns = [
      ...removed.map(d => d.pattern),
      ...added.map(d => d.pattern),
    ];
    const affected = this._findAffectedScenarios(changedPatterns);
    if (affected.length === 0) { return; }

    const fileName  = path.basename(uri.fsPath);
    const isBreaking = removed.length > 0;
    const n         = affected.length;
    const plural    = n === 1 ? 'scenario' : 'scenarios';
    const removedNote = isBreaking
      ? ` (${removed.length} pattern${removed.length > 1 ? 's' : ''} removed)`
      : '';
    const msg = isBreaking
      ? `⚡ ${n} ${plural} affected by step changes in ${fileName}${removedNote}`
      : `${n} ${plural} now covered by new steps in ${fileName}`;

    const action = isBreaking
      ? await vscode.window.showWarningMessage(msg, 'Run Impacted', 'Show List')
      : await vscode.window.showInformationMessage(msg, 'Run Impacted', 'Show List');

    if (action === 'Run Impacted') {
      const items = affected.map(a => a.item).filter((i): i is vscode.TestItem => !!i);
      if (items.length > 0) {
        await this._controller.runItems(items);
      } else {
        for (const a of affected) {
          await this._controller.runScenario(a.scenarioName, a.featureUri);
        }
      }
    } else if (action === 'Show List') {
      await this._showList(affected);
    }
  }

  private _findAffectedScenarios(patterns: RegExp[]): AffectedScenario[] {
    const affected: AffectedScenario[] = [];
    const seen = new Set<string>();

    this._controller.featureItems.forEach((featureItem, fsPath) => {
      const featureUri  = featureItem.uri!;
      const featureName = featureItem.label;

      const checkItem = (item: vscode.TestItem) => {
        const key = `${fsPath}::${item.label}`;
        if (seen.has(key)) { return; }

        const steps: vscode.TestItem[] = [];
        item.children.forEach(c => steps.push(c));

        const matches = steps.some(stepItem => {
          // Step item label is "Keyword step text" — strip keyword before matching.
          const text = stepItem.label.replace(/^(Given|When|Then|And|But|\*)\s+/i, '');
          return patterns.some(p => p.test(text));
        });

        if (matches) {
          seen.add(key);
          affected.push({ featureUri, scenarioName: item.label, featureName, item });
        }
      };

      featureItem.children.forEach(child => {
        if (child.description === 'Scenario Outline') {
          child.children.forEach(example => checkItem(example));
        } else {
          checkItem(child);
        }
      });
    });

    return affected;
  }

  private async _showList(affected: AffectedScenario[]): Promise<void> {
    type Item = vscode.QuickPickItem & { scenario: AffectedScenario };

    const items: Item[] = affected.map(a => ({
      label: a.scenarioName,
      description: a.featureName,
      detail: vscode.workspace.asRelativePath(a.featureUri),
      scenario: a,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${affected.length} affected scenario${affected.length > 1 ? 's' : ''} — select to navigate`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) { return; }

    const doc    = await vscode.workspace.openTextDocument(picked.scenario.featureUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos    = picked.scenario.item?.range?.start ?? new vscode.Position(0, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}
