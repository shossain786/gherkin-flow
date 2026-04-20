import * as fs from 'fs';

export type StepStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'undefined';

export interface ParsedStep {
  keyword: string;
  name: string;
  status: StepStatus;
  durationMs: number;
  errorMessage?: string;
  output?: string[];
}

export interface ParsedScenario {
  name: string;
  overallStatus: StepStatus;
  steps: ParsedStep[];
  durationMs: number;
}

export interface ParsedReport {
  scenarios: Map<string, ParsedScenario>;
}

interface RawStep {
  keyword: string;
  name: string;
  result?: { status?: string; duration?: number; error_message?: string };
  output?: string[];
}

interface RawElement {
  type: string;
  name: string;
  steps?: RawStep[];
}

interface RawFeature {
  name: string;
  elements?: RawElement[];
}

function deriveStatus(steps: ParsedStep[]): StepStatus {
  if (steps.some(s => s.status === 'failed'))    { return 'failed'; }
  if (steps.some(s => s.status === 'undefined')) { return 'failed'; }
  if (steps.some(s => s.status === 'pending'))   { return 'skipped'; }
  if (steps.every(s => s.status === 'passed'))   { return 'passed'; }
  return 'skipped';
}

export function parseReport(reportPath: string): ParsedReport {
  const map = new Map<string, ParsedScenario>();

  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    const features = JSON.parse(content) as RawFeature[];

    const toStep = (s: RawStep): ParsedStep => ({
      keyword: String(s.keyword ?? '').trim(),
      name: String(s.name ?? ''),
      status: (s.result?.status ?? 'undefined') as StepStatus,
      durationMs: Math.round((s.result?.duration ?? 0) / 1_000_000),
      errorMessage: s.result?.error_message ? String(s.result.error_message) : undefined,
      output: s.output && s.output.length > 0 ? s.output : undefined
    });

    for (const feature of features) {
      let pendingBackgroundSteps: ParsedStep[] = [];

      for (const el of feature.elements ?? []) {
        if (el.type === 'background') {
          // Capture background steps — they precede each scenario in the JSON
          pendingBackgroundSteps = (el.steps ?? []).map(toStep);
          continue;
        }
        if (el.type !== 'scenario') { continue; }

        // Prepend background steps so indices align with featureParser's scenario.steps
        const steps: ParsedStep[] = [
          ...pendingBackgroundSteps,
          ...(el.steps ?? []).map(toStep)
        ];

        const durationMs = steps.reduce((sum, s) => sum + s.durationMs, 0);

        map.set(el.name, {
          name: el.name,
          overallStatus: deriveStatus(steps),
          steps,
          durationMs
        });

        // Reset so next scenario gets its own fresh background (Cucumber repeats per scenario)
        pendingBackgroundSteps = [];
      }
    }
  } catch {
    // Report not found or invalid — return empty map
  }

  return { scenarios: map };
}
