# Gherkin Flow

Run Cucumber scenarios directly from `.feature` files in VS Code — with a step-by-step test results panel, CodeLens run buttons, and full Test Explorer integration.

## Features

### ▶ CodeLens Run Buttons
Clickable **▶ Run Scenario** and **▶️ Run Feature** buttons appear inline above every scenario and feature line — no right-clicking needed.

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

## Usage

1. Open a workspace containing `.feature` files
2. Click **▶ Run Scenario** above any scenario, or **▶️ Run Feature** at the top
3. View results in the **Testing** panel (flask icon in Activity Bar)
4. Click any step to see its log output

### Right-click menu
Right-click anywhere inside a `.feature` file for:
- **Run Scenario (GherkinFlow)** — runs the scenario at the cursor
- **Run Feature File (GherkinFlow)** — runs all scenarios in the file

## Extension Settings

No configuration required. The extension auto-activates when a workspace contains `.feature` files.

## Known Limitations

- Requires the Cucumber JSON report at `target/cucumber-report.json`
- Per-step `System.out.println` output is not captured individually (Maven output stream only)

## Release Notes

### 0.1.0
Initial release with CodeLens, Test Explorer integration, Scenario Outline support, and step-level results.
