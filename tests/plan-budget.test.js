/**
 * Plan size budget (warning only).
 *
 * In one real phase the planner wrote 415 KB of PLAN files for 57 KB of source. A plan over
 * workflow.plan_budget_kb (default 30) now gets a warning from `verify plan-structure`, which
 * the planner and the plan checker both already run. It never makes a plan invalid.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlanningFixture, cleanupFixture, validPlanContent } from './helpers/planning-fixture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(__dirname, '..', 'packages/donny/bin/donny-tools.cjs');

function planStructure(root, planPath, home) {
  const out = execFileSync('node', [TOOLS, 'verify', 'plan-structure', planPath, '--cwd', root], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home },
  });
  return JSON.parse(out);
}

function fixtureWithPlan(kilobytes, workflow) {
  const root = buildPlanningFixture({});
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const dir = join(root, '.planning', 'phases', '23-fixture');
  mkdirSync(dir, { recursive: true });
  const padding = '\n<!-- ' + 'x'.repeat(1000) + ' -->';
  const plan = validPlanContent({}) + padding.repeat(kilobytes);
  writeFileSync(join(dir, '23-01-PLAN.md'), plan);
  if (workflow) writeFileSync(join(root, '.planning', 'config.json'), JSON.stringify({ workflow }));
  return { root, home, plan: join('.planning', 'phases', '23-fixture', '23-01-PLAN.md') };
}

const overBudget = (r) => r.warnings.filter((w) => /plan_budget_kb/.test(w));

describe('verify plan-structure: size budget', () => {
  it('warns, and stays valid, when a plan passes the default 30 KB', () => {
    const f = fixtureWithPlan(40);
    try {
      const r = planStructure(f.root, f.plan, f.home);
      assert.equal(overBudget(r).length, 1, JSON.stringify(r.warnings));
      assert.match(overBudget(r)[0], /30 KB/);
      assert.equal(r.valid, true);
    } finally { cleanupFixture(f.root); }
  });

  it('says nothing for a plan inside the budget', () => {
    const f = fixtureWithPlan(5);
    try {
      assert.equal(overBudget(planStructure(f.root, f.plan, f.home)).length, 0);
    } finally { cleanupFixture(f.root); }
  });

  it('uses workflow.plan_budget_kb from the project config', () => {
    const f = fixtureWithPlan(40, { plan_budget_kb: 60 });
    try {
      assert.equal(overBudget(planStructure(f.root, f.plan, f.home)).length, 0);
    } finally { cleanupFixture(f.root); }
  });

  it('falls back to ~/.donny/defaults.json when the project sets nothing', () => {
    const f = fixtureWithPlan(40);
    try {
      mkdirSync(join(f.home, '.donny'), { recursive: true });
      writeFileSync(join(f.home, '.donny', 'defaults.json'), JSON.stringify({ workflow: { plan_budget_kb: 100 } }));
      assert.equal(overBudget(planStructure(f.root, f.plan, f.home)).length, 0);
    } finally { cleanupFixture(f.root); }
  });
});
