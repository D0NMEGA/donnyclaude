#!/usr/bin/env node
// cco-hook-version: 1.0.0
// SessionEnd (cc-autopilot, PILOT-03 / D-08): remove this session's registry entry
// so the supervisor stops considering it live. SessionEnd has no decision control
// (side-effect only — fine for cleanup). A crash / kill -9 may emit NO SessionEnd,
// so the daemon does NOT trust this for liveness (it reconciles against tmux +
// bridge freshness, D-10) — this is best-effort cleanup of the per-session file.
// Metadata-only; exits 0 on EVERY path; mirrors the cco-compact-nudge.js guard.
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

    const dir = path.join(os.homedir(), ".claude", ".autopilot", "registry.d");
    try {
      fs.unlinkSync(path.join(dir, sessionId + ".json"));
    } catch (e) {}
    process.exit(0);
  } catch (e) {
    process.exit(0); // never block the session
  }
});
