# Changelog

All notable changes to GherkinFlow are documented here.

---

### 0.9.44
**New extension icon** — refreshed branding with a redesigned logo: a cucumber medallion paired with a checkmark badge on a dark rounded-square background, used for the Marketplace listing and `.feature` file icon.

### 0.9.43
**Auto-indent while typing** — pressing Enter after `Feature:`/`Rule:`/`Background:`/`Scenario(:Outline):`/`Examples:` now indents the next line one level deeper, while step lines, table rows, and tag lines keep the same indentation for the line that follows. Adds `editor.tabSize: 2` / `insertSpaces: true` / `detectIndentation: false` defaults for `.feature` files so indentation matches the existing formatter's 0/2/4/6 convention.

**Gherkin keyword completions** — typing `Fea`, `Sc`, `Giv`, etc. now suggests `Feature:`, `Scenario:`, `Scenario Outline:`, `Background:`, `Examples:`, `Given `, `When `, `Then `, `And `, `But `.

**Fix: step suggestions duplicated typed text** — accepting a suggested step definition now replaces the text you'd already typed instead of appending the suggestion after it (e.g. typing `Given I` and accepting `I perform an action` previously produced `Given I I perform an action`).

### 0.9.42
**Fix: syntax highlighting was completely broken** — `syntaxes/gherkin.tmLanguage.json` contained an invalid JSON escape sequence (`\`` before backticks) in the docstring patterns. This caused the entire Gherkin grammar to fail to load, so `.feature` files rendered as plain text with no highlighting at all (Feature/Scenario/Given/When/Then keywords, tags, strings, tables — none of it). Fixed by removing the unnecessary escapes around the ` ``` ` docstring delimiter.

**Added a file icon for `.feature` files** — the `gherkin` language now contributes its own icon (shown in the Explorer and editor tabs), so `.feature` files display the GherkinFlow icon instead of falling back to a generic file icon.

### 0.9.41
**Linter rules GF008–GF011 + configurable disable** — four new quality rules:
- **GF008** *(warning)*: Feature file with no runnable scenarios
- **GF009** *(warning)*: Background with more than 4 steps (shared setup anti-pattern)
- **GF010** *(hint)*: Same quoted string literal repeated in 3+ scenarios — suggests a Scenario Outline
- **GF011** *(error)*: `And`/`But` as the very first step in a scenario (no Given/When/Then opener)

Adds `gherkinflow.lint.disable` setting (array of rule codes) to suppress any rule per project — e.g. `["GF006","GF007"]` silences the UI-detail and jargon hints for teams that intentionally write implementation-level steps. The disable filter also applies to all pre-existing rules (GF001–GF007). Settings changes are picked up live without reloading.

### 0.9.40
**Generate CI Workflow** — Command palette → `GherkinFlow: Generate CI Workflow`. Scaffolds a ready-to-commit pipeline file for GitHub Actions, GitLab CI, or a Jenkinsfile, pre-filled with the runtime setup, install/test commands, working directory, and report-artifact path for your detected stack (Java/Maven, Java/Gradle, cucumber-js, or Behave) — including the correct subdirectory for monorepos. Prompts before overwriting an existing pipeline file.

### 0.9.39
**AI: Explain Failure** — a `💡 Explain Failure` CodeLens appears above any scenario (and Scenario Outline example row) that failed on its last run. Clicking it sends the failed step, the full error message, and the matched step definition source to GitHub Copilot, which streams a structured explanation into a new Markdown document: *What went wrong*, *Likely causes*, and *Suggested fix*. Requires VS Code 1.90+ with GitHub Copilot installed; all other features work without it.

### 0.9.38
**Faster Java scenario execution** — selected Java scenarios now use `feature:line` addressing when available, which reduces the cost of running a single scenario and avoids broader name-filter selection overhead.

**Better Test Explorer status fallback** — when the configured JSON report is missing or mismatched, GherkinFlow now uses live stdout step status to infer the scenario outcome instead of leaving the item unresolved.

Fix: step definition regex parser now correctly handles escape sequences and flags (`/pattern/gi`) in TypeScript/JavaScript step files. Previously a regex with a `/` in the pattern (e.g. `Given(/I visit \/home/)`) would be truncated at the inner slash.

### 0.9.37
**AI: Generate Scenarios from Description** — Command palette → `GherkinFlow: Generate Scenarios from Description`. Type (or select) a plain-English requirement and GherkinFlow generates a complete, production-quality `.feature` file using GitHub Copilot. The result streams live into a new editor tab so you see scenarios appear as they are written. Up to 25 existing step patterns from your project are injected as context so the AI reuses real definitions instead of inventing new ones. Requires VS Code 1.90+ with GitHub Copilot installed; all other features work without it.

**HTML/Allure report opener** — a `📄 Open Report` button appears on the `Feature:` line whenever a report file is detected in the project. Clicking it opens the report directly in the system browser. Checks in order: the `html:` formatter path declared in `cucumber.js`, then Allure (`allure-report/index.html`), then common defaults for Maven, Gradle, and cucumber-js.

**Similar step suggester** — when a step has no definition, the lightbulb now offers existing step patterns ranked by similarity before the Generate option.

**Outline PENDING fix** — `▶ Run All Rows` on Scenario Outlines now uses `file:LINE` addressing, eliminating the PENDING error in projects with `parallel: N` configured.

### 0.9.36
**Similar step suggester** — when a step has no definition, GherkinFlow now analyses your existing step patterns for semantic similarity and offers quick-fix actions directly in the lightbulb menu:

```
⚠ No step definition found for: "I navigate to the home page"
  💡 Use: I navigate to {string}   (87% match — LoginSteps.java:12)
  💡 Use: I am on the {string} page (61% match — NavigationSteps.java:8)
  ⚡ Generate step definition
```

- Similarity is computed using Jaccard index on meaningful word tokens (stop words stripped)
- The replacement preserves values from the original step text: `{string}` slots are filled with quoted values already present, `{int}`/`{float}` slots with numbers
- The top suggestion is marked as the preferred (bold) action; Generate stub falls back when no similar step is found
- Works across all supported stacks (Java, TypeScript, JavaScript, Python)

### 0.9.35
**Gherkin Quality Linter** — GherkinFlow now analyses your feature files for structural and style issues and reports them as inline diagnostics (visible in the Problems panel and as underlines in the editor):

| Code | Severity | Rule |
|---|---|---|
| GF001 | ❌ Error | Duplicate scenario name in the same feature |
| GF002 | ⚠ Warning | Scenario Outline with only one example row — use a plain Scenario |
| GF003 | ⚠ Warning | Scenario has no Then step (no assertion) |
| GF004 | ⚠ Warning | Scenario has no When step (no action) |
| GF005 | ⚠ Warning | Scenario has more than 8 steps — consider splitting |
| GF006 | 💡 Hint | Step leaks UI implementation detail (click, button, CSS selector, XPath…) |
| GF007 | 💡 Hint | Step contains developer jargon (API, SQL, JSON, endpoint…) |

Fix: Scenario Outline parent (`▶ Run All Rows`) now uses `file:LINE` addressing instead of `--name`, matching the fix applied to regular scenarios in 0.9.29. This eliminates the `PENDING` error that occurred when `parallel: N` was set in `cucumber.js`.

### 0.9.34
Fix: Impacted test finder now works reliably across all supported languages (Java, TypeScript, JavaScript, Python). The previous two implementations both depended on VS Code save events (`onDidSaveTextDocument`, `onWillSaveTextDocument`) to capture a pre-change snapshot, which was unreliable — save events fire at different times relative to the OS file-watcher depending on the language tooling and platform. Replaced with a baseline-snapshot approach: at startup the analyzer seeds a pattern cache from the already-scanned index, then on every `onDidChange(uri)` event it diffs the current index state against that cache and updates the cache. No save events involved — works for user saves, auto-save, external formatters, and git operations equally.

### 0.9.33
Fix: Impacted test finder now works correctly for TypeScript/JavaScript cucumber-js projects. The previous version used `onDidSaveTextDocument` to capture the pre-save step pattern snapshot, but on Windows the OS file-watcher (`ReadDirectoryChangesW`) can notify VS Code and reload the index before `onDidSaveTextDocument` fires for fast-writing file types like `.ts`/`.js`. This caused the "before" and "after" snapshots to be identical and no notification to appear. Fixed by switching to `onWillSaveTextDocument` which fires before the file hits disk, guaranteeing the snapshot is always captured before any reload. Also normalises file path keys to lowercase to prevent Windows drive-letter case mismatches between VS Code's URI system and OS paths.

### 0.9.32
**Impacted test finder** — GherkinFlow now watches your step definition files and automatically identifies which scenarios are affected when you save changes. Save a `.java`, `.ts`, `.js`, or `.py` step file and a notification appears instantly:

> *⚡ 14 scenarios affected by step changes in LoginSteps.java (2 patterns removed)*

- **Run Impacted** — runs only the affected scenarios in Test Explorer with one click, no manual test selection needed
- **Show List** — opens a searchable list of all affected scenarios with feature name and file path; click any entry to navigate directly to it
- No notification is shown when no scenarios are affected, keeping the experience quiet by default
- Uses the already-loaded Test Explorer tree — zero additional file I/O on save

### 0.9.31
Fix: Python / Behave stub generation now produces valid, runnable stubs. Previously the generator used Cucumber Expression syntax (`{string}`, `{int}`) which Behave does not understand, and produced duplicate parameter names (e.g. `def func(context, string, string)`) that are invalid Python. Stubs now use Behave's `parse` format — quoted strings become `"{argN}"`, integers `{argN:d}`, floats `{argN:f}` — with unique parameter names and function names derived from the step text rather than the literal values. The step file picker now only shows `.py` files for Behave projects (previously showed Java/TS/JS files alongside Python ones).

### 0.9.30
**Debug mode** — a `$(debug-alt) Debug` button now appears above every scenario. Click it to run the scenario with the debugger attached: set a breakpoint in any step definition and step through it interactively without leaving VS Code. Works across all supported stacks:
- **Node.js (cucumber-js)**: spawns with `--inspect-brk` and auto-attaches VS Code's Node debugger
- **Java (Maven)**: runs with `-Dmaven.surefire.debug` (suspends on port 5005) and attaches the Java debugger
- **Java (Gradle)**: runs with `--debug-jvm` (suspends on port 5005) and attaches the Java debugger
- **Python (Behave)**: runs via `python -m debugpy --listen 5678 --wait-for-client` and attaches the Python debugger

No `launch.json` configuration required — GherkinFlow attaches automatically after the process is ready.

### 0.9.29
Fix: scenario runs on cucumber-js projects with `parallel: N` configured in `cucumber.js` no longer throw `"instance not running (PENDING)"`. The root cause: `--name "scenario"` filter forces the parallel coordinator to scan support files to match scenario names, but does so before `reset()` initialises the Cucumber instance. GherkinFlow now uses the `features/file.feature:LINE` line-number addressing format instead of `--name`, which lets cucumber-js filter scenarios directly from the Gherkin AST without touching support code. Falls back to `--name` only when no line number is available (rare fallback path).

### 0.9.28
Fix: removed the `--parallel 0` flag that was silently breaking projects using playwright-bdd and similar cucumber-js setups. In certain cucumber-js v11 configurations, passing `--parallel 0` triggers an internal coordinator code path that imports support modules before the Cucumber instance is initialised (status: PENDING), causing `setDefaultTimeout()` and `setWorldConstructor()` to throw even though the same command works fine from a terminal. Also strip `ELECTRON_RUN_AS_NODE` from the child process environment to prevent VS Code's Electron runtime from leaking into spawned Node processes.

### 0.9.27
Fix: scenario and feature runs now pass `--parallel 0` to override any `parallel: N` set in `cucumber.js`. With parallel workers enabled, support files (e.g. `hooks.ts`, `world.ts`) were loaded inside worker processes before `startWrappingMethods()` initialised the Cucumber instance, causing module-level calls like `setDefaultTimeout()` and `setWorldConstructor()` to throw `"instance not running (PENDING)"`. Serial mode (`--parallel 0`) guarantees the correct initialisation order. Tag runs keep the project's parallel setting.

### 0.9.26
Fix: never fall back to `npx cucumber-js` — if `@cucumber/cucumber` is not installed locally, print a clear error telling the user to run `npm install` instead of downloading the security-placeholder package from npm.

### 0.9.25
Fix: Node.js Cucumber projects now invoke `node node_modules/@cucumber/cucumber/bin/cucumber-js` directly when the local binary is installed, instead of relying on `npx cucumber-js`. Previously, when `node_modules` was absent or `cucumber-js` was not locally installed, `npx` would fall back to downloading the npm package named `cucumber-js` — which is a security placeholder, not the actual runner — producing a confusing error. The local binary is now preferred; `npx` is only used as a last resort.

### 0.9.24
Fix: Playwright + cucumber-js projects now work correctly. Previously, the presence of a `cucumber.js` config file caused GherkinFlow to assume JSON reporting was already configured and skip adding the `--format json:` arg. Playwright projects always have `cucumber.js` for TypeScript/fixture setup but rarely include JSON output — so the report file was never written and Test Explorer stayed empty. GherkinFlow now reads the config to check whether a `json:` formatter is actually declared. If not, it appends one automatically. If it is, the declared path is used as the report location.

### 0.9.23
Real-time step progress — Test Explorer now updates step-by-step as tests run instead of waiting for the full suite to finish. Steps turn green (✓) or red (✗) the moment they complete. Supports Cucumber JVM (pretty formatter), Behave, and cucumber-js. Final results from the JSON report are applied after the run and remain the authoritative source.

### 0.9.22
Python / Behave support — GherkinFlow now works with Python BDD projects using Behave. Auto-detected via `behave.ini`, `features/steps/` directory, or `behave` in `requirements.txt`. Run buttons execute `behave` with JSON output automatically appended. Step definitions in `.py` files are indexed for Ctrl+click navigation, autocomplete, missing step detection, and stub generation. Behave JSON duration (seconds) is correctly converted to milliseconds in Test Explorer.

### 0.9.21
Scenario history — after each run, pass/fail and duration are persisted in workspace state (up to 10 runs per scenario). A history CodeLens appears above the scenario once it has been run at least once, showing the last 5 results as `✓ ✓ ✗ ✓ ✓`. Mixed results are flagged as `⚡ Flaky  ✓ ✗ ✓`. Click the lens to see a full timestamped history in a popup. History survives VS Code restarts.

### 0.9.20
README and Marketplace description updated to clearly show JavaScript/TypeScript (cucumber-js) support alongside Java. Added `cucumber-js`, `javascript`, `typescript`, and `nodejs` keywords for Marketplace discoverability.

### 0.9.19
Parallel run support — after each run, GherkinFlow scans for sibling report files alongside the primary report (e.g. `cucumber-report-1.json`, `cucumber-report-2.json`) and a parallel reports directory (e.g. `target/cucumber-reports/*.json`). All found reports are merged before applying results to Test Explorer, so parallel Cucumber executions show correct pass/fail per scenario without any configuration.

### 0.9.18
README update — Features section and comparison table updated to document Watch mode, Tags sidebar, Parameter type hints, and Step usage heatmap. Roadmap cleaned up (Tags sidebar marked shipped).

### 0.9.17
Fix: tag runs (`▶ @smoke`) now go through the tracked execution path instead of the terminal fallback. Results appear in Test Explorer and the Gherkin Tags sidebar shows pass/fail counts immediately after the run.

### 0.9.16
- **Tags sidebar** — a *Gherkin Tags* panel appears in the Testing side bar listing every `@tag` in the workspace. Expand a tag to see all scenarios under it; click any scenario to jump to it. Pass/fail icons update automatically after each run: green tick when all scenarios for a tag passed, red circle when any failed.
- **Step usage heatmap** — a `$(references) Used in N steps` CodeLens appears above every `@Given`/`@When`/`@Then` annotation in your Java/TypeScript/JavaScript step definition files. `$(warning) Unused step` flags definitions that no feature file references.

### 0.9.15
- **Watch mode** — click `👁 Watch` above any scenario to auto-rerun it on save. Saving the feature file re-runs it immediately; saving a step definition file re-runs all watched scenarios (with a short debounce). Click `👁 Watching` to stop.
- **Inlay type hints** — parameter types (`string`, `int`, `float`, `word`) appear as inline grey annotations after each matched value in a step, e.g. `Given I enter "admin"`: string. Powered by the VS Code Inlay Hints API.

### 0.9.14
Fix: dry run (and tag runs) sent Maven/Gradle system property args (e.g. `-Dcucumber.features=...`) to the terminal without quoting. PowerShell/cmd.exe split these at the `.`, causing Maven to receive `.features=...` as an unknown lifecycle phase. Args starting with `-D` or `-P` are now quoted before being sent to the terminal.

### 0.9.13
- **Monorepo support** — build tool is now detected by walking up from each feature file's directory instead of always using the workspace root. Maven, Gradle, and Node.js sub-projects in a multi-module repo each use their own `pom.xml` / `gradlew` / `package.json` as the working directory
- **Background step misalignment fix** — some Cucumber JSON reporters omit background steps from scenario elements; step results now align correctly by detecting the offset rather than silently decorating the wrong lines
- **`rerunFailed` scope fix** — running a single scenario no longer overwrites the failure list for the whole feature; failures are merged per scenario so Re-run always targets the correct set
- **Dry run** — `⚡ Dry Run` CodeLens on every Feature line; runs Cucumber with `--dry-run` / `-Dcucumber.filter.dryRun=true` to validate step bindings instantly without executing tests

### 0.9.12
Fix: scenario names containing double quotes (`"`) now run correctly — quotes are replaced with `.` (regex wildcard) in the Cucumber filter value, which matches correctly and avoids `cmd.exe` shell quoting issues on Windows.

### 0.9.11
Fix: Scenario Outline names (and any scenario name) containing spaces now run correctly — args with spaces are quoted before being passed to the shell, so Maven/Gradle no longer interprets words after the first space as extra lifecycle phases.

### 0.9.10
Fix: tests not running on Windows — `shell: false` prevented batch-script executables (`mvn.cmd`, `npx.cmd`, `gradlew.bat`) from being found. Reverted to `shell: true` while keeping the args-array structure. Added `proc.on('error')` handler so a failed spawn always resolves cleanly instead of hanging the cancel button indefinitely.

### 0.9.9
Fix: stop button now appears for runs triggered from the Test Explorer gutter/panel as well as from CodeLens buttons — the run profile callback now fires the running state event in both paths.

### 0.9.8
Fix: clicking a run button while a test is already running now cancels the active run before starting the new one — no more two processes running simultaneously. A **$(stop-circle) Stop GherkinFlow** button appears in the status bar during any run and cancels it immediately when clicked.

### 0.9.7
- **Format Document** (`Shift+Alt+F`) fixes Gherkin indentation in one shot — Feature at 0, Scenario/Background at 2, steps at 4, Examples table rows at 6; works with Format on Save
- **Run single Examples row** — each data row in a Scenario Outline Examples table gets its own `▶ Run | col1 | col2 |` CodeLens so you can test one row without commenting out the others
- **Duplicate scenario name warning** — flags both occurrences inline and in the Problems panel when two scenarios in the same feature file share a name
- **Shell injection fix** — scenario and tag names are now passed as separate args to `spawn` with `shell: false` instead of interpolated into a shell command string
- **Async step file reads** — `_reloadFile` now uses `vscode.workspace.fs.readFile` instead of blocking `fs.readFileSync`

### 0.9.6
Quality improvements: autocomplete now matches mid-string (type any word in a step and suggestions appear); diagnostics re-evaluation after step file changes is debounced to 300 ms to avoid redundant passes during rapid edits; diagnostics provider now reacts to the step index's own change event instead of maintaining a separate `FileSystemWatcher`.

### 0.9.5
Internal quality fixes: map leaks on feature file reload, `CancellationTokenSource` disposed after each run, `GherkinFlow` terminal reused across tag runs, warning shown when Cucumber JSON report is missing after a run, decoration types properly disposed on deactivation, dead code removed.

### 0.9.4
Fix: Ctrl+click on a step again opens the step definition in a new permanent tab. The DocumentLinkProvider is restored for navigation; a `textDecoration: none` decoration is applied over matched step text to cancel the underline VS Code would otherwise show.

### 0.9.3
- Fix: step text in feature file is no longer underlined (removed DocumentLinkProvider; Ctrl+click via DefinitionProvider is unaffected)
- Fix: steps in Test Explorer now appear in the same order as the feature file — `sortText` set on all test items using their file position index
- Fix: `🔄 Re-run` button now appears on the specific scenario that failed, not at the top of the feature file

### 0.9.2
- Ctrl+click on a step now opens the step definition in a **new permanent tab** instead of reusing the current editor
- Hover tooltip now correctly renders Javadoc/JSDoc HTML tags (`<br>`, `<ul>`, `<li>`, `<b>`, etc.)
- `🔄 Re-run Failed (N)` CodeLens appears on the Feature line after any run that had failures — re-runs only the failed scenarios

### 0.9.1
README overhaul — new headline, pain-to-solution hook, Why GherkinFlow comparison table, benefit-driven feature descriptions, roadmap section, and demo GIF.

### 0.9.0
Step hover tooltip — hovering any Gherkin step shows the matched Cucumber pattern, the step definition file and line number, and the Javadoc/JSDoc comment if one is present above the method.

### 0.8.2
Fix: the light bulb quick fix now correctly includes `DataTable`/`DocString` parameters — previously only the CodeLens path detected them; the quick fix path rebuilt the step without checking the following lines.

### 0.8.1
Fix: generated step definitions now include the correct extra parameter when a step is followed by a DataTable (`io.cucumber.datatable.DataTable` for Java, `DataTable` for TypeScript) or a DocString (`String` / `string`).

### 0.8.0
Generate Step Definitions — `⚡ Generate Missing Steps (N)` CodeLens appears on the Feature line when unmatched steps exist. Click to generate all stubs at once into a chosen step definition file. A light bulb quick fix on each underlined step offers single-step or bulk generation. Supports Java, TypeScript, and JavaScript with correct annotations, types, and file headers.

### 0.7.4
Fix: clicking a step in Test Explorer now shows `System.out.println` and log output captured during that step — parsed from the `output` field in the Cucumber JSON report.

### 0.7.3
Fix: scenario names containing double quotes (`"`) no longer break the run command — quotes are replaced with `.` (regex wildcard) in the Cucumber filter, which matches correctly without shell quoting issues.

### 0.7.2
Fix: scenario run command now includes feature file path (`-Dcucumber.features`) so projects with Maven runner class configuration work correctly.

### 0.7.1
Added Marketplace screenshots showcasing all key features.

### 0.7.0
JavaScript/TypeScript Cucumber support — auto-detects `@cucumber/cucumber` projects, runs via `npx cucumber-js`, scans `.ts`/`.js` step definitions for jump, autocomplete, and missing step detection.

### 0.6.0
Gherkin syntax highlighting — proper TextMate grammar with coloured keywords, tags, strings, table cells, docstrings, and outline parameters.

### 0.5.0
Inline failure decoration — failed steps highlighted with red background and inline error text.

### 0.4.0
Gherkin autocomplete — step definition suggestions while typing in `.feature` files.

### 0.3.0
Missing step detection — warning underlines for steps with no matching Java definition.

### 0.2.0
Step Definition Jump (Ctrl+click), Tag Filtering CodeLens buttons, GitHub Actions CI/CD.

### 0.1.0
Initial release with CodeLens, Test Explorer integration, Scenario Outline support, and step-level results.
