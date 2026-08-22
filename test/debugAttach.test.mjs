import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadyDetector, readyPattern } from '../out/debugAttach.js';

const JVM_BANNER = 'Listening for transport dt_socket at address: 5005\n';

// --- gherkin-flow#2 -------------------------------------------------------
test('#2 the JVM banner is detected (it arrives on stdout)', () => {
  const d = new ReadyDetector('java');
  assert.equal(d.accept('[INFO] Running tests...\n'), false);
  assert.equal(d.accept(JVM_BANNER), true);
});

test('#2 fires exactly once', () => {
  const d = new ReadyDetector('java');
  assert.equal(d.accept(JVM_BANNER), true);
  assert.equal(d.accept(JVM_BANNER), false);
  assert.ok(d.fired);
});

test('#2 banner split across two chunks is still detected', () => {
  const d = new ReadyDetector('java');
  assert.equal(d.accept('Listening for tra'), false);
  assert.equal(d.accept('nsport dt_socket at address: 5005'), true);
});

test('#2 ordinary maven output never triggers an attach', () => {
  const d = new ReadyDetector('java');
  for (const line of [
    '[INFO] Scanning for projects...',
    '[INFO] Tests run: 3, Failures: 0',
    '[INFO] BUILD SUCCESS',
  ]) { assert.equal(d.accept(line), false); }
  assert.equal(d.fired, false);
});

test('#2 debugpy has its own banner', () => {
  const d = new ReadyDetector('debugpy');
  assert.equal(d.accept('waiting for client to connect'), true);
});

test('#2 node has no banner — it attaches on a timer instead', () => {
  assert.equal(readyPattern('node'), undefined);
  const d = new ReadyDetector('node');
  assert.equal(d.accept(JVM_BANNER), false);
});
