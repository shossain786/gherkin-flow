# Gherkin Flow

Run Cucumber scenarios directly from `.feature` files in VS Code — with step-by-step results, CodeLens run buttons, step definition navigation, autocomplete, and inline failure decorations.

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
Steps with no matching Java definition are underlined with a warning. Hover to see the message. All unmatched steps appear in the **Problems** panel (Ctrl+Shift+M).

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
