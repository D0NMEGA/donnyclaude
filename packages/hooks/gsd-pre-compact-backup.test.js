#!/usr/bin/env node
// Unit tests for gsd-pre-compact-backup hook logic.
// Run with: node packages/hooks/gsd-pre-compact-backup.test.js
// Exit code 0 on pass, 1 on fail.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  safeIsoTimestamp,
  parseTranscriptLines,
  extractCurrentTask,
  extractToolCalls,
  extractOpenFilePaths,
  buildState,
  writeBackup,
  readTestStatus,
  BACKUP_VERSION,
  MAX_TOOL_CALLS,
  MAX_TASK_CHARS,
} = require('./gsd-pre-compact-backup.js');

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

// ---------- safeIsoTimestamp ----------

test('safeIsoTimestamp is filesystem-safe (no colons, no dots)', () => {
  const stamp = safeIsoTimestamp(new Date('2026-04-22T19:30:45.123Z'));
  assert.strictEqual(stamp, '2026-04-22T19-30-45Z');
  assert.ok(!stamp.includes(':'));
  assert.ok(!stamp.includes('.'));
});

test('safeIsoTimestamp sorts lexicographically in chronological order', () => {
  const a = safeIsoTimestamp(new Date('2026-04-22T10:00:00Z'));
  const b = safeIsoTimestamp(new Date('2026-04-22T11:00:00Z'));
  const c = safeIsoTimestamp(new Date('2026-05-01T09:00:00Z'));
  const sorted = [c, a, b].sort();
  assert.deepStrictEqual(sorted, [a, b, c]);
});

test('safeIsoTimestamp matches regex in restore hook', () => {
  const stamp = safeIsoTimestamp(new Date('2026-04-22T19:30:45.123Z'));
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(stamp));
});

// ---------- parseTranscriptLines ----------

test('parseTranscriptLines parses valid JSONL', () => {
  const tail = '{"a":1}\n{"b":2}\n';
  const parsed = parseTranscriptLines(tail);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].a, 1);
  assert.strictEqual(parsed[1].b, 2);
});

test('parseTranscriptLines skips malformed lines', () => {
  const tail = '{"a":1}\nnot json\n{"b":2}\n';
  const parsed = parseTranscriptLines(tail);
  assert.strictEqual(parsed.length, 2);
});

test('parseTranscriptLines handles null and empty', () => {
  assert.deepStrictEqual(parseTranscriptLines(null), []);
  assert.deepStrictEqual(parseTranscriptLines(''), []);
});

// ---------- extractCurrentTask ----------

test('extractCurrentTask picks the most recent text', () => {
  const entries = [
    { message: { role: 'user', content: 'first' } },
    { message: { role: 'assistant', content: 'second' } },
    { message: { role: 'user', content: 'third' } },
  ];
  assert.strictEqual(extractCurrentTask(entries), 'third');
});

test('extractCurrentTask handles array content blocks', () => {
  const entries = [
    { message: { role: 'assistant', content: [{ type: 'text', text: 'hello world' }] } },
  ];
  assert.strictEqual(extractCurrentTask(entries), 'hello world');
});

test('extractCurrentTask truncates to MAX_TASK_CHARS', () => {
  const long = 'x'.repeat(MAX_TASK_CHARS + 50);
  const entries = [{ message: { role: 'user', content: long } }];
  const result = extractCurrentTask(entries);
  assert.strictEqual(result.length, MAX_TASK_CHARS);
});

test('extractCurrentTask returns null when no text found', () => {
  assert.strictEqual(extractCurrentTask([]), null);
  assert.strictEqual(extractCurrentTask([{ message: { role: 'system', content: 'x' } }]), null);
});

// ---------- extractToolCalls ----------

test('extractToolCalls pulls tool_use blocks from assistant entries', () => {
  const entries = [
    {
      timestamp: '2026-04-22T19:00:00Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/a.js' } },
        ],
      },
    },
  ];
  const calls = extractToolCalls(entries);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'Read');
  assert.strictEqual(calls[0].input_summary, '/a.js');
  assert.strictEqual(calls[0].timestamp, '2026-04-22T19:00:00Z');
});

test('extractToolCalls caps at MAX_TOOL_CALLS taking the most recent', () => {
  const entries = [];
  for (let i = 0; i < MAX_TOOL_CALLS + 5; i++) {
    entries.push({
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: `/f${i}.js` } }] },
    });
  }
  const calls = extractToolCalls(entries);
  assert.strictEqual(calls.length, MAX_TOOL_CALLS);
  assert.strictEqual(calls[calls.length - 1].input_summary, `/f${MAX_TOOL_CALLS + 4}.js`);
});

test('extractToolCalls summarizes Bash commands', () => {
  const entries = [
    { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }] } },
  ];
  const calls = extractToolCalls(entries);
  assert.strictEqual(calls[0].input_summary, 'ls -la');
});

// ---------- extractOpenFilePaths ----------

test('extractOpenFilePaths dedupes file paths from Read/Edit/Write', () => {
  const calls = [
    { name: 'Read', input_summary: '/a.js', timestamp: null },
    { name: 'Edit', input_summary: '/a.js', timestamp: null },
    { name: 'Write', input_summary: '/b.js', timestamp: null },
    { name: 'Bash', input_summary: 'ls', timestamp: null },
  ];
  const files = extractOpenFilePaths(calls);
  assert.deepStrictEqual(files.sort(), ['/a.js', '/b.js']);
});

// ---------- readTestStatus ----------

test('readTestStatus returns null when no test file present', () => {
  const tmp = mkTmp('precompact-');
  try {
    assert.strictEqual(readTestStatus(tmp), null);
  } finally {
    rmRf(tmp);
  }
});

test('readTestStatus parses .test-results.json', () => {
  const tmp = mkTmp('precompact-');
  try {
    fs.writeFileSync(path.join(tmp, '.test-results.json'), JSON.stringify({ passing: 5 }));
    assert.deepStrictEqual(readTestStatus(tmp), { passing: 5 });
  } finally {
    rmRf(tmp);
  }
});

test('readTestStatus falls back to raw_text on malformed JSON', () => {
  const tmp = mkTmp('precompact-');
  try {
    fs.writeFileSync(path.join(tmp, '.test-results.json'), 'not json');
    const result = readTestStatus(tmp);
    assert.strictEqual(result.raw_text, 'not json');
  } finally {
    rmRf(tmp);
  }
});

// ---------- buildState round-trip ----------

test('buildState produces serializable state.json with all required fields', () => {
  const entries = [
    { message: { role: 'user', content: 'build a feature' } },
    {
      timestamp: '2026-04-22T19:00:00Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.js' } }] },
    },
  ];
  const input = { session_id: 'abc-123' };
  const state = buildState(input, entries, '/workdir');
  assert.strictEqual(state.backup_version, BACKUP_VERSION);
  assert.strictEqual(state.session_id, 'abc-123');
  assert.strictEqual(state.working_directory, '/workdir');
  assert.strictEqual(state.current_task, 'build a feature');
  assert.deepStrictEqual(state.open_file_paths, ['/a.js']);
  assert.strictEqual(state.last_20_tool_calls.length, 1);
  assert.ok(typeof state.captured_at_utc === 'string');
  // Must round-trip through JSON without loss.
  const roundtripped = JSON.parse(JSON.stringify(state));
  assert.deepStrictEqual(roundtripped, state);
});

// ---------- writeBackup ----------

test('writeBackup creates .claude/backups/<timestamp>/state.json', () => {
  const tmp = mkTmp('precompact-');
  try {
    const state = { backup_version: 1, session_id: 'x' };
    const filePath = writeBackup(tmp, state);
    assert.ok(fs.existsSync(filePath));
    assert.ok(filePath.startsWith(path.join(tmp, '.claude', 'backups')));
    assert.ok(filePath.endsWith('state.json'));
    const roundtrip = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepStrictEqual(roundtrip, state);
  } finally {
    rmRf(tmp);
  }
});

test('writeBackup is idempotent on concurrent mkdir (recursive handles races)', () => {
  const tmp = mkTmp('precompact-');
  try {
    // Pre-create the backups parent.
    fs.mkdirSync(path.join(tmp, '.claude', 'backups'), { recursive: true });
    // First write.
    writeBackup(tmp, { backup_version: 1 });
    // Second write immediately after should also succeed (different second,
    // or same second in which case the directory pre-exists).
    writeBackup(tmp, { backup_version: 1 });
  } finally {
    rmRf(tmp);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
