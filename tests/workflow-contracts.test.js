// Static scan of the shipped workflow and skill markdown. These guard the
// calls a workflow makes at run time: a Skill() target the model cannot load,
// a tool that does not exist, or a subagent spawn with no model all fail
// silently in a real session, so they are checked here instead.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');
const WORKFLOWS = join(PACKAGES, 'donny', 'workflows');

// Irreversible commands: the user types them, a workflow never calls them.
const USER_ONLY = ['donny-complete-milestone', 'donny-cleanup'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_archived')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const shipped = walk(PACKAGES).map((file) => ({
  file,
  rel: relative(ROOT, file),
  text: fs.readFileSync(file, 'utf-8'),
}));

function visibleSkills() {
  const src = fs.readFileSync(join(ROOT, 'bin', 'donnyclaude.js'), 'utf-8');
  const block = src.match(/DEFAULT_TOP_K_AUTOINVOKE_SKILLS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'DEFAULT_TOP_K_AUTOINVOKE_SKILLS not found in bin/donnyclaude.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('shipped markdown references', () => {
  it('never mentions the nonexistent SlashCommand tool', () => {
    const hits = shipped.filter((f) => /SlashCommand/.test(f.text)).map((f) => f.rel);
    assert.deepEqual(hits, []);
  });

  it('never uses the colon form donny:<name> for a skill', () => {
    const hits = shipped.filter((f) => /donny:[a-z]/.test(f.text)).map((f) => f.rel);
    assert.deepEqual(hits, []);
  });
});

describe('Skill() targets', () => {
  const calls = [];
  for (const f of shipped) {
    for (const m of f.text.matchAll(/Skill\(skill=\\?"(donny-[a-z0-9-]+)\\?"/g)) {
      calls.push({ rel: f.rel, skill: m[1] });
    }
  }

  it('finds the calls it is meant to check', () => {
    assert.ok(calls.length > 20, `only ${calls.length} Skill() calls found`);
  });

  it('only calls skills that stay visible to the model', () => {
    const visible = new Set(visibleSkills());
    const bad = calls
      .filter((c) => !USER_ONLY.includes(c.skill) && !visible.has(c.skill))
      .map((c) => `${c.rel}: ${c.skill}`);
    assert.deepEqual(bad, []);
  });

  it('never calls a user-only skill', () => {
    const bad = calls.filter((c) => USER_ONLY.includes(c.skill)).map((c) => `${c.rel}: ${c.skill}`);
    assert.deepEqual(bad, []);
  });

  it('keeps the user-only skills out of the visible list', () => {
    const visible = visibleSkills();
    for (const name of USER_ONLY) assert.ok(!visible.includes(name), name);
  });
});

describe('subagent spawns', () => {
  const workflows = shipped.filter((f) => f.file.startsWith(WORKFLOWS));

  // A spawn block runs from its Task( or Agent( opener to the next fence line,
  // the next opener, or 60 lines, whichever comes first.
  function spawnBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(Task|Agent)\(/.test(lines[i])) continue;
      let end = i + 1;
      while (
        end < lines.length &&
        end - i < 60 &&
        !/^\s*```/.test(lines[end]) &&
        !/^\s*(Task|Agent)\(/.test(lines[end])
      ) end++;
      blocks.push({ line: i + 1, body: lines.slice(i, end).join('\n') });
    }
    return blocks;
  }

  it('gives every general-purpose spawn an explicit model', () => {
    const bad = [];
    for (const f of workflows) {
      for (const b of spawnBlocks(f.text)) {
        if (/subagent_type\s*=\s*\\?"donny-/.test(b.body)) continue;
        if (!/\bmodel\s*=/.test(b.body)) bad.push(`${f.rel}:${b.line}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe('--no-advance', () => {
  const read = (name) => fs.readFileSync(join(WORKFLOWS, name), 'utf-8');

  it('is honoured by plan-phase', () => {
    assert.match(read('plan-phase.md'), /--no-advance/);
  });

  it('is passed by orchestrators that run execution as their own step', () => {
    assert.match(read('manager.md'), /donny-plan-phase[^\n]*--no-advance/);
    assert.match(read('autonomous.md'), /donny-plan-phase[^\n]*--no-advance/);
  });
});
