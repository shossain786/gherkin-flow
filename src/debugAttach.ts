// Pure detection of "the debuggee is now waiting for a debugger", kept free of
// any `vscode` import so it can be unit-tested.

export type DebugType = 'java' | 'node' | 'debugpy';

/**
 * Matches the JVM's JDWP banner and debugpy's equivalent.
 *
 * The JVM prints `Listening for transport dt_socket at address: 5005` on
 * **stdout**, not stderr. gherkin-flow#2 watched stderr only, so the attach
 * never fired and the run hung forever with the JVM suspended at `suspend=y`.
 */
export function readyPattern(debugType: DebugType): RegExp | undefined {
  switch (debugType) {
    case 'java':    return /Listening for transport/i;
    case 'debugpy': return /waiting for client|Waiting for debugger/i;
    default:        return undefined;
  }
}

/**
 * Scans a process's combined output for the ready banner.
 *
 * Keeps a small tail of the previous chunk, because the banner can be split
 * across two `data` events — a single-chunk test would miss it intermittently,
 * which is worse than missing it always.
 */
export class ReadyDetector {
  private _tail = '';
  private _fired = false;
  private readonly _re: RegExp | undefined;

  constructor(debugType: DebugType) {
    this._re = readyPattern(debugType);
  }

  /** Returns true exactly once, on the chunk that completes the banner. */
  accept(chunk: string): boolean {
    if (this._fired || !this._re) { return false; }
    const window = this._tail + chunk;
    if (this._re.test(window)) {
      this._fired = true;
      this._tail = '';
      return true;
    }
    this._tail = window.slice(-200);
    return false;
  }

  get fired(): boolean { return this._fired; }
}
