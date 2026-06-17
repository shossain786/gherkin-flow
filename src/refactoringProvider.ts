import * as vscode from 'vscode';
import { StepDefinitionIndex } from './stepDefinitionProvider';
import { fillPattern } from './stepSuggester';

const STEP_RE       = /^(\s*)(Given|When|Then|And|But|\*)\s+(.*)/i;
const BACKGROUND_RE = /^\s*Background:/i;
const SCENARIO_RE   = /^\s*Scenario/i;
const TAG_RE        = /^\s*@/;

// ── Extract to Background ─────────────────────────────────────────────────

export class ExtractToBackgroundProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorExtract];

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const stepLines = getStepLinesInRange(document, range);
    if (stepLines.length === 0) { return []; }
    if (!stepLines.every(l => isLineInScenario(document, l))) { return []; }

    const action = new vscode.CodeAction('⬆ Extract to Background', vscode.CodeActionKind.RefactorExtract);
    action.command = {
      command: 'gherkinFlow.extractToBackground',
      title: 'Extract to Background',
      arguments: [document.uri, stepLines],
    };
    return [action];
  }
}

function getStepLinesInRange(document: vscode.TextDocument, range: vscode.Range): number[] {
  const lines: number[] = [];
  for (let i = range.start.line; i <= range.end.line; i++) {
    if (STEP_RE.test(document.lineAt(i).text)) { lines.push(i); }
  }
  return lines;
}

function isLineInScenario(document: vscode.TextDocument, lineNumber: number): boolean {
  for (let i = lineNumber; i >= 0; i--) {
    const t = document.lineAt(i).text.trim();
    if (BACKGROUND_RE.test(t)) { return false; }
    if (SCENARIO_RE.test(t)) { return true; }
  }
  return false;
}

export async function executeExtractToBackground(uri: vscode.Uri, stepLines: number[]): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);

  let backgroundEndLine = -1;   // line after last Background step; -1 = no Background
  let firstScenarioLine = -1;   // line where Background should be inserted if absent
  let inBackground = false;

  for (let i = 0; i < document.lineCount; i++) {
    const text    = document.lineAt(i).text;
    const trimmed = text.trim();

    if (BACKGROUND_RE.test(trimmed)) {
      inBackground = true;
      backgroundEndLine = i + 1;
    } else if (inBackground && STEP_RE.test(text)) {
      backgroundEndLine = i + 1;
    } else if (SCENARIO_RE.test(trimmed) || (TAG_RE.test(trimmed) && firstScenarioLine === -1)) {
      if (firstScenarioLine === -1) { firstScenarioLine = i; }
      inBackground = false;
    } else if (inBackground && trimmed && !trimmed.startsWith('#') && !TAG_RE.test(trimmed)) {
      inBackground = false;
    }
  }

  const stepsText = stepLines
    .map(l => '  ' + document.lineAt(l).text.trim())
    .join('\n');

  const edit = new vscode.WorkspaceEdit();

  if (backgroundEndLine === -1) {
    edit.insert(uri, new vscode.Position(firstScenarioLine, 0), `Background:\n${stepsText}\n\n`);
  } else {
    edit.insert(uri, new vscode.Position(backgroundEndLine, 0), stepsText + '\n');
  }

  // Delete in reverse order so earlier line numbers stay valid
  for (const line of [...stepLines].sort((a, b) => b - a)) {
    edit.delete(uri, document.lineAt(line).rangeIncludingLineBreak);
  }

  await vscode.workspace.applyEdit(edit);
}

// ── Rename Step Definition ────────────────────────────────────────────────

export class RenameStepProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

  constructor(private readonly _index: StepDefinitionIndex) {}

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const line = document.lineAt(range.start.line).text;
    const stepMatch = line.match(STEP_RE);
    if (!stepMatch) { return []; }
    if (!this._index.findDef(stepMatch[3].trim())) { return []; }

    const action = new vscode.CodeAction('✏ Rename step definition', vscode.CodeActionKind.Refactor);
    action.command = {
      command: 'gherkinFlow.renameStep',
      title: 'Rename Step Definition',
      arguments: [document.uri, range.start.line],
    };
    return [action];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function executeRenameStep(
  uri: vscode.Uri,
  lineNumber: number,
  index: StepDefinitionIndex
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const stepMatch = document.lineAt(lineNumber).text.match(STEP_RE);
  if (!stepMatch) { return; }

  const def = index.findDef(stepMatch[3].trim());
  if (!def) { return; }

  const newPattern = await vscode.window.showInputBox({
    title: 'GherkinFlow: Rename Step Pattern',
    prompt: 'Edit the step pattern — use {string}, {int}, {float} for parameters',
    value: def.rawPattern,
    validateInput: v => v.trim() ? undefined : 'Pattern cannot be empty',
  });
  if (!newPattern || newPattern.trim() === def.rawPattern) { return; }
  const trimmedNew = newPattern.trim();

  const edit = new vscode.WorkspaceEdit();

  await updateStepDefAnnotation(edit, def.location.uri, def.rawPattern, trimmedNew);

  const featureUris = await vscode.workspace.findFiles('**/*.feature');
  let updatedSteps = 0;
  for (const fUri of featureUris) {
    updatedSteps += await updateFeatureSteps(edit, fUri, def.pattern, trimmedNew);
  }

  await vscode.workspace.applyEdit(edit);

  const stepWord = updatedSteps === 1 ? 'step' : 'steps';
  const fileWord = featureUris.length === 1 ? 'file' : 'files';
  vscode.window.showInformationMessage(
    `GherkinFlow: "${def.rawPattern}" → "${trimmedNew}" (${updatedSteps} ${stepWord} across ${featureUris.length} feature ${fileWord})`
  );
}

async function updateStepDefAnnotation(
  edit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  oldPattern: string,
  newPattern: string
): Promise<void> {
  const doc     = await vscode.workspace.openTextDocument(uri);
  const text    = doc.getText();
  const escaped = escapeRegex(oldPattern);
  // Replace both quote styles — covers Java, TypeScript/JavaScript, Python annotations
  const updated = text
    .replace(new RegExp(`"${escaped}"`, 'g'), `"${newPattern}"`)
    .replace(new RegExp(`'${escaped}'`, 'g'), `'${newPattern}'`);
  if (updated === text) { return; }
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), updated);
}

async function updateFeatureSteps(
  edit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  oldPattern: RegExp,
  newPattern: string
): Promise<number> {
  const doc = await vscode.workspace.openTextDocument(uri);
  let count = 0;
  for (let i = 0; i < doc.lineCount; i++) {
    const lineText  = doc.lineAt(i).text;
    const stepMatch = lineText.match(STEP_RE);
    if (!stepMatch) { continue; }
    const stepText = stepMatch[3].trim();
    if (!oldPattern.test(stepText)) { continue; }
    const newStepText = fillPattern(stepText, newPattern);
    edit.replace(uri, doc.lineAt(i).range, `${stepMatch[1]}${stepMatch[2]} ${newStepText}`);
    count++;
  }
  return count;
}
