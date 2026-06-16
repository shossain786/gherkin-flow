import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseFeatureFile } from './featureParser';
import { StepDefinitionIndex } from './stepDefinitionProvider';
import { ProjectConfig } from './projectDetector';
import { findSimilarSteps, fillPattern } from './stepSuggester';
import { generateStepImpl } from './aiFeatures';

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

// Cucumber Expression format — used for Java / TS / JS stubs.
function textToPattern(text: string): string {
  let p = text.replace(/"[^"]*"/g, '{string}').replace(/'[^']*'/g, '{string}');
  p = p.replace(/\b\d+\.\d+\b/g, '{float}');
  p = p.replace(/\b\d+\b/g, '{int}');
  return p;
}

// Behave parse format — preserves quotes in pattern, uses named positional params.
// "I enter \"admin\" in \"username\""  →  { pattern: 'I enter "{arg0}" in "{arg1}"', params: ['arg0','arg1'] }
function textToPatternBehave(text: string): { pattern: string; params: string[] } {
  let p = text;
  const params: string[] = [];
  let n = 0;
  p = p.replace(/"[^"]*"/g,    () => { const name = `arg${n++}`; params.push(name); return `"{${name}}"`; });
  p = p.replace(/'[^']*'/g,    () => { const name = `arg${n++}`; params.push(name); return `'{${name}}'`; });
  p = p.replace(/\b\d+\.\d+\b/g, () => { const name = `arg${n++}`; params.push(name); return `{${name}:f}`; });
  p = p.replace(/\b\d+\b/g,   () => { const name = `arg${n++}`; params.push(name); return `{${name}:d}`; });
  return { pattern: p, params };
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

function patternToSnakeCase(text: string): string {
  const words = text
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) { return 'step_impl'; }
  return words.map(w => w.toLowerCase()).join('_');
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

function extractSignature(stub: string, ext: string): string {
  if (ext === 'java') {
    const m = stub.match(/public void (\w+\([^)]*\))/);
    return m ? m[1] : '';
  }
  if (ext === 'py') {
    const m = stub.match(/def (\w+\([^)]*\))/);
    return m ? m[1] : '';
  }
  const m = stub.match(/function\s*\(([^)]*)\)/);
  return m ? `function(${m[1]})` : '';
}

function injectImpl(stub: string, impl: string, ext: string): string {
  const indent = ext === 'java' ? '        ' : '    ';
  const indented = impl.split('\n').map(l => l.trim() ? indent + l : '').join('\n');
  if (ext === 'java') {
    return stub.replace(
      '        // TODO: implement\n        throw new io.cucumber.java.PendingException();',
      indented
    );
  }
  if (ext === 'py') {
    return stub.replace(
      /    # TODO: implement\n    raise NotImplementedError\([^\n]*\)/,
      indented
    );
  }
  return stub.replace('    // TODO: implement', indented);
}

function generateStub(step: MissingStep, ext: string): string {
  const pattern = textToPattern(step.text);
  const methodName = patternToMethodName(pattern);
  const params = extractParams(pattern, ext);
  const kw = normaliseKeyword(step.keyword);
  const quoted = JSON.stringify(pattern);

  if (ext === 'py') {
    // Use Behave's parse format: quoted strings become "{argN}", integers {argN:d}, floats {argN:f}.
    // Derive function name from step text with literal values stripped (not from pattern),
    // so "I enter "admin" in "field"" → i_enter_in rather than i_enter_admin_in_field.
    const { pattern: behavePattern, params: behaveParams } = textToPatternBehave(step.text);
    const stripped = step.text.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '')
      .replace(/\b\d+\.\d+\b/g, '').replace(/\b\d+\b/g, '');
    const fnName = patternToSnakeCase(stripped) || 'step_impl';
    const allParams = ['context', ...behaveParams];
    if (step.hasDataTable) { allParams.push('table'); }
    if (step.hasDocString) { allParams.push('text'); }
    return [
      `@${kw.toLowerCase()}(u'${behavePattern}')`,
      `def ${fnName}(${allParams.join(', ')}):`,
      `    # TODO: implement`,
      `    raise NotImplementedError(u'STEP: ${step.keyword} ${step.text}')`,
      ``,
    ].join('\n');
  }

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
  } else if (ext === 'py') {
    content = [`from behave import given, when, then`, ``, ...stubs].join('\n');
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

// --- AI-enhanced stub builder ---

async function buildStubs(
  missing: MissingStep[],
  ext: string,
  index: StepDefinitionIndex
): Promise<string[]> {
  const rawStubs = missing.map(s => generateStub(s, ext));
  const aiAvailable = 'lm' in vscode;
  if (!aiAvailable) { return rawStubs; }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `GherkinFlow: Generating ${missing.length === 1 ? 'implementation' : `${missing.length} implementations`}…`,
      cancellable: false,
    },
    async () => {
      const patterns = index.getAllPatterns().slice(0, 15);
      return Promise.all(rawStubs.map(async (stub, i) => {
        const step = missing[i];
        const impl = await generateStepImpl({
          keyword: step.keyword,
          stepText: step.text,
          methodSignature: extractSignature(stub, ext),
          language: ext as 'java' | 'ts' | 'js' | 'py',
          patterns,
        });
        return impl ? injectImpl(stub, impl, ext) : stub;
      }));
    }
  );
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
  // Only offer step files that match the project's language so Python projects
  // don't show Java/TS files and vice versa.
  const allowedExts = config.type === 'python-behave' ? ['py']
    : config.type === 'node' ? ['ts', 'js']
    : ['java'];
  const defFiles = index.getDefinitionFiles()
    .filter(f => allowedExts.includes(path.extname(f).slice(1).toLowerCase()));
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
    const defaultVal = config.type === 'node' ? 'src/steps/steps.ts'
      : config.type === 'python-behave' ? 'features/steps/steps.py'
      : 'src/test/java/steps/StepDefinitions.java';
    const input = await vscode.window.showInputBox({
      prompt: 'New file path (relative to workspace root)',
      value: defaultVal,
      validateInput: v => v.trim() ? undefined : 'Path cannot be empty'
    });
    if (!input) { return; }
    targetPath = path.join(wsRoot, input);
    ext = path.extname(targetPath).slice(1).toLowerCase() || (config.type === 'node' ? 'ts' : 'java');
    createNewFile(targetPath, await buildStubs(missing, ext, index), ext);
  } else {
    targetPath = picked.filePath;
    ext = path.extname(targetPath).slice(1).toLowerCase();
    await appendToFile(targetPath, await buildStubs(missing, ext, index), ext);
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

    // ── Similar step suggestions (shown first, above Generate) ──────────────
    const similar = findSimilarSteps(stepsAtCursor[0].text, this._index);
    for (const suggestion of similar) {
      const line      = document.lineAt(stepsAtCursor[0].line);
      const stepMatch = line.text.match(/^(\s*(?:Given|When|Then|And|But|\*)\s+)(.*)/i);
      if (!stepMatch) { continue; }

      const filled    = fillPattern(stepMatch[2], suggestion.rawPattern);
      const relPath   = vscode.workspace.asRelativePath(suggestion.location.uri);
      const lineNo    = suggestion.location.range.start.line + 1;
      const pct       = Math.round(suggestion.similarity * 100);

      const action    = new vscode.CodeAction(
        `💡 Use: ${suggestion.rawPattern}  (${pct}% match — ${relPath}:${lineNo})`,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [gherkinDiags[0]];
      action.isPreferred = similar.indexOf(suggestion) === 0; // top match = preferred

      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, line.range, stepMatch[1] + filled);
      action.edit = edit;
      actions.push(action);
    }

    // ── Generate new stub ────────────────────────────────────────────────────
    const singleAction = new vscode.CodeAction(`⚡ Generate step definition`, vscode.CodeActionKind.QuickFix);
    singleAction.command = { command: 'gherkinFlow.generateSteps', title: 'Generate Step Definition', arguments: [document.uri, [stepsAtCursor[0]]] };
    singleAction.diagnostics = [gherkinDiags[0]];
    if (similar.length === 0) { singleAction.isPreferred = true; }
    actions.push(singleAction);

    if (allMissing.length > 1) {
      const allAction = new vscode.CodeAction(`⚡ Generate all ${allMissing.length} missing step definitions`, vscode.CodeActionKind.QuickFix);
      allAction.command = { command: 'gherkinFlow.generateSteps', title: 'Generate All Missing Steps', arguments: [document.uri, allMissing] };
      actions.push(allAction);
    }

    return actions;
  }
}
