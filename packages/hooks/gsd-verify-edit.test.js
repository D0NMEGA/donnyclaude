#!/usr/bin/env node
// Tests for gsd-verify-edit.js. No test framework dependency, runs under
// plain node so it can execute in hook-land without installing devDeps.
//
// Usage: node packages/hooks/gsd-verify-edit.test.js
// Exit code 0 on success, non-zero on failure.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'gsd-verify-edit.js');
const mod = require('./gsd-verify-edit.js');

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail) {
  if (condition) {
    passed++;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failed++;
    failures.push({ label, detail });
    process.stdout.write(`  FAIL ${label} ${detail || ''}\n`);
  }
}

function mktmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function runHook(inputObj, opts = {}) {
  const input = JSON.stringify(inputObj);
  const result = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: 'utf8',
    timeout: opts.timeout || 15000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// Test a: detection heuristic correctly identifies npm lint.
function testDetectNpmLint() {
  const tmp = mktmp('gsd-verify-a');
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { lint: 'echo lint' } })
  );
  const target = path.join(tmp, 'index.ts');
  fs.writeFileSync(target, 'export const a = 1;\n');

  const command = mod.detectCommand(tmp, target);
  assert(
    'detect npm run lint when package.json scripts.lint is present',
    command && command.label === 'npm run lint' && command.args[0] === 'run' && command.args[1] === 'lint',
    JSON.stringify(command)
  );

  // Priority check: even with eslint config alongside, npm script wins.
  fs.writeFileSync(path.join(tmp, '.eslintrc.json'), '{}');
  const command2 = mod.detectCommand(tmp, target);
  assert(
    'npm script takes priority over inferred eslint',
    command2 && command2.label === 'npm run lint',
    JSON.stringify(command2)
  );
}

// Test b: false-success pattern catches "Error:" on exit 0.
function testFalseSuccessHeuristic() {
  assert(
    'catches leading "Error:" as false success',
    mod.hasFalseSuccessToken('Error: undefined variable\n  at line 3'),
    'should detect'
  );
  assert(
    'catches case-insensitive "FATAL"',
    mod.hasFalseSuccessToken('FATAL: parse error'),
    'should detect'
  );
  assert(
    'catches leading "Traceback"',
    mod.hasFalseSuccessToken('Traceback (most recent call last):'),
    'should detect'
  );
  assert(
    'catches leading "✗"',
    mod.hasFalseSuccessToken('✗ something broke'),
    'should detect ✗'
  );
  assert(
    'does not flag clean success output',
    !mod.hasFalseSuccessToken('All 42 checks passed\nDone in 2s'),
    'should not detect'
  );
  assert(
    'does not flag mid-line "error" word',
    !mod.hasFalseSuccessToken('All checks ok, no errors found'),
    'must not false-positive on informational text'
  );
  assert(
    'tolerates empty output',
    !mod.hasFalseSuccessToken(''),
    'empty must be clean'
  );
}

// Test c: timeout path fails open. We simulate by pointing npm script at a
// command that would take too long. Instead of actually running that, we
// verify via the hook's own timeout behavior with a malformed input causing a
// fast fail-open and empty stdout.
function testTimeoutAndCrashFailOpen() {
  // Case 1: non-JSON stdin. Should exit 0 with empty stdout.
  const res1 = runHook('not-json-at-all');
  assert(
    'non-JSON stdin returns exit 0 with empty stdout',
    res1.status === 0 && res1.stdout === '',
    `status=${res1.status} stdout=${JSON.stringify(res1.stdout)}`
  );

  // Case 2: tool_name is Bash, which is out of scope. Must exit silently.
  const res2 = runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert(
    'non-Edit tool_name exits 0 with empty stdout',
    res2.status === 0 && res2.stdout === '',
    `status=${res2.status} stdout=${JSON.stringify(res2.stdout)}`
  );

  // Case 3: no file_path. Must exit silently.
  const res3 = runHook({ tool_name: 'Edit', tool_input: {} });
  assert(
    'missing file_path exits 0 with empty stdout',
    res3.status === 0 && res3.stdout === '',
    `status=${res3.status} stdout=${JSON.stringify(res3.stdout)}`
  );
}

// Test d: fixture of a realistic tool_input JSON passes through without crash.
// This exercises the full stdin -> parse -> detect -> skip-silently path for a
// project that has no linter config (verify hook returns empty additionalContext).
function testFixturePassthrough() {
  const tmp = mktmp('gsd-verify-d');
  const target = path.join(tmp, 'note.txt');
  fs.writeFileSync(target, 'hello\n');
  // No package.json, no eslint, no ruff: detection returns null, hook is a
  // no-op.
  const fixture = {
    session_id: 'abc123',
    tool_name: 'Write',
    tool_input: { file_path: target, content: 'hello\n' },
    tool_response: { file_path: target, success: true },
    cwd: tmp,
  };
  const res = runHook(fixture);
  assert(
    'realistic Write fixture returns exit 0 silently when no linter',
    res.status === 0 && res.stdout === '',
    `status=${res.status} stdout=${JSON.stringify(res.stdout)}`
  );

  // Also verify the hook emits a structured warning when the linter fails.
  // We simulate a failing lint by using a fake npm script that prints Error:
  // on stdout with exit 0 (the exact false-success case from baseline).
  const projTmp = mktmp('gsd-verify-d2');
  fs.writeFileSync(
    path.join(projTmp, 'package.json'),
    JSON.stringify({
      name: 'x',
      scripts: { lint: 'node -e "console.log(\'Error: demo undefined var\'); process.exit(0)"' },
    })
  );
  const projTarget = path.join(projTmp, 'index.ts');
  fs.writeFileSync(projTarget, 'export const a = 1;\n');
  const res2 = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: projTarget },
    cwd: projTmp,
  }, { timeout: 20000 });
  let parsed = null;
  try {
    parsed = JSON.parse(res2.stdout);
  } catch {
    parsed = null;
  }
  assert(
    'false-success stdout triggers additionalContext injection',
    res2.status === 0 &&
      parsed &&
      parsed.hookSpecificOutput &&
      parsed.hookSpecificOutput.hookEventName === 'PostToolUse' &&
      typeof parsed.hookSpecificOutput.additionalContext === 'string' &&
      parsed.hookSpecificOutput.additionalContext.includes('POST-EDIT VERIFY'),
    `status=${res2.status} stdout=${JSON.stringify(res2.stdout).slice(0, 200)}`
  );
}

// Run all.
process.stdout.write('gsd-verify-edit.test.js\n');
process.stdout.write('-- detection heuristic --\n');
testDetectNpmLint();
process.stdout.write('-- false-success pattern --\n');
testFalseSuccessHeuristic();
process.stdout.write('-- timeout and crash fail-open --\n');
testTimeoutAndCrashFailOpen();
process.stdout.write('-- fixture passthrough --\n');
testFixturePassthrough();

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) {
    process.stdout.write(`FAILURE: ${f.label} ${f.detail || ''}\n`);
  }
  process.exit(1);
}
process.exit(0);
