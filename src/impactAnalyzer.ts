import * as vscode from 'vscode';
import * as path from 'path';
import { StepDefinitionIndex } from './stepDefinitionProvider';
import { GherkinTestController } from './testController';

const STEP_FILE_EXTS = new Set(['java', 'ts', 'js', 'py']);

interface Def { rawPattern: string; pattern: RegExp; }

interface AffectedScenario {
  featureUri: vscode.Uri;
  scenarioName: string;
  featureName: string;
  item?: vscode.TestItem;
}

export class ImpactAnalyzer {
  // Stores defs captured just before a step file is written to disk.
  // Keyed by normalised lowercase fsPath so Windows drive-letter case
  // differences between VS Code URIs and OS paths never cause a miss.
  private readonly _pendingSaves = new Map<string, Def[]>();

  constructor(
    private readonly _index: StepDefinitionIndex,
    private readonly _controller: GherkinTestController,
    context: vscode.ExtensionContext
  ) {
    context.subscriptions.push(
      // onWillSaveTextDocument fires BEFORE the file hits disk, which guarantees
      // we capture old defs before the OS file-watcher can reload the index.
      // onDidSaveTextDocument can fire AFTER the watcher on fast file systems
      // (especially for .ts/.js on Windows), making it unreliable here.
      vscode.workspace.onWillSaveTextDocument(e => {
        const ext = path.extname(e.document.fileName).slice(1).toLowerCase();
        if (!STEP_FILE_EXTS.has(ext)) { return; }
        const key = e.document.uri.fsPath.toLowerCase();
        // Only capture the very first snapshot — don't overwrite if a rapid
        // double-save fires before the watcher processes the first write.
        if (!this._pendingSaves.has(key)) {
          this._pendingSaves.set(key, this._index.getDefsForFile(e.document.uri.fsPath));
        }
      })
    );

    // When the index finishes reloading a file, compare with the pre-save snapshot.
    _index.onDidChange(uri => {
      if (!uri) { return; }
      const key = uri.fsPath.toLowerCase();
      const oldDefs = this._pendingSaves.get(key);
      if (oldDefs === undefined) { return; }
      this._pendingSaves.delete(key);
      const newDefs = this._index.getDefsForFile(uri.fsPath);
      void this._analyze(uri, oldDefs, newDefs);
    });
  }

  private async _analyze(uri: vscode.Uri, oldDefs: Def[], newDefs: Def[]): Promise<void> {
    const newRaw  = new Set(newDefs.map(d => d.rawPattern));
    const oldRaw  = new Set(oldDefs.map(d => d.rawPattern));

    const removed = oldDefs.filter(d => !newRaw.has(d.rawPattern));
    const added   = newDefs.filter(d => !oldRaw.has(d.rawPattern));

    if (removed.length === 0 && added.length === 0) { return; }

    // Find affected scenarios using the changed patterns.
    const changedPatterns = [
      ...removed.map(d => d.pattern),
      ...added.map(d => d.pattern),
    ];
    const affected = this._findAffectedScenarios(changedPatterns);
    if (affected.length === 0) { return; }

    const fileName = path.basename(uri.fsPath);
    const isBreaking = removed.length > 0;
    const plural = affected.length === 1 ? 'scenario' : 'scenarios';

    const msg = isBreaking
      ? `⚡ ${affected.length} ${plural} affected by step changes in ${fileName} (${removed.length} pattern${removed.length > 1 ? 's' : ''} removed)`
      : `${affected.length} ${plural} now covered by new steps in ${fileName}`;

    const action = isBreaking
      ? await vscode.window.showWarningMessage(msg, 'Run Impacted', 'Show List')
      : await vscode.window.showInformationMessage(msg, 'Run Impacted', 'Show List');

    if (action === 'Run Impacted') {
      const items = affected.map(a => a.item).filter((i): i is vscode.TestItem => !!i);
      if (items.length > 0) {
        await this._controller.runItems(items);
      } else {
        // Items not yet in the Test Explorer — fall back to individual runs.
        for (const a of affected) {
          await this._controller.runScenario(a.scenarioName, a.featureUri);
        }
      }
    } else if (action === 'Show List') {
      await this._showList(affected);
    }
  }

  // Scans all loaded feature items (already parsed by the test controller) — no I/O needed.
  private _findAffectedScenarios(patterns: RegExp[]): AffectedScenario[] {
    const affected: AffectedScenario[] = [];
    const seen = new Set<string>();

    this._controller.featureItems.forEach((featureItem, fsPath) => {
      const featureUri = featureItem.uri!;
      const featureName = featureItem.label;

      const checkScenario = (item: vscode.TestItem) => {
        const key = `${fsPath}::${item.label}`;
        if (seen.has(key)) { return; }

        const steps: vscode.TestItem[] = [];
        item.children.forEach(c => steps.push(c));

        // Match against step labels — label is "Keyword stepText"
        const matches = steps.some(stepItem => {
          const text = stepItem.label.replace(/^(Given|When|Then|And|But|\*)\s+/i, '');
          return patterns.some(p => p.test(text));
        });

        if (matches) {
          seen.add(key);
          affected.push({ featureUri, scenarioName: item.label, featureName, item });
        }
      };

      featureItem.children.forEach(child => {
        // Outline parent — check each example row
        if (child.description === 'Scenario Outline') {
          child.children.forEach(example => checkScenario(example));
        } else {
          checkScenario(child);
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
    const doc = await vscode.workspace.openTextDocument(picked.scenario.featureUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Scroll to the scenario line using the test item's range if available.
    const pos = picked.scenario.item?.range?.start ?? new vscode.Position(0, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}
