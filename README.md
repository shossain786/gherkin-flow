# gherkin-flow

A lightweight VS Code extension to run Cucumber scenarios directly from `.feature` files.

## Features

- Right-click inside a `.feature` file
- Detect the current `Scenario` under the cursor
- Run only that scenario via Maven/Gradle
- Output logs in the VS Code terminal

## Usage

1. Open a `.feature` file in VS Code.
2. Place the cursor inside the scenario you want to execute.
3. Right-click and choose `Run Scenario (GherkinFlow)`.
4. The extension runs a command in the workspace root terminal.

## Supported project layouts

- `gradlew` / `gradle`
- `mvnw` / Maven `pom.xml`

## Development

```bash
npm install
npm run compile
```
