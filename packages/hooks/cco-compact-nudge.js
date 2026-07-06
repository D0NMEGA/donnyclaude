#!/usr/bin/env node
// cco-hook-version: 2.0.0
// PostToolUse: operator-only (systemMessage) near-ceiling /compact heads-up. Retuned for the
// ride-1M strategy (Phase 4, COMPACT-06 / D-01, D-03, D-04): it fires near the TRUE wall (~80%),
// NOT at 60%, and emits a top-level `systemMessage` (operator-visible only) — it injects ZERO
// model-facing context, so the model never sees a context-pressure / rush signal
// (the v1 60% rush is eliminated). The informational 60% cue is the statusline ┊ marker
// (statusline.py), which is operator-only by nature. Nudge, don't force (PostToolUse cannot
// trigger /compact — binary-confirmed); deduped + re-armed. Reads the RAW bridge written by
// statusline.py ($TMPDIR/claude-ctx-{session_id}.json, C-2). Exits 0 on every path.
const fs = require("fs");
const os = require("os");
const path = require("path");

// ride-1M: operator-only ceiling reminder near the true wall; the 60% ┊ statusline marker is the informational cue (statusline.py).
const THRESHOLD = 80;
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
    // V5: reject path traversal in session_id before using it in any path
    if (/[/\\]|\.\./.test(sessionId)) process.exit(0);

    const tmp = os.tmpdir();
    const metricsPath = path.join(tmp, `claude-ctx-${sessionId}.json`);
    if (!fs.existsSync(metricsPath)) process.exit(0); // fresh session / subagent: no bridge yet

    const m = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    const nowSecs = Math.floor(Date.now() / 1000);
    if (m.timestamp && nowSecs - m.timestamp > 60) process.exit(0); // stale metrics

    // RAW boundary (C-2) — never use a normalized used_pct
    let usedRaw = null;
    if (m.used_pct_raw != null) usedRaw = m.used_pct_raw;
    else if (m.remaining_percentage != null) usedRaw = 100 - m.remaining_percentage;
    if (usedRaw == null) process.exit(0);

    // Dedup + re-arm (D-09) via a flag file
    const flagPath = path.join(tmp, `claude-ctx-${sessionId}-nudged.json`);
    let nudged = false;
    try {
      nudged = JSON.parse(fs.readFileSync(flagPath, "utf8")).nudged === true;
    } catch (e) {
      nudged = false;
    }
    if (usedRaw < THRESHOLD) {
      // dropped below threshold -> re-arm so the next crossing fires again
      try { fs.writeFileSync(flagPath, JSON.stringify({ nudged: false })); } catch (e) {}
      process.exit(0);
    }
    if (nudged) process.exit(0); // fire once per crossing
    try { fs.writeFileSync(flagPath, JSON.stringify({ nudged: true })); } catch (e) {}

    const message =
      `[context] ${Math.round(usedRaw)}% used (>= ${THRESHOLD}%). Operator: native auto-compact ` +
      `fires at the ${THRESHOLD}% override (verified 2026-07-01 on CC 2.1.198, trigger:auto on 1M Opus 4.8). ` +
      `A manual /compact at a clean boundary is optional. This is a heads-up, not a deadline.`;
    // Operator-only channel (D-01/D-03): a top-level systemMessage is the model-invisible surface.
    // The model receives nothing from this hook, so it sees no context-pressure / rush signal.
    process.stdout.write(JSON.stringify({ systemMessage: message }));
    process.exit(0);
  } catch (e) {
    process.exit(0); // never interfere with the tool loop
  }
});
