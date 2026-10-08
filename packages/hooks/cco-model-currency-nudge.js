#!/usr/bin/env node
// cco-hook-version: 1
// SessionStart model-currency nudge. Model aliases (opus/sonnet/haiku) track the provider's
// *recommended* version, which lags the newest release; the harness pins lagging tiers to the
// newest ID via ANTHROPIC_DEFAULT_*_MODEL in ~/.zshenv. A static pin FREEZES, so this tripwire
// injects a concise informational nudge when the last currency verification is >30 days old,
// prompting a re-check (BUMP a pin when a newer model ships, DROP a pin once the bare alias
// catches up). Keyed on elapsed time, not `claude --version` (not on the hook PATH); model
// releases are ~quarterly, so a 30d cadence catches a new tier within weeks.
//
// State: ~/.claude/state/cco-model-currency.json  {last_verified, newest{}, pins{}, notes}.
// Re-stamp after a verification with:  node <thisfile> record
//
// Informational only (D-10): no context-pressure / urgency language; never blocks (SessionStart
// cannot block anyway). Silent when fresh (<30d) or when the model DISABLE flag is set.
//
// cco-* spine (mirrored from cco-vault-audit-nudge): line-2 version marker; `const start`;
// 5s stdin-timeout -> exit 0; V5 session_id traversal guard; fail-safe process.exit(0) on every
// path; defensive cco-log.js require; SessionStart additionalContext + hookEventName contract.
const fs = require("fs");
const os = require("os");
const path = require("path");

let logEvent = () => {};
try {
  ({ logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js")));
} catch (e) {}

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_MS = 30 * DAY_MS;
const STATE = path.join(os.homedir(), ".claude", "state", "cco-model-currency.json");
const start = Date.now();

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch (e) {
    return null;
  }
}

// ── `record` CLI mode: re-stamp last_verified=now, preserving newest/pins/notes ──
if (process.argv[2] === "record") {
  const prev = readState() || {};
  prev.last_verified = Date.now();
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(prev, null, 2) + "\n");
    process.stdout.write("cco-model-currency: stamped last_verified=" + new Date(prev.last_verified).toISOString() + "\n");
  } catch (e) {
    process.stderr.write("cco-model-currency: failed to write state: " + e.message + "\n");
    process.exit(1);
  }
  process.exit(0);
}

// ── SessionStart hook mode ──
let input = "";
const t = setTimeout(() => process.exit(0), 5000); // pipe-hang guard (#775/#1162) -> exit 0
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    if (process.env.CCO_MODEL_CURRENCY_DISABLE === "1") process.exit(0);

    const data = JSON.parse(input || "{}");
    const sid = data.session_id || "";
    if (/[/\\]|\.\./.test(sid)) process.exit(0); // V5 traversal guard

    const state = readState();
    // Missing/unreadable state -> nudge to seed it (verify + record); fresh state -> silent.
    const last = state && typeof state.last_verified === "number" ? state.last_verified : 0;
    const age = Date.now() - last;
    if (age < DUE_MS) process.exit(0);

    const days = last ? Math.floor(age / DAY_MS) : null;
    const newest = (state && state.newest) || {};
    const when = last
      ? `last verified ${days}d ago`
      : "no verification on record";
    const seen = Object.keys(newest).length
      ? " Last-known newest: " +
        ["fable", "opus", "sonnet", "haiku"]
          .filter((k) => newest[k])
          .map((k) => `${k} ${newest[k]}`)
          .join(", ") + "."
      : "";

    const msg =
      "Model currency re-check due (" + when + "). Aliases lag the newest release, so the " +
      "harness pins lagging tiers in ~/.zshenv (ANTHROPIC_DEFAULT_*_MODEL)." + seen +
      " Re-verify fable/opus/sonnet/haiku alias-vs-newest against the current model lineup: BUMP a " +
      "pin if a newer model shipped, DROP a pin once its bare alias has caught up (so the tier " +
      "auto-tracks again). Then run `node ~/.claude/hooks/cco-model-currency-nudge.js record` " +
      "to re-stamp. Set CCO_MODEL_CURRENCY_DISABLE=1 to silence.";

    try {
      logEvent({
        hook: "cco-model-currency-nudge",
        event: "SessionStart",
        sid,
        latency_ms: Date.now() - start,
        decision: "info",
        matched: last ? "overdue" : "unseeded",
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
