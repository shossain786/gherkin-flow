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
  return {
    type: 'python-behave',
    projectRoot,
    buildScenarioArgs: (name, feat, line) => ({
      file: 'behave',
      // Behave supports "path/to/file.feature:15" line-number addressing.
      // Use it when available to skip name-based filtering entirely.
      args: feat && line !== undefined
        ? [`${feat}:${line}`, ...fmtArgs]
        : [...(feat ? [feat] : []), '--name', safeFilter(name), ...fmtArgs],
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

  return {
    type: 'node',
    projectRoot,
    // Use "file:line" addressing when possible — avoids the parallel coordinator
    // loading support files before reset() is called (which causes PENDING errors
    // when the project has "parallel: N" in cucumber.js). Falls back to --name.
    buildScenarioArgs: (name, feat, line) => feat && line !== undefined
      ? invoke([`${feat}:${line}`, ...fmtArgs])
      : invoke([...(feat ? [feat] : []), '--name', safeFilter(name), ...fmtArgs]),
    buildFeatureArgs:  (rel)         => invoke([rel, ...fmtArgs]),
    buildTagArgs:      (tag)         => invoke(['--tags', tag, ...fmtArgs]),
    buildDryRunArgs:   (rel)         => invoke([rel, '--dry-run']),
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
