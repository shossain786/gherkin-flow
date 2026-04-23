import * as vscode from 'vscode';
import { parseFeatureFile } from './featureParser';
import { GherkinTestController } from './testController';

interface ScenarioRef {
  name: string;
  uri: vscode.Uri;
  line: number;
}

export class TagItem extends vscode.TreeItem {
  readonly type = 'tag' as const;
  constructor(
    public readonly tag: string,
    public readonly scenarios: ScenarioRef[],
    passedCount: number,
    failedCount: number
  ) {
    super(tag, vscode.TreeItemCollapsibleState.Collapsed);
    const ran = passedCount + failedCount;
    if (ran === 0) {
      this.description = `${scenarios.length} scenario${scenarios.length !== 1 ? 's' : ''}`;
      this.iconPath = new vscode.ThemeIcon('tag');
    } else if (failedCount > 0) {
      this.description = `${passedCount} passed · ${failedCount} failed`;
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    } else {
      this.description = `${passedCount} passed`;
      this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    }
    this.contextValue = 'gherkinTag';
  }
}

export class ScenarioItem extends vscode.TreeItem {
  readonly type = 'scenario' as const;
  constructor(public readonly scenario: ScenarioRef, status?: 'passed' | 'failed') {
    super(scenario.name, vscode.TreeItemCollapsibleState.None);
    this.description = vscode.workspace.asRelativePath(scenario.uri);
    this.command = {
      command: 'vscode.open',
      title: 'Open Scenario',
      arguments: [scenario.uri, { selection: new vscode.Range(scenario.line, 0, scenario.line, 0) }]
    };
    if (status === 'passed') {
      this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    } else if (status === 'failed') {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    }
    this.contextValue = 'gherkinScenario';
  }
}

type TreeNode = TagItem | ScenarioItem;

export class TagsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private _tagMap = new Map<string, ScenarioRef[]>();
  private readonly _watcher: vscode.FileSystemWatcher;
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly _controller: GherkinTestController
  ) {
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    this._watcher.onDidCreate(() => this._scheduleRefresh());
    this._watcher.onDidChange(() => this._scheduleRefresh());
    this._watcher.onDidDelete(() => this._scheduleRefresh());
    context.subscriptions.push(this._watcher, this._onDidChange);

    // Refresh icons after each test run (pass/fail state changed)
    _controller.onDidRunTests(() => this._onDidChange.fire());
  }

  async initialScan(): Promise<void> {
    await this._scanAll();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem { return element; }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return [...this._tagMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, scenarios]) => {
          let passed = 0, failed = 0;
          for (const s of scenarios) {
            const st = this._controller.getScenarioStatus(s.uri, s.name);
            if (st === 'passed') { passed++; }
            else if (st === 'failed') { failed++; }
          }
          return new TagItem(tag, scenarios, passed, failed);
        });
    }
    if (element instanceof TagItem) {
      return element.scenarios.map(s =>
        new ScenarioItem(s, this._controller.getScenarioStatus(s.uri, s.name))
      );
    }
    return [];
  }

  private _scheduleRefresh(): void {
    if (this._refreshTimer !== undefined) { clearTimeout(this._refreshTimer); }
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      this._scanAll().then(() => this._onDidChange.fire());
    }, 300);
  }

  private async _scanAll(): Promise<void> {
    const tagMap = new Map<string, ScenarioRef[]>();
    const uris = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');

    for (const uri of uris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const parsed = parseFeatureFile(doc);
        if (!parsed) { continue; }

        for (const scenario of parsed.scenarios) {
          // Use outline name for expanded rows so they group under a single readable entry
          // but track by expanded name for status lookups
          for (const tag of scenario.tags) {
            if (!tagMap.has(tag)) { tagMap.set(tag, []); }
            tagMap.get(tag)!.push({ name: scenario.name, uri, line: scenario.line });
          }
        }
      } catch { /* skip unreadable files */ }
    }

    this._tagMap = tagMap;
  }
}
