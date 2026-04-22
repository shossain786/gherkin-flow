# GherkinFlow — Improvement Points

## Bugs to Fix Now

- [x] **`stepLines` / `scenarioTags` leak on file reload** — `_loadFile` calls `ctrl.items.delete` but never cleans those two maps first; only `_deleteFile` does. Call `_deleteFile` at the top of `_loadFile` before rebuilding.

- [x] **`CancellationTokenSource` never disposed** — `runScenario`, `runFeature`, and `rerunFailed` all do `new vscode.CancellationTokenSource().token` and throw away the source. Store it, pass `.token`, call `.dispose()` in the `proc.on('close')` handler.

- [x] **Scenario name collision across features** — `ParsedReport.scenarios` is keyed by `el.name` only. Two features with a scenario named `"Login"` means one silently overwrites the other. Key it as `featureName::scenarioName` and match accordingly in `_applyScenario`.

- [x] **`scenarioDecoration` in `extension.ts` is never disposed** — it's created at module level with `createTextEditorDecorationType` but never pushed to `context.subscriptions`. Add it.

- [x] **`_reloadFile` uses `fs.readFileSync` on a file watcher callback** — this blocks the extension host thread. Replace with `vscode.workspace.fs.readFile` (async).

- [x] **Shell injection via scenario/tag names** — `safeFilter` only replaces `"` with `.`. A scenario named `` `$(id)` `` or `$HOME` passes through unmodified. Pass args as an array to `spawn` and drop `shell: true`, or at minimum strip all shell metacharacters.

---

## Performance

- [x] **`provideCodeLenses` calls `collectMissingSteps` → `parseFeatureFile` on every keystroke** — cache the result keyed by `document.uri.toString() + document.version` and invalidate only when the version changes.

- [x] **`_updateAll` in `diagnosticsProvider` re-parses every open feature file when any `.java`/`.ts`/`.js` changes** — debounce it with a 300ms timeout; step files rarely change mid-session.

- [x] **`StepDefinitionIndex` has a second `FileSystemWatcher` for `*.{java,ts,js}`** — `diagnosticsProvider` creates its own identical watcher. Expose an `onDidChange` event from the index and subscribe to that instead.

- [x] **`_discoverAll` is called in the constructor and again via `resolveHandler`** — it runs twice on activation. Guard with a flag or remove the constructor call and rely solely on `resolveHandler`.

---

## Correctness / Edge Cases

- [x] **Scenario Outline examples all share the same `line` (the outline's line)** — `featureParser` sets `line: outlineTemplate.line` for every expanded row. The actual data row line is available at parse time (`i`); use it so inline decorations and Test Explorer navigation land on the right line.

- [x] **`rerunFailed` runs scenarios from the last run of *any* feature, not the one you clicked** — `_failedScenarios` is keyed by `uri.fsPath` but is only correct if the last run was for that exact file; running a different file first silently clears it. Document this or scope it properly.

- [x] **`gradleExe()` is defined but never called** — `gradleConfig` is called directly with a string. The function is dead code; remove it.

- [x] **`detectProject` only looks at `workspaceFolders[0]`** — in a monorepo with multiple sub-projects, every feature file uses the root detector. Walk up from the feature file's directory to find the nearest `pom.xml` / `package.json` instead.

- [x] **Background steps may cause step index misalignment** — if the Cucumber JSON reporter omits background steps from scenario elements (some versions do), step index alignment between `featureParser` and `reportParser` breaks silently.

---

## UX / Quality of Life

- [x] **No user-facing error when the report file is missing after a run** — the run silently marks everything as skipped. Show a warning notification with the expected report path so users know what to configure.

- [x] **`_fallback` creates a new terminal on every tag run** — `runByTag` always falls back to a terminal and creates a new one each time. Reuse an existing `GherkinFlow` terminal if one is already open.

- [x] **Completion only matches from the start of the typed text** — `filter(p => p.toLowerCase().startsWith(typed))` misses mid-string matches. Use `includes` or fuzzy match so `"enter credentials"` surfaces when you type `"cred"`.

- [x] **`package.json` version is `0.9.1` but README says `0.9.4`** — they're out of sync; align them before the next publish.

- [x] **No `eslint` or `prettier` config** — the codebase is consistent now but will drift. Add at minimum `strict: true` to `tsconfig.json`.

---

## Killer Feature Ideas

- [x] **Dry run mode** — add a `▶ Dry Run` CodeLens that runs Cucumber with `--dry-run`. Validates all step bindings instantly without executing anything.

- [ ] **Inlay hints for step parameters** — use the VS Code inlay hints API (1.79+) to show parameter type labels directly on `{string}` / `{int}` values in the feature file.

- [ ] **Step usage heatmap** — track how many feature files reference each step definition. Show a CodeLens on the definition: `Used in 12 scenarios`. Helps find dead or duplicate steps.

- [ ] **Watch mode** — `👁 Watch` CodeLens that re-runs the scenario automatically on save of any related `.feature` or step definition file.

- [ ] **Tags sidebar** — tree view showing all tags across the workspace with pass/fail counts from the last run: `@smoke (12 passed, 1 failed)`.

- [ ] **Scenario diff view** — on failure, show a side-by-side diff of the last passing run vs the current failure using `vscode.diff`. Persist last-passed report in `workspaceState`.

- [ ] **Multi-root / monorepo support** — detect build tool per feature file by walking up the directory tree, not just from `workspaceFolders[0]`.
