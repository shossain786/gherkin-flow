import * as vscode from 'vscode';
import { StepDefinitionIndex } from './stepDefinitionProvider';

// ── VS Code LM API (available from VS Code 1.90 + GitHub Copilot) ─────────
// Typed inline so we don't need to bump @types/vscode — everything resolves
// through (vscode as any).lm with a runtime availability check.

interface LMMessage {
  role: 1 | 2;   // User = 1, Assistant = 2 (LanguageModelChatMessageRole)
  content: string;
}
interface LMResponse {
  text: AsyncIterable<string>;
}
interface LMModel {
  sendRequest(
    messages: LMMessage[],
    options: { justification?: string },
    token: vscode.CancellationToken
  ): Thenable<LMResponse>;
}
interface VSLM {
  selectChatModels(selector?: object): Thenable<LMModel[]>;
}

function getLM(): VSLM | undefined {
  return 'lm' in vscode ? (vscode as any).lm as VSLM : undefined;
}

function userMsg(content: string): LMMessage {
  return { role: 1, content };
}

async function pickModel(lm: VSLM): Promise<LMModel | undefined> {
  // Try Copilot first, then fall back to any available model.
  for (const selector of [{ vendor: 'copilot' }, {}]) {
    try {
      const list = await lm.selectChatModels(selector);
      if (list.length > 0) { return list[0]; }
    } catch { /* continue */ }
  }
  return undefined;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:gherkin|feature|cucumber)?\r?\n?/im, '')
    .replace(/\r?\n?```\s*$/im, '')
    .trim();
}

// ── Feature 1: Natural Language → Gherkin ────────────────────────────────


export async function generateScenariosFromNL(
  index: StepDefinitionIndex
): Promise<void> {
  const lm = getLM();
  if (!lm) {
    vscode.window.showErrorMessage(
      'GherkinFlow AI requires VS Code 1.90+ with GitHub Copilot installed.'
    );
    return;
  }

  // Pre-populate from selected text if the active file is a .feature file.
  const active   = vscode.window.activeTextEditor;
  const selected = active?.document.fileName.endsWith('.feature')
    ? active.document.getText(active.selection).trim()
    : '';

  const input = await vscode.window.showInputBox({
    title: 'GherkinFlow AI — Generate Scenarios',
    prompt: 'Describe the feature or user story in plain English',
    value: selected || undefined,
    placeHolder: 'e.g. Users should be able to reset their password via an email link',
    validateInput: v => v.trim() ? undefined : 'Please enter a description',
  });
  if (!input) { return; }

  const model = await pickModel(lm);
  if (!model) {
    vscode.window.showErrorMessage(
      'GherkinFlow AI: No language model available. Please install GitHub Copilot.'
    );
    return;
  }

  // Include up to 25 existing step patterns so the AI can reuse real definitions.
  const patterns     = index.getAllPatterns().slice(0, 25);
  const patternsNote = patterns.length > 0
    ? `\n\nExisting step definitions in this project — reuse these wherever they fit:\n${patterns.map(p => `- ${p}`).join('\n')}`
    : '';

  const prompt = [
    'You are a senior BDD/QA engineer. Generate a complete, production-quality Gherkin feature file for this requirement:\n',
    `"${input}"`,
    patternsNote,
    '\n\nRules:',
    '- Feature name must clearly summarise the functionality',
    '- Include 4–7 scenarios: happy path, edge cases, error/validation cases, boundary conditions',
    '- Use Scenario Outline + Examples table for data-driven cases (multiple similar inputs)',
    '- Use Background for shared Given steps when 3 or more scenarios share them',
    '- Steps must use business language — no UI details (no "click", "CSS selector", "XPath")',
    '- Reuse the existing step patterns listed above where they fit; invent new ones only when needed',
    '- Every scenario must have at least one Then step (an assertion)',
    '- Return ONLY valid Gherkin — no markdown fences, no explanation, no commentary',
  ].join('\n');

  // Open the output document before streaming so the user sees progress live.
  const doc       = await vscode.workspace.openTextDocument({ language: 'gherkin', content: '' });
  const outEditor = await vscode.window.showTextDocument(doc, { preview: false });

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'GherkinFlow AI: Generating scenarios…',
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        const response = await model.sendRequest(
          [userMsg(prompt)],
          { justification: 'Generate Gherkin BDD scenarios from user description' },
          token
        );

        let accumulated = '';
        for await (const chunk of response.text) {
          accumulated += chunk;
          // Stream each chunk into the document so the user sees it being written.
          const preview = stripFences(accumulated);
          await outEditor.edit(
            eb => {
              const all = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
              );
              eb.replace(all, preview);
            },
            { undoStopBefore: false, undoStopAfter: false }
          );
        }

        // Final clean pass — single undo stop so Ctrl+Z reverts the whole generation.
        await outEditor.edit(eb => {
          const all = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          eb.replace(all, stripFences(accumulated));
        });

      } catch (err) {
        if (err instanceof vscode.CancellationError) { return; }
        vscode.window.showErrorMessage(`GherkinFlow AI error: ${err}`);
      }
    }
  );
}

// ── Feature 3: AI Step Implementation ────────────────────────────────────

export async function generateStepImpl(params: {
  keyword: string;
  stepText: string;
  methodSignature: string;
  language: 'java' | 'ts' | 'js' | 'py';
  patterns?: string[];
}): Promise<string | null> {
  const lm = getLM();
  if (!lm) { return null; }

  const model = await pickModel(lm);
  if (!model) { return null; }

  const langLabel: Record<string, string> = {
    java: 'Java (Cucumber JVM + Selenium WebDriver)',
    ts:   'TypeScript (cucumber-js)',
    js:   'JavaScript (cucumber-js)',
    py:   'Python (Behave)',
  };

  const patternsNote = params.patterns?.length
    ? `\nExisting step patterns in this project (use for context on the automation style):\n${params.patterns.slice(0, 15).map(p => `- ${p}`).join('\n')}`
    : '';

  const prompt = [
    `You are writing a BDD automation step definition.`,
    `Language: ${langLabel[params.language] ?? params.language}`,
    `Step: ${params.keyword} ${params.stepText}`,
    `Signature: ${params.methodSignature}`,
    patternsNote,
    ``,
    `Write ONLY the method body — the code that goes inside the function, not the declaration or annotations.`,
    `Use idiomatic automation patterns (Selenium WebDriver, Playwright, or REST calls as appropriate).`,
    `No explanation. No markdown fences. Just the implementation code.`,
  ].join('\n');

  const cts = new vscode.CancellationTokenSource();
  try {
    const response = await model.sendRequest(
      [userMsg(prompt)],
      { justification: 'Generate BDD step definition implementation body' },
      cts.token
    );
    let result = '';
    for await (const chunk of response.text) { result += chunk; }
    return stripFences(result).trim() || null;
  } catch {
    return null;
  } finally {
    cts.dispose();
  }
}

// ── Feature 2: AI Failure Analysis ───────────────────────────────────────

export async function analyzeFailure(params: {
  scenarioName: string;
  stepText: string;
  error: string;
  stepDefCode?: string;
}): Promise<void> {
  const lm = getLM();
  if (!lm) {
    vscode.window.showErrorMessage(
      'GherkinFlow AI requires VS Code 1.90+ with GitHub Copilot installed.'
    );
    return;
  }

  const model = await pickModel(lm);
  if (!model) {
    vscode.window.showErrorMessage(
      'GherkinFlow AI: No language model available. Please install GitHub Copilot.'
    );
    return;
  }

  const stepDefSection = params.stepDefCode
    ? `\nStep definition implementation:\n\`\`\`\n${params.stepDefCode}\n\`\`\``
    : '';

  const prompt = [
    'A BDD test step failed. Explain what likely went wrong and how to fix it.',
    '',
    `Scenario: "${params.scenarioName}"`,
    `Failed step: \`${params.stepText}\``,
    stepDefSection,
    '',
    'Error message:',
    '```',
    params.error,
    '```',
    '',
    'Respond using EXACTLY this structure (keep the headers):',
    '',
    '## What went wrong',
    '(1–3 plain-English sentences — no jargon, no code)',
    '',
    '## Likely causes',
    '(2–4 bullet points)',
    '',
    '## Suggested fix',
    '(concrete actionable steps a developer can follow immediately)',
  ].join('\n');

  const doc       = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
  const outEditor = await vscode.window.showTextDocument(doc, { preview: false });

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'GherkinFlow AI: Analysing failure…',
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        const response = await model.sendRequest(
          [userMsg(prompt)],
          { justification: 'Analyse BDD test failure and suggest a fix' },
          token
        );

        let accumulated = '';
        for await (const chunk of response.text) {
          accumulated += chunk;
          await outEditor.edit(
            eb => {
              const all = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
              );
              eb.replace(all, accumulated);
            },
            { undoStopBefore: false, undoStopAfter: false }
          );
        }

        await outEditor.edit(eb => {
          const all = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          eb.replace(all, accumulated);
        });

      } catch (err) {
        if (err instanceof vscode.CancellationError) { return; }
        vscode.window.showErrorMessage(`GherkinFlow AI error: ${err}`);
      }
    }
  );
}
