#!/usr/bin/env node
// gsd-hook-version: 1.33.0-ws3
// PreCompact Active Backup Hook
//
// Upgrades PreCompact from passive observation to active backup. Serializes
// critical session state to a time-stamped directory so SessionStart can
// surface recovery hints after lossy compaction.
//
// Evidence base: DEEP-RESEARCH.md section 6 rec #3 (claudefa.st PreCompact
// backup pattern). Morph LLM: "By the time compaction triggers, the damage
// is done." Backup captures current task, open files, recent tool calls,
// and test status before summarization strips them.
//
// Backup layout:
//   <cwd>/.claude/backups/<ISO-8601-UTC-filesystem-safe>/state.json
//
// Filesystem-safe ISO-8601: colons replaced with hyphens. Example:
//   2026-04-22T19-30-45Z
// Lexicographic sort of these names is chronological, so SessionStart can
// pick the most recent with a simple sort-descending.
//
// Fail-open: always exit 0. Never block compaction on IO errors.

const fs = require('fs');
const path = require('path');

const BACKUP_VERSION = 1;
const MAX_TOOL_CALLS = 20;
const MAX_TRANSCRIPT_BYTES = 50 * 1024;
const MAX_TASK_CHARS = 500;
const STDIN_TIMEOUT_MS = 10000;

function safeIsoTimestamp(date) {
  // 2026-04-22T19:30:45.123Z -> 2026-04-22T19-30-45Z
  const iso = date.toISOString();
  const trimmed = iso.replace(/\.\d{3}Z$/, 'Z');
  return trimmed.replace(/:/g, '-');
}

function readTranscriptTail(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') {
    return null;
  }
  try {
    if (!fs.existsSync(transcriptPath)) {
      return null;
    }
    const stat = fs.statSync(transcriptPath);
    const size = stat.size;
    const start = Math.max(0, size - MAX_TRANSCRIPT_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function parseTranscriptLines(tailText) {
  if (!tailText) return [];
  const lines = tailText.split('\n');
  // Drop the first line if we read mid-line (non-JSON fragment).
  const start = (tailText.length >= MAX_TRANSCRIPT_BYTES) ? 1 : 0;
  const parsed = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return parsed;
}

function extractCurrentTask(entries) {
  // Walk entries in reverse; pull the most recent user or assistant text.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const role = e && e.message && e.message.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = e.message.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
          text += (text ? ' ' : '') + block.text;
        }
      }
    }
    if (text.trim()) {
      return text.slice(0, MAX_TASK_CHARS);
    }
  }
  return null;
}

function extractToolCalls(entries) {
  const calls = [];
  for (const e of entries) {
    if (!e || !e.message || e.message.role !== 'assistant') continue;
    const content = e.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const name = typeof block.name === 'string' ? block.name : 'unknown';
      const input = block.input || {};
      let inputSummary = '';
      if (typeof input.file_path === 'string') {
        inputSummary = input.file_path;
      } else if (typeof input.command === 'string') {
        inputSummary = input.command.slice(0, 120);
      } else if (typeof input.pattern === 'string') {
        inputSummary = input.pattern.slice(0, 120);
      } else {
        try {
          inputSummary = JSON.stringify(input).slice(0, 120);
        } catch {
          inputSummary = '';
        }
      }
      calls.push({
        name,
        input_summary: inputSummary,
        timestamp: typeof e.timestamp === 'string' ? e.timestamp : null,
      });
    }
  }
  return calls.slice(-MAX_TOOL_CALLS);
}

function extractOpenFilePaths(toolCalls) {
  const seen = new Set();
  const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  for (const c of toolCalls) {
    if (!FILE_TOOLS.has(c.name)) continue;
    if (c.input_summary && !c.input_summary.startsWith('{')) {
      seen.add(c.input_summary);
    }
  }
  return Array.from(seen);
}

function readTestStatus(cwd) {
  const candidates = ['.last-test-status', '.test-results.json'];
  for (const name of candidates) {
    const p = path.join(cwd, name);
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        if (name.endsWith('.json')) {
          try {
            return JSON.parse(raw);
          } catch {
            return { raw_text: raw.slice(0, 2000) };
          }
        }
        return { raw_text: raw.slice(0, 2000) };
      }
    } catch {
      // continue
    }
  }
  return null;
}

function buildState(input, entries, cwd) {
  const toolCalls = extractToolCalls(entries);
  return {
    backup_version: BACKUP_VERSION,
    captured_at_utc: new Date().toISOString(),
    session_id: input.session_id || null,
    current_task: extractCurrentTask(entries),
    open_file_paths: extractOpenFilePaths(toolCalls),
    recent_test_status: readTestStatus(cwd),
    last_20_tool_calls: toolCalls,
    working_directory: cwd,
  };
}

function writeBackup(cwd, state) {
  const stamp = safeIsoTimestamp(new Date());
  const dir = path.join(cwd, '.claude', 'backups', stamp);
  // fs.mkdirSync with recursive handles parallel mkdir races across
  // concurrent PreCompact invocations (different timestamps collide only
  // at sub-second granularity; mkdirSync recursive is idempotent).
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'state.json');
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return filePath;
}

let stdinBuf = '';
const timer = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { stdinBuf += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    const input = stdinBuf ? JSON.parse(stdinBuf) : {};
    const cwd = input.cwd || process.cwd();
    const tail = readTranscriptTail(input.transcript_path);
    const entries = parseTranscriptLines(tail);
    const state = buildState(input, entries, cwd);
    const backupPath = writeBackup(cwd, state);
    // Advisory additionalContext so Claude can reference the backup if it
    // wishes. Non-blocking.
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: `PreCompact backup written to ${backupPath}. ` +
          'If post-compaction context feels incomplete, read this file to recover ' +
          'the pre-compaction task, open files, and last 20 tool calls.',
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (e) {
    process.stderr.write(`[gsd-pre-compact-backup] IO failure (fail-open): ${e.message}\n`);
    process.exit(0);
  }
});

module.exports = {
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
};
