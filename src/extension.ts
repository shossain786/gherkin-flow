import * as path from 'path';
import * as vscode from 'vscode';
import { GherkinTestController } from './testController';
import { StepDefinitionIndex, GherkinDefinitionProvider, GherkinHoverProvider, GherkinDocumentLinkProvider, getMatchedStepRanges } from './stepDefinitionProvider';
import { GherkinDiagnosticsProvider } from './diagnosticsProvider';
import { GherkinCompletionProvider } from './completionProvider';
import { InlineDecorationProvider } from './inlineDecorationProvider';
import { StepGeneratorProvider, collectMissingSteps, executeGenerateSteps } from './stepGeneratorProvider';
import { GherkinFormattingProvider } from './featureFormatter';
import { substitute } from './featureParser';

const SCENARIO_REGEX  = /^\s*(Scenario(?: Outline)?):\s*(.*)$/i;
const FEATURE_REGEX   = /^\s*Feature:\s*(.*)$/i;
const TAG_LINE_REGEX  = /^\s*(@\S+(?:\s+@\S+)*)\s*$/;
const EXAMPLES_REGEX  = /^\s*Examples\s*:/i;
const TABLE_ROW_REGEX = /^\s*\|(.+)\|\s*$/;

const scenarioDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('testing.runAction'),
  backgroundColor: new vscode.ThemeColor('testing.coveredBackground'),
  overviewRulerColor: new vscode.ThemeColor('testing.runAction'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

// Suppresses the underline that DocumentLinkProvider applies to matched step text.
// Extension inline styles (textDecoration: none) override VS Code's link CSS class.
const noLinkUnderlineDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'none',
  cursor: 'pointer',
});

function applyDecorations(editor: vscode.TextEditor): void {
  if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') { return; }
  const ranges: vscode.Range[] = [];
  for (let i = 0; i < editor.document.lineCount; i++) {
    const line = editor.document.lineAt(i);
    const match = line.text.match(SCENARIO_REGEX);
    if (match && match[2].trim().length > 0) { ranges.push(line.range); }
  }
  editor.setDecorations(scenarioDecoration, ranges);
}

function applyLinkDecorations(editor: vscode.TextEditor, stepIndex: StepDefinitionIndex): void {
  if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') { return; }
  editor.setDecorations(noLinkUnderlineDecoration, getMatchedStepRanges(editor.document, stepIndex));
}

function findScenarioAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  for (let i = position.line; i >= 0; i--) {
    const match = document.lineAt(i).text.match(SCENARIO_REGEX);
    if (match && match[2].trim().length > 0) { return match[2].trim(); }
  }
  return undefined;
}

class GherkinFlowCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onChange.event;
  private readonly _missingCache = new Map<string, { version: number; steps: ReturnType<typeof collectMissingSteps> }>();

  constructor(
    private readonly _stepIndex: StepDefinitionIndex,
    private readonly _controller: GherkinTestController
  ) {
    _controller.onDidRunTests(() => this._onChange.fire());
    _stepIndex.onDidChange(() => { this._missingCache.clear(); this._onChange.fire(); });
  }

  private _getMissingSteps(document: vscode.TextDocument) {
    const key = document.uri.toString();
    const cached = this._missingCache.get(key);
    if (cached && cached.version === document.version) { return cached.steps; }
    const steps = collectMissingSteps(document, this._stepIndex);
    this._missingCache.set(key, { version: document.version, steps });
    return steps;
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const failedNames = new Set(
      this._controller.getFailedScenarios(document.uri).map(item => item.label)
    );

    // Outline / Examples table state
    let outlineTemplateName: string | undefined;
    let examplesHeaders: string[] = [];
    let inExamples = false;

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const range = new vscode.Range(i, 0, i, line.text.length);

      if (FEATURE_REGEX.test(line.text)) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶️ Run Feature',
          command: 'gherkinFlow.runFeatureByUri',
          arguments: [document.uri]
        }));
        const missing = this._getMissingSteps(document);
        if (missing.length > 0) {
          lenses.push(new vscode.CodeLens(range, {
            title: `⚡ Generate Missing Steps (${missing.length})`,
            command: 'gherkinFlow.generateSteps',
            arguments: [document.uri, missing]
          }));
        }
        outlineTemplateName = undefined;
        inExamples = false;
        continue;
      }

      // Examples keyword — start tracking the table
      if (EXAMPLES_REGEX.test(line.text) && outlineTemplateName) {
        inExamples = true;
        examplesHeaders = [];
        continue;
      }

      // Table rows inside an Examples block
      if (inExamples && outlineTemplateName) {
        const rowMatch = line.text.match(TABLE_ROW_REGEX);
        if (rowMatch) {
          const cells = rowMatch[1].split('|').map(c => c.trim());
          if (examplesHeaders.length === 0) {
            examplesHeaders = cells;  // header row — no lens
          } else {
            // Data row — build the expanded scenario name and add a run lens
            const vars: Record<string, string> = {};
            examplesHeaders.forEach((h, idx) => { vars[h] = cells[idx] ?? ''; });
            const expandedName = substitute(outlineTemplateName, vars);
            const label = cells.join(' | ');
            lenses.push(new vscode.CodeLens(range, {
              title: `▶ Run | ${label} |`,
              command: 'gherkinFlow.runScenarioByName',
              arguments: [expandedName, document.uri]
            }));
            if (failedNames.has(expandedName)) {
              lenses.push(new vscode.CodeLens(range, {
                title: '🔄 Re-run',
                command: 'gherkinFlow.runScenarioByName',
                arguments: [expandedName, document.uri]
              }));
            }
          }
          continue;
        }
        // Non-table line ends the Examples block (blank lines are allowed inside)
        if (line.text.trim().length > 0) { inExamples = false; }
      }

      const sm = line.text.match(SCENARIO_REGEX);
      if (sm && sm[2].trim().length > 0) {
        const isOutline = /outline/i.test(sm[1]);
        const scenarioName = sm[2].trim();

        // Reset outline tracking
        outlineTemplateName = isOutline ? scenarioName : undefined;
        inExamples = false;
        examplesHeaders = [];

        lenses.push(new vscode.CodeLens(range, {
          title: isOutline ? '▶ Run All Rows' : '▶ Run Scenario',
          command: 'gherkinFlow.runScenarioByName',
          arguments: [scenarioName, document.uri]
        }));
        if (failedNames.has(scenarioName)) {
          lenses.push(new vscode.CodeLens(range, {
            title: '🔄 Re-run',
            command: 'gherkinFlow.runScenarioByName',
            arguments: [scenarioName, document.uri]
          }));
        }
        // Tag buttons
        const tags: string[] = [];
        for (let j = i - 1; j >= 0; j--) {
          const tagMatch = document.lineAt(j).text.match(TAG_LINE_REGEX);
          if (tagMatch) { tags.unshift(...tagMatch[1].trim().split(/\s+/)); }
          else if (document.lineAt(j).text.trim().length > 0) { break; }
        }
        for (const tag of [...new Set(tags)]) {
          lenses.push(new vscode.CodeLens(range, {
            title: `▶ ${tag}`,
            command: 'gherkinFlow.runByTag',
            arguments: [tag, document.uri]
          }));
        }
      }
    }
    return lenses;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const decorations = new InlineDecorationProvider(context);
  const controller = new GherkinTestController(context, decorations);

  // Build step index first — CodeLens and code actions both need it
  const stepIndex = new StepDefinitionIndex(context);
  await stepIndex.scan();

  vscode.window.visibleTextEditors.forEach(applyDecorations);
  vscode.window.visibleTextEditors.forEach(e => applyLinkDecorations(e, stepIndex));
  stepIndex.onDidChange(() => {
    vscode.window.visibleTextEditors.forEach(e => applyLinkDecorations(e, stepIndex));
  });

  // Right-click: run scenario at cursor
  const runScenarioAtCursor = vscode.commands.registerTextEditorCommand(
    'gherkinFlow.runScenario',
    (editor) => {
      if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
        vscode.window.showErrorMessage('GherkinFlow: Only works with .feature files.');
        return;
      }
      const name = findScenarioAtPosition(editor.document, editor.selection.active);
      if (!name) {
        vscode.window.showErrorMessage('GherkinFlow: No Scenario found at cursor position.');
        return;
      }
      controller.runScenario(name, editor.document.uri);
    }
  );

  // Right-click: run entire feature file
  const runFeatureAtCursor = vscode.commands.registerTextEditorCommand(
    'gherkinFlow.runFeature',
    (editor) => {
      if (path.extname(editor.document.fileName).toLowerCase() !== '.feature') {
        vscode.window.showErrorMessage('GherkinFlow: Only works with .feature files.');
        return;
      }
      controller.runFeature(editor.document.uri);
    }
  );

  // CodeLens: run scenario by name
  const runScenarioByName = vscode.commands.registerCommand(
    'gherkinFlow.runScenarioByName',
    (scenarioName: string, uri: vscode.Uri) => controller.runScenario(scenarioName, uri)
  );

  // CodeLens: run feature by URI
  const runFeatureByUri = vscode.commands.registerCommand(
    'gherkinFlow.runFeatureByUri',
    (uri: vscode.Uri) => controller.runFeature(uri)
  );

  // CodeLens: run all scenarios with a tag
  const runByTag = vscode.commands.registerCommand(
    'gherkinFlow.runByTag',
    (tag: string, uri: vscode.Uri) => controller.runByTag(tag, uri)
  );

  // Generate missing step definitions
  const generateSteps = vscode.commands.registerCommand(
    'gherkinFlow.generateSteps',
    (uri: vscode.Uri, missing) => executeGenerateSteps(uri, missing, stepIndex, controller.config)
  );

  // Re-run failed scenarios for a feature file
  const rerunFailed = vscode.commands.registerCommand(
    'gherkinFlow.rerunFailed',
    (uri: vscode.Uri) => controller.rerunFailed(uri)
  );

  // Open step definition in a new permanent tab (invoked by DocumentLinkProvider)
  const openStepDef = vscode.commands.registerCommand(
    'gherkinFlow.openStepDef',
    async (uriStr: string, line: number) => {
      const uri = vscode.Uri.parse(uriStr);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  );


  const codeLens = vscode.languages.registerCodeLensProvider(
    { pattern: '**/*.feature' },
    new GherkinFlowCodeLensProvider(stepIndex, controller)
  );

  const defProvider = vscode.languages.registerDefinitionProvider(
    { pattern: '**/*.feature' },
    new GherkinDefinitionProvider(stepIndex)
  );

  const hoverProvider = vscode.languages.registerHoverProvider(
    { pattern: '**/*.feature' },
    new GherkinHoverProvider(stepIndex)
  );

  const docLinkProvider = vscode.languages.registerDocumentLinkProvider(
    { pattern: '**/*.feature' },
    new GherkinDocumentLinkProvider(stepIndex)
  );


  const diagnosticsProvider = new GherkinDiagnosticsProvider(stepIndex, context);
  await diagnosticsProvider.initialScan();

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { pattern: '**/*.feature' },
    new GherkinCompletionProvider(stepIndex),
    ' '
  );

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { pattern: '**/*.feature' },
    new StepGeneratorProvider(stepIndex),
    { providedCodeActionKinds: StepGeneratorProvider.providedCodeActionKinds }
  );

  const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    { pattern: '**/*.feature' },
    new GherkinFormattingProvider()
  );

  context.subscriptions.push(
    formattingProvider,
    scenarioDecoration,
    noLinkUnderlineDecoration,
    completionProvider,
    codeActionProvider,
    hoverProvider,
    docLinkProvider,
    openStepDef,
    rerunFailed,
    runScenarioAtCursor,
    runFeatureAtCursor,
    runScenarioByName,
    runFeatureByUri,
    generateSteps,
    codeLens,
    defProvider,
    runByTag,
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        applyDecorations(editor);
        applyLinkDecorations(editor, stepIndex);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        applyDecorations(editor);
        applyLinkDecorations(editor, stepIndex);
      }
    })
  );
}

export function deactivate() {}
