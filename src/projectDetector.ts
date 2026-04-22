import * as fs from 'fs';
import * as path from 'path';

const IS_WIN = process.platform === 'win32';

export type ProjectType = 'java-gradle' | 'java-maven' | 'node';

export interface ProjectConfig {
  type: ProjectType;
  buildScenarioCmd(name: string, featureRelPath?: string): string;
  buildFeatureCmd(relativePath: string): string;
  buildTagCmd(tag: string): string;
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
  const fmt = hasNodeConfig(cwd) ? '' : ' --format json:reports/cucumber.json';
  const safePath   = (s: string) => s.replace(/"/g, '\\"');
  const safeFilter = (s: string) => s.replace(/"/g, '.');
  return {
    type: 'node',
    buildScenarioCmd: (name, feat) => `npx cucumber-js${feat ? ` "${safePath(feat)}"` : ''} --name "${safeFilter(name)}"${fmt}`,
    buildFeatureCmd:  (rel)  => `npx cucumber-js "${rel}"${fmt}`,
    buildTagCmd:      (tag)  => `npx cucumber-js --tags "${safeFilter(tag)}"${fmt}`,
    reportPath:  path.join('reports', 'cucumber.json'),
    stepFileGlob: '**/*.{ts,js}',
  };
}

function gradleConfig(exe: string): ProjectConfig {
  const safePath   = (s: string) => s.replace(/"/g, '\\"');
  const safeFilter = (s: string) => s.replace(/"/g, '.');
  return {
    type: 'java-gradle',
    buildScenarioCmd: (name, feat) => [
      `${exe} test`,
      feat ? `"-Pcucumber.features=${safePath(feat)}"` : '',
      `"-Pcucumber.filter.name=${safeFilter(name)}"`
    ].filter(Boolean).join(' '),
    buildFeatureCmd:  (rel)  => `${exe} test "-Pcucumber.features=${safePath(rel)}"`,
    buildTagCmd:      (tag)  => `${exe} test "-Pcucumber.filter.tags=${safeFilter(tag)}"`,
    reportPath:  path.join('target', 'cucumber-report.json'),
    stepFileGlob: '**/*.java',
  };
}

function mavenConfig(exe: string): ProjectConfig {
  const safePath   = (s: string) => s.replace(/"/g, '\\"');
  const safeFilter = (s: string) => s.replace(/"/g, '.');
  return {
    type: 'java-maven',
    buildScenarioCmd: (name, feat) => [
      `${exe} test`,
      feat ? `"-Dcucumber.features=${safePath(feat)}"` : '',
      `"-Dcucumber.filter.name=${safeFilter(name)}"`
    ].filter(Boolean).join(' '),
    buildFeatureCmd:  (rel)  => `${exe} test "-Dcucumber.features=${safePath(rel)}"`,
    buildTagCmd:      (tag)  => `${exe} test "-Dcucumber.filter.tags=${safeFilter(tag)}"`,
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
