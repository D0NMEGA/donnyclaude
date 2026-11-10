/**
 * The verification verdict rule, and the readers that must all agree on it.
 *
 * donny-verifier writes `status: PASS|FAIL|PARTIAL` plus `verdict: passed|gaps_found|
 * human_needed`. Before this file the engine keyed on a lowercase `status: passed`, so every
 * verifier-written phase read as unverified: /donny-ship blocked, the records gate failed and
 * milestone coverage undercounted. verificationVerdict in frontmatter.cjs is now the one rule;
 * these tests pin it and drive each reader through a real file on disk.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPlanningFixture,
  cleanupFixture,
  requirementsContent,
  summaryContent,
  verificationContent,
} from './helpers/planning-fixture.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LIB = resolve(ROOT, 'packages/donny/bin/lib');
const { extractFrontmatter, verificationVerdict } = require(join(LIB, 'frontmatter.cjs'));
const verify = require(join(LIB, 'verify.cjs'));
const uat = require(join(LIB, 'uat.cjs'));
const commands = require(join(LIB, 'commands.cjs'));

const PHASE = '23-fixture';

// -- The rule ---------------------------------------------------------------

const RULE_TABLE = [
  // [label, frontmatter, expected verdict, expected verified]
  ['verdict passed + status PASS', { status: 'PASS', verdict: 'passed' }, 'passed', true],
  ['verdict passed + status PARTIAL', { status: 'PARTIAL', verdict: 'passed' }, 'passed', false],
  ['verdict passed + status FAIL', { status: 'FAIL', verdict: 'passed' }, 'passed', false],
  ['verdict gaps_found + status PARTIAL', { status: 'PARTIAL', verdict: 'gaps_found' }, 'gaps_found', false],
  ['verdict gaps_found + status PASS (conflict)', { status: 'PASS', verdict: 'gaps_found' }, 'gaps_found', false],
  ['verdict human_needed + status PARTIAL', { status: 'PARTIAL', verdict: 'human_needed' }, 'human_needed', false],
  ['verdict wins over a legacy status', { status: 'human_needed', verdict: 'passed' }, 'passed', false],
  ['verdict in another letter case', { status: 'pass', verdict: 'Passed' }, 'passed', true],
  ['verdict passed, no status key', { verdict: 'passed' }, 'passed', true],
  ['legacy status passed only', { status: 'passed' }, 'passed', true],
  ['legacy status PASS only', { status: 'PASS' }, 'passed', true],
  ['legacy status Pass only', { status: 'Pass' }, 'passed', true],
  ['legacy status FAIL only', { status: 'FAIL' }, 'gaps_found', false],
  ['legacy status failed only', { status: 'failed' }, 'gaps_found', false],
  ['legacy status gaps_found only', { status: 'gaps_found' }, 'gaps_found', false],
  ['legacy status human_needed only', { status: 'human_needed' }, 'human_needed', false],
  // Before the rule, PARTIAL never mapped onto gaps_found anywhere (coverage read it like
  // human_needed or missing), so it stays an unknown, unverified verdict.
  ['legacy status PARTIAL only', { status: 'PARTIAL' }, 'unknown', false],
  ['blank: no keys at all', {}, 'unknown', false],
  ['blank: null frontmatter', null, 'unknown', false],
  ['blank status (parser gives {}) with verdict passed', { status: {}, verdict: 'passed' }, 'passed', false],
  ['empty-string status with verdict passed', { status: '', verdict: 'passed' }, 'passed', false],
  ['blank verdict falls back to status', { status: 'PASS', verdict: {} }, 'passed', true],
  ['malformed verdict', { status: 'PASS', verdict: 'maybe' }, 'unknown', false],
  ['malformed status with verdict passed', { status: 'SECURED', verdict: 'passed' }, 'passed', false],
  ['malformed status only', { status: 'pending' }, 'unknown', false],
  ['non-scalar verdict', { status: 'PASS', verdict: ['passed'] }, 'unknown', false],
];

describe('verificationVerdict: the one verdict rule', () => {
  for (const [label, fm, verdict, verified] of RULE_TABLE) {
    it(label, () => {
      assert.deepEqual(verificationVerdict(fm), { verdict, verified });
    });
  }

  it('reads the real verifier frontmatter shape end to end', () => {
    const fm = extractFrontmatter([
      '---',
      'status: PARTIAL',
      'agent: donny-verifier',
      'phase: 17-x',
      'verified: 2026-10-24T04:10:03Z',
      'verdict: human_needed',
      'score: 4/5',
      '---',
      '',
      '# Phase 17',
    ].join('\n'));
    assert.deepEqual(verificationVerdict(fm), { verdict: 'human_needed', verified: false });
  });
});

// -- phase-verified ---------------------------------------------------------

function phaseVerified(verification) {
  const root = buildPlanningFixture({ phase: PHASE, verification });
  try {
    const r = verify.captureVerb(() => verify.cmdVerifyPhaseVerified(root, PHASE, false));
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.json;
  } finally {
    cleanupFixture(root);
  }
}

describe('verify phase-verified emits verified and verdict', () => {
  it('verifies a verifier-written PASS + passed record and keeps the raw status', () => {
    const j = phaseVerified(verificationContent({ status: 'PASS', verdict: 'passed' }));
    assert.equal(j.verified, true);
    assert.equal(j.verdict, 'passed');
    assert.equal(j.status, 'PASS', 'the raw status field is reported as written');
  });

  it('does not verify PARTIAL + human_needed, and names the verdict', () => {
    const j = phaseVerified(verificationContent({ status: 'PARTIAL', verdict: 'human_needed' }));
    assert.equal(j.verified, false);
    assert.equal(j.verdict, 'human_needed');
    assert.equal(j.status, 'PARTIAL');
  });

  it('verifies a legacy lowercase status: passed record', () => {
    const j = phaseVerified(verificationContent({ status: 'passed' }));
    assert.equal(j.verified, true);
    assert.equal(j.verdict, 'passed');
    assert.equal(j.status, 'passed');
  });

  it('reports verdict missing when there is no VERIFICATION.md', () => {
    const j = phaseVerified(null);
    assert.equal(j.verified, false);
    assert.equal(j.status, 'missing');
    assert.equal(j.verdict, 'missing');
  });

  it('gate detail names the verdict and the status of an unverified phase', () => {
    const got = verify.classifyVerbResult('phase-verified',
      { ok: true, json: { verified: false, verdict: 'human_needed', status: 'PARTIAL' } });
    assert.equal(got.severity, 'error');
    assert.match(got.detail, /human_needed/);
    assert.match(got.detail, /PARTIAL/);
  });
});

describe('ui-reviewed accepts the ui-auditor vocabulary', () => {
  for (const status of ['PASS', 'passed', 'Pass']) {
    it(`scores status ${status} as a pass`, () => {
      const got = verify.classifyVerbResult('ui-reviewed', { ok: true, json: { status } });
      assert.equal(got.severity, 'pass');
    });
  }

  for (const status of ['PARTIAL', 'FAIL', 'unknown']) {
    it(`warns on status ${status}`, () => {
      const got = verify.classifyVerbResult('ui-reviewed', { ok: true, json: { status } });
      assert.equal(got.severity, 'warning');
    });
  }
});

// -- milestone coverage -----------------------------------------------------

function coverage(verification) {
  const root = buildPlanningFixture({
    phase: PHASE,
    summaries: [{ name: '23-01-SUMMARY.md', content: summaryContent({ requirementsCompleted: ['FIX-01'] }) }],
    verification,
    requirements: requirementsContent({ entries: [{ id: 'FIX-01', checked: true, phase: 'Phase 23' }] }),
  });
  try {
    const r = verify.captureVerb(() => verify.cmdVerifyMilestoneCoverage(root, false));
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.json;
  } finally {
    cleanupFixture(root);
  }
}

describe('milestone coverage reads the shared verdict', () => {
  it('counts a requirement satisfied when its phase is PASS + passed', () => {
    const j = coverage(verificationContent({ status: 'PASS', verdict: 'passed' }));
    assert.equal(j.counts.satisfied, 1, JSON.stringify(j));
    assert.equal(j.gate, 'passed');
  });

  it('counts it satisfied for a legacy status: passed phase', () => {
    const j = coverage(verificationContent({ status: 'passed' }));
    assert.equal(j.counts.satisfied, 1, JSON.stringify(j));
  });

  it('counts it partial, not satisfied, when the phase is human_needed', () => {
    const j = coverage(verificationContent({ status: 'PARTIAL', verdict: 'human_needed' }));
    assert.equal(j.counts.satisfied, 0);
    assert.equal(j.counts.partial, 1);
  });

  it('counts it partial when verdict says passed but status says PARTIAL', () => {
    const j = coverage(verificationContent({ status: 'PARTIAL', verdict: 'passed' }));
    assert.equal(j.counts.satisfied, 0);
    assert.equal(j.counts.partial, 1);
  });

  it('counts it unsatisfied when the phase has gaps', () => {
    const j = coverage(verificationContent({ status: 'PARTIAL', verdict: 'gaps_found' }));
    assert.equal(j.counts.unsatisfied, 1);
    assert.equal(j.gate, 'gaps_found');
  });
});

// -- progress phase status --------------------------------------------------

describe('determinePhaseStatus reads the shared verdict', () => {
  const statusFor = (verification) => {
    const root = buildPlanningFixture({ phase: PHASE, verification });
    try {
      return commands.determinePhaseStatus(1, 1, join(root, '.planning', 'phases', PHASE), 'Pending');
    } finally {
      cleanupFixture(root);
    }
  };

  it('is Complete for PASS + passed', () => {
    assert.equal(statusFor(verificationContent({ status: 'PASS', verdict: 'passed' })), 'Complete');
  });

  it('is Needs Review for PARTIAL + human_needed', () => {
    assert.equal(statusFor(verificationContent({ status: 'PARTIAL', verdict: 'human_needed' })), 'Needs Review');
  });

  it('is Executed for PARTIAL + gaps_found', () => {
    assert.equal(statusFor(verificationContent({ status: 'PARTIAL', verdict: 'gaps_found' })), 'Executed');
  });

  it('is not Complete when a body line says status: passed but the frontmatter does not', () => {
    const content = verificationContent({ status: 'PARTIAL', verdict: 'gaps_found' })
      + '\nA previous run had status: passed before the regression.\n';
    assert.equal(statusFor(content), 'Executed');
  });
});

// -- UAT audit --------------------------------------------------------------

const HUMAN_NEEDED_VERIFICATION = [
  '---',
  'status: PARTIAL',
  'agent: donny-verifier',
  `phase: ${PHASE}`,
  'verified: 2026-11-10T00:00:00Z',
  'verdict: human_needed',
  'score: 4/5',
  '---',
  '',
  `# Phase ${PHASE} Verification Report`,
  '',
  '## Human Verification Required',
  '',
  '### 1. A target that never answers holds the slot',
  '',
  '**Test:** Run the probe.',
  '**Expected:** 503 at once.',
  '**Why human:** The verifier does not start servers.',
  '',
  '### 2. Owner sign-off on the evidence form',
  '',
  '**Test:** Read the tests.',
  '**Expected:** The owner accepts the scope.',
  '**Why human:** A reading of the wording.',
  '',
  '## Gaps Summary',
  '',
  'No goal gap was found.',
  '',
].join('\n');

function auditUat(verification) {
  const root = buildPlanningFixture({ phase: PHASE, verification });
  try {
    const r = verify.captureVerb(() => uat.cmdAuditUat(root, false));
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.json;
  } finally {
    cleanupFixture(root);
  }
}

describe('audit-uat reads verifier-written human checks', () => {
  it('lists both `### N. Title` human-check items of a PARTIAL + human_needed phase', () => {
    const j = auditUat(HUMAN_NEEDED_VERIFICATION);
    assert.equal(j.results.length, 1, JSON.stringify(j));
    const r = j.results[0];
    assert.equal(r.type, 'verification');
    assert.equal(r.verdict, 'human_needed');
    assert.deepEqual(r.items.map((i) => [i.test, i.name]), [
      [1, 'A target that never answers holds the slot'],
      [2, 'Owner sign-off on the evidence form'],
    ]);
    assert.ok(r.items.every((i) => i.category === 'human_uat'));
    assert.equal(j.summary.total_items, 2);
  });

  it('still reads a legacy status: human_needed file with a numbered list', () => {
    const legacy = [
      '---', 'status: human_needed', `phase: ${PHASE}`, '---', '',
      '## Human Verification Required', '',
      '1. Check the login page renders on a phone',
      '',
    ].join('\n');
    const j = auditUat(legacy);
    assert.equal(j.results.length, 1);
    assert.deepEqual(j.results[0].items.map((i) => i.name), ['Check the login page renders on a phone']);
  });

  it('lists nothing for a passed phase', () => {
    const j = auditUat(verificationContent({ status: 'PASS', verdict: 'passed' }));
    assert.deepEqual(j.results, []);
  });
});

// -- extractFrontmatter: the leading block only -----------------------------

describe('extractFrontmatter reads the leading block only', () => {
  it('ignores a later body pair of --- separators', () => {
    const fm = extractFrontmatter([
      '---', 'status: PASS', 'verdict: passed', '---', '',
      '# Report', '', '---', '', 'Section after a rule', '', '---', '', 'Footer', '',
    ].join('\n'));
    assert.deepEqual(fm, { status: 'PASS', verdict: 'passed' });
  });

  it('ignores a fenced example frontmatter block in the body', () => {
    const fm = extractFrontmatter([
      '---', 'phase: 03-chat', 'status: PARTIAL', '---', '',
      '## Example', '', '```markdown', '---', 'phase: 99-example', 'status: passed', '---', '```', '',
    ].join('\n'));
    assert.deepEqual(fm, { phase: '03-chat', status: 'PARTIAL' });
  });

  it('returns nothing when the file does not open with a frontmatter block', () => {
    const fm = extractFrontmatter([
      '# Template', '', '---', '', '```markdown', '---', 'status: passed', '---', '```', '',
    ].join('\n'));
    assert.deepEqual(fm, {});
  });

  it('keeps the last of consecutive stacked leading blocks (the CRLF corruption case)', () => {
    const fm = extractFrontmatter(
      '---\r\nstatus: executing\r\n---\r\n\r\n---\nstatus: complete\nphase: 2\n---\n\n# State\n',
    );
    assert.deepEqual(fm, { status: 'complete', phase: '2' });
  });

  it('does not treat a rule right after the frontmatter as a stacked block', () => {
    const fm = extractFrontmatter([
      '---', 'status: PASS', '---', '', '---', '', '# Body heading', '', 'text', '---', '',
    ].join('\n'));
    assert.deepEqual(fm, { status: 'PASS' });
  });

  it('does not end the block on a line that merely starts with ---', () => {
    const fm = extractFrontmatter('---\nstatus: PASS\n--- not a fence\nverdict: passed\n---\n\nbody\n');
    assert.equal(fm.status, 'PASS');
    assert.equal(fm.verdict, 'passed');
  });
});
