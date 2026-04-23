#!/usr/bin/env node
// gsd-session-start.js: SessionStart hook. Emits structured additionalContext
// JSON so the model does not have to discover working-environment facts on
// turn 1. Fail-open (exit 0 on all paths). Sub-tasks use execFile with an
// args array (no shell). Registered timeout 10s, per-task 2s, target under 8s.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SUB_TIMEOUT_MS = 2000;
const MAX_DIFF_LINES = 20;
const MAX_COMMIT_LINES = 5;

function poetrySection(cwd) {
  try {
    return /\[tool\.poetry\]/.test(fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8'));
  } catch (_) { return false; }
}

// Package manager precedence (first match wins). Locked by unit test.
const PACKAGE_MANAGERS = [
  { file: 'bun.lockb', name: 'bun' },
  { file: 'pnpm-lock.yaml', name: 'pnpm' },
  { file: 'yarn.lock', name: 'yarn' },
  { file: 'package-lock.json', name: 'npm' },
  { file: 'pyproject.toml', name: 'python-poetry', requires: poetrySection },
  { file: 'requirements.txt', name: 'python-pip' },
  { file: 'Cargo.toml', name: 'cargo' },
  { file: 'go.mod', name: 'go' },
  { file: 'Gemfile.lock', name: 'bundler' },
  { file: 'composer.lock', name: 'composer' },
];

const TEST_RUNNER_FALLBACKS = [
  { file: 'pytest.ini', name: 'pytest' },
  { file: 'vitest.config.js', name: 'vitest' },
  { file: 'vitest.config.ts', name: 'vitest' },
  { file: 'vitest.config.mjs', name: 'vitest' },
  { file: 'jest.config.js', name: 'jest' },
  { file: 'jest.config.ts', name: 'jest' },
  { file: 'jest.config.mjs', name: 'jest' },
  { file: 'jest.config.cjs', name: 'jest' },
  { file: 'Cargo.toml', name: 'cargo test' },
  { file: 'go.mod', name: 'go test' },
];

function runGit(cwd, args) {
  return new Promise((resolve) => {
    const opts = { cwd, timeout: SUB_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 };
    execFile('git', args, opts, (err, stdout) => {
      if (err) { resolve(null); return; }
      resolve(typeof stdout === 'string' ? stdout.trim() : null);
    });
  });
}

const detectBranch = (cwd) => runGit(cwd, ['branch', '--show-current']);
const detectRecentCommits = (cwd) => runGit(cwd, ['log', '--oneline', '-' + MAX_COMMIT_LINES]);

async function detectDiff(cwd) {
  const raw = await runGit(cwd, ['diff', '--stat', 'HEAD']);
  if (raw === null) return null;
  if (raw.length === 0) return 'clean';
  return raw.split('\n').slice(0, MAX_DIFF_LINES).join('\n');
}

function detectPackageManager(cwd) {
  for (const entry of PACKAGE_MANAGERS) {
    const full = path.join(cwd, entry.file);
    if (!fs.existsSync(full)) continue;
    if (typeof entry.requires === 'function' && !entry.requires(cwd)) continue;
    return entry.name;
  }
  return null;
}

function detectTestRunner(cwd) {
  // package.json scripts.test wins because it is explicit project intent.
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const script = pkg && pkg.scripts && pkg.scripts.test;
      if (typeof script === 'string' && script.trim().length > 0) {
        return 'npm test (' + truncate(script.trim(), 60) + ')';
      }
    }
  } catch (_) { /* fall through */ }
  for (const entry of TEST_RUNNER_FALLBACKS) {
    if (fs.existsSync(path.join(cwd, entry.file))) return entry.name;
  }
  return null;
}

function detectMostRecentBackup(cwd) {
  const dir = path.join(cwd, '.claude', 'backups');
  try {
    if (!fs.existsSync(dir)) return '(none)';
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    if (entries.length === 0) return '(none)';
    return path.join(dir, entries[entries.length - 1]);
  } catch (_) { return '(none)'; }
}

const truncate = (s, n) => s.length <= n ? s : s.slice(0, n - 3) + '...';

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function parseStdin(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* ignore */ }
  return {};
}

function buildContext(r) {
  const lines = ['Session context:'];
  if (r.branch) lines.push('- Branch: ' + r.branch);
  if (r.diff === 'clean') lines.push('- Uncommitted: none');
  else if (r.diff) lines.push('- Uncommitted: ' + truncate(r.diff.split('\n')[0], 120));
  if (r.commits) {
    lines.push('- Recent commits:');
    for (const line of r.commits.split('\n').slice(0, MAX_COMMIT_LINES)) lines.push('  ' + line);
  }
  if (r.packageManager) lines.push('- Package manager: ' + r.packageManager);
  if (r.testRunner) lines.push('- Test runner: ' + r.testRunner);
  lines.push('- Most recent backup: ' + (r.backup || '(none)'));
  return lines.join('\n') + '\n';
}

const settledValue = (s) => (s.status === 'fulfilled' ? s.value : null);

async function main() {
  try {
    const raw = await readStdin();
    const payload = parseStdin(raw);
    const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0
      ? payload.cwd
      : process.cwd();

    const settled = await Promise.allSettled([
      detectBranch(cwd),
      detectDiff(cwd),
      detectRecentCommits(cwd),
      Promise.resolve(detectPackageManager(cwd)),
      Promise.resolve(detectTestRunner(cwd)),
      Promise.resolve(detectMostRecentBackup(cwd)),
    ]);

    const results = {
      branch: settledValue(settled[0]),
      diff: settledValue(settled[1]),
      commits: settledValue(settled[2]),
      packageManager: settledValue(settled[3]),
      testRunner: settledValue(settled[4]),
      backup: settledValue(settled[5]),
    };

    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: buildContext(results),
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Fail-open. Never block session start.
    process.stderr.write('[gsd-session-start] error: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  detectPackageManager,
  detectTestRunner,
  detectMostRecentBackup,
  buildContext,
  parseStdin,
  PACKAGE_MANAGERS,
};
