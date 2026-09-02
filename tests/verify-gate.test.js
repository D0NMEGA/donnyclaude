import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPlanningFixture,
  cleanupFixture,
  requirementsContent,
  securityContent,
  summaryContent,
  validPlanContent,
  verificationContent,
} from './helpers/planning-fixture.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const verify = require(resolve(ROOT, 'packages/donny/bin/lib/verify.cjs'));
const { extractFrontmatter } = require(resolve(ROOT, 'packages/donny/bin/lib/frontmatter.cjs'));

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

// ── Recorded per-verb fixtures ──────────────────────────────────────────────
// These are recorded by tests/fixtures/record-verb-fixtures.mjs from real archived phase
// artifacts plus synthetic degraded trees, never hand-written. They are the ground truth
// the severity classifier is tested against, so this block exists to stop a later plan
// from quietly deleting one or emptying its cases.

const VERB_FIXTURES = [
  'phase-completeness', 'plan-graph', 'phase-verified', 'ui-reviewed', 'threats-clear',
  'milestone-coverage', 'plan-structure', 'references', 'commits', 'artifacts',
  'key-links', 'schema-drift', 'verify-summary',
];

describe('recorded verb fixtures', () => {
  const dir = join(__dirname, 'fixtures', 'verbs');

  it('has exactly the thirteen expected files and no others', () => {
    const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    assert.deepEqual(onDisk, [...VERB_FIXTURES].map(v => `${v}.json`).sort());
  });

  for (const verb of VERB_FIXTURES) {
    it(`${verb}.json parses and carries recorded cases`, () => {
      const raw = fs.readFileSync(join(dir, `${verb}.json`), 'utf-8');
      const fixture = JSON.parse(raw);
      assert.equal(fixture.verb, verb);
      assert.ok(fixture.recorded_at, 'recorded_at must be present');
      assert.ok(fixture.recorded_from, 'recorded_from must name where the cases came from');
      assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0, 'cases must be a non-empty array');
      for (const c of fixture.cases) {
        assert.equal(typeof c.label, 'string');
        assert.equal(typeof c.source, 'string');
        assert.ok(c.output && typeof c.output === 'object' && !Array.isArray(c.output),
          `case '${c.label}' must carry an output object`);
      }
    });
  }

  it('every verb carries at least one real case and one synthetic case', () => {
    for (const verb of VERB_FIXTURES) {
      const fixture = JSON.parse(fs.readFileSync(join(dir, `${verb}.json`), 'utf-8'));
      const sources = fixture.cases.map(c => c.source);
      assert.ok(sources.some(s => s !== 'synthetic'), `${verb} has no case recorded from real artifacts`);
      assert.ok(sources.some(s => s === 'synthetic'), `${verb} has no degraded synthetic case`);
    }
  });
});

// ── Fixture builder ─────────────────────────────────────────────────────────

describe('planning fixture helper', () => {
  it('builds a git-initialised .planning tree and cleans it up', () => {
    const root = buildPlanningFixture({
      phase: '23-fixture',
      plans: [{ name: '23-01-PLAN.md', content: validPlanContent({}) }],
      summaries: [{ name: '23-01-SUMMARY.md', content: summaryContent({ requirementsCompleted: ['FIX-01'] }) }],
      verification: verificationContent({ status: 'passed' }),
      security: securityContent({ threatsOpen: 0 }),
      requirements: requirementsContent(),
      config: { workflow: { record_gate: true } },
    });
    try {
      assert.ok(fs.existsSync(join(root, '.git')), 'fixture root must be a git repo');
      assert.ok(fs.existsSync(join(root, '.planning', 'REQUIREMENTS.md')));
      assert.ok(fs.existsSync(join(root, '.planning', 'config.json')));
      const phaseDir = join(root, '.planning', 'phases', '23-fixture');
      assert.deepEqual(fs.readdirSync(phaseDir).sort(), [
        '23-01-PLAN.md', '23-01-SUMMARY.md', '23-fixture-SECURITY.md', '23-fixture-VERIFICATION.md',
      ]);
      const r = verify.captureVerb(
        () => verify.cmdVerifyPlanStructure(root, '.planning/phases/23-fixture/23-01-PLAN.md', false),
      );
      assert.equal(r.ok, true);
      assert.deepEqual(r.json.errors, [], 'the canned plan must produce no structural errors');
      assert.deepEqual(r.json.warnings, [], 'the canned plan must produce no structural warnings');
    } finally {
      cleanupFixture(root);
      assert.equal(fs.existsSync(root), false, 'cleanupFixture must remove the tree');
    }
  });

  it('emits the five requirements-completed parse shapes the D-16 check has to tell apart', () => {
    const parse = (rc) => extractFrontmatter(summaryContent({ requirementsCompleted: rc }));

    assert.deepEqual(parse(['A-01', 'A-02'])['requirements-completed'], ['A-01', 'A-02']);
    assert.deepEqual(parse([])['requirements-completed'], []);
    assert.equal(parse(null)['requirements-completed'], undefined);
    // The trailing inline comment defeats the endsWith(']') test, so this parses as a STRING.
    assert.equal(typeof parse('inline-comment')['requirements-completed'], 'string');
    // A body `---` pair shadows the real block, so the whole file parses to zero keys.
    assert.deepEqual(Object.keys(parse('shadowed')), []);
  });
});

// ── Pre-repair v5.0 fixture ─────────────────────────────────────────────────
// tests/fixtures/pre-repair-v5/ is the Phase 19 and Phase 20 tree as it stood at
// claudecodeoptimized commit f328bee, the last state before Phase 22 repaired the v5.0
// record drift in place. Plan 09 replays the gate over it to prove the gate would have
// caught the July findings, so this block pins that the drift is still present. Every value
// below was measured against the extracted tree, which was verified byte-identical to
// f328bee by sha256 across all 25 files at extraction time and again before this was written.

const PRE_ROOT = join(__dirname, 'fixtures', 'pre-repair-v5');
const PRE_PLANNING = join(PRE_ROOT, '.planning');
const PRE_19 = join(PRE_PLANNING, 'phases', '19-supervisor-foundation');
const PRE_20 = join(PRE_PLANNING, 'phases', '20-auto-compact-at-60-keystone');

const readFixture = (dir, name) => fs.readFileSync(join(dir, name), 'utf-8');
const fenceCount = (text) => text.split('\n').filter(l => l === '---').length;

describe('pre-repair v5 fixture', () => {
  it('carries all twelve Phase 19 and eleven Phase 20 artifacts plus REQUIREMENTS and ROADMAP', () => {
    assert.equal(fs.readdirSync(PRE_19).filter(f => f.endsWith('.md')).length, 12);
    assert.equal(fs.readdirSync(PRE_20).filter(f => f.endsWith('.md')).length, 11);
    assert.ok(fs.existsSync(join(PRE_PLANNING, 'REQUIREMENTS.md')));
    assert.ok(fs.existsSync(join(PRE_PLANNING, 'ROADMAP.md')));
  });

  it('J1: 19-VERIFICATION.md reads `status: PASS`, which the engine does not accept', () => {
    const fm = extractFrontmatter(readFixture(PRE_19, '19-VERIFICATION.md'));
    assert.equal(fm.status, 'PASS');
    // The engine compares against the literal lowercase 'passed', so the phase reads unverified.
    assert.equal(verify.phaseVerificationVerdict(fm).verified, false);
  });

  it('J2: 19-01-SUMMARY.md frontmatter is shadowed by a body block and parses to zero keys', () => {
    const fm = extractFrontmatter(readFixture(PRE_19, '19-01-SUMMARY.md'));
    assert.equal(Object.keys(fm).length, 0);
  });

  it('J3: 19-03-SUMMARY.md parses cleanly but has no requirements-completed key', () => {
    const fm = extractFrontmatter(readFixture(PRE_19, '19-03-SUMMARY.md'));
    // Measured 9, not the 6 the 23-01 plan recorded. The extraction is not in doubt: all 25
    // files sha256-match f328bee, and no SUMMARY in either the pre-repair or the post-repair
    // tree parses to 6 keys, so the planning-time figure was wrong. The load-bearing half of
    // the assertion, that requirements-completed is absent, holds exactly as recorded.
    assert.equal(Object.keys(fm).length, 9);
    assert.equal(fm['requirements-completed'], undefined);
  });

  it('J4: 20-VERIFICATION.md has twelve `---` lines, so a body block shadows its frontmatter', () => {
    assert.equal(fenceCount(readFixture(PRE_20, '20-VERIFICATION.md')), 12);
  });

  it('J5: 20-04-SUMMARY.md carries the empty requirements-completed case', () => {
    const lines = readFixture(PRE_20, '20-04-SUMMARY.md').split('\n');
    assert.ok(lines.includes('requirements-completed: []'),
      'the literal empty-array line must survive in the fixture');
  });

  it('J6: 20-SECURITY.md is genuinely absent and was not synthesised', () => {
    assert.equal(fs.existsSync(join(PRE_20, '20-SECURITY.md')), false);
  });

  it('MANIFEST.md records provenance and uses no bare `---` rules', () => {
    const manifest = readFixture(PRE_ROOT, 'MANIFEST.md');
    assert.equal(fenceCount(manifest), 0, 'MANIFEST.md must contain no bare --- lines');
    assert.match(manifest, /f328bee/);
  });
});
