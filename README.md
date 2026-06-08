# Gherkin Flow

**The AI-powered BDD toolkit for VS Code.**

> Write better scenarios, run faster, debug instantly — without leaving your feature file.
>
> Describe a requirement in plain English and watch GherkinFlow generate a complete `.feature` file. Run any scenario with one click, step through failures in the debugger, and let the AI-driven quality linter catch bad BDD before your team review.
>
> Supports **Java** (Maven / Gradle), **JavaScript / TypeScript** (cucumber-js), and **Python** (Behave) — zero configuration required.

---

![GherkinFlow Demo](images/demo.gif)

---

## The Problem

Your Gherkin test fails. Now what?

1. Scroll through 300 lines of Maven / npm / behave output to find which step broke
2. Copy the error, manually search across Java / TypeScript / JavaScript / Python files
3. Open the file, fix the step, switch back to the terminal
4. Re-run the entire suite and wait again
5. Repeat — ten times a day

And before it even runs: you spent 20 minutes writing scenarios from scratch, duplicated three step definitions that already existed, and shipped scenarios with no `Then` assertion that nobody caught in review.

That's not a test workflow. That's a context-switch tax — plus a quality problem.

**GherkinFlow eliminates every one of those switches** and brings AI into your BDD loop: generate scenarios, catch quality issues, debug step-by-step, and know instantly when your code changes break existing tests — all from the feature file.

---

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="images/highligh-run-btn.png" alt="CodeLens Run Buttons" width="100%"/>
      <br/><sub><b>▶ One-Click Run</b><br/>Run buttons appear inline above every scenario — no terminal needed</sub>
    </td>
    <td align="center" width="50%">
      <img src="images/run-btn.png" alt="Run Buttons in Feature File" width="100%"/>
      <br/><sub><b>▶ Run Feature File</b><br/>Run all scenarios including Scenario Outline examples</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="images/step-by-step-visual.png" alt="Step-by-Step Results" width="100%"/>
      <br/><sub><b>🧪 Step-by-Step Results</b><br/>See exactly which step passed or failed — with timing</sub>
    </td>
    <td align="center" width="50%">
      <img src="images/failures-in-secnario-display.png" alt="Inline Failure Decoration" width="100%"/>
      <br/><sub><b>🔴 Failure Right in Your File</b><br/>Error message shown as inline ghost text on the failed step</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="images/undefined-step-highlight.png" alt="Missing Step Detection" width="50%"/>
      <br/><sub><b>⚠️ Missing Step Detection</b><br/>Undefined steps underlined before you even run — with autocomplete</sub>
    </td>
  </tr>
</table>


---

## Why GherkinFlow?

| Without GherkinFlow | With GherkinFlow |
|---|---|
| Write scenarios from scratch every time | **AI generates a full feature file** from plain English |
| Run tests from the terminal | Click **▶** directly above any scenario |
| Scroll terminal output to find failures | See pass/fail **per step** in Test Explorer |
| Add print statements and re-run to debug | **One-click debug** — attach the debugger to any scenario |
| Search Java / TS / JS files manually for step definitions | **Ctrl+click** any step to jump instantly |
| Write a step that already exists elsewhere | **Similar step suggester** shows the closest match |
| Undefined steps only fail at runtime | **Underline warning** appears as you type |
| Write stub boilerplate by hand | **Generate all missing stubs** in one click |
| Bad BDD only gets caught in PR review | **Quality linter** flags no-Then, too many steps, UI leaks |
| No context when reading a step | **Hover** shows the matched pattern + doc comment |
| Re-run manually after every edit | **Watch mode** reruns on save automatically |
| Hunt for tag usage across files | **Tags sidebar** shows all tags with pass/fail counts |
| Dead step definitions accumulate silently | **Usage heatmap** flags unused steps instantly |
| Save a step file, wonder what broke | **Impact finder** shows affected scenarios instantly |
| Switch to browser to check the HTML report | **Open Report** launches it from the Feature line |
| Hand-write CI pipeline YAML and guess at paths | **Generate CI Workflow** scaffolds GitHub Actions / GitLab CI / Jenkinsfile from your detected stack |

---

## Features

### ▶ One-Click Run — No Terminal Needed
Clickable **▶ Run Scenario** and **▶️ Run Feature** buttons appear inline above every scenario. Tag buttons appear automatically for tagged scenarios — run `@smoke` or `@regression` directly from the file.

```
@smoke @regression
▶ Run Scenario  ▶ @smoke  ▶ @regression
Scenario: Admin login
```

You can also right-click anywhere in a feature file:
- **Run Scenario (GherkinFlow)** — runs the scenario at your cursor
- **Run Feature File (GherkinFlow)** — runs all scenarios in the file

### 🧪 Know Exactly Which Step Failed
The VS Code Testing panel shows a full hierarchical tree with pass ✓ / fail ✗ per step and execution time. Click any failed step to see the full error message, stack trace, and `System.out.println` / log output captured during that step.

```
▼ Feature: Login
  ▼ ✗ Scenario: Admin login         (320ms)
      ✓ Given I am on the login page
      ✓ When I enter admin credentials
      ✗ Then I see the dashboard     ← AssertionError: expected 'Login' but was 'Dashboard'
  ▼ Scenario Outline: Login as <role>
    ▼ ✓ Login as admin
        ✓ Given I log in as "admin"
```

### 🔴 See the Error Without Leaving the File
After a run, failed steps are highlighted with a red background and the error message is shown as inline ghost text — right on the line that broke. No switching windows, no scrolling logs.

```
  ✓ Given I am on the login page
  ✓ When I enter admin credentials
  ✗ Then I see the dashboard   ← AssertionError: expected 'Login' but was 'Dashboard'
```

Decorations clear automatically on the next run.

### 💬 Hover to Inspect Any Step
Hover any Gherkin step to see the matched Cucumber expression, the source file and line number, and the Javadoc/JSDoc comment if one exists above the method.

```
@Given("I enter {string} in {string}")
LoginSteps.java:42

---
Enters text into a named input field.
@param value  the text to type
@param field  the field label
```

### 🔗 Ctrl+Click to Jump to the Definition
**Ctrl+click** any step to jump directly to the matching Java, TypeScript, or JavaScript step definition. Supports both Cucumber Expressions (`{string}`, `{int}`) and regex patterns. Updates automatically when your step files change.

### 💡 Autocomplete from Your Own Codebase
Type `Given `, `When `, `Then ` and get inline suggestions pulled from your existing step definitions — with snippet placeholders for parameters.

```
Given I enter |
              ↓
  ✦ I enter {string} in {string}
  ✦ I enter {int} items
```

### ⚠️ Catch Missing Steps Before Running
Steps with no matching definition are underlined with a warning as you write them — not after a failed run. Hover the underline to see the message. All unmatched steps also appear in the **Problems** panel (Ctrl+Shift+M).

### ⚡ Generate All Missing Stubs in One Click
A `⚡ Generate Missing Steps (N)` button appears on the Feature line when unmatched steps exist. Click it to generate all stubs at once — pick an existing step file or create a new one. A light bulb quick fix on each underlined step also offers single or bulk generation.

Generated stubs include correct annotations, parameter types (including `DataTable` and `DocString`), and file headers for Java, TypeScript, and JavaScript:

```java
@Given("I enter {string} in {string}")
public void iEnterInField(String arg0, String arg1) {
    // TODO: implement
    throw new io.cucumber.java.PendingException();
}
```

### 👁 Watch Mode — Auto-Rerun on Save
Click **👁 Watch** above any scenario to start watching it. Every time you save the feature file that scenario reruns automatically — no manual click needed. Click **👁 Watching** to stop.

### 🏷 Tags Sidebar
A **Gherkin Tags** panel in the Testing activity bar lists every `@tag` across your workspace. Expand a tag to see all scenarios under it. After a run the tag shows `3 passed · 1 failed` with a green/red icon. Click any scenario to navigate directly to it.

### 🔢 Parameter Type Hints
Inline grey annotations appear after matched parameter values in your feature file:

```gherkin
When I enter "admin": string in "username": string
Given I add 3: int items to the cart
```

These are editor overlays — not real text — powered by the VS Code Inlay Hints API.

### 📊 Step Usage Heatmap
Open any Java/TypeScript/JavaScript step definition file. Each `@Given`/`@When`/`@Then` annotation shows a CodeLens with its usage count across all feature files:

```
$(references) Used in 5 steps
@Given("I enter {string} in {string}")
```

`$(warning) Unused step` flags definitions that no feature file references — helping you find dead code before it accumulates.

### 🚀 Generate CI Workflow
Command palette → `GherkinFlow: Generate CI Workflow`. Pick **GitHub Actions**, **GitLab CI**, or a **Jenkinsfile** and GherkinFlow scaffolds a ready-to-commit pipeline using the same stack detection that powers local runs — correct runtime setup, install/test commands, working directory (including monorepo subdirectories), and the report file wired up as a build artifact:

```yaml
- name: Run Cucumber tests
  working-directory: services/checkout
  run: mvn test

- name: Upload Cucumber report
  uses: actions/upload-artifact@v4
  with:
    path: services/checkout/target/cucumber-report.json
```

You'll be prompted before anything overwrites an existing pipeline file.

### 🔧 Zero-Config Build Detection
Automatically detects your build tool — no configuration file needed:

| Tool | Detected by |
|---|---|
| `./gradlew` / `gradlew.bat` | wrapper in project root |
| `mvn` / `./mvnw` | `pom.xml` or wrapper in project root |
| `npx cucumber-js` | `@cucumber/cucumber` in `package.json` |
| `behave` | `behave.ini`, `features/steps/` directory, or `behave` in `requirements.txt` |

---

## Quick Start

1. Open any workspace containing `.feature` files — the extension activates automatically
2. Click **▶ Run Scenario** above any scenario
3. Watch results appear step-by-step in the **Testing** panel (flask icon in the Activity Bar)
4. Click a failed step to read the error and stack trace
5. **Ctrl+click** any step to jump to its implementation

---

## Requirements

### Java (Maven / Gradle)
- Cucumber JVM 7+
- Maven or Gradle as the build tool
- A Cucumber JSON reporter writing to `target/cucumber-report.json`

Add the JSON reporter to your runner if not already present:
```java
@CucumberOptions(
    plugin = { "json:target/cucumber-report.json" }
)
```

### JavaScript / TypeScript
- `@cucumber/cucumber` in `package.json`
- The extension auto-detects and runs via `npx cucumber-js`
- JSON output written to `reports/cucumber.json` (configured automatically if no `cucumber.js` config file is found)

### Python (Behave)
- `behave` installed (`pip install behave`)
- Detected automatically via `behave.ini`, a `features/steps/` directory, or `behave` in `requirements.txt`
- JSON output written to `reports/behave.json` (appended automatically — no manual configuration needed)
- Step definitions in `features/steps/*.py` are indexed for jump, autocomplete, and missing step detection

---

## Roadmap

Have a feature request or found a bug? Open an issue on [GitHub](https://github.com/shossain786/gherkin-flow/issues) — contributions welcome.

---

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full version history.
