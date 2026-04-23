#!/usr/bin/env node
// Unit tests for gsd-session-start hook logic.
// Run with: node packages/hooks/gsd-session-start.test.js
// Exit code 0 on pass, 1 on fail.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectPackageManager,
  detectTestRunner,
  detectMostRecentBackup,
  buildContext,
  parseStdin,
  PACKAGE_MANAGERS,
} = require('./gsd-session-start.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
    passed++;
  } catch (err) {
    console.error('FAIL ' + name + ': ' + (err && err.message ? err.message : err));
    failed++;
  }
}

// Helper: create an isolated tmp dir per test so detection is deterministic.
function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-session-start-' + prefix + '-'));
}

function touch(dir, name, content) {
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content === undefined ? '' : content);
  return full;
}

// -------- parseStdin --------

test('parseStdin returns parsed object on valid JSON', () => {
  const parsed = parseStdin('{"cwd":"/tmp","session_id":"abc"}');
  assert.strictEqual(parsed.cwd, '/tmp');
  assert.strictEqual(parsed.session_id, 'abc');
});

test('parseStdin returns empty object on invalid JSON', () => {
  assert.deepStrictEqual(parseStdin('not json'), {});
  assert.deepStrictEqual(parseStdin(''), {});
  assert.deepStrictEqual(parseStdin('null'), {});
});

// -------- package manager precedence --------

test('detectPackageManager picks bun when bun.lockb is present alone', () => {
  const dir = mkTmp('bun');
  touch(dir, 'bun.lockb');
  assert.strictEqual(detectPackageManager(dir), 'bun');
});

test('detectPackageManager picks bun over pnpm/yarn/npm when all are present', () => {
  const dir = mkTmp('multi');
  touch(dir, 'bun.lockb');
  touch(dir, 'pnpm-lock.yaml');
  touch(dir, 'yarn.lock');
  touch(dir, 'package-lock.json');
  assert.strictEqual(detectPackageManager(dir), 'bun');
});

test('detectPackageManager picks pnpm over yarn and npm', () => {
  const dir = mkTmp('pnpm-over');
  touch(dir, 'pnpm-lock.yaml');
  touch(dir, 'yarn.lock');
  touch(dir, 'package-lock.json');
  assert.strictEqual(detectPackageManager(dir), 'pnpm');
});

test('detectPackageManager picks yarn over npm', () => {
  const dir = mkTmp('yarn-over');
  touch(dir, 'yarn.lock');
  touch(dir, 'package-lock.json');
  assert.strictEqual(detectPackageManager(dir), 'yarn');
});

test('detectPackageManager picks npm when only package-lock.json is present', () => {
  const dir = mkTmp('npm');
  touch(dir, 'package-lock.json');
  assert.strictEqual(detectPackageManager(dir), 'npm');
});

test('detectPackageManager picks python-poetry only when pyproject.toml has [tool.poetry]', () => {
  const withPoetry = mkTmp('poetry');
  touch(withPoetry, 'pyproject.toml', '[tool.poetry]\nname = "x"\n');
  assert.strictEqual(detectPackageManager(withPoetry), 'python-poetry');

  const withoutPoetry = mkTmp('no-poetry');
  touch(withoutPoetry, 'pyproject.toml', '[project]\nname = "x"\n');
  // Should fall through to null (no matching detector) since this project
  // only has a non-poetry pyproject.toml.
  assert.strictEqual(detectPackageManager(withoutPoetry), null);
});

test('detectPackageManager picks pip when only requirements.txt is present', () => {
  const dir = mkTmp('pip');
  touch(dir, 'requirements.txt', 'flask\n');
  assert.strictEqual(detectPackageManager(dir), 'python-pip');
});

test('detectPackageManager picks cargo when only Cargo.toml is present', () => {
  const dir = mkTmp('cargo');
  touch(dir, 'Cargo.toml', '[package]\nname = "x"\n');
  assert.strictEqual(detectPackageManager(dir), 'cargo');
});

test('detectPackageManager picks go when only go.mod is present', () => {
  const dir = mkTmp('go');
  touch(dir, 'go.mod', 'module x\n');
  assert.strictEqual(detectPackageManager(dir), 'go');
});

test('detectPackageManager returns null when no known lockfile exists', () => {
  const dir = mkTmp('empty');
  assert.strictEqual(detectPackageManager(dir), null);
});

test('PACKAGE_MANAGERS declared precedence matches contract', () => {
  const order = PACKAGE_MANAGERS.map((e) => e.name);
  const expectedHead = ['bun', 'pnpm', 'yarn', 'npm', 'python-poetry', 'python-pip', 'cargo', 'go'];
  for (let i = 0; i < expectedHead.length; i++) {
    assert.strictEqual(order[i], expectedHead[i], 'position ' + i + ' should be ' + expectedHead[i]);
  }
});

// -------- test runner detection --------

test('detectTestRunner prefers package.json scripts.test', () => {
  const dir = mkTmp('scripts-test');
  touch(dir, 'package.json', JSON.stringify({ scripts: { test: 'jest --coverage' } }));
  touch(dir, 'pytest.ini');
  const runner = detectTestRunner(dir);
  assert.match(runner, /^npm test \(/);
  assert.match(runner, /jest --coverage/);
});

test('detectTestRunner falls back to pytest when no package.json', () => {
  const dir = mkTmp('pytest');
  touch(dir, 'pytest.ini', '[pytest]\n');
  assert.strictEqual(detectTestRunner(dir), 'pytest');
});

test('detectTestRunner falls back to vitest config when present', () => {
  const dir = mkTmp('vitest');
  touch(dir, 'vitest.config.ts', '');
  assert.strictEqual(detectTestRunner(dir), 'vitest');
});

test('detectTestRunner detects cargo test via Cargo.toml', () => {
  const dir = mkTmp('cargo-test');
  touch(dir, 'Cargo.toml', '[package]\n');
  assert.strictEqual(detectTestRunner(dir), 'cargo test');
});

test('detectTestRunner returns null when nothing is detectable', () => {
  const dir = mkTmp('no-test');
  assert.strictEqual(detectTestRunner(dir), null);
});

test('detectTestRunner survives malformed package.json', () => {
  const dir = mkTmp('bad-pkg');
  touch(dir, 'package.json', '{ not valid json');
  // No pytest etc., so it should return null (not throw).
  assert.strictEqual(detectTestRunner(dir), null);
});

// -------- backup detection --------

test('detectMostRecentBackup returns (none) when dir is missing', () => {
  const dir = mkTmp('no-backups');
  assert.strictEqual(detectMostRecentBackup(dir), '(none)');
});

test('detectMostRecentBackup returns (none) when dir exists but is empty', () => {
  const dir = mkTmp('empty-backups');
  fs.mkdirSync(path.join(dir, '.claude', 'backups'), { recursive: true });
  assert.strictEqual(detectMostRecentBackup(dir), '(none)');
});

test('detectMostRecentBackup returns lexicographically last subdir', () => {
  const dir = mkTmp('backups');
  fs.mkdirSync(path.join(dir, '.claude', 'backups', '2026-04-20T00-00-00Z'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'backups', '2026-04-22T00-00-00Z'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'backups', '2026-04-21T00-00-00Z'), { recursive: true });
  const got = detectMostRecentBackup(dir);
  assert.strictEqual(got, path.join(dir, '.claude', 'backups', '2026-04-22T00-00-00Z'));
});

test('detectMostRecentBackup ignores files at top level', () => {
  const dir = mkTmp('backups-with-files');
  fs.mkdirSync(path.join(dir, '.claude', 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'backups', 'stray.txt'), 'x');
  fs.mkdirSync(path.join(dir, '.claude', 'backups', '2026-04-20T00-00-00Z'), { recursive: true });
  const got = detectMostRecentBackup(dir);
  assert.strictEqual(got, path.join(dir, '.claude', 'backups', '2026-04-20T00-00-00Z'));
});

// -------- buildContext --------

test('buildContext includes all lines when every field is populated', () => {
  const out = buildContext({
    branch: 'main',
    diff: ' 3 files changed, 10 insertions(+)',
    commits: 'aaa first\nbbb second',
    packageManager: 'pnpm',
    testRunner: 'vitest',
    backup: '/tmp/x/.claude/backups/2026-04-22',
  });
  assert.match(out, /Session context:/);
  assert.match(out, /- Branch: main/);
  assert.match(out, /- Uncommitted: .*3 files changed/);
  assert.match(out, /- Recent commits:/);
  assert.match(out, /aaa first/);
  assert.match(out, /bbb second/);
  assert.match(out, /- Package manager: pnpm/);
  assert.match(out, /- Test runner: vitest/);
  assert.match(out, /- Most recent backup: \/tmp\/x\/\.claude\/backups\/2026-04-22/);
});

test('buildContext emits Uncommitted: none when diff is "clean"', () => {
  const out = buildContext({
    branch: 'main',
    diff: 'clean',
    commits: null,
    packageManager: null,
    testRunner: null,
    backup: '(none)',
  });
  assert.match(out, /- Uncommitted: none/);
  assert.doesNotMatch(out, /Recent commits/);
});

test('buildContext omits git sections entirely when git commands returned null (missing repo path)', () => {
  const out = buildContext({
    branch: null,
    diff: null,
    commits: null,
    packageManager: 'npm',
    testRunner: 'jest',
    backup: '(none)',
  });
  assert.doesNotMatch(out, /- Branch:/);
  assert.doesNotMatch(out, /- Uncommitted:/);
  assert.doesNotMatch(out, /- Recent commits:/);
  assert.match(out, /- Package manager: npm/);
  assert.match(out, /- Test runner: jest/);
  assert.match(out, /- Most recent backup: \(none\)/);
});

test('buildContext always emits backup line, defaulting to (none)', () => {
  const out = buildContext({ branch: null, diff: null, commits: null, packageManager: null, testRunner: null, backup: null });
  assert.match(out, /- Most recent backup: \(none\)/);
});

test('buildContext truncates oversized uncommitted summary', () => {
  const longSummary = ' '.repeat(300) + 'end';
  const out = buildContext({
    branch: 'main',
    diff: longSummary,
    commits: null,
    packageManager: null,
    testRunner: null,
    backup: '(none)',
  });
  // First line should be truncated with "..." suffix.
  const uncommittedLine = out.split('\n').find((l) => l.startsWith('- Uncommitted:'));
  assert.ok(uncommittedLine.length <= 135, 'uncommitted line should be reasonably short, got ' + uncommittedLine.length);
  assert.match(uncommittedLine, /\.\.\.$/);
});

// -------- summary --------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
