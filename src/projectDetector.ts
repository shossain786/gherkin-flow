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
  buildScenarioArgs(name: string, featureRelPath?: string): SpawnArgs;
  buildFeatureArgs(relativePath: string): SpawnArgs;
  buildTagArgs(tag: string): SpawnArgs;
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

function nodeConfig(cwd: string): ProjectConfig {
  const fmtArgs = hasNodeConfig(cwd) ? [] : ['--format', 'json:reports/cucumber.json'];
  return {
    type: 'node',
    buildScenarioArgs: (name, feat) => ({
      file: 'npx',
      args: ['cucumber-js', ...(feat ? [feat] : []), '--name', name, ...fmtArgs],
    }),
    buildFeatureArgs: (rel) => ({
      file: 'npx',
      args: ['cucumber-js', rel, ...fmtArgs],
    }),
    buildTagArgs: (tag) => ({
      file: 'npx',
      args: ['cucumber-js', '--tags', tag, ...fmtArgs],
    }),
    reportPath:  path.join('reports', 'cucumber.json'),
    stepFileGlob: '**/*.{ts,js}',
  };
}

function gradleConfig(exe: string): ProjectConfig {
  return {
    type: 'java-gradle',
    buildScenarioArgs: (name, feat) => ({
      file: exe,
      args: ['test', ...(feat ? [`-Pcucumber.features=${feat}`] : []), `-Pcucumber.filter.name=${name}`],
    }),
    buildFeatureArgs: (rel) => ({
      file: exe,
      args: ['test', `-Pcucumber.features=${rel}`],
    }),
    buildTagArgs: (tag) => ({
      file: exe,
      args: ['test', `-Pcucumber.filter.tags=${tag}`],
    }),
    reportPath:  path.join('target', 'cucumber-report.json'),
    stepFileGlob: '**/*.java',
  };
}

function mavenConfig(exe: string): ProjectConfig {
  return {
    type: 'java-maven',
    buildScenarioArgs: (name, feat) => ({
      file: exe,
      args: ['test', ...(feat ? [`-Dcucumber.features=${feat}`] : []), `-Dcucumber.filter.name=${name}`],
    }),
    buildFeatureArgs: (rel) => ({
      file: exe,
      args: ['test', `-Dcucumber.features=${rel}`],
    }),
    buildTagArgs: (tag) => ({
      file: exe,
      args: ['test', `-Dcucumber.filter.tags=${tag}`],
    }),
    reportPath:  path.join('target', 'cucumber-report.json'),
    stepFileGlob: '**/*.java',
  };
}

export function detectProject(cwd: string): ProjectConfig {
  if (exists(cwd, 'package.json') && hasNodeCucumber(cwd)) { return nodeConfig(cwd); }
  if (IS_WIN  && exists(cwd, 'gradlew.bat')) { return gradleConfig('gradlew.bat'); }
  if (!IS_WIN && exists(cwd, 'gradlew'))     { return gradleConfig('./gradlew');   }
  if (exists(cwd, 'gradle'))                 { return gradleConfig('gradle');      }
  if (IS_WIN  && exists(cwd, 'mvnw.cmd'))    { return mavenConfig('mvnw.cmd');     }
  if (!IS_WIN && exists(cwd, 'mvnw'))        { return mavenConfig('./mvnw');       }
  return mavenConfig('mvn');
}
