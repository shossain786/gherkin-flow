import * as vscode from 'vscode';

export interface FeatureStep {
  keyword: string;
  text: string;
  line: number;
}

export interface FeatureScenario {
  keyword: string;
  name: string;
  line: number;
  steps: FeatureStep[];
  tags: string[];
}

export interface ParsedFeature {
  name: string;
  line: number;
  uri: vscode.Uri;
  scenarios: FeatureScenario[];
}

const FEATURE_RE    = /^\s*Feature:\s*(.*)/i;
const SCENARIO_RE   = /^\s*(Scenario(?:\s+Outline)?):\s*(.*)/i;
const STEP_RE       = /^\s*(Given|When|Then|And|But|\*)\s+(.*)/i;
const BACKGROUND_RE = /^\s*Background:/i;
const TAG_RE        = /^\s*(@\S+(?:\s+@\S+)*)/;

export function parseFeatureFile(document: vscode.TextDocument): ParsedFeature | undefined {
  let feature: ParsedFeature | undefined;
  let currentScenario: FeatureScenario | undefined;
  let backgroundSteps: FeatureStep[] = [];
  let pendingTags: string[] = [];
  let inBackground = false;

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;

    const tagMatch = text.match(TAG_RE);
    if (tagMatch) {
      pendingTags.push(...tagMatch[1].trim().split(/\s+/));
      continue;
    }

    const featureMatch = text.match(FEATURE_RE);
    if (featureMatch) {
      feature = { name: featureMatch[1].trim(), line: i, uri: document.uri, scenarios: [] };
      pendingTags = [];
      inBackground = false;
      continue;
    }

    if (!feature) { pendingTags = []; continue; }

    if (BACKGROUND_RE.test(text)) {
      inBackground = true;
      backgroundSteps = [];
      currentScenario = undefined;
      pendingTags = [];
      continue;
    }

    const scenarioMatch = text.match(SCENARIO_RE);
    if (scenarioMatch && scenarioMatch[2].trim().length > 0) {
      inBackground = false;
      currentScenario = {
        keyword: scenarioMatch[1].trim(),
        name: scenarioMatch[2].trim(),
        line: i,
        steps: [...backgroundSteps],   // prepend background steps so indices match JSON report
        tags: [...pendingTags]
      };
      feature.scenarios.push(currentScenario);
      pendingTags = [];
      continue;
    }

    const stepMatch = text.match(STEP_RE);
    if (stepMatch) {
      const step: FeatureStep = { keyword: stepMatch[1], text: stepMatch[2].trim(), line: i };
      if (inBackground) {
        backgroundSteps.push(step);
      } else if (currentScenario) {
        currentScenario.steps.push(step);
      }
    }
  }

  return feature;
}
