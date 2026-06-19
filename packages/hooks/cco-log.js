#!/usr/bin/env node
// cco-hook-version: 1
// OBS-01 shared event-logging spine. NOT a stdin hook — a require()'d helper every cco-* hook
// calls right before it exits. Its ONLY job is a single fail-safe, metadata-only JSONL append.
//
// CONTRACT (D-07 fail-safe): logEvent() returns nothing and THROWS NOTHING. The entire body is
// wrapped in try/catch that swallows every error — a logging failure can NEVER change a calling
// hook's exit code or wedge the tool loop. The caller owns the cco-* spine (stdin timeout,
// session_id traversal guard, exit 0); cco-log.js owns the never-throw append.
//
// CONTRACT (D-12 metadata-only): logEvent records ONLY {ts, hook, event, sid, latency_ms,
// decision, matched}. It MUST NOT accept or write file CONTENTS, prompt text, tool_input /
// tool_output bodies, or any secret. Callers pass metadata describing the fire, never payloads.
//
// Write target: ~/.claude/cco-memory/hooks/events-<LOCAL-DATE>.jsonl (one line per fire). The
// filename carries the LOCAL calendar date, so date-rotation is implicit and no rotation logic is
// needed. If ~/.claude/cco-memory/ is absent (the global-fire opt-in gate is off), logEvent is a
// silent no-op — it NEVER creates the store from the log path.
const fs = require("fs");
const os = require("os");
const path = require("path");

// LOCAL YYYY-MM-DD (NOT toISOString().slice(0,10), which is UTC and rolls the date early — the
// same bug cco-vault-capture v2 fixed: a write at 22:50 CT is 03:50Z and would land in tomorrow).
function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Append one metadata-only event line. Fail-safe: swallows ALL errors, returns/throws nothing.
function logEvent(rec) {
  try {
    rec = rec || {};
    const root = path.join(os.homedir(), ".claude", "cco-memory");
    // Opt-in gate: do nothing if the store is absent. NEVER create it from here.
    if (!fs.existsSync(root)) return;
    const dir = path.join(root, "hooks");

    // METADATA ONLY — build the line from the fixed field set; ignore anything else the caller
    // passed (so a stray tool_input/content key can never leak into the log). latency_ms keeps an
    // explicit null when unset; matched is omitted when absent (drop-undefined).
    const out = {
      ts: new Date().toISOString(),
      hook: rec.hook,
      event: rec.event,
      sid: rec.sid || "",
      latency_ms: rec.latency_ms == null ? null : rec.latency_ms,
      decision: rec.decision || "none",
      matched: rec.matched == null ? undefined : rec.matched,
    };
    // Drop any key whose value is undefined (e.g. matched, or an unset hook/event).
    for (const k of Object.keys(out)) {
      if (out[k] === undefined) delete out[k];
    }

    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const file = path.join(dir, "events-" + localDate() + ".jsonl");
    fs.appendFileSync(file, JSON.stringify(out) + "\n");
  } catch (e) {
    // Swallow — logging must NEVER change a caller's exit code (D-07). Throw nothing, return nothing.
  }
}

// Convenience wrapper for the common "this hook blocked" case (decision forced to "block").
function logBlocked(rec) {
  try {
    logEvent(Object.assign({}, rec, { decision: "block" }));
  } catch (e) {
    // Swallow — same fail-safe contract.
  }
}

module.exports = { logEvent, logBlocked };
