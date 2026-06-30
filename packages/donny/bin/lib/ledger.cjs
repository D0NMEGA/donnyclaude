'use strict';
// Donny action ledger: an append-only JSONL trail of orchestration actions, written as
// NN-LEDGER.jsonl alongside the phase SUMMARY.md. The machine-readable companion to the
// human SUMMARY -- so an autonomous run leaves a structured, greppable record of what it did.
//
// Pattern copied from cco-dream-log (the contracts, not the language; the engine is Node CJS):
//   - append-only: rows are appended, never truncated or rewritten.
//   - fixed, auditable schema: a row carries ONLY whitelisted keys; stray keys are dropped, so a
//     payload can never be smuggled into the log.
//   - short metadata only: free-text fields are truncated; they are SHORT notes, never file
//     contents, diffs, command output, or secrets.
//   - fail-safe: every filesystem touch is wrapped. A ledger failure NEVER crashes the caller
//     (append returns false; reads return []). A workflow's ledger call cannot break the workflow.
//   - timestamped (ISO) and versioned.

const fs = require('fs');
const path = require('path');

const LEDGER_VERSION = 1;
// Free-text cap: these are short orchestration notes, not payloads.
const TEXT_CAP = 200;
// The columns a caller may fill, beyond the always-stamped ts / v / phase. Declared once so the
// row shape stays auditable; anything outside this set is dropped by buildRow.
const FIELDS = ['plan', 'event', 'task', 'ref', 'status', 'detail'];

function truncate(val) {
  const s = String(val);
  return s.length > TEXT_CAP ? s.slice(0, TEXT_CAP) : s;
}

// Build ONE row carrying exactly the whitelisted keys, stamped and truncated. Unknown keys dropped.
function buildRow(phase, fields) {
  const row = { ts: new Date().toISOString(), v: LEDGER_VERSION, phase: String(phase) };
  for (const k of FIELDS) {
    const val = fields[k];
    if (val != null && val !== '') row[k] = truncate(val);
  }
  return row;
}

// Resolve NN-LEDGER.jsonl next to the phase SUMMARY. Returns an absolute path, or null if the
// phase directory cannot be found. The NN prefix is derived via the canonical normalizePhaseName
// (the same function init.cjs uses to name NN-SUMMARY.md), so the ledger always matches its sibling
// SUMMARY in every naming mode: 05, 12.1, 12A, CK-05, and custom IDs.
function resolveLedgerPath(cwd, phase) {
  const { findPhaseInternal, normalizePhaseName } = require('./core.cjs');
  const found = findPhaseInternal(cwd, phase);
  if (!found || !found.directory) return null;
  const padded = normalizePhaseName(found.phase_number || phase);
  return path.join(cwd, found.directory, `${padded}-LEDGER.jsonl`);
}

// Append one row. Fail-safe: any error yields false, never throws.
function appendRow(file, row) {
  try {
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
    return true;
  } catch {
    return false;
  }
}

// Read the last n rows (parsed), skipping malformed lines. Fail-safe: yields [] on any error.
function tailRows(file, n) {
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const rows = [];
    for (const line of lines.slice(-n)) {
      try { rows.push(JSON.parse(line)); } catch { /* skip a malformed line, keep the rest */ }
    }
    return rows;
  } catch {
    return [];
  }
}

// Parse `--key value` pairs (a bare `--flag` becomes "true"). Used by the append subcommand so the
// workflows can pass fields without constructing JSON on the command line.
function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      out[key] = (next !== undefined && !next.startsWith('--')) ? args[++i] : 'true';
    }
  }
  return out;
}

// CLI: ledger <append|tail|path> <phase> [...]
//   append <phase> <event> [--plan P] [--task T] [--ref R] [--status S] [--detail D]
//   tail   <phase> [n]
//   path   <phase>
function cmdLedger(cwd, args, raw) {
  const { output, error } = require('./core.cjs');
  const sub = args[0];
  const phase = args[1];

  if (sub === 'append') {
    if (!phase) error('Usage: ledger append <phase> <event> [--plan P] [--task T] [--ref R] [--status S] [--detail D]');
    // Positional event (args[2]) unless it is itself a flag.
    const positionalEvent = (args[2] && !args[2].startsWith('--')) ? args[2] : undefined;
    const flags = parseFlags(args.slice(positionalEvent ? 3 : 2));
    if (positionalEvent && !flags.event) flags.event = positionalEvent;
    // Fail-safe: a missing phase dir or a write error must not break the caller -> exit 0.
    const file = resolveLedgerPath(cwd, phase);
    if (!file) { output({ appended: false, reason: 'phase_not_found', phase }, raw); return; }
    const row = buildRow(phase, flags);
    output({ appended: appendRow(file, row), path: file, row }, raw);
    return;
  }

  if (sub === 'tail') {
    if (!phase) error('Usage: ledger tail <phase> [n]');
    const file = resolveLedgerPath(cwd, phase);
    if (!file) error(`Phase not found: ${phase}`);
    const n = parseInt(args[2], 10) || 20;
    output({ path: file, rows: tailRows(file, n) }, raw);
    return;
  }

  if (sub === 'path') {
    if (!phase) error('Usage: ledger path <phase>');
    const file = resolveLedgerPath(cwd, phase);
    if (!file) error(`Phase not found: ${phase}`);
    output({ path: file }, raw);
    return;
  }

  error('Usage: ledger <append|tail|path> <phase> [...]');
}

module.exports = { LEDGER_VERSION, TEXT_CAP, FIELDS, buildRow, resolveLedgerPath, appendRow, tailRows, parseFlags, cmdLedger };
