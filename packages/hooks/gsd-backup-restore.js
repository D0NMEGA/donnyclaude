#!/usr/bin/env node
// gsd-hook-version: 1.33.0-ws3
// SessionStart Backup Restore Hook
//
// Pairs with gsd-pre-compact-backup.js. Reads .claude/backups/, finds the
// most recent backup directory (ISO-8601 filesystem-safe timestamps sort
// lexicographically), loads its state.json, and injects an advisory
// additionalContext summary so Claude is aware of a recoverable backup.
//
// Design decisions (DEEP-RESEARCH.md section 6 rec #3):
//   - Advisory injection only. No auto-restore. Claude decides whether to
//     actually read the backup file.
//   - Emit the absolute path so Claude can read it with a single Read call.
//   - Missing directory and malformed state.json are non-fatal: emit an
//     empty hook payload and exit 0. Never block session start.

const fs = require('fs');
const path = require('path');

const STDIN_TIMEOUT_MS = 10000;
const MAX_FILES_IN_SUMMARY = 10;

function findMostRecentBackup(cwd) {
  const backupsDir = path.join(cwd, '.claude', 'backups');
  try {
    if (!fs.existsSync(backupsDir)) {
      return null;
    }
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      // Keep only entries that look like our timestamp format.
      // Example: 2026-04-22T19-30-45Z
      .filter(n => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(n))
      .sort();
    if (dirs.length === 0) {
      return null;
    }
    const latest = dirs[dirs.length - 1];
    return path.join(backupsDir, latest);
  } catch {
    return null;
  }
}

function loadState(backupDir) {
  if (!backupDir) return null;
  const statePath = path.join(backupDir, 'state.json');
  try {
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { statePath, state: parsed };
  } catch {
    return null;
  }
}

function formatSummary(statePath, state) {
  const capturedAt = state.captured_at_utc || 'unknown time';
  const task = state.current_task
    ? state.current_task.replace(/\s+/g, ' ').trim().slice(0, 200)
    : '(no task text captured)';
  const files = Array.isArray(state.open_file_paths) ? state.open_file_paths : [];
  const displayedFiles = files.slice(0, MAX_FILES_IN_SUMMARY);
  const filesSuffix = files.length > MAX_FILES_IN_SUMMARY
    ? ` (and ${files.length - MAX_FILES_IN_SUMMARY} more)`
    : '';
  const filesStr = displayedFiles.length > 0
    ? `[${displayedFiles.join(', ')}]${filesSuffix}`
    : '[none]';
  return (
    `Most recent PreCompact backup captured at ${capturedAt}. ` +
    `Current task: ${task}. ` +
    `Open files: ${filesStr}. ` +
    `Use /restore or read ${statePath} for full state.`
  );
}

function emitEmpty() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: '',
    },
  }));
}

let stdinBuf = '';
const timer = setTimeout(() => { emitEmpty(); process.exit(0); }, STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { stdinBuf += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    let input = {};
    if (stdinBuf) {
      try { input = JSON.parse(stdinBuf); } catch { input = {}; }
    }
    const cwd = input.cwd || process.cwd();
    const backupDir = findMostRecentBackup(cwd);
    const loaded = loadState(backupDir);
    if (!loaded) {
      emitEmpty();
      process.exit(0);
      return;
    }
    const summary = formatSummary(loaded.statePath, loaded.state);
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: summary,
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (e) {
    process.stderr.write(`[gsd-backup-restore] IO failure (fail-open): ${e.message}\n`);
    emitEmpty();
    process.exit(0);
  }
});

module.exports = {
  findMostRecentBackup,
  loadState,
  formatSummary,
  MAX_FILES_IN_SUMMARY,
};
