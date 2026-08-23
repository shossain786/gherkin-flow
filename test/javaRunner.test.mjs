import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject } from '../out/projectDetector.js';
import { findCucumberRunners } from '../out/javaRunner.js';

// --- gherkin-flow#4 -------------------------------------------------------
// "Running a Cucumber scenario executes the entire TestNG suite":
// mvn test -Dcucumber.features=... narrows Cucumber but not Surefire, so all
// ~643 test classes in src/test/java ran alongside the one scenario.

const FEATURE = 'src/test/resources/features/saucedemo.feature';

function write(root, rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

// Mirrors the layout in the report: one Cucumber runner sharing src/test/java
// with unit, integration, JUnit 5 and plain TestNG tests.
function fixture(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf4-'));
  write(root, 'pom.xml', '<project><artifactId>testfly</artifactId></project>');
  write(root, FEATURE, 'Feature: SauceDemo\n  Scenario: login\n    Given a user\n');
  write(root, 'src/test/java/io/testfly/unit/CalculatorTest.java',
    'package io.testfly.unit;\npublic class CalculatorTest {}\n');
  write(root, 'src/test/java/io/testfly/integration/ApiIntegrationTest.java',
    'package io.testfly.integration;\npublic class ApiIntegrationTest {}\n');
  write(root, 'src/test/java/io/testfly/testng/LoginTest.java',
    'package io.testfly.testng;\npublic class LoginTest {}\n');
  // The abstract base carries the TestNG plumbing but is not runnable itself.
  write(root, 'src/test/java/io/testfly/cucumber/BaseCucumberTest.java',
    'package io.testfly.cucumber;\n' +
    'import io.cucumber.testng.AbstractTestNGCucumberTests;\n' +
    'public abstract class BaseCucumberTest extends AbstractTestNGCucumberTests {}\n');
  write(root, 'src/test/java/io/testfly/examples/cucumber/SauceDemoCucumberRunner.java',
    'package io.testfly.examples.cucumber;\n' +
    'import io.cucumber.testng.CucumberOptions;\n' +
    '@CucumberOptions(\n' +
    `    features = "${FEATURE}",\n` +
    '    glue = { "io.testfly.examples.cucumber.steps" },\n' +
    '    plugin = { "json:target/cucumber-report.json" }\n' +
    ')\n' +
    'public class SauceDemoCucumberRunner extends BaseCucumberTest {}\n');
  for (const [rel, body] of Object.entries(extra)) { write(root, rel, body); }
  return root;
}

const featureDir = (root) => path.join(root, 'src/test/resources/features');

test('#4 a scenario run is scoped to the Cucumber runner class', () => {
  const root = fixture();
  const cfg = detectProject(featureDir(root));
  assert.equal(cfg.type, 'java-maven');

  const { args } = cfg.buildScenarioArgs('login', FEATURE, 3);
  assert.ok(args.includes('-Dtest=SauceDemoCucumberRunner'),
    `expected Surefire scoping, got: ${args.join(' ')}`);
  // A reactor build must not fail on modules that hold no Cucumber runner.
  assert.ok(args.includes('-DfailIfNoSpecifiedTests=false'));
});

test('#4 the abstract base class is never selected', () => {
  const root = fixture();
  const names = findCucumberRunners(root).map(r => r.simpleName);
  assert.deepEqual(names, ['SauceDemoCucumberRunner']);
});

test('#4 unrelated test classes are not selected', () => {
  const root = fixture();
  const { args } = cfgOf(root).buildScenarioArgs('login', FEATURE, 3);
  const scope = args.find(a => a.startsWith('-Dtest='));
  for (const other of ['CalculatorTest', 'ApiIntegrationTest', 'LoginTest']) {
    assert.ok(!scope.includes(other), `${other} should not be in ${scope}`);
  }
});

const cfgOf = (root, opts) => detectProject(featureDir(root), opts);

test('#4 the Cucumber filter arguments are unchanged', () => {
  const root = fixture();
  const { args } = cfgOf(root).buildScenarioArgs('login', FEATURE, 3);
  assert.ok(args.includes('test'));
  assert.ok(args.includes(`-Dcucumber.features=${FEATURE}:3`));
});

test('#4 feature, tag and dry-run modes are scoped too', () => {
  const root = fixture();
  const cfg = cfgOf(root);
  for (const args of [
    cfg.buildFeatureArgs(FEATURE).args,
    cfg.buildTagArgs('@smoke').args,
    cfg.buildDryRunArgs(FEATURE).args,
  ]) {
    assert.ok(args.some(a => a.startsWith('-Dtest=')), args.join(' '));
  }
});

test('#4 debug keeps the surefire debug flag and adds the scope', () => {
  const root = fixture();
  const { args } = cfgOf(root).buildDebugScenarioArgs('login', FEATURE, 3);
  assert.ok(args.includes('-Dmaven.surefire.debug'));
  assert.ok(args.includes('-Dtest=SauceDemoCucumberRunner'));
});

test('#4 scoping can be turned off', () => {
  const root = fixture();
  const { args } = cfgOf(root, { scopeToRunnerClass: false }).buildScenarioArgs('login', FEATURE, 3);
  assert.ok(!args.some(a => a.startsWith('-Dtest=')));
  assert.ok(!args.includes('-DfailIfNoSpecifiedTests=false'));
});

test('#4 an explicit runner class wins over detection', () => {
  const root = fixture();
  const { args } = cfgOf(root, { runnerClass: 'com.acme.RunCucumberTest' })
    .buildScenarioArgs('login', FEATURE, 3);
  assert.ok(args.includes('-Dtest=RunCucumberTest'));
});

test('#4 the runner that declares the feature is preferred', () => {
  const root = fixture({
    'src/test/java/io/testfly/examples/cucumber/CheckoutRunner.java':
      'package io.testfly.examples.cucumber;\n' +
      'import io.cucumber.testng.CucumberOptions;\n' +
      '@CucumberOptions(features = "src/test/resources/features/checkout.feature")\n' +
      'public class CheckoutRunner extends BaseCucumberTest {}\n',
  });
  const { args } = cfgOf(root).buildScenarioArgs('login', FEATURE, 3);
  assert.ok(args.includes('-Dtest=SauceDemoCucumberRunner'));
});

test('#4 when no runner declares the feature, every runner is listed', () => {
  const root = fixture({
    'src/test/java/io/testfly/examples/cucumber/GenericRunner.java':
      'package io.testfly.examples.cucumber;\n' +
      'import io.cucumber.testng.CucumberOptions;\n' +
      '@CucumberOptions(glue = "io.testfly")\n' +
      'public class GenericRunner extends BaseCucumberTest {}\n',
  });
  const { args } = cfgOf(root).buildScenarioArgs('login', 'src/test/resources/features/other.feature', 3);
  const scope = args.find(a => a.startsWith('-Dtest='));
  assert.ok(scope.includes('GenericRunner'));
  assert.ok(scope.includes('SauceDemoCucumberRunner'));
});

test('#4 a commented-out annotation is not a runner', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf4c-'));
  write(root, 'pom.xml', '<project/>');
  write(root, 'src/test/java/Sample.java',
    '// @CucumberOptions(features = "x.feature")\npublic class Sample {}\n');
  assert.deepEqual(findCucumberRunners(root), []);
});

test('#4 JUnit 4 and JUnit 5 runner styles are recognised', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf4j-'));
  write(root, 'pom.xml', '<project/>');
  write(root, 'src/test/java/com/acme/RunCucumberTest.java',
    'package com.acme;\n@RunWith(Cucumber.class)\npublic class RunCucumberTest {}\n');
  write(root, 'src/test/java/com/acme/RunSuiteTest.java',
    'package com.acme;\n@Suite\n@IncludeEngines("cucumber")\n' +
    '@SelectClasspathResource("features")\npublic class RunSuiteTest {}\n');
  const names = findCucumberRunners(root).map(r => r.fqcn);
  assert.deepEqual(names, ['com.acme.RunCucumberTest', 'com.acme.RunSuiteTest']);
});

test('#4 Gradle scopes with fully-qualified --tests', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'pom.xml'));
  write(root, 'build.gradle', 'apply plugin: "java"\n');
  const cfg = detectProject(featureDir(root));
  assert.equal(cfg.type, 'java-gradle');
  const { args } = cfg.buildScenarioArgs('login', FEATURE, 3);
  const i = args.indexOf('--tests');
  assert.ok(i >= 0, args.join(' '));
  // Gradle matches fully-qualified names; a bare simple name matches nothing.
  assert.equal(args[i + 1], 'io.testfly.examples.cucumber.SauceDemoCucumberRunner');
});

test('#4 non-Java stacks are untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf4n-'));
  write(root, 'package.json', JSON.stringify({ devDependencies: { '@cucumber/cucumber': '^10' } }));
  write(root, 'features/a.feature', 'Feature: a\n');
  const { args } = detectProject(path.join(root, 'features')).buildScenarioArgs('login', 'features/a.feature', 2);
  assert.ok(!args.some(a => a.startsWith('-Dtest=') || a === '--tests'));
});
