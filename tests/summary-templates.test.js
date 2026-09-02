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

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEMPLATES = resolve(ROOT, 'packages/donny/templates');
const { extractFrontmatter } = require(resolve(ROOT, 'packages/donny/bin/lib/frontmatter.cjs'));
const { cmdTemplateFill } = require(resolve(ROOT, 'packages/donny/bin/lib/template.cjs'));

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

// ── the three sibling templates ─────────────────────────────────────────────
//
// Unlike summary.md these are raw templates rather than documentation wrappers, so the
// whole-file parse is the correct target. Each expected key count is one higher than the
// pre-fix count, and key-decisions is asserted alongside because the inserted lines sit
// at indent 0 directly after an indented array item - the parser has to pop its stack
// back to the root object (frontmatter.cjs:35-37) without swallowing the array.

describe('sibling summary templates', () => {
  const cases = [
    { file: 'summary-minimal.md', keys: 12, keyDecisions: [] },
    { file: 'summary-standard.md', keys: 12, keyDecisions: ['Decision 1'] },
    { file: 'summary-complex.md', keys: 14, keyDecisions: ['Decision 1'] },
  ];

  for (const c of cases) {
    describe(c.file, () => {
      const md = readTemplate(c.file);
      const fm = extractFrontmatter(md);

      it(`parses to ${c.keys} frontmatter keys`, () => {
        assert.equal(Object.keys(fm).length, c.keys);
      });

      it('carries requirements-completed as an empty array', () => {
        assert.deepEqual(fm['requirements-completed'], []);
        assert.ok(Array.isArray(fm['requirements-completed']));
      });

      it('leaves key-decisions intact', () => {
        assert.deepEqual(fm['key-decisions'], c.keyDecisions);
      });

      it('keeps exactly two --- lines', () => {
        assert.equal(ruleCount(md), 2, 'a third --- pair would shadow the frontmatter');
      });

      it('does not carry the inline-comment form', () => {
        assert.ok(!md.includes('requirements-completed: []  #'));
      });
    });
  }
});

// ── the fifth generator ─────────────────────────────────────────────────────
//
// cmdTemplateFill builds a SUMMARY from a hardcoded object literal and never reads a
// template file, so a template-only fix leaves a compliant-looking path emitting a
// non-compliant record. These assertions run the real command and read what it wrote.

describe('cmdTemplateFill', () => {
  const roots = [];

  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function fillSummary() {
    const root = mkdtempSync(join(tmpdir(), 'donny-tmpl-'));
    roots.push(root);
    mkdirSync(join(root, '.planning/phases/23-fixture'), { recursive: true });

    // The command reports through output(), which does a blocking fs.writeSync(1, ...).
    // Swap that out so the JSON result is captured rather than dumped into the test log.
    const realWriteSync = fs.writeSync;
    let captured = '';
    fs.writeSync = (fd, data, ...rest) => {
      if (fd === 1) {
        captured += String(data);
        return Buffer.byteLength(String(data));
      }
      return realWriteSync(fd, data, ...rest);
    };
    try {
      cmdTemplateFill(root, 'summary', { phase: '23', plan: '02' }, false);
    } finally {
      fs.writeSync = realWriteSync;
    }

    const result = JSON.parse(captured);
    return { root, result, content: readFileSync(join(root, result.path), 'utf-8') };
  }

  it('writes a SUMMARY into the resolved phase directory', () => {
    const { result } = fillSummary();
    assert.equal(result.created, true);
    assert.equal(result.path, '.planning/phases/23-fixture/23-02-SUMMARY.md');
  });

  it('emits requirements-completed as an array', () => {
    const { content } = fillSummary();
    const fm = extractFrontmatter(content);
    assert.deepEqual(fm['requirements-completed'], []);
    assert.ok(
      Array.isArray(fm['requirements-completed']),
      'a SUMMARY from cmdTemplateFill must be readable by milestone-coverage too',
    );
  });

  it('emits 13 frontmatter keys and exactly two --- lines', () => {
    const { content } = fillSummary();
    assert.equal(Object.keys(extractFrontmatter(content)).length, 13);
    assert.equal(ruleCount(content), 2);
  });
});
