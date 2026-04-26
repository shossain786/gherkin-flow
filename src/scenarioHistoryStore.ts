import * as vscode from 'vscode';

export interface RunRecord {
  timestamp: number;   // Unix ms
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
}

const STORAGE_KEY = 'gherkinFlow.scenarioHistory';
const MAX_RECORDS = 10;
const DISPLAY_RUNS = 5;

export class ScenarioHistoryStore {
  private _data: Record<string, RunRecord[]>;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _state: vscode.Memento) {
    this._data = this._state.get<Record<string, RunRecord[]>>(STORAGE_KEY, {});
  }

  record(uri: vscode.Uri, scenarioName: string, status: 'passed' | 'failed' | 'skipped', durationMs: number): void {
    const key  = this._key(uri, scenarioName);
    const hist = this._data[key] ?? [];
    hist.push({ timestamp: Date.now(), status, durationMs });
    if (hist.length > MAX_RECORDS) { hist.splice(0, hist.length - MAX_RECORDS); }
    this._data[key] = hist;
    this._state.update(STORAGE_KEY, this._data);
    this._onDidChange.fire();
  }

  getHistory(uri: vscode.Uri, scenarioName: string): RunRecord[] {
    return this._data[this._key(uri, scenarioName)] ?? [];
  }

  // Returns a short CodeLens label: "✓ ✓ ✗ ✓ ✓" or "⚡ Flaky  ✓ ✗ ✓"
  getLabel(uri: vscode.Uri, scenarioName: string): string | undefined {
    const hist = this.getHistory(uri, scenarioName);
    if (hist.length === 0) { return undefined; }
    const last   = hist.slice(-DISPLAY_RUNS);
    const dots   = last.map(r => r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '–').join(' ');
    const flaky  = last.some(r => r.status === 'passed') && last.some(r => r.status === 'failed');
    return flaky ? `⚡ Flaky  ${dots}` : dots;
  }

  // Returns a formatted detail string for the notification popup
  getDetail(uri: vscode.Uri, scenarioName: string): string {
    const hist = this.getHistory(uri, scenarioName);
    if (hist.length === 0) { return 'No history recorded yet.'; }
    return hist
      .slice()
      .reverse()
      .map((r, i) => {
        const icon = r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '–';
        const date = new Date(r.timestamp).toLocaleString();
        const dur  = r.durationMs > 0 ? ` (${r.durationMs}ms)` : '';
        return `#${i + 1}  ${icon} ${r.status}${dur}  —  ${date}`;
      })
      .join('\n');
  }

  private _key(uri: vscode.Uri, name: string): string {
    return `${uri.fsPath}::${name}`;
  }
}
