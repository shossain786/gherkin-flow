import * as fs from 'fs';
import * as path from 'path';

// gherkin-flow#4 — "mvn test -Dcucumber.features=..." narrows what Cucumber executes
// but leaves Surefire's test-class selection untouched, so every other test class in
// src/test/java runs alongside the one scenario. Scoping the build tool to the Cucumber
// runner class (-Dtest / --tests) is what actually limits the run.

export interface JavaRunner {
  simpleName: string;
  fqcn: string;        // package-qualified when the file declares a package
  file: string;        // absolute path
  features: string[];  // feature paths declared on the runner, if any
}

const SKIP_DIRS = new Set([
  'target', 'build', 'node_modules', '.git', '.gradle', '.idea', 'out', 'bin', 'dist',
]);

// A scan bound so a huge monorepo can never stall a run.
const MAX_FILES = 5000;

// Strip comments so a commented-out annotation in a sample or an old runner
// doesn't register as a real one.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// Markers that identify a Cucumber runner across the three JVM stacks.
function isRunnerSource(src: string): boolean {
  const s = stripComments(src);
  if (/@CucumberOptions\b/.test(s))                                       { return true; }
  if (/\bAbstractTestNGCucumberTests\b/.test(s))                          { return true; }
  if (/@RunWith\s*\(\s*(?:[\w.]+\.)?Cucumber\s*\.\s*class\s*\)/.test(s))  { return true; }
  // JUnit 5 platform suite
  if (/@Suite\b/.test(s) && /@(?:IncludeEngines|SelectClasspathResource|SelectDirectories)\b/.test(s)) {
    return /cucumber/i.test(s);
  }
  return false;
}

// Surefire and Gradle select concrete classes; an abstract base carrying the
// annotations (BaseCucumberTest extends AbstractTestNGCucumberTests) is not runnable.
function isAbstractClass(src: string, simpleName: string): boolean {
  const decl = new RegExp(`(?:^|[\\s;}])((?:public|final|abstract|static|strictfp|@\\w+|\\s)*)\\bclass\\s+${simpleName}\\b`);
  const m = stripComments(src).match(decl);
  return m ? /\babstract\b/.test(m[1]) : false;
}

function packageOf(src: string): string | undefined {
  const m = stripComments(src).match(/^\s*package\s+([\w.]+)\s*;/m);
  return m?.[1];
}

// Feature paths declared in @CucumberOptions(features = ...) or
// @SelectClasspathResource / @SelectDirectories, normalised to forward slashes.
function featurePathsOf(src: string): string[] {
  const s = stripComments(src);
  const out: string[] = [];
  const opts = s.match(/features\s*=\s*(\{[^}]*\}|"[^"]*")/);
  if (opts) {
    for (const q of opts[1].match(/"([^"]*)"/g) ?? []) {
      out.push(q.slice(1, -1).replace(/\\/g, '/'));
    }
  }
  for (const m of s.matchAll(/@(?:SelectClasspathResource|SelectDirectories)\s*\(\s*"([^"]*)"/g)) {
    out.push(m[1].replace(/\\/g, '/'));
  }
  return out;
}

function walkJava(dir: string, acc: string[]): void {
  if (acc.length >= MAX_FILES) { return; }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) { return; }
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) { continue; }
      walkJava(path.join(dir, e.name), acc);
    } else if (e.isFile() && e.name.endsWith('.java')) {
      acc.push(path.join(dir, e.name));
    }
  }
}

// Finds every concrete Cucumber runner class under the project's test sources.
// Falls back to scanning the whole project when there is no src/test/java.
export function findCucumberRunners(projectRoot: string): JavaRunner[] {
  const testRoot = path.join(projectRoot, 'src', 'test', 'java');
  const files: string[] = [];
  walkJava(fs.existsSync(testRoot) ? testRoot : projectRoot, files);

  const runners: JavaRunner[] = [];
  for (const file of files) {
    let src: string;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!isRunnerSource(src)) { continue; }
    // Java requires the public top-level class to match the file name.
    const simpleName = path.basename(file, '.java');
    if (isAbstractClass(src, simpleName)) { continue; }
    const pkg = packageOf(src);
    runners.push({
      simpleName,
      fqcn: pkg ? `${pkg}.${simpleName}` : simpleName,
      file,
      features: featurePathsOf(src),
    });
  }
  return runners.sort((a, b) => a.fqcn.localeCompare(b.fqcn));
}

// Narrows the candidates to the runner(s) that declare the feature being run.
// Returns every candidate when none declares it — the build tool accepts a list,
// so a wider scope is still far narrower than the whole test suite, and it can
// never exclude the runner that owns the scenario.
export function runnersForFeature(runners: JavaRunner[], featureRelPath?: string): JavaRunner[] {
  if (!featureRelPath) { return runners; }
  const feat = featureRelPath.replace(/\\/g, '/').replace(/:\d+$/, '');
  const owns = (r: JavaRunner) => r.features.some(decl => {
    const d = decl.replace(/^classpath:/, '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!d) { return false; }
    return feat === d || feat.endsWith(`/${d}`) || feat.includes(`${d}/`);
  });
  const matched = runners.filter(owns);
  return matched.length > 0 ? matched : runners;
}
