import * as fs from 'fs';
import * as path from 'path';

const IS_WIN = process.platform === 'win32';

export type ProjectType = 'java-gradle' | 'java-maven' | 'node' | 'python-behave';

export interface SpawnArgs {
  file: string;
  args: string[];
}

export interface ProjectConfig {
  type: ProjectType;
  projectRoot: string;
  // line: 1-based line number of the scenario in the feature file.
  // When provided, node/behave runners use "file:line" instead of "--name" to avoid
  // loading support code in the parallel coordinator before reset() is called.
  buildScenarioArgs(name: string, featureRelPath?: string, line?: number): SpawnArgs;
  buildFeatureArgs(relativePath: string): SpawnArgs;
  buildTagArgs(tag: string): SpawnArgs;
  buildDryRunArgs(featureRelPath: string): SpawnArgs;
  // Debug: spawn with debugger listening, then attach VS Code debugger.
  buildDebugScenarioArgs(name: string, featureRelPath?: string, line?: number): SpawnArgs;
  debugPort: number;
  debugType: 'node' | 'java' | 'debugpy';
  reportPath: string;
  stepFileGlob: string;
}

function exists(dir: string, file: string): boolean {
  return fs.existsSync(path.join(dir, file));
}

function hasNodeCucumber(cwd: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    return '@cucumber/cucumber' in all || 'cucumber' in all;
  } catch { return false; }
}

// Returns the json: reporter path already declared in the user's cucumber config,
// or undefined when no JSON reporter is configured.
// Supports cucumber.js / .cucumber.js / cucumber.mjs / cucumber.cjs / cucumber.yaml.
function extractCucumberJsonPath(cwd: string): string | undefined {
  for (const f of ['cucumber.js', '.cucumber.js', 'cucumber.mjs', 'cucumber.cjs', 'cucumber.yaml', '.cucumber.yaml']) {
    try {
      const content = fs.readFileSync(path.join(cwd, f), 'utf8');
      const m = content.match(/['"`]json:([^'"`\s,)]+)/);
      if (m) { return m[1]; }
    } catch {}
  }
  return undefined;
}

function extractCucumberHtmlPath(cwd: string): string | undefined {
  for (const f of ['cucumber.js', '.cucumber.js', 'cucumber.mjs', 'cucumber.cjs', 'cucumber.yaml', '.cucumber.yaml']) {
    try {
      const content = fs.readFileSync(path.join(cwd, f), 'utf8');
      const m = content.match(/['"`]html:([^'"`\s,)]+)/);
      if (m) { return m[1]; }
    } catch {}
  }
  return undefined;
}

// Finds the first existing HTML report in the project, checking the project's
// configured formatter path first then common framework defaults.
export function findHtmlReport(projectRoot: string): string | undefined {
  const candidates = [
    extractCucumberHtmlPath(projectRoot),   // cucumber.js html: formatter
    'allure-report/index.html',             // Allure (all stacks)
    'reports/html/cucumber-report.html',    // cucumber-js common
    'reports/html/index.html',
    'reports/index.html',
    'target/cucumber-reports/index.html',   // Maven cucumber-reporting plugin
    'target/site/cucumber-pretty/index.html',
    'build/reports/tests/test/index.html',  // Gradle HTML test report
  ].filter((p): p is string => Boolean(p));

  for (const rel of candidates) {
    if (fs.existsSync(path.join(projectRoot, rel))) { return rel; }
  }
  return undefined;
}

function hasBehaveProject(cwd: string): boolean {
  if (exists(cwd, 'behave.ini')) { return true; }
  if (fs.existsSync(path.join(cwd, 'features', 'steps'))) { return true; }
  for (const f of ['requirements.txt', 'requirements-test.txt', 'Pipfile']) {
    try {
      if (fs.readFileSync(path.join(cwd, f), 'utf8').toLowerCase().includes('behave')) { return true; }
    } catch {}
  }
  return false;
}

function behaveConfig(projectRoot: string): ProjectConfig {
  const fmtArgs = ['--format', 'json', '-o', 'reports/behave.json'];
  const behaveScenarioArgs = (name: string, feat?: string, line?: number) =>
    feat && line !== undefined
      ? [`${feat}:${line}`, ...fmtArgs]
      : [...(feat ? [feat] : []), '--name', safeFilter(name), ...fmtArgs];
  return {
    type: 'python-behave',
    projectRoot,
    buildScenarioArgs: (name, feat, line) => ({
      file: 'behave',
      args: behaveScenarioArgs(name, feat, line),
    }),
    buildFeatureArgs: (rel) => ({
      file: 'behave',
      args: [rel, ...fmtArgs],
    }),
    buildTagArgs: (tag) => ({
      file: 'behave',
      args: ['--tags', safeFilter(tag), ...fmtArgs],
    }),
    buildDryRunArgs: (rel) => ({
      file: 'behave',
      args: [rel, '--dry-run'],
    }),
    buildDebugScenarioArgs: (name, feat, line) => ({
      // python -m debugpy --listen 5678 --wait-for-client -m behave <scenario>
      file: 'python',
      args: ['-m', 'debugpy', '--listen', '5678', '--wait-for-client',
             '-m', 'behave', ...behaveScenarioArgs(name, feat, line)],
    }),
    debugPort: 5678,
    debugType: 'debugpy',
    reportPath:   'reports/behave.json',
    stepFileGlob: '**/*.py',
  };
}

// Replace " with . so Cucumber treats it as a regex wildcard.
// Double quotes cannot be reliably escaped inside cmd.exe quoted strings on Windows.
const safeFilter = (s: string) => s.replace(/"/g, '.');

function nodeConfig(projectRoot: string): ProjectConfig {
  // If the user's config already declares a json: formatter, respect their path and don't
  // add a duplicate. Otherwise always append our own so the report is guaranteed to exist.
  const configuredJsonPath = extractCucumberJsonPath(projectRoot);
  const fmtArgs   = configuredJsonPath ? [] : ['--format', 'json:reports/cucumber.json'];
  const reportPath = configuredJsonPath ?? path.join('reports', 'cucumber.json');

  // Prefer the npm-generated wrapper in node_modules/.bin — it uses %~dp0 on Windows
  // and a shell shebang on Unix, which avoids backslash path issues when the path is
  // passed through cmd.exe with shell:true.  Falls back to the raw JS file via node,
  // and finally to a clear "npm install" error message.
  const binCmd  = path.join(projectRoot, 'node_modules', '.bin', IS_WIN ? 'cucumber-js.cmd' : 'cucumber-js');
  const localJs = path.join(projectRoot, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber-js');
  const notInstalledMsg = [
    `process.stderr.write(`,
    `"GherkinFlow: @cucumber/cucumber is not installed.\\n" +`,
    `"Run \\"npm install\\" in: ${projectRoot.replace(/\\/g, '/')}\\n"`,
    `); process.exit(1);`
  ].join(' ');
  const invoke = (extra: string[]): SpawnArgs => {
    if (fs.existsSync(binCmd))  { return { file: binCmd,  args: extra }; }
    if (fs.existsSync(localJs)) { return { file: 'node',  args: [localJs, ...extra] }; }
    return { file: 'node', args: ['-e', notInstalledMsg] };
  };

  const DEBUG_PORT = 9229;
  const nodeScenarioArgs = (name: string, feat?: string, line?: number) =>
    feat && line !== undefined
      ? [`${feat}:${line}`, ...fmtArgs]
      : [...(feat ? [feat] : []), '--name', safeFilter(name), ...fmtArgs];

  return {
    type: 'node',
    projectRoot,
    // Use "file:line" addressing when possible — avoids the parallel coordinator
    // loading support files before reset() is called (which causes PENDING errors
    // when the project has "parallel: N" in cucumber.js). Falls back to --name.
    buildScenarioArgs: (name, feat, line) => invoke(nodeScenarioArgs(name, feat, line)),
    buildFeatureArgs:  (rel)              => invoke([rel, ...fmtArgs]),
    buildTagArgs:      (tag)              => invoke(['--tags', tag, ...fmtArgs]),
    buildDryRunArgs:   (rel)              => invoke([rel, '--dry-run']),
    buildDebugScenarioArgs: (name, feat, line) => {
      const args = nodeScenarioArgs(name, feat, line);
      // Must call node directly (not .cmd wrapper) so --inspect-brk reaches the
      // node process, not cmd.exe.
      if (fs.existsSync(localJs)) {
        return { file: 'node', args: [`--inspect-brk=${DEBUG_PORT}`, localJs, ...args] };
      }
      return { file: 'node', args: ['-e', notInstalledMsg] };
    },
    debugPort: DEBUG_PORT,
    debugType: 'node',
    reportPath,
    stepFileGlob: '**/*.{ts,js}',
  };
}

function gradleConfig(projectRoot: string, exe: string): ProjectConfig {
  return {
    type: 'java-gradle',
    projectRoot,
    buildScenarioArgs: (name, feat) => ({
      file: exe,
      args: ['test', ...(feat ? [`-Pcucumber.features=${feat}`] : []), `-Pcucumber.filter.name=${safeFilter(name)}`],
    }),
    buildFeatureArgs: (rel) => ({
      file: exe,
      args: ['test', `-Pcucumber.features=${rel}`],
    }),
    buildTagArgs: (tag) => ({
      file: exe,
      args: ['test', `-Pcucumber.filter.tags=${safeFilter(tag)}`],
    }),
    buildDryRunArgs: (rel) => ({
      file: exe,
      args: ['test', `-Pcucumber.features=${rel}`, '-Pcucumber.filter.dryRun=true'],
    }),
    buildDebugScenarioArgs: (name, feat) => ({
      // --debug-jvm suspends the JVM on port 5005 waiting for a debugger to attach.
      file: exe,
      args: ['test', '--debug-jvm', ...(feat ? [`-Pcucumber.features=${feat}`] : []), `-Pcucumber.filter.name=${safeFilter(name)}`],
    }),
    debugPort: 5005,
    debugType: 'java',
    reportPath:  path.join('target', 'cucumber-report.json'),
    stepFileGlob: '**/*.java',
  };
}

function mavenConfig(projectRoot: string, exe: string): ProjectConfig {
  return {
    type: 'java-maven',
    projectRoot,
    buildScenarioArgs: (name, feat) => ({
      file: exe,
      args: ['test', ...(feat ? [`-Dcucumber.features=${feat}`] : []), `-Dcucumber.filter.name=${safeFilter(name)}`],
    }),
    buildFeatureArgs: (rel) => ({
      file: exe,
      args: ['test', `-Dcucumber.features=${rel}`],
    }),
    buildTagArgs: (tag) => ({
      file: exe,
      args: ['test', `-Dcucumber.filter.tags=${safeFilter(tag)}`],
    }),
    buildDryRunArgs: (rel) => ({
      file: exe,
      args: ['test', `-Dcucumber.features=${rel}`, '-Dcucumber.filter.dryRun=true'],
    }),
    buildDebugScenarioArgs: (name, feat) => ({
      // -Dmaven.surefire.debug suspends the JVM on port 5005 waiting for a debugger.
      file: exe,
      args: ['test', '-Dmaven.surefire.debug', ...(feat ? [`-Dcucumber.features=${feat}`] : []), `-Dcucumber.filter.name=${safeFilter(name)}`],
    }),
    debugPort: 5005,
    debugType: 'java',
    reportPath:  path.join('target', 'cucumber-report.json'),
    stepFileGlob: '**/*.java',
  };
}

// Walk up from startDir until a recognised build file is found.
// Stops at the filesystem root. Falls back to mvn with startDir as root.
export function detectProject(startDir: string): ProjectConfig {
  let dir = startDir;
  while (true) {
    if (exists(dir, 'package.json') && hasNodeCucumber(dir)) { return nodeConfig(dir); }
    if (hasBehaveProject(dir))                               { return behaveConfig(dir); }
    if (IS_WIN  && exists(dir, 'gradlew.bat')) { return gradleConfig(dir, 'gradlew.bat'); }
    if (!IS_WIN && exists(dir, 'gradlew'))     { return gradleConfig(dir, './gradlew');   }
    if (exists(dir, 'build.gradle') || exists(dir, 'build.gradle.kts')) {
      return gradleConfig(dir, 'gradle');
    }
    if (IS_WIN  && exists(dir, 'mvnw.cmd'))    { return mavenConfig(dir, 'mvnw.cmd');    }
    if (!IS_WIN && exists(dir, 'mvnw'))        { return mavenConfig(dir, './mvnw');      }
    if (exists(dir, 'pom.xml'))                { return mavenConfig(dir, 'mvn');         }

    const parent = path.dirname(dir);
    if (parent === dir) { break; }  // reached filesystem root
    dir = parent;
  }
  return mavenConfig(startDir, 'mvn');
}
