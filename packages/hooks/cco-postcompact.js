#!/usr/bin/env node
// cco-hook-version: 1.2.0
// PostCompact (COMPACT-04, D-12). Exit 0 always (PostCompact cannot stop the flow).
//
// BINARY CORRECTION (2026-06-13, CC 2.1.177): a real /compact proved the prior design wrong.
// The binary REJECTS `hookSpecificOutput.additionalContext` on PostCompact:
//   "Hook JSON output validation failed — (root): Invalid input"
// Its own schema dump lists additionalContext only under PreToolUse / UserPromptSubmit /
// PostToolUse / PostToolBatch / Stop|SubagentStop — PostCompact is NOT among them. So a
// PostCompact hook cannot inject model-facing context in 2.1.177. `systemMessage` IS a valid
// top-level field (per that same schema dump), so we use it for operator-visible confirmation.
//
// Three responsibilities, all best-effort:
//   1. LOG raw stdin to ~/.claude/compact-snapshots/postcompact-schema.log (drift visibility).
//   2. WRITE the curated resume pointer to a per-session bridge file so a binary-VALID surface
//      (a verified UserPromptSubmit/SessionStart consumer — tracked follow-up) can re-inject it
//      to the model on the next turn. No capability is silently dropped; it is relocated.
//   3. EMIT { systemMessage } — operator sees "compaction fired + resume pointer" at a glance.
//      The hook firing at all confirms a compaction occurred (the 1M-Opus #63627/#65048 signal).
const fs = require("fs");
const os = require("os");
const path = require("path");

let input = "";
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  const snapDir = path.join(os.homedir(), ".claude", "compact-snapshots");
  // 1. Schema log (drift visibility) — best-effort
  try {
    try { fs.mkdirSync(snapDir, { recursive: true }); } catch (e) {}
    fs.appendFileSync(path.join(snapDir, "postcompact-schema.log"), new Date().toISOString() + " " + input + "\n");
  } catch (e) {}

  try {
    let data = {};
    try { data = JSON.parse(input); } catch (e) { data = {}; }
    const trigger = data.trigger || "?";
    const sessionId = typeof data.session_id === "string" ? data.session_id : "";
    const cwd = data.cwd || "";

    // Curated pointer — sourced from STATE.md / latest snapshot, never the (unverified) summary field
    let phase = null, resume = null, focus = null;
    try {
      if (cwd) {
        const statePath = path.join(cwd, ".planning", "STATE.md");
        if (fs.existsSync(statePath)) {
          const st = fs.readFileSync(statePath, "utf8");
          let m;
          if ((m = st.match(/\*\*Current focus:\*\*\s*(.+)/i))) focus = m[1].trim();
          if ((m = st.match(/^Phase:\s*(.+)/im))) phase = m[1].trim();
          if ((m = st.match(/Resume file:\s*(.+)/i))) resume = m[1].trim();
        }
      }
    } catch (e) {}

    // Newest PreCompact snapshot for this session (a full state pointer), if any
    let snap = null;
    try {
      if (sessionId && !/[/\\]|\.\./.test(sessionId)) {
        const mine = fs.readdirSync(snapDir)
          .filter((f) => f.startsWith(`${sessionId}-`) && f.endsWith(".json"))
          .sort();
        if (mine.length) snap = path.join(snapDir, mine[mine.length - 1]);
      }
    } catch (e) {}

    const parts = [`[PostCompact] Compaction fired (trigger: ${trigger}). Critical context a summary may drop:`];
    if (focus) parts.push(`• ${focus}`);
    else if (phase) parts.push(`• Phase: ${phase}`);
    if (resume) parts.push(`• Resume context: ${resume}`);
    if (snap) parts.push(`• Pre-compact snapshot: ${snap}`);
    parts.push(`(auto-compact fires at the 60% override as of CC 2.1.198, verified 2026-07-01; this hook confirms a compaction occurred.)`);
    const message = parts.join("\n");

    // 2. Bridge file for a binary-VALID model-facing consumer (tracked follow-up). One-shot payload.
    try {
      if (sessionId && !/[/\\]|\.\./.test(sessionId)) {
        const bridge = path.join(os.tmpdir(), `claude-postcompact-reinject-${sessionId}.json`);
        fs.writeFileSync(bridge, JSON.stringify({ message, trigger, ts: new Date().toISOString() }), { mode: 0o600 });
      }
    } catch (e) {}

    // 3. Operator-visible confirmation via the binary-VALID `systemMessage` field (NOT additionalContext)
    process.stdout.write(JSON.stringify({ systemMessage: message }));
  } catch (e) {
    // best-effort; never fail the flow
  }
  process.exit(0);
});
