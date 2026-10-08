#!/usr/bin/env node
// cco-hook-version: 1.0.0
// SessionStart (cc-autopilot, PILOT-03 / D-08): record this session's
// {session_id, pane, cwd, pid, ts, source} into a per-session registry file the
// external supervisor reads to map a live session_id -> its tmux pane (%N) with
// no mis-routing. Metadata-ONLY (id/pane/cwd/pid/ts/source, never conversation text) matches cco-log
// hygiene. The hook inherits $TMUX_PANE from the CC process (which runs inside the
// wrapped tmux pane, D-04); when absent (not in tmux — D-11 fallback) it writes
// pane:null and never crashes. SessionStart re-fires on resume/clear/compact, so
// the write is an idempotent UPSERT keyed on session_id (a resume may land in a
// DIFFERENT pane). Per-session file + atomic temp-write-then-rename avoids the
// concurrent-write race of one shared registry file (RESEARCH §5.3, T-19-05).
// Exits 0 on EVERY path — a hook must never block the session.
const fs = require("fs");
const os = require("os");
const path = require("path");

let input = "";
const t = setTimeout(() => process.exit(0), 10000); // pipe-hang guard (#775/#1162)
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;
    if (!sessionId) process.exit(0);
    // reject path traversal in session_id before interpolating it into a filename (T-19-04)
    if (/[/\\]|\.\./.test(sessionId)) process.exit(0);

    // D-11 fallback: pane is null when not inside tmux — never crash. Pane is a %N id.
    const pane = process.env.TMUX_PANE || null;

    // metadata-only record (id/pane/cwd/pid/ts/source, never conversation text)
    const record = {
      session_id: sessionId,
      pane: pane,
      cwd: data.cwd || null,
      pid: process.ppid || null,
      ts: Math.floor(Date.now() / 1000),
      source: data.source || null,
    };

    const dir = path.join(os.homedir(), ".claude", ".autopilot", "registry.d");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}

    // atomic upsert (race-safe, RESEARCH §5.3 / T-19-05): write a pid-scoped temp
    // then rename onto the final per-session file. A same-session resume overwrites
    // its own file -> idempotent upsert keyed on session_id.
    const finalPath = path.join(dir, sessionId + ".json");
    const tmpPath = path.join(dir, sessionId + ".json." + (process.pid || "0") + ".tmp");
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(record));
      fs.renameSync(tmpPath, finalPath);
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (e2) {}
    }
    process.exit(0);
  } catch (e) {
    process.exit(0); // never block the session
  }
});
