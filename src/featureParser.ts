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
  outlineName?: string;   // set when this is an expanded Scenario Outline row
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
const EXAMPLES_RE   = /^\s*Examples:/i;
const TABLE_ROW_RE  = /^\s*\|(.+)\|\s*$/;
const TAG_RE        = /^\s*(@\S+(?:\s+@\S+)*)/;

export function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/<([^>]+)>/g, (_, key) => vars[key] ?? `<${key}>`);
}

export function parseFeatureFile(document: vscode.TextDocument): ParsedFeature | undefined {
  let feature: ParsedFeature | undefined;
  let currentScenario: FeatureScenario | undefined;
  let backgroundSteps: FeatureStep[] = [];
  let pendingTags: string[] = [];
  let inBackground = false;

  // Outline state
  let outlineTemplate: FeatureScenario | undefined;
  let examplesHeaders: string[] = [];
  let inExamples = false;

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;

    // Tags
    const tagMatch = text.match(TAG_RE);
    if (tagMatch) {
      pendingTags.push(...tagMatch[1].trim().split(/\s+/));
      continue;
    }

    // Feature
    const featureMatch = text.match(FEATURE_RE);
    if (featureMatch) {
      feature = { name: featureMatch[1].trim(), line: i, uri: document.uri, scenarios: [] };
      pendingTags = [];
      inBackground = false;
      inExamples = false;
      outlineTemplate = undefined;
      continue;
    }

    if (!feature) { pendingTags = []; continue; }

    // Background
    if (BACKGROUND_RE.test(text)) {
      inBackground = true;
      inExamples = false;
      backgroundSteps = [];
      currentScenario = undefined;
      outlineTemplate = undefined;
      pendingTags = [];
      continue;
    }

    // Examples keyword — begins the Examples table for the current outline
    if (EXAMPLES_RE.test(text) && outlineTemplate) {
      inExamples = true;
      examplesHeaders = [];
      pendingTags = [];
      continue;
    }

    // Table rows — only processed when inside an Examples block
    if (inExamples && outlineTemplate) {
      const rowMatch = text.match(TABLE_ROW_RE);
      if (rowMatch) {
        const cells = rowMatch[1].split('|').map(c => c.trim());
        if (examplesHeaders.length === 0) {
          examplesHeaders = cells;
        } else {
          // Expand this row into a concrete scenario
          const vars: Record<string, string> = {};
          examplesHeaders.forEach((h, idx) => { vars[h] = cells[idx] ?? ''; });

          const expandedName  = substitute(outlineTemplate.name, vars);
          const expandedSteps = outlineTemplate.steps.map(s => ({
            ...s,
            text: substitute(s.text, vars)
          }));

          feature.scenarios.push({
            keyword: outlineTemplate.keyword,
            name: expandedName,
            line: i,
            steps: expandedSteps,
            tags: [...outlineTemplate.tags],
            outlineName: outlineTemplate.name
          });
        }
        continue;
      }
      // Non-table line ends the examples block
      inExamples = false;
    }

    // Scenario / Scenario Outline
    const scenarioMatch = text.match(SCENARIO_RE);
    if (scenarioMatch && scenarioMatch[2].trim().length > 0) {
      inBackground = false;
      inExamples = false;
      const isOutline = /outline/i.test(scenarioMatch[1]);

      const scenarioBase: FeatureScenario = {
        keyword: scenarioMatch[1].trim(),
        name: scenarioMatch[2].trim(),
        line: i,
        steps: [...backgroundSteps],
        tags: [...pendingTags]
      };
      pendingTags = [];

      if (isOutline) {
        outlineTemplate = scenarioBase;
        currentScenario = undefined;
      } else {
        outlineTemplate = undefined;
        currentScenario = scenarioBase;
        feature.scenarios.push(currentScenario);
      }
      continue;
    }

    // Steps
    const stepMatch = text.match(STEP_RE);
    if (stepMatch) {
      const step: FeatureStep = { keyword: stepMatch[1], text: stepMatch[2].trim(), line: i };
      if (inBackground) {
        backgroundSteps.push(step);
      } else if (outlineTemplate && !inExamples) {
        outlineTemplate.steps.push(step);
      } else if (currentScenario) {
        currentScenario.steps.push(step);
      }
    }
  }

  return feature;
}
