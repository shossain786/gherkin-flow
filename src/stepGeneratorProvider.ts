import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseFeatureFile } from './featureParser';
import { StepDefinitionIndex } from './stepDefinitionProvider';
import { ProjectConfig } from './projectDetector';

export interface MissingStep {
  keyword: string;
  text: string;
  line: number;
  hasDataTable?: boolean;
  hasDocString?: boolean;
}

const DIAG_RE  = /No step definition found for: "(.+)"$/;
const KWPRE_RE = /^(Given|When|Then|And|But|\*)\s+(.*)/i;

// --- Public helpers ---

function detectStepExtras(document: vscode.TextDocument, stepLine: number): { hasDataTable: boolean; hasDocString: boolean } {
  for (let i = stepLine + 1; i < document.lineCount; i++) {
    const text = document.lineAt(i).text.trim();
    if (text === '') { continue; }
    if (text.startsWith('|')) { return { hasDataTable: true, hasDocString: false }; }
    if (text.startsWith('"""') || text.startsWith("'''")) { return { hasDataTable: false, hasDocString: true }; }
    break;
  }
  return { hasDataTable: false, hasDocString: false };
}

export function collectMissingSteps(
  document: vscode.TextDocument,
  index: StepDefinitionIndex
): MissingStep[] {
  const parsed = parseFeatureFile(document);
  if (!parsed) { return []; }
  const seen = new Set<string>();
  const out: MissingStep[] = [];
  for (const scenario of parsed.scenarios) {
    for (const step of scenario.steps) {
      const key = `${step.keyword}|${step.text}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      if (!index.find(step.text)) {
        const extras = detectStepExtras(document, step.line);
        out.push({ keyword: step.keyword, text: step.text, line: step.line, ...extras });
      }
    }
  }
  return out;
}

// --- Stub generation ---

function textToPattern(text: string): string {
  let p = text.replace(/"[^"]*"/g, '{string}').replace(/'[^']*'/g, '{string}');
  p = p.replace(/\b\d+\.\d+\b/g, '{float}');
  p = p.replace(/\b\d+\b/g, '{int}');
  return p;
}

function patternToMethodName(pattern: string): string {
  const words = pattern
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) { return 'pendingStep'; }
  return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
}

function extractParams(pattern: string, ext: string): string[] {
  const params: string[] = [];
  let n = 0;
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern)) !== null) {
    const t = m[1].toLowerCase();
    if (ext === 'java') {
      const jt = t === 'string' ? 'String' : (t === 'int' || t === 'long') ? 'int' : (t === 'float' || t === 'double') ? 'double' : 'Object';
      params.push(`${jt} arg${n++}`);
    } else if (ext === 'ts') {
      const tt = t === 'string' ? 'string' : (t === 'int' || t === 'float' || t === 'double') ? 'number' : 'unknown';
      params.push(`arg${n++}: ${tt}`);
    } else {
      params.push(`arg${n++}`);
    }
  }
  return params;
}

function normaliseKeyword(kw: string): string {
  const k = kw.charAt(0).toUpperCase() + kw.slice(1).toLowerCase();
  if (k === 'And' || k === 'But' || k === '*') { return 'Given'; }
  return k;
}

function generateStub(step: MissingStep, ext: string): string {
  const pattern = textToPattern(step.text);
  const methodName = patternToMethodName(pattern);
  const params = extractParams(pattern, ext);
  const kw = normaliseKeyword(step.keyword);
  const quoted = JSON.stringify(pattern);

  if (step.hasDataTable) {
    if (ext === 'java')     { params.push('io.cucumber.datatable.DataTable dataTable'); }
    else if (ext === 'ts')  { params.push('dataTable: DataTable'); }
    else                    { params.push('dataTable'); }
  } else if (step.hasDocString) {
    if (ext === 'java')     { params.push('String docString'); }
    else if (ext === 'ts')  { params.push('docString: string'); }
    else                    { params.push('docString'); }
  }

  if (ext === 'java') {
    return [
      `    @${kw}(${quoted})`,
      `    public void ${methodName}(${params.join(', ')}) {`,
      `        // TODO: implement`,
      `        throw new io.cucumber.java.PendingException();`,
      `    }`,
      ``
    ].join('\n');
  }

  const funcParams = params.length > 0 ? `function (${params.join(', ')})` : 'function ()';
  return [
    `${kw}(${quoted}, ${funcParams} {`,
    `    // TODO: implement`,
    `});`,
    ``
  ].join('\n');
}

// --- File operations ---

function detectJavaPackage(dir: string): string {
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.java')) { continue; }
      const m = fs.readFileSync(path.join(dir, file), 'utf8').match(/^package\s+([\w.]+)\s*;/m);
      if (m) { return m[1]; }
    }
  } catch { /* ignore */ }
  return '';
}

async function appendToFile(filePath: string, stubs: string[], ext: string): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf8');
  let updated: string;
  if (ext === 'java') {
    const lastBrace = content.lastIndexOf('}');
    const insert = '\n' + stubs.join('\n');
    updated = lastBrace === -1
      ? content + insert
      : content.slice(0, lastBrace) + insert + '}\n';
  } else {
    updated = content.trimEnd() + '\n\n' + stubs.join('\n');
  }
  fs.writeFileSync(filePath, updated, 'utf8');
}

function createNewFile(filePath: string, stubs: string[], ext: string): void {
  let content: string;
  if (ext === 'java') {
    const pkg = detectJavaPackage(path.dirname(filePath));
    const cls = path.basename(filePath, '.java');
    content = [
      pkg ? `package ${pkg};\n` : '',
      `import io.cucumber.java.en.Given;`,
      `import io.cucumber.java.en.When;`,
      `import io.cucumber.java.en.Then;`,
      ``,
      `public class ${cls} {`,
      ``,
      ...stubs,
      `}`,
      ``
    ].join('\n');
  } else if (ext === 'ts') {
    const needsDataTable = stubs.some(s => s.includes('DataTable'));
    const imports = needsDataTable ? `import { Given, When, Then, DataTable } from '@cucumber/cucumber';` : `import { Given, When, Then } from '@cucumber/cucumber';`;
    content = [imports, ``, ...stubs].join('\n');
  } else {
    content = [`const { Given, When, Then } = require('@cucumber/cucumber');`, ``, ...stubs].join('\n');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// --- Command handler ---

export async function executeGenerateSteps(
  uri: vscode.Uri,
  missing: MissingStep[],
  index: StepDefinitionIndex,
  config: ProjectConfig
): Promise<void> {
  if (missing.length === 0) { return; }

  type PickItem = vscode.QuickPickItem & { filePath?: string };
  const defFiles = index.getDefinitionFiles();
  const items: PickItem[] = [
    { label: '$(add) Create new file...', description: 'Create a new step definition file' },
    ...defFiles.map(f => ({
      label: path.basename(f),
      description: vscode.workspace.asRelativePath(f),
      filePath: f
    }))
  ];

  const placeholder = missing.length > 1
    ? `Generate ${missing.length} step definitions into...`
    : `Generate step for: "${missing[0].keyword} ${missing[0].text}"`;

  const picked = await vscode.window.showQuickPick(items, { placeHolder: placeholder, matchOnDescription: true });
  if (!picked) { return; }

  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  let targetPath: string;
  let ext: string;

  if (!picked.filePath) {
    const defaultVal = config.type === 'node' ? 'src/steps/steps.ts' : 'src/test/java/steps/StepDefinitions.java';
    const input = await vscode.window.showInputBox({
      prompt: 'New file path (relative to workspace root)',
      value: defaultVal,
      validateInput: v => v.trim() ? undefined : 'Path cannot be empty'
    });
    if (!input) { return; }
    targetPath = path.join(wsRoot, input);
    ext = path.extname(targetPath).slice(1).toLowerCase() || (config.type === 'node' ? 'ts' : 'java');
    createNewFile(targetPath, missing.map(s => generateStub(s, ext)), ext);
  } else {
    targetPath = picked.filePath;
    ext = path.extname(targetPath).slice(1).toLowerCase();
    await appendToFile(targetPath, missing.map(s => generateStub(s, ext)), ext);
  }

  const doc = await vscode.workspace.openTextDocument(targetPath);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const lastLine = doc.lineCount - 1;
  const pos = new vscode.Position(lastLine, 0);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
  editor.selection = new vscode.Selection(pos, pos);
}

// --- Code Action Provider (light bulb on unmatched steps) ---

export class StepGeneratorProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly _index: StepDefinitionIndex) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const gherkinDiags = context.diagnostics.filter(d => d.source === 'GherkinFlow');
    if (gherkinDiags.length === 0) { return []; }

    // Use collectMissingSteps so hasDataTable/hasDocString are correctly populated
    const allMissing = collectMissingSteps(document, this._index);
    if (allMissing.length === 0) { return []; }

    // Match the step at the diagnostic line
    const diagLines = new Set(gherkinDiags.map(d => d.range.start.line));
    const stepsAtCursor = allMissing.filter(s => diagLines.has(s.line));
    if (stepsAtCursor.length === 0) { return []; }

    const actions: vscode.CodeAction[] = [];

    const singleAction = new vscode.CodeAction(`⚡ Generate step definition`, vscode.CodeActionKind.QuickFix);
    singleAction.command = { command: 'gherkinFlow.generateSteps', title: 'Generate Step Definition', arguments: [document.uri, [stepsAtCursor[0]]] };
    singleAction.diagnostics = [gherkinDiags[0]];
    singleAction.isPreferred = true;
    actions.push(singleAction);

    if (allMissing.length > 1) {
      const allAction = new vscode.CodeAction(`⚡ Generate all ${allMissing.length} missing step definitions`, vscode.CodeActionKind.QuickFix);
      allAction.command = { command: 'gherkinFlow.generateSteps', title: 'Generate All Missing Steps', arguments: [document.uri, allMissing] };
      actions.push(allAction);
    }

    return actions;
  }
}
