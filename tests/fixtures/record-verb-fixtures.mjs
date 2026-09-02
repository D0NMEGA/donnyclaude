#!/usr/bin/env node
/**
 * One-shot recorder for the per-verb JSON fixtures under tests/fixtures/verbs/.
 *
 * This is NOT a test. It is deliberately not named *.test.js, because that glob is the suite
 * (package.json: "node --test tests/*.test.js"). Run it by hand, inspect the output, commit
 * the output:
 *
 *   node tests/fixtures/record-verb-fixtures.mjs
 *
 * Why record rather than hand-write: these fixtures are the ground truth the severity
 * classifier is tested against. A hand-written fixture pins an assumption about what a verb
 * returns; a recorded one pins what it actually returns. Research measured the difference -
 * artifacts fails 51/54 and key-links 47/47 on real archived plans, which no one would have
 * guessed while writing a fixture by hand.
 *
 * Each verb gets at least one case from a real archived phase and one degraded case from a
 * synthetic tree, so the classifier is never tested only against healthy input.
 *
 * Three phase-resolution conventions are respected (measured live, 23-RESEARCH.md Q3):
 *   - dir-path group  (plan-graph, phase-verified, ui-reviewed, threats-clear) takes
 *     info.directory; a bare number fails on archived phases.
 *   - findPhaseInternal group (phase-completeness) takes the phase NUMBER; a dir path
 *     returns {"error":"Phase not found"}.
 *   - substring-scan group (schema-drift) scans .planning/phases only and matches
 *     entry.name.includes(phaseArg) (verify.cjs), so it is handed the directory BASENAME -
 *     a bare "2" would also match 23-record-integrity-and-the-validation-gate.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPlanningFixture,
  cleanupFixture,
  requirementsContent,
  summaryContent,
  validPlanContent,
} from '../helpers/planning-fixture.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(__dirname, 'verbs');

const CCO_ROOT = '/Users/d0nmega/Developer/claudecodeoptimized';
const ARCHIVE_LABEL = '.planning/milestones/v5.0-phases';
const PHASES = ['19', '20', '21', '22'];

const VERB_FILES = [
  'phase-completeness',
  'plan-graph',
  'phase-verified',
  'ui-reviewed',
  'threats-clear',
  'milestone-coverage',
  'plan-structure',
  'references',
  'commits',
  'artifacts',
  'key-links',
  'schema-drift',
  'verify-summary',
];

if (!existsSync(CCO_ROOT)) {
  console.error(`Recorder needs the claudecodeoptimized repo at ${CCO_ROOT}; it is not there.`);
  console.error('These fixtures are recorded from real archived phase artifacts, so there is');
  console.error('no meaningful fallback. Run this on the machine that carries that repo.');
  process.exit(1);
}

const V = require(resolve(ROOT, 'packages/donny/bin/lib/verify.cjs'));
const core = require(resolve(ROOT, 'packages/donny/bin/lib/core.cjs'));

const RECORDED_AT = new Date().toISOString().slice(0, 10);
const cases = new Map();

function rec(verb, label, source, thunk) {
  const r = V.captureVerb(thunk);
  const output = r.ok
    ? r.json
    : { _capture_failed: true, error: r.error || null, raw: r.raw || '' };
  if (!cases.has(verb)) cases.set(verb, []);
  cases.get(verb).push({ label, source, output });
}

// ── Real archived phases ────────────────────────────────────────────────────

for (const phaseNum of PHASES) {
  const info = core.findPhaseInternal(CCO_ROOT, phaseNum);
  if (!info || !info.found) {
    console.error(`Phase ${phaseNum} did not resolve; skipping it.`);
    continue;
  }
  const dir = info.directory;
  const base = dir.split('/').pop();

  rec('phase-completeness', `${phaseNum} archived`, dir,
    () => V.cmdVerifyPhaseCompleteness(CCO_ROOT, phaseNum, false));
  rec('plan-graph', `${phaseNum} archived`, dir,
    () => V.cmdVerifyPlanGraph(CCO_ROOT, dir, false));
  rec('phase-verified', `${phaseNum} archived`, dir,
    () => V.cmdVerifyPhaseVerified(CCO_ROOT, dir, false));
  rec('threats-clear', `${phaseNum} archived`, dir,
    () => V.cmdVerifyThreatsClear(CCO_ROOT, dir, false));
  rec('ui-reviewed', `${phaseNum} archived`, dir,
    () => V.cmdVerifyUiReviewed(CCO_ROOT, dir, false));
  // Handed the directory BASENAME, not the bare number. Archived phases are never scanned by
  // this verb, so the recorded result is the "Phase directory not found" message, as-is.
  rec('schema-drift', `${phaseNum} archived`, dir,
    () => V.cmdVerifySchemaDrift(CCO_ROOT, base, false, false));
  rec('milestone-coverage', `current milestone, read while recording phase ${phaseNum}`, '.planning/REQUIREMENTS.md',
    () => V.cmdVerifyMilestoneCoverage(CCO_ROOT, false));

  for (const p of info.plans) {
    const rel = dir + '/' + p;
    rec('plan-structure', p, rel, () => V.cmdVerifyPlanStructure(CCO_ROOT, rel, false));
    rec('references', p, rel, () => V.cmdVerifyReferences(CCO_ROOT, rel, false));
    rec('artifacts', p, rel, () => V.cmdVerifyArtifacts(CCO_ROOT, rel, false));
    rec('key-links', p, rel, () => V.cmdVerifyKeyLinks(CCO_ROOT, rel, false));
  }
  for (const s of info.summaries) {
    const rel = dir + '/' + s;
    rec('verify-summary', s, rel, () => V.cmdVerifySummary(CCO_ROOT, rel, 2, false));
  }
}

// ── commits: one real short hash plus one bogus hash ─────────────────────────
// NEVER call cmdVerifyCommits with an empty array. verify.cjs calls error() on one, and
// error() is process.exit(1) (core.cjs), which would kill the recorder mid-run (T-23-02).
const realHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: CCO_ROOT, encoding: 'utf-8',
}).trim();
rec('commits', 'one real HEAD hash and one bogus hash', 'claudecodeoptimized git history',
  () => V.cmdVerifyCommits(CCO_ROOT, [realHash, 'deadbee'], false));

// ── Synthetic degraded cases ────────────────────────────────────────────────
// An empty phase directory: no VERIFICATION, no SECURITY, no UI-REVIEW, no plans.
const emptyRoot = buildPlanningFixture({ phase: '99-empty' });
// A phase carrying one PLAN whose must_haves has no artifacts and no key_links blocks,
// which is the only way to reach those two verbs' early-return error shape.
const bareRoot = buildPlanningFixture({
  phase: '99-bare',
  plans: [{ name: '99-01-PLAN.md', content: validPlanContent({ phase: '99-bare', plan: '01' }) }],
  summaries: [{ name: '99-01-SUMMARY.md', content: summaryContent({ phase: '99-bare', plan: '01' }) }],
  requirements: requirementsContent(),
});

try {
  rec('phase-verified', 'empty phase', 'synthetic',
    () => V.cmdVerifyPhaseVerified(emptyRoot, '.planning/phases/99-empty', false));
  rec('threats-clear', 'empty phase', 'synthetic',
    () => V.cmdVerifyThreatsClear(emptyRoot, '.planning/phases/99-empty', false));
  rec('ui-reviewed', 'empty phase', 'synthetic',
    () => V.cmdVerifyUiReviewed(emptyRoot, '.planning/phases/99-empty', false));
  rec('plan-graph', 'empty phase', 'synthetic',
    () => V.cmdVerifyPlanGraph(emptyRoot, '.planning/phases/99-empty', false));
  rec('phase-completeness', 'empty phase', 'synthetic',
    () => V.cmdVerifyPhaseCompleteness(emptyRoot, '99', false));
  rec('schema-drift', 'live (non-archived) fixture phase', 'synthetic',
    () => V.cmdVerifySchemaDrift(bareRoot, '99-bare', false, false));
  rec('milestone-coverage', 'fixture REQUIREMENTS with one covered and one orphaned requirement', 'synthetic',
    () => V.cmdVerifyMilestoneCoverage(bareRoot, false));

  rec('artifacts', 'plan whose must_haves has no artifacts block', 'synthetic',
    () => V.cmdVerifyArtifacts(bareRoot, '.planning/phases/99-bare/99-01-PLAN.md', false));
  rec('key-links', 'plan whose must_haves has no key_links block', 'synthetic',
    () => V.cmdVerifyKeyLinks(bareRoot, '.planning/phases/99-bare/99-01-PLAN.md', false));
  rec('plan-structure', 'clean fixture plan', 'synthetic',
    () => V.cmdVerifyPlanStructure(bareRoot, '.planning/phases/99-bare/99-01-PLAN.md', false));
  rec('plan-structure', 'file that does not exist', 'synthetic',
    () => V.cmdVerifyPlanStructure(bareRoot, '.planning/phases/99-bare/99-99-PLAN.md', false));
  rec('references', 'clean fixture plan', 'synthetic',
    () => V.cmdVerifyReferences(bareRoot, '.planning/phases/99-bare/99-01-PLAN.md', false));
  rec('verify-summary', 'summary path that does not exist', 'synthetic',
    () => V.cmdVerifySummary(bareRoot, '.planning/phases/99-bare/99-99-SUMMARY.md', 2, false));
  rec('commits', 'bogus hash only', 'synthetic',
    () => V.cmdVerifyCommits(bareRoot, ['deadbee'], false));
} finally {
  cleanupFixture(emptyRoot);
  cleanupFixture(bareRoot);
}

// ── Write ───────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const recorded = [...cases.keys()].sort();
const expected = [...VERB_FILES].sort();
if (recorded.join(',') !== expected.join(',')) {
  console.error('Recorded verb set does not match the expected thirteen.');
  console.error('  missing: ' + expected.filter(v => !recorded.includes(v)).join(', '));
  console.error('  extra:   ' + recorded.filter(v => !expected.includes(v)).join(', '));
  process.exit(1);
}

for (const verb of VERB_FILES) {
  const payload = {
    verb,
    recorded_at: RECORDED_AT,
    recorded_from: `claudecodeoptimized ${ARCHIVE_LABEL} plus synthetic fixture phases`,
    cases: cases.get(verb),
  };
  const file = join(OUT_DIR, `${verb}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  console.log(`${verb}.json  ${payload.cases.length} case(s)`);
}
console.log(`\nWrote ${VERB_FILES.length} fixtures to ${OUT_DIR}`);
