/**
 * Regression pins for `donny-tools state update-progress` (cmdStateUpdateProgress).
 *
 * The command rewrites one progress-bar line in .planning/STATE.md. Two defects in the
 * patterns it used to select that line corrupted STATE.md silently - they never errored,
 * so the damage only showed up when a human read the file:
 *
 *   1. The bold pattern was /(\*\*Progress:\*\*\s*).*\/i - no line anchor and no /m - so it
 *      rewrote the FIRST `**Progress:**` substring anywhere in the document. A sentence that
 *      merely quoted the token as an example had its remainder replaced by a progress bar,
 *      while the real bar line further down was left stale.
 *   2. The plain pattern was /^(Progress:\s*).*\/im - case-insensitive - so `^progress:`
 *      matched the frontmatter's own lowercase YAML block key, which appears earlier in the
 *      file than the body's bar. The command reported `updated: true` and the visible body
 *      bar never changed at all.
 *
 * The fix splits the document at its frontmatter and matches only inside the body, anchored
 * to line start. These tests drive the real CLI as a subprocess, because cmdStateUpdateProgress
 * reports through output(), which does a blocking fs.writeSync(1, ...) rather than returning.
 *
 * Two things constrain how the assertions are written:
 *
 *   - writeStateMd calls syncStateFrontmatter, which DISCARDS the incoming frontmatter and
 *     rebuilds it from the body plus the on-disk plan/summary counts. So no assertion can
 *     require the input frontmatter to survive byte-for-byte; it never does, fix or no fix.
 *     The observable that does discriminate is the JSON verdict: with a frontmatter
 *     `progress:` key and no body bar at all, the fixed code reports `updated: false` while
 *     the old code reported a false `updated: true` off the frontmatter key.
 *   - The seeded bar is `[XXXXXXXXXX] 7%`, a value the engine can never emit. Seeding a
 *     legitimate-looking `[..........] 0%` would let a test pass vacuously whenever the
 *     computed percent also happened to be 0.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlanningFixture, cleanupFixture } from './helpers/planning-fixture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOOLS = resolve(ROOT, 'packages/donny/bin/donny-tools.cjs');

/** A bar the engine cannot produce, so "was it rewritten" is never ambiguous. */
const SEEDED_BAR = '[XXXXXXXXXX] 7%';

/** Ten cells of U+2588 FULL BLOCK / U+2591 LIGHT SHADE, then a percent. What the engine writes. */
const REAL_BAR = String.raw`\[[█░]{10}\] \d+%`;

/** One PLAN and one SUMMARY, so the phase directory is never empty whatever the filter decides. */
function fixture(stateMd) {
  const root = buildPlanningFixture({
    phase: '24-fixture',
    plans: [{ name: '24-01-PLAN.md', content: 'x' }],
    summaries: [{ name: '24-01-SUMMARY.md', content: 'x' }],
  });
  writeFileSync(join(root, '.planning', 'STATE.md'), stateMd, 'utf-8');
  return root;
}

function updateProgress(root) {
  const stdout = execFileSync(process.execPath, [TOOLS, 'state', 'update-progress'], {
    cwd: root,
    encoding: 'utf-8',
  });
  return JSON.parse(stdout);
}

function readState(root) {
  return readFileSync(join(root, '.planning', 'STATE.md'), 'utf-8');
}

/** Split a STATE.md the same way the fix does, so the body can be asserted on independently. */
function splitState(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return m ? { head: m[0], body: content.slice(m[0].length) } : { head: '', body: content };
}

describe('donny-tools state update-progress', () => {
  // ── Bug 2: the frontmatter's lowercase `progress:` key stealing the match ──────────
  //
  // Probe A is the shape claudecodeoptimized/.planning/STATE.md actually carries: a
  // `progress:` block key in frontmatter AND a plain `Progress:` bar in the body. Probe B
  // strips the body bar, which is the only way the frontmatter match becomes visible in the
  // command's own output rather than being erased by the frontmatter rebuild.

  it('rewrites the body bar and never lets the frontmatter progress: key claim the match', () => {
    const withBodyBar = fixture(
      [
        '---',
        'milestone: v6.0',
        'progress:',
        '  total_phases: 9',
        '  percent: 0',
        '---',
        '',
        '# Project State',
        '',
        `Progress: ${SEEDED_BAR}`,
        '',
      ].join('\n'),
    );

    try {
      const res = updateProgress(withBodyBar);
      assert.equal(res.updated, true);

      const { head, body } = splitState(readState(withBodyBar));
      const line = body.match(new RegExp(`^Progress: ${REAL_BAR}$`, 'm'));
      assert.ok(line, `body bar was not rewritten to a real bar:\n${body}`);
      assert.equal(
        line[0],
        `Progress: ${res.bar}`,
        'the body line must carry the bar the command reported computing',
      );
      assert.ok(!body.includes('XXXXXXXXXX'), 'the seeded placeholder bar must be gone');
      assert.ok(
        !/\[[█░]/.test(head),
        `a progress bar leaked into the frontmatter block:\n${head}`,
      );
    } finally {
      cleanupFixture(withBodyBar);
    }

    // Probe B: frontmatter `progress:` key present, no body bar anywhere. The pre-fix
    // case-insensitive pattern matched the YAML key and reported a success that changed
    // nothing a reader could see. The fix reports honestly that there is nothing to update.
    const frontmatterKeyOnly = fixture(
      [
        '---',
        'milestone: v6.0',
        'progress:',
        '  total_phases: 9',
        '  percent: 0',
        '---',
        '',
        '# Project State',
        '',
        'Some body text with no progress bar.',
        '',
      ].join('\n'),
    );

    try {
      const res = updateProgress(frontmatterKeyOnly);
      assert.equal(
        res.updated,
        false,
        'a lowercase progress: key in frontmatter is not a body progress bar',
      );
      assert.match(String(res.reason), /not found/i);
    } finally {
      cleanupFixture(frontmatterKeyOnly);
    }
  });

  // ── Bug 1: the unanchored bold pattern eating narrative prose ─────────────────────
  //
  // The quoted mention sits BEFORE the real bar on purpose. The pre-fix pattern took the
  // first substring match in the document, so ordering is what makes the bug reachable.

  it('leaves a mid-sentence **Progress:** mention intact and rewrites the real bar line', () => {
    const prose = 'Earlier prose that mentions **Progress:** as an example and must survive.';
    const root = fixture(
      [
        '---',
        'milestone: v6.0',
        '---',
        '',
        prose,
        '',
        `**Progress:** ${SEEDED_BAR}`,
        '',
      ].join('\n'),
    );

    try {
      const res = updateProgress(root);
      assert.equal(res.updated, true);

      const { body } = splitState(readState(root));
      assert.ok(body.includes(prose), `narrative prose was rewritten:\n${body}`);

      const line = body.match(new RegExp(`^\\*\\*Progress:\\*\\* ${REAL_BAR}$`, 'm'));
      assert.ok(line, `the real bold bar line was not rewritten:\n${body}`);
      assert.equal(line[0], `**Progress:** ${res.bar}`);
      assert.ok(!body.includes('XXXXXXXXXX'), 'the seeded placeholder bar must be gone');
    } finally {
      cleanupFixture(root);
    }
  });

  // ── The fmMatch === null path ────────────────────────────────────────────────────
  //
  // Splitting on frontmatter must not become a precondition for matching at all. A STATE.md
  // with no leading --- block still has head = '' and body = the whole document.

  it('still rewrites a plain Progress: line when the file has no frontmatter', () => {
    const root = fixture(['# Project State', '', `Progress: ${SEEDED_BAR}`, ''].join('\n'));

    try {
      const res = updateProgress(root);
      assert.equal(res.updated, true);

      const { body } = splitState(readState(root));
      const line = body.match(new RegExp(`^Progress: ${REAL_BAR}$`, 'm'));
      assert.ok(line, `body bar was not rewritten with no frontmatter present:\n${body}`);
      assert.equal(line[0], `Progress: ${res.bar}`);
      assert.ok(!body.includes('XXXXXXXXXX'), 'the seeded placeholder bar must be gone');
    } finally {
      cleanupFixture(root);
    }
  });
});
