#!/usr/bin/env node
// cco-hook-version: 1.0.0
// PreCompact: snapshot curated critical state BEFORE compaction so context can be recovered
// (COMPACT-03 / D-11). MUST exit 0 on every path — a non-zero exit would stop compaction,
// which we never want (DoS-on-self). Writes user-only (0o600) under ~/.claude/compact-snapshots.
const fs = require("fs");
const os = require("os");
const path = require("path");

const RETAIN = 20;
let input = "";
const t = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    let data = {};
    try { data = JSON.parse(input); } catch (e) { data = {}; }
    const sessionId = data.session_id || "";
    // V5: reject empty / traversal session_id before using it in a path
    if (!sessionId || /[/\\]|\.\./.test(sessionId)) process.exit(0);

    const snapDir = path.join(os.homedir(), ".claude", "compact-snapshots");
    try { fs.mkdirSync(snapDir, { recursive: true }); } catch (e) {}

    const cwd = data.cwd || "";
    // Curated pointers only (never arbitrary input): best-effort read of STATE.md
    let stateResume = null, currentPhase = null;
    try {
      if (cwd) {
        const statePath = path.join(cwd, ".planning", "STATE.md");
        if (fs.existsSync(statePath)) {
          const st = fs.readFileSync(statePath, "utf8");
          const rm = st.match(/Resume file:\s*(.+)/i);
          if (rm) stateResume = rm[1].trim();
          const ph = st.match(/Phase:\s*(.+)/i);
          if (ph) currentPhase = ph[1].trim();
        }
      }
    } catch (e) {}

    // Best-effort bridge metrics (known file only)
    let bridge = null;
    try {
      const bp = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
      if (fs.existsSync(bp)) bridge = JSON.parse(fs.readFileSync(bp, "utf8"));
    } catch (e) {}

    const snapshot = {
      session_id: sessionId,
      trigger: data.trigger || null, // fires on both "manual" and "auto"
      timestamp: new Date().toISOString(),
      transcript_path: data.transcript_path || null, // stored as a pointer string only (never a write path)
      cwd: cwd || null,
      planning: { state_resume: stateResume, current_phase: currentPhase },
      bridge: bridge,
    };

    const snapPath = path.join(snapDir, `${sessionId}-${Date.now()}.json`);
    try {
      fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      fs.chmodSync(snapPath, 0o600); // V12: guarantee user-only regardless of umask
    } catch (e) {}

    // Retention: keep the newest RETAIN snapshots for this session
    try {
      const mine = fs.readdirSync(snapDir)
        .filter((f) => f.startsWith(`${sessionId}-`) && f.endsWith(".json"))
        .sort();
      if (mine.length > RETAIN) {
        for (const f of mine.slice(0, mine.length - RETAIN)) {
          try { fs.unlinkSync(path.join(snapDir, f)); } catch (e) {}
        }
      }
    } catch (e) {}

    process.exit(0);
  } catch (e) {
    process.exit(0); // never stop compaction
  }
});
