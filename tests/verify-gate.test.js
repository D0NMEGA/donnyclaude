import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const verify = require(resolve(ROOT, 'packages/donny/bin/lib/verify.cjs'));

// The archived Phase 19 tree lives in the operator's claudecodeoptimized repo.
// donnyclaude ships publicly, so every test touching it is skipped when absent.
const CCO_ROOT = '/Users/d0nmega/Developer/claudecodeoptimized';
const CCO_PHASE_19 = '.planning/milestones/v5.0-phases/19-supervisor-foundation';
const hasCco = fs.existsSync(resolve(CCO_ROOT, CCO_PHASE_19));

// ── captureVerb ─────────────────────────────────────────────────────────────

describe('captureVerb', () => {
  it('is exported as a function', () => {
    assert.equal(typeof verify.captureVerb, 'function');
  });

  it('captures a fd-1 write and parses it as JSON', () => {
    const r = verify.captureVerb(() => { fs.writeSync(1, '{"a":1}'); });
    assert.deepEqual(r, { ok: true, json: { a: 1 } });
  });

  it('restores fs.writeSync after a successful call', () => {
    const before = fs.writeSync;
    verify.captureVerb(() => { fs.writeSync(1, '{"a":1}'); });
    assert.equal(fs.writeSync, before, 'fs.writeSync must be restored after a clean verb');
  });

  it('restores fs.writeSync after a throwing call and reports the message', () => {
    const before = fs.writeSync;
    const r = verify.captureVerb(() => { throw new Error('boom'); });
    assert.equal(fs.writeSync, before, 'fs.writeSync must be restored after a throwing verb');
    assert.equal(r.ok, false);
    assert.match(r.error, /boom/);
  });

  it('reads back an @file: overflow payload', () => {
    const tmpPath = join(tmpdir(), `donny-gate-capture-${Date.now()}.json`);
    fs.writeFileSync(tmpPath, '{"big":true}', 'utf-8');
    try {
      const r = verify.captureVerb(() => { fs.writeSync(1, '@file:' + tmpPath); });
      assert.deepEqual(r, { ok: true, json: { big: true } });
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });

  it('returns the raw string when the output does not parse, without throwing', () => {
    const r = verify.captureVerb(() => { fs.writeSync(1, 'not json at all'); });
    assert.equal(r.ok, false);
    assert.equal(r.raw, 'not json at all');
  });

  it('reports empty output rather than a parse failure', () => {
    const r = verify.captureVerb(() => { /* writes nothing */ });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'verb produced no output');
  });

  it('delegates fd-2 writes to the underlying writeSync instead of capturing them', () => {
    const orig = fs.writeSync;
    const stderrSeen = [];
    fs.writeSync = function (fd, data, ...rest) {
      if (fd === 2) { stderrSeen.push(String(data)); return String(data).length; }
      return orig.call(fs, fd, data, ...rest);
    };
    let r;
    try {
      r = verify.captureVerb(() => {
        fs.writeSync(2, 'this-goes-to-stderr');
        fs.writeSync(1, '{"a":1}');
      });
    } finally {
      fs.writeSync = orig;
    }
    assert.deepEqual(stderrSeen, ['this-goes-to-stderr'], 'fd 2 must reach the real writeSync');
    assert.deepEqual(r, { ok: true, json: { a: 1 } });
  });

  it('returns a byte count from the patched writeSync so callers that check it still work', () => {
    let returned = null;
    verify.captureVerb(() => { returned = fs.writeSync(1, '{"a":1}'); });
    assert.equal(returned, '{"a":1}'.length);
  });

  it('drives a real verb end to end', { skip: hasCco ? false : 'claudecodeoptimized repo not present' }, () => {
    const r = verify.captureVerb(
      () => verify.cmdVerifyPhaseVerified(CCO_ROOT, CCO_PHASE_19, false),
    );
    assert.equal(r.ok, true, `expected JSON, got ${JSON.stringify(r)}`);
    assert.equal(r.json.verified, true);
    assert.equal(r.json.status, 'passed');
  });
});
