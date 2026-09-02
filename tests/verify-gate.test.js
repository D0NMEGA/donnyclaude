import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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

// ── cmdVerifySummary requirements-completed (D-16) ──────────────────────────
// The phase's headline check. Before this plan cmdVerifySummary imported extractFrontmatter
// and never called it, so the one field the milestone turns on went unchecked. There are
// three failing states, not two: besides missing and empty, the key can parse as a STRING (a
// trailing inline comment defeats the endsWith(']') test at frontmatter.cjs:55) or the whole
// block can be shadowed by a body `---` pair (extractFrontmatter keeps the LAST block). Both
// look correct to a human reader, and both are the July J2 defect the pre-repair fixture
// above carries. The predicate is the same Array.isArray gate cmdVerifyMilestoneCoverage:586
// uses, so a SUMMARY this check accepts is one the coverage engine can read.

const SUMMARY_PHASE = '23-fixture';

/** Build a one-SUMMARY fixture, drive cmdVerifySummary over it, return the parsed JSON. */
function runVerifySummary(content, { name = '23-01-SUMMARY.md' } = {}) {
  const root = buildPlanningFixture({ phase: SUMMARY_PHASE, summaries: [{ name, content }] });
  try {
    // Relative on purpose: cmdVerifySummary resolves with a bare path.join(cwd, summaryPath)
    // and has no path.isAbsolute guard, unlike its sibling verbs.
    const r = verify.captureVerb(
      () => verify.cmdVerifySummary(root, `.planning/phases/${SUMMARY_PHASE}/${name}`, 2, false),
    );
    assert.equal(r.ok, true, `expected JSON, got ${JSON.stringify(r)}`);
    return r.json;
  } finally {
    cleanupFixture(root);
  }
}

describe('cmdVerifySummary requirements-completed (D-16)', () => {
  it('accepts a parseable array and reports it verbatim', () => {
    const j = runVerifySummary(summaryContent({ requirementsCompleted: ['PILOT-04'] }));
    assert.deepEqual(j.checks.requirements_completed, ['PILOT-04']);
    assert.deepEqual(j.errors, []);
    assert.equal(j.passed, true);
  });

  it('fails a SUMMARY with no requirements-completed key', () => {
    const j = runVerifySummary(summaryContent({ requirementsCompleted: null }));
    assert.equal(j.passed, false);
    assert.equal(j.checks.requirements_completed, null);
    assert.ok(j.errors.some(e => /requirements-completed missing/.test(e)),
      `expected a missing error, got ${JSON.stringify(j.errors)}`);
  });

  it('fails an empty requirements-completed list, and keeps the parsed empty array', () => {
    const j = runVerifySummary(summaryContent({ requirementsCompleted: [] }));
    assert.equal(j.passed, false);
    assert.deepEqual(j.checks.requirements_completed, []);
    assert.ok(j.errors.some(e => /requirements-completed is empty/.test(e)),
      `expected an empty error, got ${JSON.stringify(j.errors)}`);
  });

  it('fails the `[]  # REQUIRED - ...` form, which parses as a string', () => {
    const j = runVerifySummary(summaryContent({ requirementsCompleted: 'inline-comment' }));
    assert.equal(j.passed, false);
    assert.equal(j.checks.requirements_completed, null);
    assert.ok(j.errors.some(e => /not a YAML list/.test(e)),
      `expected a not-a-list error, got ${JSON.stringify(j.errors)}`);
  });

  it('fails when a body `---` pair shadows otherwise valid frontmatter', () => {
    const j = runVerifySummary(summaryContent({ requirementsCompleted: 'shadowed' }));
    assert.equal(j.passed, false);
    assert.equal(j.checks.requirements_completed, null);
    // Shadowing is indistinguishable from absence at the parse layer, so it lands on the
    // missing branch. The error string names the shadowing case so the reader is not sent
    // hunting for a key that is right there in the file.
    assert.ok(j.errors.some(e => /requirements-completed missing/.test(e)),
      `expected a missing error, got ${JSON.stringify(j.errors)}`);
  });

  it('carries requirements_completed: null on the missing-file early return', () => {
    const root = buildPlanningFixture({ phase: SUMMARY_PHASE });
    try {
      const r = verify.captureVerb(
        () => verify.cmdVerifySummary(root, `.planning/phases/${SUMMARY_PHASE}/23-99-SUMMARY.md`, 2, false),
      );
      assert.equal(r.ok, true, `expected JSON, got ${JSON.stringify(r)}`);
      assert.equal(r.json.passed, false);
      assert.deepEqual(r.json.checks, {
        summary_exists: false,
        files_created: { checked: 0, found: 0, missing: [] },
        commits_exist: false,
        self_check: 'not_found',
        requirements_completed: null,
      });
      assert.deepEqual(r.json.errors, ['SUMMARY.md not found']);
    } finally {
      cleanupFixture(root);
    }
  });

  it('leaves the four pre-existing checks behaving exactly as before', () => {
    const failing = summaryContent({ requirementsCompleted: ['PILOT-04'] })
      .replace('## Self-Check: PASSED', '## Self-Check: FAILED\n\nMissing: src/never-written.js');
    const j = runVerifySummary(failing);
    assert.equal(j.checks.summary_exists, true);
    assert.deepEqual(j.checks.files_created, { checked: 0, found: 0, missing: [] });
    assert.equal(j.checks.commits_exist, false);
    assert.equal(j.checks.self_check, 'failed');
    assert.ok(j.errors.includes('Self-check section indicates failure'),
      `expected the self-check error, got ${JSON.stringify(j.errors)}`);
    // The new check is orthogonal: a valid requirements-completed does not rescue a red
    // self-check, and a red self-check does not suppress the new key.
    assert.deepEqual(j.checks.requirements_completed, ['PILOT-04']);
    assert.equal(j.passed, false);
  });
});

// ── expandHomePath (A-03) ───────────────────────────────────────────────────
// must_haves.artifacts paths are written by a human in a PLAN, and this project's
// deliverables live outside the repo (~/Developer/cc-autopilot/, ~/.claude/bin/). The bare
// path.join(cwd, '~/x') that cmdVerifyArtifacts used produced '<cwd>/~/x', which never
// exists, so 51 of 54 artifact checks failed across the eighteen archived v5.0 plans purely
// for that reason. A gate that is red on every phase from day one is the ignorable gate this
// phase exists to prevent.

describe('expandHomePath (A-03)', () => {
  const HOME = process.env.HOME;

  it('expands a leading ~/', () => {
    assert.equal(verify.expandHomePath('/tmp/cwd', '~/x/y.txt'), join(HOME, 'x/y.txt'));
  });

  it('expands a leading $HOME/', () => {
    assert.equal(verify.expandHomePath('/tmp/cwd', '$HOME/x/y.txt'), join(HOME, 'x/y.txt'));
  });

  it('passes an absolute path through unchanged', () => {
    assert.equal(verify.expandHomePath('/tmp/cwd', '/abs/x.txt'), '/abs/x.txt');
  });

  it('joins a relative path against cwd, as before', () => {
    assert.equal(verify.expandHomePath('/tmp/cwd', 'rel/x.txt'), join('/tmp/cwd', 'rel/x.txt'));
  });

  it('does NOT resolve a bare ~user, which this engine does not support', () => {
    assert.equal(verify.expandHomePath('/tmp/cwd', '~notauser/x'), join('/tmp/cwd', '~notauser/x'));
  });
});

// ── cmdVerifyArtifacts home expansion ───────────────────────────────────────

describe('cmdVerifyArtifacts home expansion', () => {
  /**
   * Run cmdVerifyArtifacts over a PLAN whose artifacts carry the given paths, with $HOME
   * pointed at a throwaway directory so the assertion never depends on a real file in the
   * developer's home. HOME is restored in a finally, because leaking it would silently
   * change every later test in this process.
   */
  function runArtifacts(artifacts, { seed = null } = {}) {
    const fakeHome = join(tmpdir(), `donny-gate-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (seed) {
      fs.mkdirSync(join(fakeHome, dirname(seed)), { recursive: true });
      fs.writeFileSync(join(fakeHome, seed), 'seeded artifact contents\n', 'utf-8');
    } else {
      fs.mkdirSync(fakeHome, { recursive: true });
    }
    const root = buildPlanningFixture({
      phase: '23-fixture',
      plans: [{ name: '23-01-PLAN.md', content: validPlanContent({ artifacts }) }],
    });
    const origHome = process.env.HOME;
    try {
      process.env.HOME = fakeHome;
      const r = verify.captureVerb(
        () => verify.cmdVerifyArtifacts(root, '.planning/phases/23-fixture/23-01-PLAN.md', false),
      );
      assert.equal(r.ok, true, `expected JSON, got ${JSON.stringify(r)}`);
      return r.json;
    } finally {
      process.env.HOME = origHome;
      cleanupFixture(root);
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  }

  it('finds an artifact named by a ~/ path that really exists under $HOME', () => {
    const j = runArtifacts(
      [{ path: '~/Developer/seeded/artifact.txt', provides: 'the seeded file' }],
      { seed: 'Developer/seeded/artifact.txt' },
    );
    assert.equal(j.artifacts.length, 1);
    assert.equal(j.artifacts[0].exists, true, 'a ~/ artifact path must resolve against $HOME');
    assert.deepEqual(j.artifacts[0].issues, []);
    assert.equal(j.all_passed, true);
  });

  it('finds the same artifact named by a $HOME/ path', () => {
    const j = runArtifacts(
      [{ path: '$HOME/Developer/seeded/artifact.txt', provides: 'the seeded file' }],
      { seed: 'Developer/seeded/artifact.txt' },
    );
    assert.equal(j.artifacts[0].exists, true, 'a $HOME/ artifact path must resolve against $HOME');
    assert.equal(j.all_passed, true);
  });

  it('still reports a genuinely absent ~/ path as missing', () => {
    const j = runArtifacts([
      { path: `~/definitely-not-here-${Math.random().toString(36).slice(2)}/x.md`, provides: 'nothing' },
    ]);
    assert.equal(j.artifacts[0].exists, false);
    assert.deepEqual(j.artifacts[0].issues, ['File not found']);
    assert.equal(j.all_passed, false);
  });

  it('leaves the no-artifacts-block early return unchanged', () => {
    const root = buildPlanningFixture({
      phase: '23-fixture',
      plans: [{ name: '23-01-PLAN.md', content: validPlanContent({}) }],
    });
    try {
      const r = verify.captureVerb(
        () => verify.cmdVerifyArtifacts(root, '.planning/phases/23-fixture/23-01-PLAN.md', false),
      );
      assert.equal(r.ok, true, `expected JSON, got ${JSON.stringify(r)}`);
      assert.equal(r.json.error, 'No must_haves.artifacts found in frontmatter');
    } finally {
      cleanupFixture(root);
    }
  });

  it('leaves cmdVerifyReferences and cmdVerifyKeyLinks untouched (HC-5 blast radius)', () => {
    // A-03 names verify.cjs:689 only. The references backtick branch and both key-links
    // joins carry the identical defect and are deliberately NOT fixed here; the residue is
    // handled by scoring unresolved paths as warnings in the Plan 04 classifier. This pins
    // that they were not opportunistically widened. Measured: two joins in
    // cmdVerifyReferences (the at-reference ternary's else branch and the backtick branch),
    // not the one the plan's acceptance criterion recorded.
    const src = fs.readFileSync(resolve(ROOT, 'packages/donny/bin/lib/verify.cjs'), 'utf-8');
    const joins = src.split('\n').filter(l => l.includes('path.join(cwd, cleanRef)'));
    assert.equal(joins.length, 2, 'cmdVerifyReferences must keep both unexpanded joins');
    assert.ok(src.includes('const sourceContent = safeReadFile(path.join(cwd, link.from || \'\'));'),
      'cmdVerifyKeyLinks must keep its unexpanded source join');
  });
});

// ── classifyVerbResult (D-14 as amended by A-01 and A-03) ───────────────────
// D-14's intent survives - reuse each verb's own semantics rather than invent a second
// severity model - but its implementation cannot: the uniform errors[]/warnings[] split
// exists in only 2 of the 13 functions (C-5), so a `result.errors.length ? fail : pass` read
// would be wrong ten times out of thirteen.
//
// Every case below is driven from a RECORDED fixture in tests/fixtures/verbs/, never from a
// hand-written payload, so the classifier is tested against what the verbs actually emit.
// The expectation is stated as a literal severity per verb: a `default` plus the named
// exceptions, with the recorded case count pinned so a re-recording that adds or drops a case
// fails here instead of silently inheriting the default.

const EXPECTED_SEVERITY = {
  // Every archived phase has its plans and summaries paired, and the synthetic empty phase
  // has neither, so the verb reports complete with no errors and no warnings in all five.
  'phase-completeness': { cases: 5, default: 'pass', byLabel: {} },

  // Four real graphs are acyclic with ordered waves. A phase with zero PLAN files has nothing
  // to check, and a clean graph over zero nodes must not read as a pass the gate never earned.
  'plan-graph': { cases: 5, default: 'pass', byLabel: { 'empty phase': 'not_applicable' } },

  // All four archived VERIFICATION.md files read `status: passed`. The synthetic phase has no
  // VERIFICATION.md at all, which is A-01's not-yet: an input that does not exist yet.
  'phase-verified': { cases: 5, default: 'pass', byLabel: { 'empty phase': 'not_yet' } },

  // All four archived SECURITY.md files carry a register with zero open threats. The
  // synthetic phase has no SECURITY.md, which /donny-audit-phase writes AFTER execute-phase
  // close by design (A-01), so its absence is not-yet rather than a defect.
  'threats-clear': { cases: 5, default: 'pass', byLabel: { 'empty phase': 'not_yet' } },

  // Measured: no archived v5.0 phase has a UI-REVIEW.md. `missing` is the normal state for
  // every backend phase, and nothing later in the lifecycle will write one, so it is
  // not_applicable rather than not_yet.
  'ui-reviewed': { cases: 5, default: 'not_applicable', byLabel: {} },

  // The verb never scans .planning/milestones/, so all four archived phases come back
  // "Phase directory not found" - expected on an archive, not a defect. The one live fixture
  // phase is scanned properly and is clean.
  'schema-drift': {
    cases: 5,
    default: 'not_applicable',
    byLabel: { 'live (non-archived) fixture phase': 'pass' },
  },

  // Every recorded payload is the v6.0 REQUIREMENTS.md mid-milestone, where nothing is
  // satisfied yet, so each one scores error on its own unsatisfied rows.
  'milestone-coverage': { cases: 5, default: 'error', byLabel: {} },

  // Measured 0 errors and 8 warnings across the 18 real archived plans (the plan's constant,
  // re-measured here and confirmed exactly), so this verb is safe at error severity. The three
  // plans carrying warnings all have tasks with no <files> element.
  'plan-structure': {
    cases: 20,
    default: 'pass',
    byLabel: {
      '19-01-PLAN.md': 'warning',
      '19-02-PLAN.md': 'warning',
      '19-03-PLAN.md': 'warning',
      'file that does not exist': 'error',
    },
  },

  // A-03 half 2: 353 unresolved references across the 18 real plans, from unexpanded ~ in
  // backticks and from paths that moved when the milestone was archived. Scored as errors
  // this single verb would make the gate red on every phase.
  'references': { cases: 19, default: 'warning', byLabel: { 'clean fixture plan': 'pass' } },

  // After 23-03's expandHomePath fix, 15 of 18 archived plans verify all their artifacts. The
  // three that do not name files that moved into .planning/milestones/ at milestone close,
  // which no expansion rule can resolve - A-03 half 2 again.
  'artifacts': {
    cases: 19,
    default: 'pass',
    byLabel: {
      '21-06-PLAN.md': 'warning',
      '22-01-PLAN.md': 'warning',
      '22-02-PLAN.md': 'warning',
      'plan whose must_haves has no artifacts block': 'not_applicable',
    },
  },

  // 47 of 47 key-link checks fail on the archived plans, for the same unexpanded-path reason
  // (23-03 finding F2, deliberately left unfixed). A PLAN with no key_links block declares
  // nothing to check.
  'key-links': {
    cases: 19,
    default: 'warning',
    byLabel: { 'plan whose must_haves has no key_links block': 'not_applicable' },
  },

  // git history can be rewritten, and cmdVerifySummary harvests hashes with a hex-word regex
  // that picks up noise, so an unresolvable hash is recorded rather than failed.
  'commits': { cases: 2, default: 'warning', byLabel: {} },

  // THE ONE THAT DECIDES WHETHER THE GATE IS READABLE. Measured by 23-03 over 21 SUMMARYs
  // (3 from phase 23 plus all 18 archived): files_created fails 21/21, commits_exist 12/21,
  // self_check 7/21, for reasons that are artifacts of how those three checks are written and
  // not record defects. Scored as plain errors this verb is red on every SUMMARY this project
  // has ever written. The eight archived SUMMARYs below that DO score error are exactly the
  // ones missing requirements-completed - the J3/J5 drift Phase 22 had to repair by hand, and
  // the defect this milestone exists for. The ninth is the missing-file early return.
  'verify-summary': {
    cases: 19,
    default: 'warning',
    byLabel: {
      '20-01-SUMMARY.md': 'error',
      '20-02-SUMMARY.md': 'error',
      '20-03-SUMMARY.md': 'error',
      '21-01-SUMMARY.md': 'error',
      '21-02-SUMMARY.md': 'error',
      '21-03-SUMMARY.md': 'error',
      '21-04-SUMMARY.md': 'error',
      '21-05-SUMMARY.md': 'error',
      'summary path that does not exist': 'error',
    },
  },
};

/**
 * milestone-coverage is the one verb classifyVerbResult cannot score from the payload alone:
 * D-15 reduces the milestone-wide list to one phase first, and the classifier reads that
 * reduced list from opts. Here each recorded payload is scored whole; the D-15 filter and the
 * phase-scoped view are asserted in their own block below.
 */
const optsFor = (verb, kase) => (verb === 'milestone-coverage'
  ? { filteredRequirements: kase.output.requirements || [] }
  : undefined);

const readVerbFixture = (verb) =>
  JSON.parse(fs.readFileSync(join(__dirname, 'fixtures', 'verbs', `${verb}.json`), 'utf-8'));

describe('classifyVerbResult: the GATE_VERBS contract', () => {
  it('exports thirteen verb names, exactly the thirteen recorded fixtures', () => {
    assert.ok(Array.isArray(verify.GATE_VERBS), 'GATE_VERBS must be exported as an array');
    assert.equal(verify.GATE_VERBS.length, 13);
    assert.deepEqual([...verify.GATE_VERBS].sort(), [...VERB_FIXTURES].sort());
  });

  it('handles every GATE_VERBS name without falling through to the default branch', () => {
    // T-23-17: a verb added to verify.cjs in a later milestone must not be able to drop out
    // of the gate while the record still reads clean. This pins the handled set to the
    // constant, in both directions.
    for (const verb of verify.GATE_VERBS) {
      const got = verify.classifyVerbResult(verb, { ok: true, json: {} });
      assert.doesNotMatch(got.detail, /unmapped verb/, `${verb} must have a severity rule`);
    }
    for (const notAVerb of ['summary', 'gate', 'verify-artifacts', 'plan_structure', '']) {
      const got = verify.classifyVerbResult(notAVerb, { ok: true, json: {} });
      assert.equal(got.severity, 'error');
      assert.match(got.detail, /unmapped verb/);
    }
  });
});

// The loop reads VERB_FIXTURES rather than verify.GATE_VERBS on purpose: the assertion above
// pins the two lists equal, and iterating a local constant means a missing or truncated
// export cannot silently erase 133 assertions at module-load time.
for (const verb of VERB_FIXTURES) {
  describe(`classifyVerbResult: ${verb}`, () => {
    const spec = EXPECTED_SEVERITY[verb];
    const fixture = readVerbFixture(verb);

    it(`still has the ${spec.cases} recorded cases this table was written against`, () => {
      assert.equal(fixture.cases.length, spec.cases,
        `${verb}.json changed shape: re-record deliberately, then update EXPECTED_SEVERITY`);
    });

    for (const kase of fixture.cases) {
      const want = Object.prototype.hasOwnProperty.call(spec.byLabel, kase.label)
        ? spec.byLabel[kase.label]
        : spec.default;
      it(`classifies '${kase.label}' as ${want}`, () => {
        const got = verify.classifyVerbResult(verb, { ok: true, json: kase.output }, optsFor(verb, kase));
        assert.equal(got.severity, want,
          `${verb} case '${kase.label}' (source: ${kase.source}) classified ${got.severity}: ${got.detail}`);
        assert.equal(got.verb, verb);
        assert.equal(typeof got.detail, 'string');
        assert.ok(got.detail.length > 0, 'detail must say something');
        assert.ok(Array.isArray(got.findings), 'findings must be an array');
      });
    }
  });
}

describe('classifyVerbResult: boundary cases', () => {
  it('scores a verb that threw as an error, carrying the thrown message, for all thirteen', () => {
    // T-23-01: captureVerb returns rather than throws, so a verb that blew up must be scored
    // as an error with its message in the record, never read as an empty pass.
    for (const verb of verify.GATE_VERBS) {
      const got = verify.classifyVerbResult(verb, { ok: false, error: 'boom' });
      assert.equal(got.severity, 'error', `${verb} must fail on a non-ok capture`);
      assert.match(got.detail, /boom/);
      assert.deepEqual(got.findings, ['boom']);
    }
  });

  it('scores an unparseable capture as an error even with no message', () => {
    const got = verify.classifyVerbResult('references', { ok: false, raw: 'not json' });
    assert.equal(got.severity, 'error');
    assert.match(got.detail, /no parseable output/);
  });

  it('treats a PLAN with no must_haves.artifacts as not_applicable, not a failure', () => {
    const got = verify.classifyVerbResult('artifacts',
      { ok: true, json: { error: 'No must_haves.artifacts found in frontmatter' } });
    assert.equal(got.severity, 'not_applicable');
  });

  it('treats a PLAN with no must_haves.key_links as not_applicable', () => {
    const got = verify.classifyVerbResult('key-links',
      { ok: true, json: { error: 'No must_haves.key_links found in frontmatter' } });
    assert.equal(got.severity, 'not_applicable');
  });

  it('treats a missing SECURITY.md as not_yet, neither error nor warning (A-01)', () => {
    const got = verify.classifyVerbResult('threats-clear',
      { ok: true, json: { clear: false, status: 'missing' } });
    assert.equal(got.severity, 'not_yet');
  });

  it('treats the No SECURITY.md error string as not_yet as well', () => {
    const got = verify.classifyVerbResult('threats-clear',
      { ok: true, json: { clear: false, error: 'No SECURITY.md in phase' } });
    assert.equal(got.severity, 'not_yet');
  });

  it('names the literal the engine matches when VERIFICATION.md says PASS (the J1 finding)', () => {
    const got = verify.classifyVerbResult('phase-verified',
      { ok: true, json: { verified: false, status: 'PASS' } });
    assert.equal(got.severity, 'error');
    assert.match(got.detail, /PASS/);
    assert.match(got.detail, /passed/, 'the detail must name the lowercase literal the engine matches');
  });

  it('scores unresolved references as a warning, not an error (A-03 half 2)', () => {
    const got = verify.classifyVerbResult('references',
      { ok: true, json: { valid: false, missing: ['a', 'b'], found: 1, total: 3 } });
    assert.equal(got.severity, 'warning');
    assert.deepEqual(got.findings, ['a', 'b']);
  });

  it('scores an unknown verb as an error naming it, never as a pass and never by throwing', () => {
    const got = verify.classifyVerbResult('nope', { ok: true, json: {} });
    assert.equal(got.severity, 'error');
    assert.match(got.detail, /unmapped verb: nope/);
  });

  it('separates a real SUMMARY record defect from the three known measurement artifacts', () => {
    // 23-03 findings F3/F4/F5. All three of these strings are produced by checks that misfire
    // on a correctly written SUMMARY, so they warn; the D-16 requirements-completed error is
    // a real defect and fails. This is the difference between a gate that gets read and one
    // that is red on 21 of 21 records.
    const artifactsOnly = verify.classifyVerbResult('verify-summary', {
      ok: true,
      json: {
        passed: false,
        errors: [
          'Missing files: ~/Developer/cc-autopilot/autopilot/daemon.py',
          'Referenced commit hashes not found in git history',
          'Self-check section indicates failure',
        ],
      },
    });
    assert.equal(artifactsOnly.severity, 'warning');
    assert.equal(artifactsOnly.findings.length, 3, 'nothing is dropped from the record');

    const withDefect = verify.classifyVerbResult('verify-summary', {
      ok: true,
      json: {
        passed: false,
        errors: [
          'requirements-completed is empty',
          'Missing files: ~/Developer/cc-autopilot/autopilot/daemon.py',
        ],
      },
    });
    assert.equal(withDefect.severity, 'error');
    assert.match(withDefect.detail, /requirements-completed is empty/);
    assert.equal(withDefect.findings.length, 2);
  });

  it('scores an unrecognised SUMMARY error string as an error, not as an artifact', () => {
    // The partition is a named allow-list of three strings, not a "the verb was unhappy"
    // catch-all (T-23-18). Anything it has not seen fails loudly.
    const got = verify.classifyVerbResult('verify-summary',
      { ok: true, json: { passed: false, errors: ['Some future check failed'] } });
    assert.equal(got.severity, 'error');
  });

  it('passes a SUMMARY with no errors at all', () => {
    const got = verify.classifyVerbResult('verify-summary',
      { ok: true, json: { passed: true, errors: [] } });
    assert.equal(got.severity, 'pass');
  });
});

// ── filterCoverageToPhase (D-15) ────────────────────────────────────────────
// cmdVerifyMilestoneCoverage takes no phase argument at all (verify.cjs:466) and always
// reports the whole current milestone, so D-15's per-phase view has to be a post-hoc filter on
// the returned requirements[] array. requirements[].phase is the resolved phase DIRECTORY NAME
// when the phase exists on disk and the raw traceability label ("Phase 25") when it does not
// (verify.cjs:544), so both forms have to reduce to the same thing before they are compared.
//
// The hazard this block exists for is T-23-19: a substring filter would make phase 2 match
// 23-record-integrity-and-the-validation-gate and silently attribute another phase's
// requirements to this one, inflating or deflating a permanent coverage claim.

const COVERAGE_FIXTURE = readVerbFixture('milestone-coverage').cases[0].output;

describe('filterCoverageToPhase (D-15)', () => {
  it('reuses the module-level canonPhaseNum rather than a private copy', () => {
    assert.equal(typeof verify.canonPhaseNum, 'function');
    assert.equal(verify.canonPhaseNum('23'), '23');
    assert.equal(verify.canonPhaseNum('02.1'), '2.1');
    assert.equal(verify.canonPhaseNum('23-record-integrity'), null);
  });

  it('reduces the recorded milestone payload to this phase, in input order', () => {
    const got = verify.filterCoverageToPhase(COVERAGE_FIXTURE, '23');
    assert.deepEqual(got.map((r) => r.id), ['RECORD-03', 'RECORD-04', 'GATE-01', 'GATE-02', 'GATE-03']);
    assert.equal(COVERAGE_FIXTURE.requirements.length, 23, 'the recorded payload is milestone-wide');
  });

  it('matches a resolved phase DIRECTORY NAME', () => {
    const c = { requirements: [{ id: 'A', phase: '23-record-integrity-and-the-validation-gate' }] };
    assert.deepEqual(verify.filterCoverageToPhase(c, '23').map((r) => r.id), ['A']);
  });

  it('matches a raw "Phase N" traceability label, and only its own number', () => {
    const c = { requirements: [{ id: 'B', phase: 'Phase 25' }] };
    assert.deepEqual(verify.filterCoverageToPhase(c, '25').map((r) => r.id), ['B']);
    assert.deepEqual(verify.filterCoverageToPhase(c, '23'), []);
  });

  it('never matches a null phase', () => {
    const c = { requirements: [{ id: 'C', phase: null }] };
    assert.deepEqual(verify.filterCoverageToPhase(c, '23'), []);
    assert.deepEqual(verify.filterCoverageToPhase(c, '0'), []);
  });

  it('does NOT match phase 2 against a 23- directory (T-23-19, numeric equality)', () => {
    assert.deepEqual(verify.filterCoverageToPhase(COVERAGE_FIXTURE, '2'), []);
    const c = { requirements: [{ id: 'A', phase: '23-record-integrity-and-the-validation-gate' }] };
    assert.deepEqual(verify.filterCoverageToPhase(c, '2'), []);
    assert.deepEqual(verify.filterCoverageToPhase(c, '3'), []);
  });

  it('matches a decimal phase directory', () => {
    const c = { requirements: [{ id: 'D', phase: '02.1-backlog' }, { id: 'E', phase: '02-other' }] };
    assert.deepEqual(verify.filterCoverageToPhase(c, '02.1').map((r) => r.id), ['D']);
    assert.deepEqual(verify.filterCoverageToPhase(c, '2').map((r) => r.id), ['E']);
  });

  it('returns an empty array on an unknown-gate payload, without throwing', () => {
    const unknown = { gate: 'unknown', error: 'REQUIREMENTS.md not found or empty', counts: {}, requirements: [] };
    assert.deepEqual(verify.filterCoverageToPhase(unknown, '23'), []);
    assert.deepEqual(verify.filterCoverageToPhase(null, '23'), []);
    assert.deepEqual(verify.filterCoverageToPhase({}, '23'), []);
    assert.deepEqual(verify.filterCoverageToPhase(COVERAGE_FIXTURE, null), []);
    assert.deepEqual(verify.filterCoverageToPhase(COVERAGE_FIXTURE, 'no-digits-here'), []);
  });

  it('returns the original entries unmodified and leaves the payload untouched', () => {
    const before = JSON.stringify(COVERAGE_FIXTURE);
    const got = verify.filterCoverageToPhase(COVERAGE_FIXTURE, '23');
    assert.deepEqual(got[0], { id: 'RECORD-03', phase: '23-record-integrity-and-the-validation-gate', status: 'unsatisfied', orphaned: false, needs_checkbox_update: false });
    assert.equal(JSON.stringify(COVERAGE_FIXTURE), before, 'the filter must not mutate its input');
  });
});

// ── milestone-coverage classification (D-15) ────────────────────────────────

describe('milestone-coverage classification (D-15)', () => {
  const captured = { ok: true, json: { gate: 'gaps_found' } };
  const classify = (filteredRequirements) =>
    verify.classifyVerbResult('milestone-coverage', captured, { filteredRequirements });
  const req = (id, over) => Object.assign(
    { id, phase: '23-fixture', status: 'satisfied', orphaned: false, needs_checkbox_update: false },
    over,
  );

  it('scores the recorded payload filtered to phase 23 as an error', () => {
    // Driven from the real recording: all five of this phase's requirements are unsatisfied
    // mid-milestone, which is the state the gate is supposed to report.
    const got = classify(verify.filterCoverageToPhase(COVERAGE_FIXTURE, '23'));
    assert.equal(got.severity, 'error');
    assert.equal(got.findings.length, 5);
    assert.ok(got.findings.some((f) => f.startsWith('GATE-01')), JSON.stringify(got.findings));
  });

  it('scores an unsatisfied requirement as an error', () => {
    assert.equal(classify([req('X', { status: 'unsatisfied' })]).severity, 'error');
  });

  it('scores an orphaned requirement as an error naming it orphaned', () => {
    const got = classify([req('Y', { status: 'unsatisfied', orphaned: true })]);
    assert.equal(got.severity, 'error');
    assert.match(got.findings[0], /orphaned/);
  });

  it('scores a partial requirement as a warning', () => {
    assert.equal(classify([req('Z', { status: 'partial' })]).severity, 'warning');
  });

  it('scores a satisfied requirement with a stale checkbox as a warning', () => {
    const got = classify([req('W', { needs_checkbox_update: true })]);
    assert.equal(got.severity, 'warning');
    assert.match(got.findings[0], /checkbox/);
  });

  it('scores an all-satisfied list as a pass', () => {
    const got = classify([req('A'), req('B')]);
    assert.equal(got.severity, 'pass');
    assert.deepEqual(got.findings, []);
  });

  it('scores an empty filtered list as not_yet (C-9: archived phases have none)', () => {
    assert.equal(classify([]).severity, 'not_yet');
    assert.equal(classify(undefined).severity, 'not_yet');
    const unknownGate = verify.classifyVerbResult(
      'milestone-coverage',
      { ok: true, json: { gate: 'unknown' } },
      { filteredRequirements: [req('A')] },
    );
    assert.equal(unknownGate.severity, 'not_yet');
  });

  it('reports the worst severity present and names every offending id', () => {
    const got = classify([
      req('OK-01'),
      req('PART-01', { status: 'partial' }),
      req('BAD-01', { status: 'unsatisfied' }),
      req('STALE-01', { needs_checkbox_update: true }),
    ]);
    assert.equal(got.severity, 'error');
    const ids = got.findings.map((f) => f.split(':')[0]);
    assert.deepEqual(ids.sort(), ['BAD-01', 'PART-01', 'STALE-01']);
    assert.ok(!ids.includes('OK-01'), 'a satisfied requirement is not a finding');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan 05: harvestCommitHashes, runGate and cmdVerifyGate
//
// Plan 04 decided what one verb result MEANS. This block covers what happens when all
// thirteen are driven at once: that every verb runs at its correct scope, that none of them
// is ever handed an empty required argument (T-23-02, which would process.exit(1) mid-run),
// that the resolved phase directory cannot escape .planning (T-23-06), and that thirteen
// nested captureVerb calls leave fs.writeSync exactly as they found it (T-23-01).
// ─────────────────────────────────────────────────────────────────────────────

const GATE_PHASE = '23-gate';
const SEVERITIES = ['pass', 'warning', 'error', 'not_applicable', 'not_yet'];

const gatePlans = () => ([
  { name: '23-01-PLAN.md', content: validPlanContent({ phase: GATE_PHASE, plan: '01', wave: 0 }) },
  { name: '23-02-PLAN.md', content: validPlanContent({ phase: GATE_PHASE, plan: '02', wave: 1 }) },
]);

const gateSummaries = () => ([
  { name: '23-01-SUMMARY.md', content: summaryContent({ phase: GATE_PHASE, plan: '01', requirementsCompleted: ['FIX-01'] }) },
  { name: '23-02-SUMMARY.md', content: summaryContent({ phase: GATE_PHASE, plan: '02', requirementsCompleted: ['FIX-01'] }) },
]);

const buildGateFixture = (over = {}) => buildPlanningFixture({
  phase: GATE_PHASE,
  plans: gatePlans(),
  summaries: gateSummaries(),
  verification: verificationContent({ phase: GATE_PHASE }),
  security: securityContent({ phase: GATE_PHASE, threatsOpen: 0 }),
  requirements: requirementsContent({ entries: [{ id: 'FIX-01', checked: true, phase: 'Phase 23' }] }),
  ...over,
});

/** Build a fixture, hand it to fn, and always remove it. */
const withGateFixture = (over, fn) => {
  const root = buildGateFixture(over);
  try { return fn(root); } finally { cleanupFixture(root); }
};

/** A SUMMARY carrying a Task Commits section plus hex-looking words outside it. */
const summaryWithCommits = ({ inside = [], outside = [], trailingSection = true } = {}) => {
  const lines = [
    '---',
    'status: PASS',
    'requirements-completed: [FIX-01]',
    '---',
    '',
    '# Fixture summary',
    '',
    '## Accomplishments',
    '',
  ];
  for (const h of outside) lines.push(`Prose mentioning ${h} well outside any commit section.`);
  lines.push('', '## Task Commits', '');
  for (const h of inside) lines.push(`1. Task - \`${h}\` (feat: something)`);
  if (trailingSection) {
    lines.push('', '## Self-Check: PASSED', '');
    for (const h of outside) lines.push(`Also ${h} after the section closed.`);
  }
  lines.push('');
  return lines.join('\n');
};

describe('harvestCommitHashes', () => {
  it('is exported as a function', () => {
    assert.equal(typeof verify.harvestCommitHashes, 'function');
  });

  it('returns only the hashes inside the Task Commits section', () => {
    withGateFixture({
      summaries: [{
        name: '23-01-SUMMARY.md',
        content: summaryWithCommits({
          inside: ['aaaaaaa', 'bbbbbbb'],
          outside: ['ccccccc', 'ddddddd'],
        }),
      }],
    }, (root) => {
      const got = verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['23-01-SUMMARY.md']);
      assert.deepEqual(got, ['aaaaaaa', 'bbbbbbb']);
    });
  });

  it('stops at the next level-two heading and keeps document order', () => {
    withGateFixture({
      summaries: [{
        name: '23-01-SUMMARY.md',
        content: summaryWithCommits({ inside: ['1111111', '2222222', '3333333'], outside: ['9999999'] }),
      }],
    }, (root) => {
      const got = verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['23-01-SUMMARY.md']);
      assert.deepEqual(got, ['1111111', '2222222', '3333333']);
    });
  });

  it('deduplicates across SUMMARY files', () => {
    withGateFixture({
      summaries: [
        { name: '23-01-SUMMARY.md', content: summaryWithCommits({ inside: ['abcdef1', 'abcdef2'] }) },
        { name: '23-02-SUMMARY.md', content: summaryWithCommits({ inside: ['abcdef2', 'abcdef3'] }) },
      ],
    }, (root) => {
      const got = verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['23-01-SUMMARY.md', '23-02-SUMMARY.md']);
      assert.deepEqual(got, ['abcdef1', 'abcdef2', 'abcdef3']);
    });
  });

  it('caps the harvest, bounding the git subprocesses a crafted document can provoke', () => {
    const many = [];
    for (let i = 0; i < 40; i += 1) many.push(String(1000000 + i));
    withGateFixture({
      summaries: [{ name: '23-01-SUMMARY.md', content: summaryWithCommits({ inside: many }) }],
    }, (root) => {
      const got = verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['23-01-SUMMARY.md']);
      assert.equal(got.length, 20, 'default cap is 20 hashes');
      assert.equal(got[0], '1000000');
      const capped = verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['23-01-SUMMARY.md'], 5);
      assert.equal(capped.length, 5);
    });
  });

  it('returns an empty array when no SUMMARY has a Task Commits section', () => {
    withGateFixture({}, (root) => {
      const got = verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['23-01-SUMMARY.md', '23-02-SUMMARY.md']);
      assert.deepEqual(got, []);
    });
  });

  it('tolerates a missing file and an empty file list without throwing', () => {
    withGateFixture({}, (root) => {
      assert.deepEqual(verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, ['does-not-exist.md']), []);
      assert.deepEqual(verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, []), []);
      assert.deepEqual(verify.harvestCommitHashes(root, `.planning/phases/${GATE_PHASE}`, null), []);
    });
  });
});

describe('runGate', () => {
  it('is exported as a function', () => {
    assert.equal(typeof verify.runGate, 'function');
  });

  it('drives every one of the thirteen verbs and rolls them up into thirteen rows', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, '23');
      assert.equal(r.found, true);
      assert.equal(r.schema, 'verify-gate');
      assert.equal(r.phase_dir, `.planning/phases/${GATE_PHASE}`);
      const seen = new Set(r.verbs.map((v) => v.verb));
      for (const v of verify.GATE_VERBS) {
        assert.ok(seen.has(v), `every gate verb must produce at least one row: ${v}`);
      }
      assert.equal(r.rollup.length, 13);
      assert.deepEqual(r.rollup.map((x) => x.verb), verify.GATE_VERBS);
    });
  });

  it('counts every invocation exactly once', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, '23');
      const sum = SEVERITIES.reduce((acc, s) => acc + r.counts[s], 0);
      assert.equal(sum, r.verbs.length, 'the five severity counts must sum to the invocation count');
      assert.equal(r.counts.total, r.verbs.length);
    });
  });

  it('assigns every row one of the five known severities', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, '23');
      for (const row of r.verbs) {
        assert.ok(SEVERITIES.includes(row.severity), `unknown severity ${row.severity} on ${row.verb}`);
        assert.equal(typeof row.detail, 'string');
        assert.ok(Array.isArray(row.findings));
      }
    });
  });

  it('scopes each verb: seven on the phase, four per PLAN, one per SUMMARY', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, '23');
      const scopeOf = (v) => r.rollup.find((x) => x.verb === v).scope;
      assert.equal(scopeOf('phase-completeness'), 'phase');
      assert.equal(scopeOf('milestone-coverage'), 'phase');
      assert.equal(scopeOf('commits'), 'phase');
      for (const v of ['plan-structure', 'references', 'artifacts', 'key-links']) {
        assert.equal(scopeOf(v), 'plan', `${v} iterates PLAN files`);
        assert.equal(r.verbs.filter((x) => x.verb === v).length, 2, `${v} runs once per PLAN`);
        assert.deepEqual(
          r.verbs.filter((x) => x.verb === v).map((x) => x.target),
          ['23-01-PLAN.md', '23-02-PLAN.md'],
        );
      }
      assert.equal(scopeOf('verify-summary'), 'summary');
      assert.deepEqual(
        r.verbs.filter((x) => x.verb === 'verify-summary').map((x) => x.target),
        ['23-01-SUMMARY.md', '23-02-SUMMARY.md'],
      );
    });
  });

  it('passes a healthy fixture phase and never reports not_run', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, '23');
      const errs = r.verbs.filter((x) => x.severity === 'error');
      assert.deepEqual(errs.map((e) => `${e.verb}: ${e.detail}`), [], 'a clean fixture phase must produce zero errors');
      assert.equal(r.counts.error, 0);
      assert.equal(r.verdict, 'pass');
      assert.notEqual(r.verdict, 'not_run');
    });
  });

  it('fails when a verb reports an error, and the verdict follows counts.error', () => {
    withGateFixture({
      verification: verificationContent({ phase: GATE_PHASE, status: 'PASS' }),
    }, (root) => {
      const r = verify.runGate(root, '23');
      const pv = r.verbs.find((x) => x.verb === 'phase-verified');
      assert.equal(pv.severity, 'error', 'status PASS is the J1 defect, not a pass');
      assert.ok(r.counts.error > 0);
      assert.equal(r.verdict, 'fail');
    });
  });

  it('returns the not-found shape for an unknown phase instead of throwing', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, 'nope');
      assert.equal(r.found, false);
      assert.equal(r.error, 'Phase not found');
      assert.equal(r.phase, 'nope');
    });
  });

  it('refuses a traversal argument rather than resolving outside .planning (T-23-06)', () => {
    withGateFixture({}, (root) => {
      for (const bad of ['../../etc', '../..', '/etc', '.planning/../..']) {
        const r = verify.runGate(root, bad);
        assert.equal(r.found, false, `${bad} must not resolve to a phase`);
        assert.ok(!r.rollup, 'a refused argument produces no verb results at all');
      }
    });
  });

  it('leaves fs.writeSync identical after driving all thirteen verbs (T-23-01)', () => {
    withGateFixture({}, (root) => {
      const before = fs.writeSync;
      verify.runGate(root, '23');
      assert.equal(fs.writeSync, before, 'thirteen nested captures must all restore fd-1');
    });
  });

  it('writes nothing to stdout of its own accord', () => {
    withGateFixture({}, (root) => {
      const captured = verify.captureVerb(() => { verify.runGate(root, '23'); });
      assert.equal(captured.ok, false);
      assert.equal(captured.error, 'verb produced no output', 'runGate must not call output()');
    });
  });

  it('marks commits not_applicable rather than calling the verb with an empty array (T-23-02)', () => {
    withGateFixture({}, (root) => {
      // cmdVerifyCommits calls error() -> process.exit(1) on an empty hash array. If the guard
      // regressed, this test process would die here and the whole run would fail loudly.
      const r = verify.runGate(root, '23');
      const row = r.verbs.find((x) => x.verb === 'commits');
      assert.equal(row.severity, 'not_applicable');
      assert.match(row.detail, /Task Commits/);
    });
  });

  it('survives a phase with zero SUMMARY files', () => {
    withGateFixture({ summaries: [] }, (root) => {
      const r = verify.runGate(root, '23');
      assert.equal(r.found, true);
      assert.equal(r.verbs.filter((x) => x.verb === 'verify-summary').length, 0);
      const row = r.rollup.find((x) => x.verb === 'verify-summary');
      assert.equal(row.targets, 0);
      assert.equal(row.severity, 'not_applicable');
      assert.equal(r.verbs.find((x) => x.verb === 'commits').severity, 'not_applicable');
    });
  });

  it('survives a phase with zero PLAN files', () => {
    withGateFixture({ plans: [], summaries: [] }, (root) => {
      const r = verify.runGate(root, '23');
      assert.equal(r.found, true);
      assert.equal(r.rollup.length, 13);
      for (const v of ['plan-structure', 'references', 'artifacts', 'key-links']) {
        const row = r.rollup.find((x) => x.verb === v);
        assert.equal(row.targets, 0, `${v} has no targets`);
        assert.equal(row.severity, 'not_applicable');
      }
    });
  });

  it('runs commits once for the whole phase when hashes are present', () => {
    withGateFixture({
      summaries: [{ name: '23-01-SUMMARY.md', content: summaryWithCommits({ inside: ['abc1234', 'def5678'] }) }],
    }, (root) => {
      const r = verify.runGate(root, '23');
      const rows = r.verbs.filter((x) => x.verb === 'commits');
      assert.equal(rows.length, 1, 'commits runs once, not once per SUMMARY');
      assert.equal(rows[0].scope, 'phase');
      // Neither hash is in the fixture repo, which the classifier records as a warning.
      assert.equal(rows[0].severity, 'warning');
      assert.equal(rows[0].findings.length, 2);
    });
  });

  it('rolls the worst severity per verb up into the rollup row', () => {
    withGateFixture({
      summaries: [
        { name: '23-01-SUMMARY.md', content: summaryContent({ phase: GATE_PHASE, plan: '01', requirementsCompleted: ['FIX-01'] }) },
        { name: '23-02-SUMMARY.md', content: summaryContent({ phase: GATE_PHASE, plan: '02', requirementsCompleted: null }) },
      ],
    }, (root) => {
      const r = verify.runGate(root, '23');
      const row = r.rollup.find((x) => x.verb === 'verify-summary');
      assert.equal(row.targets, 2);
      assert.equal(row.severity, 'error', 'one erroring target makes the rollup row an error');
      assert.equal(row.counts.error, 1);
      assert.equal(row.counts.pass, 1);
      assert.ok(row.findings.some((f) => /requirements-completed/.test(f)));
    });
  });

  it('carries the phase identity and a timestamp the record can quote', () => {
    withGateFixture({}, (root) => {
      const r = verify.runGate(root, '23');
      assert.equal(r.phase, '23');
      assert.equal(r.archived, null);
      assert.match(r.generated_at, /^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe('runGate against the archived v5.0 Phase 19', { skip: !hasCco }, () => {
  it('resolves the archived directory and tags the milestone', () => {
    const r = verify.runGate(CCO_ROOT, '19');
    assert.equal(r.found, true);
    assert.equal(r.phase_dir, CCO_PHASE_19);
    assert.equal(r.archived, 'v5.0');
    assert.equal(r.rollup.length, 13);
  });

  it('does not fail an archived phase on inputs a later command owns', () => {
    const r = verify.runGate(CCO_ROOT, '19');
    const sev = (v) => r.rollup.find((x) => x.verb === v).severity;
    assert.notEqual(sev('threats-clear'), 'error', 'SECURITY.md absence is not a record defect');
    assert.equal(sev('ui-reviewed'), 'not_applicable', 'no v5.0 phase has a UI-REVIEW.md');
  });

  it('leaves fs.writeSync identical after a real archived run', () => {
    const before = fs.writeSync;
    verify.runGate(CCO_ROOT, '19');
    assert.equal(fs.writeSync, before);
  });
});

describe('cmdVerifyGate', () => {
  it('is exported as a function', () => {
    assert.equal(typeof verify.cmdVerifyGate, 'function');
  });

  it('emits exactly one JSON document through output()', () => {
    withGateFixture({}, (root) => {
      const captured = verify.captureVerb(() => { verify.cmdVerifyGate(root, '23', {}, false); });
      assert.equal(captured.ok, true, 'the gate must produce one parseable JSON document');
      assert.equal(captured.json.schema, 'verify-gate');
      assert.equal(captured.json.rollup.length, 13);
    });
  });

  it('honours --raw by emitting the bare verdict', () => {
    withGateFixture({}, (root) => {
      const before = fs.writeSync;
      const chunks = [];
      fs.writeSync = function (fd, data, ...rest) {
        if (fd === 1) { chunks.push(String(data)); return String(data).length; }
        return before.call(fs, fd, data, ...rest);
      };
      try { verify.cmdVerifyGate(root, '23', {}, true); } finally { fs.writeSync = before; }
      assert.equal(chunks.join(''), 'pass');
    });
  });

  it('emits not_found in raw mode for an unresolvable phase', () => {
    withGateFixture({}, (root) => {
      const before = fs.writeSync;
      const chunks = [];
      fs.writeSync = function (fd, data, ...rest) {
        if (fd === 1) { chunks.push(String(data)); return String(data).length; }
        return before.call(fs, fd, data, ...rest);
      };
      try { verify.cmdVerifyGate(root, 'nope', {}, true); } finally { fs.writeSync = before; }
      assert.equal(chunks.join(''), 'not_found');
    });
  });

  it('accepts and ignores the options slot Plan 06 fills', () => {
    withGateFixture({}, (root) => {
      const a = verify.captureVerb(() => { verify.cmdVerifyGate(root, '23', {}, false); });
      const b = verify.captureVerb(() => { verify.cmdVerifyGate(root, '23', { write: true }, false); });
      assert.equal(a.ok && b.ok, true);
      assert.deepEqual(a.json.rollup.map((r) => r.severity), b.json.rollup.map((r) => r.severity));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The CLI surface: donny-tools.cjs verify gate <phase>
//
// Two of these are load-bearing. JSON.parse over the WHOLE of stdout fails if any verb's
// output leaked past captureVerb, which is the integration-level proof of T-23-01. And
// --pick verdict nests the shipped --pick interception (donny-tools.cjs:301-333) around
// thirteen more fd-1 interceptions, so it fails unless both layers restore.
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = resolve(ROOT, 'packages/donny/bin/donny-tools.cjs');

/** Run donny-tools in a fixture root and return { status, stdout, stderr }. */
const runTools = (cwd, argv) => {
  try {
    const stdout = execFileSync(process.execPath, [TOOLS, ...argv], { cwd, encoding: 'utf-8' });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status === undefined ? -1 : e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

describe('verify gate CLI', () => {
  it('prints exactly one JSON document', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate', '23']);
      assert.equal(r.status, 0, r.stderr);
      const doc = JSON.parse(r.stdout);
      assert.equal(doc.schema, 'verify-gate');
      assert.equal(doc.rollup.length, 13);
      assert.equal(doc.verbs.length, doc.counts.total);
    });
  });

  it('emits no @file: overflow pointer, so consumers parse stdout directly', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate', '23']);
      assert.ok(!r.stdout.startsWith('@file:'), 'the gate payload must stay under the output() overflow threshold');
    });
  });

  it('honours --raw with the bare verdict and nothing else', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate', '23', '--raw']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'pass');
    });
  });

  it('honours --pick verdict, proving the two fd-1 interceptions nest', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate', '23', '--pick', 'verdict']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'pass');
    });
  });

  it('honours --pick counts.error through dot notation', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate', '23', '--pick', 'counts.error']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '0');
    });
  });

  it('exits non-zero with phase required when no phase is given', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate']);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /phase required/);
      assert.equal(r.stdout, '');
    });
  });

  it('reports an unresolvable phase as JSON rather than exiting', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'gate', '77']);
      assert.equal(r.status, 0, r.stderr);
      const doc = JSON.parse(r.stdout);
      assert.equal(doc.found, false);
      assert.equal(doc.error, 'Phase not found');
    });
  });

  it('lists gate among the available verify subcommands', () => {
    withGateFixture({}, (root) => {
      const r = runTools(root, ['verify', 'bogus-subcommand']);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Unknown verify subcommand/);
      assert.match(r.stderr, /schema-drift, gate/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real-artifact calibration
//
// The fixture suite pins SEMANTICS: does the classifier say the right thing about a known
// input. It cannot pin CALIBRATION: does the gate stay quiet on artifacts that are actually
// fine. A fixture with two clean plans will never reveal that `artifacts` failed 51 of 54
// checks on real work. This project's own recorded scar is a clean 98-of-98 suite that hid
// three HIGH defects at roughly 37 percent mutation survival, so a green fixture suite is
// necessary and not sufficient.
//
// MEASURED 2026-09-02, donnyclaude at 0a1c1be, claudecodeoptimized at 22e2963.
// Three consecutive runs per phase produced identical counts.
//
//   phase  verdict  pass  warning  error  not_applicable  not_yet  total
//   19     pass       9     16       0          2            1       28
//   20     fail      12     10       3          2            1       28
//   21     fail      15     15       5          2            1       38
//   22     pass      11     14       0          2            1       28
//
// Every one of the eight errors is the SAME finding, and it is a real record defect rather
// than a classifier miscalibration: 20-01/02/03 and 21-01/02/03/04/05 carry FOUR '---' lines,
// so extractFrontmatter takes the LAST pair (frontmatter.cjs:16-17), the real block is
// shadowed, and the file parses to ZERO frontmatter keys. Seven of the eight visibly contain
// a `requirements-completed:` line that no checker can see; 21-04 has none at all. This
// survived Phase 22's repair pass, which fixed the milestone-coverage symptom (20-04 and
// 21-06 do parse, and carry the PILOT ids, so coverage reads 10/10) without removing the
// decorative body rules on the other eight files.
//
// So the ceiling is NOT raised to absorb these. They are the drift the milestone exists to
// catch, the gate reproduces them deterministically, and the two phases nobody disputes are
// healthy (19 and 22) come back with exactly zero errors.
const CEILING = { 19: 0, 20: 3, 21: 5, 22: 0 };

const CCO_ARCHIVE = resolve(CCO_ROOT, '.planning/milestones/v5.0-phases');
const hasArchive = fs.existsSync(CCO_ARCHIVE);

describe('real-artifact calibration', { skip: !hasArchive }, () => {
  for (const phase of Object.keys(CEILING)) {
    describe(`archived v5.0 phase ${phase}`, () => {
      it('stays at or below the measured error ceiling', () => {
        const r = verify.runGate(CCO_ROOT, phase);
        assert.equal(r.found, true);
        assert.ok(
          r.counts.error <= CEILING[phase],
          `phase ${phase}: ${r.counts.error} error(s), ceiling ${CEILING[phase]}\n` +
            r.verbs.filter((x) => x.severity === 'error')
              .map((x) => `  ${x.verb} ${x.target || ''}: ${x.detail}`).join('\n'),
        );
      });

      it('still runs all thirteen checkers on real data', () => {
        const r = verify.runGate(CCO_ROOT, phase);
        assert.equal(r.rollup.length, 13);
        assert.deepEqual(r.rollup.map((x) => x.verb), verify.GATE_VERBS);
      });

      it('assigns only known severities, so no unclassified string reaches a record', () => {
        const r = verify.runGate(CCO_ROOT, phase);
        assert.ok(r.verbs.every((x) => SEVERITIES.includes(x.severity)));
        assert.ok(r.rollup.every((x) => SEVERITIES.includes(x.severity)));
        assert.equal(SEVERITIES.reduce((a, s) => a + r.counts[s], 0), r.counts.total);
      });

      it('emits a payload small enough to stay one JSON document', () => {
        const r = verify.runGate(CCO_ROOT, phase);
        // output() diverts anything over 50000 chars to a temp file and writes '@file:...'
        // instead (core.cjs:186-193), which would break every consumer that parses stdout.
        assert.ok(JSON.stringify(r, null, 2).length < 50000);
      });
    });
  }

  it('reports zero errors on the two archived phases nobody disputes are healthy', () => {
    for (const phase of ['19', '22']) {
      const r = verify.runGate(CCO_ROOT, phase);
      assert.equal(r.counts.error, 0, `phase ${phase} must be quiet`);
      assert.equal(r.verdict, 'pass');
    }
  });

  it('attributes every archived-phase error to the shadowed-frontmatter defect', () => {
    // Pins the CAUSE, not only the count. A new class of error appearing on a frozen archive
    // could otherwise slip in under the ceiling while the counts still looked familiar, which
    // is what Plan 09's replay has to be able to rule out.
    for (const phase of ['20', '21']) {
      const errs = verify.runGate(CCO_ROOT, phase).verbs.filter((x) => x.severity === 'error');
      assert.equal(errs.length, CEILING[phase]);
      for (const e of errs) {
        assert.equal(e.verb, 'verify-summary');
        assert.match(e.detail, /requirements-completed missing from SUMMARY frontmatter/);
      }
    }
  });

  it('keeps the archive byte-untouched, since the gate only ever reads (D-18)', () => {
    const before = fs.readdirSync(CCO_ARCHIVE).sort();
    for (const phase of Object.keys(CEILING)) verify.runGate(CCO_ROOT, phase);
    assert.deepEqual(fs.readdirSync(CCO_ARCHIVE).sort(), before);
  });
});
