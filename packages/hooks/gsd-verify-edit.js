#!/usr/bin/env node
// gsd-hook-version: 1.32.0
// GSD Verify Edit, PostToolUse hook on Write|Edit|MultiEdit.
//
// Purpose: close the "usually vs always" gap for code quality. A rule telling
// the model to run the linter is probabilistic; this hook runs it every time
// an edit lands, feeding the result back as additionalContext. Evidence base:
//   - LangChain Terminal Bench: PreCompletionChecklistMiddleware contributed to
//     a 13.7-point harness-only improvement.
//   - SWE-agent: linter-gated edits reject syntactically invalid changes
//     before they touch disk.
//   - Blake Crosley's 95-hook practitioner report: "The best hooks come from
//     incidents, not planning."
//
// Fail-open contract: this hook must never block the tool call. Every error
// path exits 0 with empty stdout. Signal failure only via additionalContext.
//
// False-success detection (critical, learned from Step 0 baseline):
// Three Bash tool_results in the baseline session began with "Error:" on
// stdout but had is_error: false because the CLI emitted error text on stdout
// with exit code 0. We cannot rely on spawnSync's status alone; we must also
// pattern-match the captured output for leading error tokens
// (case-insensitive: error, fatal, panic, traceback, exception, failed, ✗).
// See BASELINE.md "Surprising findings" for the full incident trail.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_STDIN_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5000;
const OUTPUT_LINE_CAP = 50;
const STDIN_READ_TIMEOUT_MS = 3000;

// Case-insensitive leading tokens that indicate a tool emitted an error on
// stdout while still exiting 0. Anchored to line starts after trimming.
const FALSE_SUCCESS_TOKENS = [
  'error',
  'fatal',
  'panic',
  'traceback',
  'exception',
  'failed',
  '✗', // ✗
];

function existsSafe(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Detect the right verification command for the edited file.
// Order matters: prefer project-declared npm scripts over inferred linters so
// project convention wins. Returns { cmd, args, cwd, label } or null to skip.
function detectCommand(projectRoot, filePath) {
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  const pkg = existsSafe(pkgJsonPath) ? readJsonSafe(pkgJsonPath) : null;
  const scripts = (pkg && pkg.scripts) || {};
  const ext = path.extname(filePath).toLowerCase();

  // 1. npm run lint if declared. Skip path-scoping because many lint scripts
  //    include their own file globs and extra args would confuse them.
  if (scripts.lint && /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(ext)) {
    return {
      cmd: 'npm',
      args: ['run', 'lint', '--if-present', '--silent'],
      cwd: projectRoot,
      label: 'npm run lint',
    };
  }

  // 2. ESLint config without an npm script. Scope to the edited file.
  const eslintConfigs = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
  ];
  const hasEslint = eslintConfigs.some(name => existsSafe(path.join(projectRoot, name)));
  if (hasEslint && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) {
    return {
      cmd: 'npx',
      args: ['--no-install', 'eslint', '--no-color', filePath],
      cwd: projectRoot,
      label: 'eslint',
    };
  }

  // 3. Python: ruff if pyproject.toml or .ruff.toml present.
  const hasRuffConfig = existsSafe(path.join(projectRoot, 'pyproject.toml')) ||
    existsSafe(path.join(projectRoot, '.ruff.toml')) ||
    existsSafe(path.join(projectRoot, 'ruff.toml'));
  if (hasRuffConfig && ext === '.py') {
    return {
      cmd: 'ruff',
      args: ['check', '--no-cache', filePath],
      cwd: projectRoot,
      label: 'ruff check',
    };
  }

  // 4. Rust: cargo check is too slow for a 10s budget. Fall back to a syntax
  //    read rather than timing out the hook. Return null to skip silently.
  if (existsSafe(path.join(projectRoot, 'Cargo.toml')) && ext === '.rs') {
    return null;
  }

  // No linter detected. Skip silently.
  return null;
}

// Find the nearest ancestor directory containing package.json, pyproject.toml,
// or Cargo.toml. Falls back to cwd if nothing matches.
function findProjectRoot(startDir, cwd) {
  const markers = ['package.json', 'pyproject.toml', 'Cargo.toml', '.git'];
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    for (const marker of markers) {
      if (existsSafe(path.join(dir, marker))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

// Return true when stdout or stderr opens with a token that signals failure,
// even though exit code was 0. Matches case-insensitive, line-leading only.
function hasFalseSuccessToken(output) {
  if (!output) return false;
  const lines = String(output).split(/\r?\n/).slice(0, OUTPUT_LINE_CAP);
  for (const raw of lines) {
    const trimmed = raw.trimStart().toLowerCase();
    if (!trimmed) continue;
    for (const token of FALSE_SUCCESS_TOKENS) {
      if (trimmed.startsWith(token)) {
        // Guard against false positives from words like "errored" appearing
        // mid-sentence; require a following boundary (colon, space, end).
        const after = trimmed.charAt(token.length);
        if (after === '' || after === ':' || after === ' ' || after === '\t' || after === ',') {
          return true;
        }
      }
    }
  }
  return false;
}

function clipOutput(output) {
  if (!output) return '';
  const lines = String(output).split(/\r?\n/);
  if (lines.length <= OUTPUT_LINE_CAP) return lines.join('\n');
  return lines.slice(0, OUTPUT_LINE_CAP).join('\n') + '\n... (truncated)';
}

function emitSuccess() {
  process.stdout.write('');
  process.exit(0);
}

function emitFailure(label, combinedOutput) {
  const clipped = clipOutput(combinedOutput);
  const message =
    `POST-EDIT VERIFY (${label}): Lint or typecheck reported issues after the edit. ` +
    `Output: ${clipped}. Consider fixing before the next edit.`;
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  };
  try {
    process.stdout.write(JSON.stringify(output));
  } catch {
    // Even JSON.stringify must not take us off the fail-open path.
  }
  process.exit(0);
}

function main(rawInput) {
  let data;
  try {
    data = JSON.parse(rawInput);
  } catch {
    emitSuccess();
    return;
  }

  const toolName = data && data.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') {
    emitSuccess();
    return;
  }

  // Prefer tool_input.file_path per task contract; tool_response.file_path is
  // secondary because it may reflect a canonicalized path that differs from
  // what the model intends to target.
  const toolInput = (data && data.tool_input) || {};
  const filePath = toolInput.file_path || toolInput.path || '';
  if (!filePath) {
    emitSuccess();
    return;
  }

  const cwd = (data && data.cwd) || process.cwd();
  const projectRoot = findProjectRoot(path.dirname(path.resolve(filePath)), cwd);
  const command = detectCommand(projectRoot, filePath);
  if (!command) {
    emitSuccess();
    return;
  }

  let result;
  try {
    result = spawnSync(command.cmd, command.args, {
      cwd: command.cwd,
      encoding: 'utf8',
      env: process.env,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch {
    emitSuccess();
    return;
  }

  if (!result || result.error) {
    // spawn crash or timeout: fail open.
    emitSuccess();
    return;
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const combined = stdout + (stderr ? `\n${stderr}` : '');

  const exitFailed = typeof result.status === 'number' && result.status !== 0;
  const falseSuccess = !exitFailed && hasFalseSuccessToken(combined);

  if (exitFailed || falseSuccess) {
    emitFailure(command.label, combined);
    return;
  }

  emitSuccess();
}

// Entry point. Read stdin with a hard timeout and byte cap; anything unusual
// falls through to fail-open.
if (require.main === module) {
  let raw = '';
  const stdinTimeout = setTimeout(() => emitSuccess(), STDIN_READ_TIMEOUT_MS);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN_BYTES) {
      const remaining = MAX_STDIN_BYTES - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      main(raw);
    } catch {
      emitSuccess();
    }
  });
  process.stdin.on('error', () => emitSuccess());
}

module.exports = {
  hasFalseSuccessToken,
  detectCommand,
  findProjectRoot,
  clipOutput,
};
