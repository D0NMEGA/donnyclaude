#!/usr/bin/env node
// cco-hook-version: 1.0.0
// StopFailure (cc-autopilot, PILOT-08 / D-01): on a rate_limit turn-end, record a
// metadata-only limit marker the external supervisor reads to detect + resume.
// Registered with matcher rate_limit. The reset time is NOT in this payload
// (last_assistant_message is the API error string) - the daemon capture-panes the
// owning pane for the reset banner. Exits 0 on EVERY path; never blocks the session.
//
// The marker record is metadata-ONLY (session_id/error/error_details/
// last_assistant_message/pane/cwd/ts - never conversation text) and matches the shape
// the Wave-0 conftest write_limit_marker fixture emits, so the daemon reader (21-05)
// parses it unchanged. Per-session file + atomic temp-write-then-rename is a race-safe
// upsert keyed on session_id. Source stays ASCII-only (no em-dashes / glyphs) so
// BSD-grep never mis-classes the file binary (standing macOS grep gotcha).
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
    const d = JSON.parse(input);
    const sid = d.session_id;
    if (!sid) process.exit(0);
    // reject path traversal in session_id before interpolating it into a filename (T-21-08)
    if (/[/\\]|\.\./.test(sid)) process.exit(0);

    // metadata-only record (matches conftest write_limit_marker; never conversation text).
    // The reset time is not here - last_assistant_message is the API error string; the
    // daemon capture-panes the owning pane (from TMUX_PANE) for the reset banner.
    const rec = {
      session_id: sid,
      error: d.error || null, // "rate_limit"
      error_details: d.error_details || null,
      last_assistant_message: d.last_assistant_message || null, // "API Error: Rate limit reached"
      pane: process.env.TMUX_PANE || null, // %N inside the wrapped tmux pane, null otherwise
      cwd: d.cwd || null,
      ts: Math.floor(Date.now() / 1000),
    };

    const dir = path.join(os.homedir(), ".claude", ".autopilot", "limits.d");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}

    // atomic upsert (race-safe): write a pid-scoped temp then rename onto the final
    // per-session file, unlinking the temp on write failure - identical to the register hook.
    const finalPath = path.join(dir, sid + ".json");
    const tmpPath = path.join(dir, sid + ".json." + (process.pid || "0") + ".tmp");
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(rec));
      fs.renameSync(tmpPath, finalPath);
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (e2) {}
    }
    process.exit(0);
  } catch (e) {
    process.exit(0); // never block the session
  }
});
