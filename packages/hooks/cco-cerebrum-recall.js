#!/usr/bin/env node
// cco-hook-version: 1
// SessionStart cerebrum recall (RECALL-01 / D-05). Reads ~/vault/cerebrum.md, slices the
// ## User Preferences + ## Do-Not-Repeat sections, and injects them ONCE per session into the
// MODEL via additionalContext (binary-valid on SessionStart in 2.1.178 — verified against the
// live Mach-O binary: `hookSpecificOutput.additionalContext (with a hookEventName)`). This is the
// "surface learned prefs + Do-Not-Repeat before relevant actions" the requirement calls for.
//
// D-10 (Phase-4 D-03): the recall text is purely INFORMATIONAL — learned preferences + things not
// to repeat — with ZERO context-pressure / "wrap up / hurry / finish quickly" language. It NEVER
// blocks (SessionStart cannot block a tool anyway). Capped to ~2000 chars so it can't bloat context.
//
// cco-* spine (mirrored EXACTLY): line-2 version marker; `const start`; 5s stdin-timeout -> exit 0;
// V5 session_id traversal guard (`/[/\\]|\.\./`); ~/vault global-fire gate (no-op when absent, since
// the hook fires in EVERY repo); fail-safe `process.exit(0)` on every path. Clean-room (no OpenWolf
// source copied — OpenWolf only reminds Claude to WRITE the cerebrum via stderr; this injects it back).
const fs = require("fs");
const os = require("os");
const path = require("path");

// OBS-01 logger (Plan 01). require()'d defensively so a missing/edited helper can never break the hook.
let logEvent = () => {};
try {
  ({ logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js")));
} catch (e) {}

// Slice the body of a `## <name>` section: everything after the header line up to the next `## `.
// Clean-room helper (interfaces block). Never throws.
function section(md, name) {
  const after = md.split("## " + name)[1];
  if (after == null) return "";
  return after.split("\n## ")[0];
}

// Strip HTML-comment placeholder lines (<!-- ... -->) and blank lines; return the meaningful body
// trimmed, or "" when the section is effectively empty (only placeholders/whitespace).
function meaningful(sectionBody) {
  return sectionBody
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s+|\s+$/g, ""))
    .filter((l) => l && !/^<!--.*-->$/.test(l))
    .join("\n")
    .trim();
}

const start = Date.now();
let input = "";
const t = setTimeout(() => process.exit(0), 5000); // pipe-hang guard (#775/#1162) -> exit 0
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const sid = data.session_id || "";
    if (/[/\\]|\.\./.test(sid)) process.exit(0); // V5 traversal guard -> say nothing

    // GLOBAL-FIRE SAFETY: no-op when the canonical memory is absent (the hook fires in every repo).
    const vault = path.join(os.homedir(), "vault");
    if (!fs.existsSync(vault)) process.exit(0);
    const cerebrumPath = path.join(vault, "cerebrum.md");
    if (!fs.existsSync(cerebrumPath)) process.exit(0); // nothing persisted yet

    let md = "";
    try {
      md = fs.readFileSync(cerebrumPath, "utf8");
    } catch (e) {
      process.exit(0);
    }

    const prefs = meaningful(section(md, "User Preferences"));
    const dnr = meaningful(section(md, "Do-Not-Repeat"));
    if (!prefs && !dnr) process.exit(0); // nothing useful to surface -> stay silent

    // Build the recall message — informational only (D-10), capped to ~2000 chars total.
    const CAP = 2000;
    let msg = "Cross-session memory (cco cerebrum):";
    if (prefs) msg += "\n[Preferences]\n" + prefs;
    if (dnr) msg += "\n[Do-Not-Repeat]\n" + dnr;
    if (msg.length > CAP) msg = msg.slice(0, CAP - 1) + "…"; // ellipsis on truncation

    try {
      logEvent({
        hook: "cco-cerebrum-recall",
        event: "SessionStart",
        sid,
        latency_ms: Date.now() - start,
        decision: "info",
        matched: "SessionStart",
      });
    } catch (e) {}

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg },
      })
    );
    process.exit(0);
  } catch (e) {
    process.exit(0); // FAIL SAFE — inject nothing rather than error
  }
});
