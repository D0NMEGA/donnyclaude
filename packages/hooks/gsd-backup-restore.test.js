#!/usr/bin/env node
// Unit tests for gsd-backup-restore hook logic.
// Run with: node packages/hooks/gsd-backup-restore.test.js
// Exit code 0 on pass, 1 on fail.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findMostRecentBackup,
  loadState,
  formatSummary,
  MAX_FILES_IN_SUMMARY,
} = require('./gsd-backup-restore.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    failed++;
  }
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmRf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function seedBackup(cwd, stamp, state) {
  const dir = path.join(cwd, '.claude', 'backups', stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  return path.join(dir, 'state.json');
}

// ---------- findMostRecentBackup ----------

test('findMostRecentBackup returns null when backups dir missing', () => {
  const tmp = mkTmp('restore-');
  try {
    assert.strictEqual(findMostRecentBackup(tmp), null);
  } finally {
    rmRf(tmp);
  }
});

test('findMostRecentBackup returns null for empty backups dir', () => {
  const tmp = mkTmp('restore-');
  try {
    fs.mkdirSync(path.join(tmp, '.claude', 'backups'), { recursive: true });
    assert.strictEqual(findMostRecentBackup(tmp), null);
  } finally {
    rmRf(tmp);
  }
});

test('findMostRecentBackup ignores non-timestamp directories', () => {
  const tmp = mkTmp('restore-');
  try {
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', 'garbage-dir'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', 'also_bad'), { recursive: true });
    assert.strictEqual(findMostRecentBackup(tmp), null);
  } finally {
    rmRf(tmp);
  }
});

test('findMostRecentBackup picks lexicographically latest ISO-8601 timestamp', () => {
  const tmp = mkTmp('restore-');
  try {
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', '2026-04-22T10-00-00Z'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', '2026-04-22T11-00-00Z'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', '2026-05-01T09-00-00Z'), { recursive: true });
    const latest = findMostRecentBackup(tmp);
    assert.ok(latest.endsWith('2026-05-01T09-00-00Z'));
  } finally {
    rmRf(tmp);
  }
});

test('findMostRecentBackup sort handles multi-day ordering correctly', () => {
  const tmp = mkTmp('restore-');
  try {
    // Chronological: 2026-04-22 before 2026-12-01. Lexicographic must agree.
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', '2026-12-01T00-00-00Z'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude', 'backups', '2026-04-22T23-59-59Z'), { recursive: true });
    const latest = findMostRecentBackup(tmp);
    assert.ok(latest.endsWith('2026-12-01T00-00-00Z'));
  } finally {
    rmRf(tmp);
  }
});

// ---------- loadState ----------

test('loadState returns null on missing state.json', () => {
  const tmp = mkTmp('restore-');
  try {
    fs.mkdirSync(path.join(tmp, 'empty'), { recursive: true });
    assert.strictEqual(loadState(path.join(tmp, 'empty')), null);
  } finally {
    rmRf(tmp);
  }
});

test('loadState returns null on malformed state.json', () => {
  const tmp = mkTmp('restore-');
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'state.json'), '{ not json');
    assert.strictEqual(loadState(tmp), null);
  } finally {
    rmRf(tmp);
  }
});

test('loadState parses valid state.json', () => {
  const tmp = mkTmp('restore-');
  try {
    const payload = { backup_version: 1, session_id: 'abc', current_task: 'work' };
    fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify(payload));
    const result = loadState(tmp);
    assert.ok(result);
    assert.deepStrictEqual(result.state, payload);
    assert.strictEqual(result.statePath, path.join(tmp, 'state.json'));
  } finally {
    rmRf(tmp);
  }
});

test('loadState handles null input safely', () => {
  assert.strictEqual(loadState(null), null);
});

// ---------- formatSummary ----------

test('formatSummary mentions captured_at and current_task', () => {
  const summary = formatSummary('/tmp/state.json', {
    captured_at_utc: '2026-04-22T19:30:00Z',
    current_task: 'refactor module X',
    open_file_paths: ['/a.js', '/b.js'],
  });
  assert.ok(summary.includes('2026-04-22T19:30:00Z'));
  assert.ok(summary.includes('refactor module X'));
  assert.ok(summary.includes('/tmp/state.json'));
  assert.ok(summary.includes('/a.js'));
  assert.ok(summary.includes('/b.js'));
});

test('formatSummary truncates very long tasks', () => {
  const longTask = 'x'.repeat(500);
  const summary = formatSummary('/tmp/state.json', {
    captured_at_utc: 't',
    current_task: longTask,
    open_file_paths: [],
  });
  // 200 chars plus decorative text.
  assert.ok(summary.includes('x'.repeat(200)));
  assert.ok(!summary.includes('x'.repeat(201)));
});

test('formatSummary indicates empty file list', () => {
  const summary = formatSummary('/tmp/state.json', {
    captured_at_utc: 't',
    current_task: 'task',
    open_file_paths: [],
  });
  assert.ok(summary.includes('[none]'));
});

test('formatSummary caps file list at MAX_FILES_IN_SUMMARY and notes overflow', () => {
  const files = [];
  for (let i = 0; i < MAX_FILES_IN_SUMMARY + 5; i++) files.push(`/f${i}.js`);
  const summary = formatSummary('/tmp/state.json', {
    captured_at_utc: 't',
    current_task: 'task',
    open_file_paths: files,
  });
  assert.ok(summary.includes('and 5 more'));
});

test('formatSummary handles missing optional fields', () => {
  const summary = formatSummary('/tmp/state.json', {});
  assert.ok(summary.includes('unknown time'));
  assert.ok(summary.includes('no task text captured'));
});

// ---------- end-to-end round trip ----------

test('round trip: most recent backup written by pre-compact is loaded by restore', () => {
  const tmp = mkTmp('restore-');
  try {
    seedBackup(tmp, '2026-04-22T10-00-00Z', { backup_version: 1, current_task: 'older' });
    seedBackup(tmp, '2026-04-22T18-00-00Z', {
      backup_version: 1,
      captured_at_utc: '2026-04-22T18:00:00Z',
      current_task: 'newer',
      open_file_paths: ['/x.js'],
    });
    const latest = findMostRecentBackup(tmp);
    const loaded = loadState(latest);
    assert.ok(loaded);
    assert.strictEqual(loaded.state.current_task, 'newer');
    const summary = formatSummary(loaded.statePath, loaded.state);
    assert.ok(summary.includes('newer'));
    assert.ok(summary.includes('/x.js'));
  } finally {
    rmRf(tmp);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
