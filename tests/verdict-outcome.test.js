/**
 * `outcome`: the one value a workflow may branch on.
 *
 * Routing on the raw verdict let `verdict: passed` with `status: PARTIAL` take the success
 * route while `verified` was false (cross-review finding, 2026-11-10). phase-verified now also
 * prints `outcome`, which is `passed` only when the phase is verified.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'packages/donny/bin/donny-tools.cjs');
const { verificationVerdict } = require(join(ROOT, 'packages/donny/bin/lib/frontmatter.cjs'));

function phaseVerified(frontmatter) {
  const root = mkdtempSync(join(tmpdir(), 'donny-outcome-'));
  const dir = join(root, '.planning', 'phases', '23-fixture');
  mkdirSync(dir, { recursive: true });
  if (frontmatter !== null) writeFileSync(join(dir, '23-VERIFICATION.md'), `---\n${frontmatter}\n---\n\n# Verification\n`);
  try {
    return JSON.parse(execFileSync('node', [TOOLS, 'verify', 'phase-verified', dir, '--cwd', root], { encoding: 'utf-8' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('verify phase-verified: outcome', () => {
  const cases = [
    ['status PASS, verdict passed', 'status: PASS\nverdict: passed', 'passed', true],
    ['status PARTIAL, verdict passed', 'status: PARTIAL\nverdict: passed', 'unknown', false],
    ['status FAIL, verdict passed', 'status: FAIL\nverdict: passed', 'unknown', false],
    ['verdict human_needed', 'status: PARTIAL\nverdict: human_needed', 'human_needed', false],
    ['verdict gaps_found', 'status: FAIL\nverdict: gaps_found', 'gaps_found', false],
    ['status PASS, verdict is a list', 'status: PASS\nverdict: []', 'unknown', false],
    ['no VERIFICATION.md', null, 'missing', false],
  ];
  for (const [label, fm, outcome, verified] of cases) {
    it(label, () => {
      const r = phaseVerified(fm);
      assert.equal(r.outcome, outcome, JSON.stringify(r));
      assert.equal(r.verified, verified, JSON.stringify(r));
    });
  }

  it('the rule treats a list or mapping verdict as unknown, never as a legacy pass', () => {
    assert.deepEqual(verificationVerdict({ status: 'PASS', verdict: [] }), { verdict: 'unknown', verified: false });
    assert.deepEqual(verificationVerdict({ status: 'passed', verdict: { a: 1 } }), { verdict: 'unknown', verified: false });
  });
});

describe('workflows route on outcome', () => {
  const dir = join(ROOT, 'packages/donny/workflows');
  it('no shipped workflow branches on the raw verdict', () => {
    const offenders = readdirSync(dir).filter((f) => f.endsWith('.md') && /--pick verdict/.test(readFileSync(join(dir, f), 'utf-8')));
    assert.deepEqual(offenders, []);
  });
  it('the phase workflows name a stop for an unknown or missing record', () => {
    for (const f of ['execute-phase.md', 'autonomous.md', 'quick.md']) {
      const text = readFileSync(join(dir, f), 'utf-8');
      assert.match(text, /--pick outcome/, f);
      assert.match(text, /`unknown`, `missing`/, f);
    }
  });
});
