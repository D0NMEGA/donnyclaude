/**
 * Throwaway .planning/ trees for the record-gate tests.
 *
 * The verbs under test resolve a phase directory off disk and shell out through execGit, so
 * a fixture has to be a real directory in a real git repo - an uninitialised directory makes
 * cmdVerifySummary's commit check nondeterministic. Modeled on tests/install.test.js:14-24.
 *
 * git is always driven through execFileSync with an argv array. No shell, no interpolation
 * of a caller-supplied name into a command string (threat T-23-03).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Build a throwaway .planning/ tree under os.tmpdir() and git init it.
 *
 * @param {object} opts
 * @param {string} opts.phase phase directory basename under .planning/phases
 * @param {Array<{name: string, content: string}>} opts.plans PLAN files to write
 * @param {Array<{name: string, content: string}>} opts.summaries SUMMARY files to write
 * @param {string|null} opts.verification body of <phase>-VERIFICATION.md, or null to omit
 * @param {string|null} opts.security body of <phase>-SECURITY.md, or null to omit
 * @param {string|null} opts.records body of <phase>-RECORDS.md, or null to omit
 * @param {string|null} opts.requirements body of .planning/REQUIREMENTS.md, or null to omit
 * @param {object|null} opts.config object serialised to .planning/config.json, or null
 * @returns {string} absolute path to the fixture root
 */
export function buildPlanningFixture({
  phase = '23-fixture',
  plans = [],
  summaries = [],
  verification = null,
  security = null,
  records = null,
  requirements = null,
  config = null,
} = {}) {
  const root = join(
    tmpdir(),
    'donny-gate-fixture-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  );
  const planning = join(root, '.planning');
  const phaseDir = join(planning, 'phases', phase);
  mkdirSync(phaseDir, { recursive: true });

  for (const f of plans) writeFileSync(join(phaseDir, f.name), f.content, 'utf-8');
  for (const f of summaries) writeFileSync(join(phaseDir, f.name), f.content, 'utf-8');
  if (verification !== null) writeFileSync(join(phaseDir, `${phase}-VERIFICATION.md`), verification, 'utf-8');
  if (security !== null) writeFileSync(join(phaseDir, `${phase}-SECURITY.md`), security, 'utf-8');
  if (records !== null) writeFileSync(join(phaseDir, `${phase}-RECORDS.md`), records, 'utf-8');
  if (requirements !== null) writeFileSync(join(planning, 'REQUIREMENTS.md'), requirements, 'utf-8');
  if (config !== null) writeFileSync(join(planning, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8');

  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init', '-q']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);

  return root;
}

export function cleanupFixture(root) {
  if (!root) return;
  rmSync(root, { recursive: true, force: true });
}

/**
 * A PLAN carrying all eight frontmatter fields cmdVerifyPlanStructure requires
 * (verify.cjs: phase, plan, type, wave, depends_on, files_modified, autonomous, must_haves)
 * plus one complete <task> block, so it produces zero errors and zero warnings.
 *
 * must_haves carries only `truths` by default. artifacts and key_links are opt-in, because
 * their absence is what produces cmdVerifyArtifacts / cmdVerifyKeyLinks' early-return error
 * shape, and the recorder needs that shape on purpose.
 */
export function validPlanContent({
  phase = '23-fixture',
  plan = '01',
  wave = 0,
  dependsOn = [],
  requirements = ['FIX-01'],
  artifacts = null,
  keyLinks = null,
  taskName = 'Task 1: the fixture task',
} = {}) {
  const lines = [
    '---',
    `phase: ${phase}`,
    `plan: ${plan}`,
    'type: execute',
    `wave: ${wave}`,
    `depends_on: [${dependsOn.join(', ')}]`,
    'files_modified:',
    '  - src/fixture.js',
    'autonomous: true',
    `requirements: [${requirements.join(', ')}]`,
    '',
    'must_haves:',
    '  truths:',
    '    - "the fixture plan parses as a plan"',
  ];
  if (artifacts) {
    lines.push('  artifacts:');
    for (const a of artifacts) {
      lines.push(`    - path: "${a.path}"`);
      if (a.provides) lines.push(`      provides: "${a.provides}"`);
      if (a.contains) lines.push(`      contains: "${a.contains}"`);
      if (a.min_lines) lines.push(`      min_lines: ${a.min_lines}`);
    }
  }
  if (keyLinks) {
    lines.push('  key_links:');
    for (const k of keyLinks) {
      lines.push(`    - from: "${k.from}"`);
      lines.push(`      to: "${k.to}"`);
      if (k.via) lines.push(`      via: "${k.via}"`);
      if (k.pattern) lines.push(`      pattern: "${k.pattern}"`);
    }
  }
  lines.push('---', '');
  lines.push(`<objective>`, `Fixture plan ${phase}-${plan}. Exists so a verb has something real to read.`, `</objective>`, '');
  lines.push('<tasks>', '');
  lines.push('<task type="auto">');
  lines.push(`  <name>${taskName}</name>`);
  lines.push('  <files>src/fixture.js</files>');
  lines.push('  <action>Write the fixture file.</action>');
  lines.push('  <verify>');
  lines.push('    <automated>node --check src/fixture.js</automated>');
  lines.push('  </verify>');
  lines.push('  <done>The fixture file exists.</done>');
  lines.push('</task>', '');
  lines.push('</tasks>', '');
  return lines.join('\n');
}

/**
 * A SUMMARY whose `requirements-completed` key takes one of the five shapes that matter:
 *
 *   ['A-01', 'A-02']  -> `requirements-completed: [A-01, A-02]`, parses as an ARRAY
 *   []                -> `requirements-completed: []`, parses as an EMPTY array
 *   null              -> the key is omitted entirely
 *   'inline-comment'  -> the defective `[]  # REQUIRED - ...` form. The trailing comment
 *                        defeats the endsWith(']') test at frontmatter.cjs:55, so it parses
 *                        as a STRING and milestone-coverage's Array.isArray check drops it.
 *   'shadowed'        -> valid top frontmatter PLUS a body `---` pair. extractFrontmatter
 *                        keeps the LAST block (frontmatter.cjs:17), so the real block is
 *                        shadowed and the file parses to zero keys.
 */
export function summaryContent({
  phase = '23-fixture',
  plan = '01',
  requirementsCompleted = null,
} = {}) {
  const lines = [
    '---',
    'status: PASS',
    'agent: donny-executor',
    `phase: ${phase}`,
    `plan: ${plan}`,
    'subsystem: fixture',
  ];
  if (requirementsCompleted === 'inline-comment') {
    lines.push('requirements-completed: []  # REQUIRED - copy ALL requirement IDs from the plan');
  } else if (requirementsCompleted === 'shadowed') {
    lines.push('requirements-completed: [FIX-01]');
  } else if (Array.isArray(requirementsCompleted)) {
    lines.push(`requirements-completed: [${requirementsCompleted.join(', ')}]`);
  }
  lines.push('---', '');
  lines.push(`# Phase ${phase} Plan ${plan} Summary`, '');
  lines.push('The fixture plan wrote one file and nothing else happened.', '');
  if (requirementsCompleted === 'shadowed') {
    lines.push('---', 'a decorative body rule carrying no keys at all', '---', '');
  }
  lines.push('## Deviations from Plan', '', 'None.', '');
  lines.push('## Self-Check: PASSED', '');
  return lines.join('\n');
}

/** A VERIFICATION.md whose frontmatter `status` drives phaseVerificationVerdict. */
export function verificationContent({
  status = 'passed',
  score = '5/5',
  phase = '23-fixture',
} = {}) {
  return [
    '---',
    `status: ${status}`,
    `score: ${score}`,
    `phase: ${phase}`,
    '---',
    '',
    `# Phase ${phase} Verification`,
    '',
    'Fixture verification record.',
    '',
  ].join('\n');
}

/**
 * A SECURITY.md with a `## Threat Register` table threatRegisterStatus can parse.
 * Exactly two `---` lines in the whole file: the shipped templates/SECURITY.md uses
 * decorative `---` rules in its body and therefore parses to zero keys (C-12).
 */
export function securityContent({ threatsOpen = 0, phase = '23-fixture' } = {}) {
  const rows = [];
  for (let i = 1; i <= threatsOpen; i += 1) {
    rows.push(`| T-${String(i).padStart(2, '0')} | Tampering | fixture | mitigate | Open | pending |`);
  }
  if (threatsOpen === 0) {
    rows.push('| T-01 | Tampering | fixture | mitigate | Closed | handled in the fixture |');
  }
  return [
    '---',
    `phase: ${phase}`,
    'status: SECURED',
    `threats_open: ${threatsOpen}`,
    '---',
    '',
    `# Phase ${phase} Security Audit`,
    '',
    '## Threat Register',
    '',
    '| Threat ID | Category | Component | Disposition | Status | Mitigation |',
    '|-----------|----------|-----------|-------------|--------|------------|',
    ...rows,
    '',
  ].join('\n');
}

/** A REQUIREMENTS.md with the checkbox lines and ## Traceability table coverage reads. */
export function requirementsContent({
  entries = [
    { id: 'FIX-01', checked: false, phase: 'Phase 99' },
    { id: 'FIX-02', checked: true, phase: 'Phase 98' },
  ],
} = {}) {
  const lines = ['# Requirements', '', '## Active', ''];
  for (const e of entries) {
    lines.push(`- [${e.checked ? 'x' : ' '}] **${e.id}**: fixture requirement ${e.id}.`);
  }
  lines.push('', '## Traceability', '');
  lines.push('| Requirement | Phase | Status |');
  lines.push('|-------------|-------|--------|');
  for (const e of entries) lines.push(`| ${e.id} | ${e.phase} | planned |`);
  lines.push('');
  return lines.join('\n');
}
