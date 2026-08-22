import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cucumberExpressionToRegex, looksLikeRegex } from '../out/stepPattern.js';

const matches = (pattern, step) => cucumberExpressionToRegex(pattern).test(step);

// --- gherkin-flow#1 -------------------------------------------------------
// Regex alternation reported as "No step definition found".
test('#1 non-capturing alternation, end-anchored (the reported case)', () => {
  const p = 'POST isteği (?:atılır|gönderilir|yapılır)$';
  assert.ok(looksLikeRegex(p));
  assert.ok(matches(p, 'POST isteği yapılır'));
  assert.ok(matches(p, 'POST isteği atılır'));
  assert.ok(matches(p, 'POST isteği gönderilir'));
  assert.ok(!matches(p, 'POST isteği silinir'));
});

test('#1 capturing alternation, end-anchored', () => {
  const p = 'POST isteği (atılır|gönderilir|yapılır)$';
  assert.ok(matches(p, 'POST isteği yapılır'));
  assert.ok(!matches(p, 'POST isteği silinir'));
});

test('#1 alternation with no anchor at all', () => {
  assert.ok(matches('I (start|stop) the server', 'I start the server'));
  assert.ok(!matches('I (start|stop) the server', 'I pause the server'));
});

test('#1 fully anchored still works', () => {
  assert.ok(matches('^the user logs in$', 'the user logs in'));
});

test('#1 regex is anchored — no partial matches', () => {
  assert.ok(!matches('^I log in$', 'before I log in after'));
  assert.ok(!matches('I (start|stop) it', 'please I start it now'));
});

test('#1 character classes and quantifiers are regex', () => {
  assert.ok(matches('I wait \\d+ seconds', 'I wait 30 seconds'));
  assert.ok(!matches('I wait \\d+ seconds', 'I wait a while seconds'));
});

// --- Cucumber Expressions must not regress --------------------------------
test('cucumber expression placeholders still work', () => {
  assert.ok(!looksLikeRegex('I have {int} cukes'));
  assert.ok(matches('I have {int} cukes', 'I have 42 cukes'));
  assert.ok(matches('I eat {float} of {string}', 'I eat 1.5 of "cake"'));
  assert.ok(matches('the {word} is ready', 'the server is ready'));
});

test('optional text is a cucumber expression, not a regex', () => {
  assert.ok(!looksLikeRegex('I have {int} cuke(s)'));
});

test('plain prose is escaped, not interpreted', () => {
  assert.ok(matches('I pay $5.00', 'I pay $5.00'));
  assert.ok(!matches('I pay $5.00', 'I pay $5X00'));
});
