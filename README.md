# Gherkin Flow

Run Cucumber scenarios directly from `.feature` files in VS Code — with step-by-step results, CodeLens run buttons, step definition navigation, autocomplete, and inline failure decorations.

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="images/highligh-run-btn.png" alt="CodeLens Run Buttons" width="100%"/>
      <br/><sub><b>▶ CodeLens Run Buttons</b><br/>Inline run buttons above every scenario and tag</sub>
    </td>
    <td align="center" width="50%">
      <img src="images/run-btn.png" alt="Run Buttons in Feature File" width="100%"/>
      <br/><sub><b>▶ Run Feature File</b><br/>Run all scenarios with Scenario Outline support</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="images/step-by-step-visual.png" alt="Step-by-Step Results" width="100%"/>
      <br/><sub><b>🧪 Step-by-Step Results</b><br/>Pass/fail status per step in the Test Explorer panel</sub>
    </td>
    <td align="center" width="50%">
      <img src="images/failures-in-secnario-display.png" alt="Inline Failure Decoration" width="100%"/>
      <br/><sub><b>🔴 Inline Failure Decoration</b><br/>Failed steps highlighted with inline error text</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="images/undefined-step-highlight.png" alt="Missing Step Detection" width="50%"/>
      <br/><sub><b>⚠️ Missing Step Detection</b><br/>Unmatched steps underlined — autocomplete suggestions shown</sub>
    </td>
  </tr>
</table>

---

## Features

### ▶ CodeLens Run Buttons
Clickable **▶ Run Scenario** and **▶️ Run Feature** buttons appear inline above every scenario and feature line — no right-clicking needed.

Tag buttons appear automatically when scenarios have tags:
```
@smoke @regression
▶ Run Scenario  ▶ @smoke  ▶ @regression
Scenario: Admin login
```

### 🧪 Test Explorer Integration
Full VS Code Testing panel support with a hierarchical tree view:
```
▼ Feature: Login
  ▼ ✓ Scenario: Admin login         (320ms)
      ✓ Given I am on the login page
      ✓ When I enter admin credentials
      ✓ Then I see the dashboard
  ▼ Scenario Outline: Login as <role>
    ▼ ✓ Login as admin
        ✓ Given I log in as "admin"
        ✓ Then I see the admin view
    ▼ ✓ Login as user
        ✓ Given I log in as "user"
        ✓ Then I see the user view
```

### 📋 Step-by-Step Results
Each step shows its individual pass ✓ / fail ✗ status and execution time. Click any failed step to see the full error message and stack trace.

### 🔴 Inline Failure Decoration
After a test run, failed step lines are highlighted with a red background and the error message is shown as inline ghost text — without leaving the feature file.

```
  ✓ Given I am on the login page
  ✓ When I enter admin credentials
  ✗ Then I see the dashboard   ← AssertionError: expected 'Login' but was 'Dashboard'
```

Decorations clear automatically on the next run.

### 🔗 Step Definition Jump
**Ctrl+click** any Gherkin step to jump directly to the matching Java step definition method. Supports both Cucumber Expressions (`{string}`, `{int}`) and regex patterns. Automatically updates when Java files change.

### 💡 Gherkin Autocomplete
Type `Given `, `When `, `Then ` etc. and get suggestions from your existing Java step definitions — with snippet placeholders for parameters.

```
Given I enter |
              ↓ suggestions:
  ✦ I enter {string} in {string}
  ✦ I enter {int} items
```

### ⚠️ Missing Step Detection
Steps with no matching definition are underlined with a warning. Hover to see the message. All unmatched steps appear in the **Problems** panel (Ctrl+Shift+M).

### ⚡ Generate Step Definitions
When a feature file has unmatched steps, a `⚡ Generate Missing Steps (N)` button appears on the Feature line. Click it to generate all missing stubs at once — pick an existing step definition file or create a new one. A light bulb quick fix on each underlined step offers single or bulk generation.

Generated stubs include correct annotations, parameter types, and file headers for Java, TypeScript, and JavaScript:
```java
@Given("I enter {string} in {string}")
public void iEnterInField(String arg0, String arg1) {
    // TODO: implement
    throw new io.cucumber.java.PendingException();
}
```

### 🎨 Visual Decorations
Scenario lines are highlighted with a green left border and subtle background, making them easy to spot in large feature files.

### 🔧 Build Tool Auto-Detection
Automatically detects and uses the right tool — no configuration needed:

| Tool | Detected by |
|---|---|
| `./gradlew` / `gradlew.bat` | `gradlew` / `gradlew.bat` in project root |
| `gradle` | `gradle` in project root |
| `./mvnw` / `mvnw.cmd` | `mvnw` / `mvnw.cmd` in project root |
| `mvn` | `pom.xml` in project root (fallback) |

---

## Requirements

- A Java project using **Cucumber JVM 7+**
- Maven or Gradle as the build tool
- A Cucumber JSON reporter writing to `target/cucumber-report.json`

Add the JSON reporter to your runner if not already present:
```java
@CucumberOptions(
    plugin = { "json:target/cucumber-report.json" }
)
```

---

## Usage

1. Open a workspace containing `.feature` files
2. Click **▶ Run Scenario** above any scenario, or **▶️ Run Feature** at the top
3. View results in the **Testing** panel (flask icon in Activity Bar)
4. Click any step to see its log output
5. **Ctrl+click** any step to jump to its Java implementation

### Right-click menu
Right-click anywhere inside a `.feature` file for:
- **Run Scenario (GherkinFlow)** — runs the scenario at the cursor
- **Run Feature File (GherkinFlow)** — runs all scenarios in the file

---

## Extension Settings

No configuration required. The extension auto-activates when a workspace contains `.feature` files.

---

## Known Limitations

- Requires the Cucumber JSON report at `target/cucumber-report.json`
- Currently supports Java (Maven/Gradle) projects only

---

## Release Notes

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

### 0.5.1
README documentation update.

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
