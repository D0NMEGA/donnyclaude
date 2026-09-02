/**
 * RECORD-03 regression pins for the SUMMARY generators.
 *
 * A SUMMARY's `requirements-completed` field is read by `cmdVerifyMilestoneCoverage`
 * (verify.cjs) behind an `Array.isArray` gate, so a field that parses as anything other
 * than an array is invisible to the coverage engine while still looking correct to a
 * human reader. Two template defects produce exactly that:
 *
 *   1. `requirements-completed: []  # comment` - the trailing comment makes the value
 *      fail the `endsWith(']')` test at frontmatter.cjs:55, so it parses as a STRING.
 *   2. Decorative `---` rules in the template body - `extractFrontmatter` keeps the LAST
 *      `---` pair in a document (frontmatter.cjs:16-17), so a SUMMARY that inherits them
 *      has its real frontmatter shadowed and parses to zero keys. The pre-repair
 *      19-01-SUMMARY.md inherited both rules verbatim from templates/summary.md.
 *
 * Every assertion here goes through the engine's own parser rather than a hand-rolled
 * YAML reader, because the parser's quirks are the whole point.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEMPLATES = resolve(ROOT, 'packages/donny/templates');
const { extractFrontmatter } = require(resolve(ROOT, 'packages/donny/bin/lib/frontmatter.cjs'));

function readTemplate(name) {
  return readFileSync(resolve(TEMPLATES, name), 'utf-8');
}

/** The ```markdown fenced blocks of a documentation-wrapper template, in file order. */
function fencedBlocks(md) {
  return [...md.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

function ruleCount(s) {
  return (s.match(/^---$/gm) || []).length;
}

function lineCount(s, re) {
  return (s.match(re) || []).length;
}

// ── templates/summary.md ────────────────────────────────────────────────────
//
// summary.md is a documentation WRAPPER, not a raw template: its real template lives
// inside the first ```markdown fence and an `<example>` filled-in copy lives inside the
// second. Parsing the whole file through extractFrontmatter returns zero keys by design,
// because a documentation `---` rule sits in the wrapper prose ahead of both fences. So
// these assertions target the fenced blocks explicitly - the bytes that actually get
// copied to make a SUMMARY.

describe('templates/summary.md', () => {
  const md = readTemplate('summary.md');
  const blocks = fencedBlocks(md);

  it('has exactly two ```markdown fenced blocks (File Template, then example)', () => {
    assert.equal(blocks.length, 2);
  });

  it('parses its File Template block to 14 frontmatter keys', () => {
    const fm = extractFrontmatter(blocks[0]);
    assert.equal(
      Object.keys(fm).length,
      14,
      'a body --- pair shadowing the real frontmatter collapses this to 0',
    );
  });

  it('parses requirements-completed as an empty array, not a string', () => {
    const fm = extractFrontmatter(blocks[0]);
    assert.deepEqual(fm['requirements-completed'], []);
    assert.ok(
      Array.isArray(fm['requirements-completed']),
      'cmdVerifyMilestoneCoverage gates on Array.isArray, so a string drops the IDs',
    );
  });

  it('keeps exactly two --- lines in the File Template block', () => {
    assert.equal(
      ruleCount(blocks[0]),
      2,
      'the two frontmatter fences only; a third and fourth shadow the frontmatter',
    );
  });

  it('has no --- lines in the example block', () => {
    assert.equal(ruleCount(blocks[1]), 0, 'the example must not teach the defect by example');
  });

  it('has exactly three --- lines in the whole file', () => {
    assert.equal(
      ruleCount(md),
      3,
      'the wrapper documentation rule plus the File Template frontmatter fences',
    );
  });

  it('does not carry the inline-comment form of requirements-completed', () => {
    assert.ok(
      !md.includes('requirements-completed: []  #'),
      'the inline-comment form parses as a string and defeats milestone-coverage (C-8)',
    );
  });

  it('carries the field and its guidance comment on separate lines', () => {
    assert.equal(lineCount(md, /^requirements-completed: \[\]$/gm), 1);
    assert.equal(lineCount(md, /^# REQUIRED - copy ALL requirement IDs/gm), 1);
  });
});
