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
