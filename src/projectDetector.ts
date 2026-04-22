import * as fs from 'fs';
import * as path from 'path';

const IS_WIN = process.platform === 'win32';

export type ProjectType = 'java-gradle' | 'java-maven' | 'node';

export interface SpawnArgs {
  file: string;
  args: string[];
}

export interface ProjectConfig {
  type: ProjectType;
  projectRoot: string;
  buildScenarioArgs(name: string, featureRelPath?: string): SpawnArgs;
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

function hasNodeConfig(cwd: string): boolean {
  return ['cucumber.js', '.cucumber.js', 'cucumber.mjs', 'cucumber.cjs'].some(f => exists(cwd, f));
}

// Replace " with . so Cucumber treats it as a regex wildcard.
// Double quotes cannot be reliably escaped inside cmd.exe quoted strings on Windows.
const safeFilter = (s: string) => s.replace(/"/g, '.');

function nodeConfig(projectRoot: string): ProjectConfig {
  const fmtArgs = hasNodeConfig(projectRoot) ? [] : ['--format', 'json:reports/cucumber.json'];
  return {
    type: 'node',
    projectRoot,
    buildScenarioArgs: (name, feat) => ({
      file: 'npx',
      args: ['cucumber-js', ...(feat ? [feat] : []), '--name', safeFilter(name), ...fmtArgs],
    }),
    buildFeatureArgs: (rel) => ({
      file: 'npx',
      args: ['cucumber-js', rel, ...fmtArgs],
    }),
    buildTagArgs: (tag) => ({
      file: 'npx',
      args: ['cucumber-js', '--tags', tag, ...fmtArgs],
    }),
    buildDryRunArgs: (rel) => ({
      file: 'npx',
      args: ['cucumber-js', rel, '--dry-run'],
    }),
    reportPath:  path.join('reports', 'cucumber.json'),
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
