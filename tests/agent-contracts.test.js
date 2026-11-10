// Contract checks for the donny-* subagent definition files. Reads them as
// text only; the prompts are parsed elsewhere, so this guards the few fields
// the harness and deterministic checks depend on.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'agents');

function read(name) {
  return fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
}

// Minimal frontmatter reader: top-level `key: value` lines and `key:` followed
// by `  - item` lists. Enough for the agent files; not a general YAML parser.
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, 'file has YAML frontmatter');
  const out = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      out[listKey].push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === '') {
      listKey = kv[1];
      out[listKey] = [];
    } else {
      listKey = null;
      out[kv[1]] = kv[2].trim();
    }
  }
  return out;
}

function toolList(fm) {
  const t = fm.tools;
  return Array.isArray(t) ? t : t.split(',').map((s) => s.trim());
}

const donnyAgents = fs
  .readdirSync(AGENTS_DIR)
  .filter((f) => /^donny-.*\.md$/.test(f))
  .map((f) => f.replace(/\.md$/, ''));

test('there are 20 donny agent files', () => {
  assert.equal(donnyAgents.length, 20);
});

for (const name of ['donny-planner', 'donny-phase-researcher']) {
  test(`${name} can use Edit`, () => {
    assert.ok(toolList(frontmatter(read(name))).includes('Edit'));
  });
}

test('planner and verifier run at effort high, debugger stays xhigh', () => {
  assert.equal(frontmatter(read('donny-planner')).effort, 'high');
  assert.equal(frontmatter(read('donny-verifier')).effort, 'high');
  assert.equal(frontmatter(read('donny-debugger')).effort, 'xhigh');
});

test('security auditor runs on sonnet', () => {
  assert.equal(frontmatter(read('donny-security-auditor')).model, 'sonnet');
});

for (const name of donnyAgents) {
  test(`${name} sets autoCompactWindow: 200000`, () => {
    assert.equal(frontmatter(read(name)).autoCompactWindow, '200000');
  });
}

test('researcher tool grants for firecrawl and exa are unchanged', () => {
  for (const name of ['donny-phase-researcher', 'donny-project-researcher', 'donny-ui-researcher']) {
    const tools = toolList(frontmatter(read(name)));
    assert.ok(tools.includes('mcp__firecrawl__*'), `${name} firecrawl`);
    assert.ok(tools.includes('mcp__exa__*'), `${name} exa`);
  }
});

test('executor output contract requires requirements-completed', () => {
  assert.match(read('donny-executor'), /requirements-completed: \[/);
});

test('verifier scopes the spot-check limits to the spot-check step', () => {
  assert.match(
    read('donny-verifier'),
    /These limits apply only to Step 7b spot-checks, not to the phase's acceptance commands\./
  );
});
