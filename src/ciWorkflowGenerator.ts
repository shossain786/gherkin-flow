import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, ProjectType } from './projectDetector';
import { GherkinTestController } from './testController';

type Provider = 'github' | 'gitlab' | 'jenkins';

interface ProviderChoice extends vscode.QuickPickItem {
  provider: Provider;
}

// POSIX-style join for YAML/Groovy paths — these run on Linux CI agents
// regardless of the host OS the workflow file is generated on.
function ciPath(...parts: string[]): string {
  return parts.filter(p => p !== '.' && p !== '').join('/').replace(/\\/g, '/');
}

// --- GitHub Actions -------------------------------------------------------

function buildGitHubActionsWorkflow(config: ProjectConfig, relDir: string): string {
  const reportPath = ciPath(relDir, config.reportPath);
  const wd         = relDir === '.' ? '' : `\n        working-directory: ${relDir}`;

  let setup: string;
  let install = '';
  let test: string;

  switch (config.type) {
    case 'java-maven':
      setup = [
        '      - name: Set up JDK',
        '        uses: actions/setup-java@v4',
        '        with:',
        '          distribution: temurin',
        "          java-version: '17'",
        '          cache: maven',
      ].join('\n');
      test = `mvn test`;
      break;
    case 'java-gradle':
      setup = [
        '      - name: Set up JDK',
        '        uses: actions/setup-java@v4',
        '        with:',
        '          distribution: temurin',
        "          java-version: '17'",
        '          cache: gradle',
      ].join('\n');
      test = `./gradlew test`;
      break;
    case 'node':
      setup = [
        '      - name: Set up Node.js',
        '        uses: actions/setup-node@v4',
        '        with:',
        "          node-version: '20'",
        "          cache: 'npm'",
      ].join('\n');
      install = `      - name: Install dependencies${wd}\n        run: npm ci\n\n`;
      test = `npx cucumber-js`;
      break;
    case 'python-behave':
      setup = [
        '      - name: Set up Python',
        '        uses: actions/setup-python@v5',
        '        with:',
        "          python-version: '3.x'",
      ].join('\n');
      install = `      - name: Install dependencies${wd}\n        run: pip install -r requirements.txt\n\n`;
      test = `behave --format json -o ${ciPath(relDir, 'reports/behave.json')}`;
      break;
  }

  return [
    'name: Cucumber Tests',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '    branches: [main]',
    '',
    'jobs:',
    '  cucumber-tests:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
    setup,
    '',
    install + `      - name: Run Cucumber tests${wd}`,
    `        run: ${test}`,
    '',
    '      - name: Upload Cucumber report',
    '        if: always()',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: cucumber-report',
    `          path: ${reportPath}`,
    '',
  ].join('\n');
}

// --- GitLab CI -------------------------------------------------------------

function buildGitLabCIConfig(config: ProjectConfig, relDir: string): string {
  const reportPath = ciPath(relDir, config.reportPath);
  const cd         = relDir === '.' ? [] : [`    - cd ${relDir}`];

  let image: string;
  let script: string[];

  switch (config.type) {
    case 'java-maven':
      image  = 'maven:3.9-eclipse-temurin-17';
      script = [...cd, '    - mvn test'];
      break;
    case 'java-gradle':
      image  = 'gradle:8-jdk17';
      script = [...cd, '    - gradle test'];
      break;
    case 'node':
      image  = 'node:20';
      script = [...cd, '    - npm ci', '    - npx cucumber-js'];
      break;
    case 'python-behave':
      image  = 'python:3.12';
      script = [
        ...cd,
        '    - pip install -r requirements.txt',
        '    - behave --format json -o reports/behave.json',
      ];
      break;
  }

  return [
    'stages:',
    '  - test',
    '',
    'cucumber-tests:',
    '  stage: test',
    `  image: ${image}`,
    '  script:',
    ...script,
    '  artifacts:',
    '    when: always',
    '    paths:',
    `      - ${reportPath}`,
    '',
  ].join('\n');
}

// --- Jenkinsfile -----------------------------------------------------------

function buildJenkinsfile(config: ProjectConfig, relDir: string): string {
  const reportPath = ciPath(relDir, config.reportPath);
  const indent     = (lines: string[], spaces: number) => lines.map(l => `${' '.repeat(spaces)}${l}`).join('\n');

  let testSteps: string[];
  switch (config.type) {
    case 'java-maven':
      testSteps = ["sh 'mvn test'"];
      break;
    case 'java-gradle':
      testSteps = ["sh './gradlew test'"];
      break;
    case 'node':
      testSteps = ["sh 'npm ci'", "sh 'npx cucumber-js'"];
      break;
    case 'python-behave':
      testSteps = [
        "sh 'pip install -r requirements.txt'",
        "sh 'behave --format json -o reports/behave.json'",
      ];
      break;
  }

  const stageBody = relDir === '.'
    ? indent(testSteps, 16)
    : `${' '.repeat(16)}dir('${relDir}') {\n${indent(testSteps, 20)}\n${' '.repeat(16)}}`;

  return [
    'pipeline {',
    '    agent any',
    '',
    '    stages {',
    "        stage('Checkout') {",
    '            steps {',
    '                checkout scm',
    '            }',
    '        }',
    "        stage('Run Cucumber Tests') {",
    '            steps {',
    stageBody,
    '            }',
    '        }',
    '    }',
    '',
    '    post {',
    '        always {',
    `            archiveArtifacts artifacts: '${reportPath}', allowEmptyArchive: true`,
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
}

// --- Command entry point ----------------------------------------------------

const TARGET_BY_PROVIDER: Record<Provider, string> = {
  github:  path.join('.github', 'workflows', 'cucumber-tests.yml'),
  gitlab:  '.gitlab-ci.yml',
  jenkins: 'Jenkinsfile',
};

const BUILDER_BY_PROVIDER: Record<Provider, (config: ProjectConfig, relDir: string) => string> = {
  github:  buildGitHubActionsWorkflow,
  gitlab:  buildGitLabCIConfig,
  jenkins: buildJenkinsfile,
};

export async function generateCIWorkflow(controller: GherkinTestController): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('GherkinFlow: Open a workspace folder before generating a CI workflow.');
    return;
  }
  const workspaceRoot = folder.uri.fsPath;

  const featureFiles = await vscode.workspace.findFiles('**/*.feature', '**/{node_modules,.git}/**', 1);
  if (featureFiles.length === 0) {
    vscode.window.showErrorMessage('GherkinFlow: No .feature files found in this workspace.');
    return;
  }

  const config  = controller.getConfig(featureFiles[0]);
  const relDir  = path.relative(workspaceRoot, config.projectRoot) || '.';
  const relDirP = relDir.replace(/\\/g, '/');

  const choice = await vscode.window.showQuickPick<ProviderChoice>([
    { label: '$(github-inverted) GitHub Actions', description: '.github/workflows/cucumber-tests.yml', provider: 'github' },
    { label: '$(gitlab) GitLab CI',               description: '.gitlab-ci.yml',                       provider: 'gitlab' },
    { label: '$(tools) Jenkinsfile',              description: 'Jenkinsfile (declarative pipeline)',   provider: 'jenkins' },
  ], {
    title: 'GherkinFlow — Generate CI Workflow',
    placeHolder: `Detected ${describeStack(config.type)} project — choose a CI provider`,
  });
  if (!choice) { return; }

  const content    = BUILDER_BY_PROVIDER[choice.provider](config, relDirP);
  const targetPath = path.join(workspaceRoot, TARGET_BY_PROVIDER[choice.provider]);

  if (fs.existsSync(targetPath)) {
    const relTarget = vscode.workspace.asRelativePath(targetPath);
    const pick = await vscode.window.showWarningMessage(
      `GherkinFlow: ${relTarget} already exists.`,
      { modal: true },
      'Overwrite', 'Open Existing'
    );
    if (!pick) { return; }
    if (pick === 'Open Existing') {
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');

  const doc    = await vscode.workspace.openTextDocument(targetPath);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);

  vscode.window.showInformationMessage(
    `GherkinFlow: Generated ${vscode.workspace.asRelativePath(targetPath)} for ${describeStack(config.type)}.`
  );
}

function describeStack(type: ProjectType): string {
  switch (type) {
    case 'java-maven':     return 'Java (Maven)';
    case 'java-gradle':    return 'Java (Gradle)';
    case 'node':           return 'Node.js (cucumber-js)';
    case 'python-behave':  return 'Python (Behave)';
  }
}
