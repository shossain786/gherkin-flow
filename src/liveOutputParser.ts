// Parses Cucumber/Behave stdout line-by-line and emits step results as they happen,
// so Test Explorer can update in real time before the JSON report is available.
//
// Supported output formats:
//   Cucumber JVM (pretty):  "    Given step # Class.method() 0.123s"  /  "(failed)"
//   Behave:                 "    Given step ... passed in 0.123s"
//   cucumber-js (pretty):   "    ✔ Given step (123ms)"  /  "    ✗ Given step"

export interface LiveStepResult {
  scenarioName: string;
  stepLabel:    string;  // "Given I am on the login page" — matches TestItem.label exactly
  status:       'passed' | 'failed' | 'skipped';
  durationMs:   number;
}

const KW = '(Given|When|Then|And|But|\\*)';

// Cucumber JVM pretty formatter — m[1]=keyword, m[2]=text, m[3]=duration
const JVM_PASSED  = new RegExp(`^\\s{4,}${KW}\\s+(.*?)\\s+#\\s+\\S+\\s+([\\d.]+)s\\s*$`, 'i');
// Cucumber JVM failed — m[1]=keyword, m[2]=text
const JVM_FAILED  = new RegExp(`^\\s{4,}${KW}\\s+(.*?)\\s+#\\s+\\S+\\s+\\(failed\\)`, 'i');
// Cucumber JVM skipped/undefined/pending — m[1]=keyword, m[2]=text
const JVM_SKIPPED = new RegExp(`^\\s{4,}${KW}\\s+(.*?)\\s+#\\s+\\S+\\s+\\((?:skipped|undefined|pending)\\)`, 'i');

// Behave — m[1]=keyword, m[2]=text, m[3]=status, m[4]=duration_seconds
const BEHAVE_STEP = new RegExp(`^\\s{4,}${KW}\\s+(.*?)\\s+\\.\\.\\.\\s+(passed|failed|skipped)\\s+in\\s+([\\d.]+)s`, 'i');

// cucumber-js — m[1]=keyword, m[2]=text, m[3]=duration_ms (optional)
const CJS_PASSED  = new RegExp(`^\\s{4,}[✔✓]\\s+${KW}\\s+(.*?)(?:\\s+\\((\\d+)ms\\))?\\s*$`, 'i');
// cucumber-js failed — m[1]=keyword, m[2]=text
const CJS_FAILED  = new RegExp(`^\\s{4,}[✗×✘]\\s+${KW}\\s+(.*)`, 'i');
// cucumber-js skipped — m[1]=keyword, m[2]=text
const CJS_SKIPPED = new RegExp(`^\\s{4,}-\\s+${KW}\\s+(.*)`, 'i');

// Scenario / Scenario Outline header
const SCENARIO_LINE = /^\s{2,4}Scenario(?:\s+Outline)?:\s+(.+)/;

function label(keyword: string, text: string): string {
  return `${keyword.trim()} ${text.trim()}`;
}

export class LiveOutputParser {
  private _scenario = '';
  private _buffer   = '';

  processChunk(chunk: string): LiveStepResult[] {
    this._buffer += chunk;
    const lines = this._buffer.split(/\r?\n/);
    this._buffer = lines.pop() ?? '';
    const out: LiveStepResult[] = [];
    for (const line of lines) {
      const r = this._parseLine(line);
      if (r) { out.push(r); }
    }
    return out;
  }

  private _result(kw: string, text: string, status: LiveStepResult['status'], durationMs: number): LiveStepResult {
    return { scenarioName: this._scenario, stepLabel: label(kw, text), status, durationMs };
  }

  private _parseLine(line: string): LiveStepResult | null {
    const sm = line.match(SCENARIO_LINE);
    if (sm) { this._scenario = sm[1].trim(); return null; }
    if (!this._scenario) { return null; }

    let m: RegExpMatchArray | null;

    if ((m = line.match(BEHAVE_STEP))) {
      // m[1]=kw, m[2]=text, m[3]=status, m[4]=seconds
      return this._result(m[1], m[2], m[3].toLowerCase() as LiveStepResult['status'],
        Math.round(parseFloat(m[4]) * 1000));
    }

    if ((m = line.match(JVM_PASSED))) {
      // m[1]=kw, m[2]=text, m[3]=seconds
      return this._result(m[1], m[2], 'passed', Math.round(parseFloat(m[3]) * 1000));
    }

    if ((m = line.match(JVM_FAILED))) {
      // m[1]=kw, m[2]=text
      return this._result(m[1], m[2], 'failed', 0);
    }

    if ((m = line.match(JVM_SKIPPED))) {
      // m[1]=kw, m[2]=text
      return this._result(m[1], m[2], 'skipped', 0);
    }

    if ((m = line.match(CJS_PASSED))) {
      // m[1]=kw, m[2]=text, m[3]=ms (optional)
      return this._result(m[1], m[2], 'passed', m[3] ? parseInt(m[3]) : 0);
    }

    if ((m = line.match(CJS_FAILED))) {
      // m[1]=kw, m[2]=text
      return this._result(m[1], m[2], 'failed', 0);
    }

    if ((m = line.match(CJS_SKIPPED))) {
      // m[1]=kw, m[2]=text
      return this._result(m[1], m[2], 'skipped', 0);
    }

    return null;
  }
}
