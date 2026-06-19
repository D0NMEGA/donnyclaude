#!/usr/bin/env node
// cco-hook-version: 1
// SessionStart vault-hygiene nudge. Runs `cco-vault-audit` at most once per 7 days
// (throttled via ~/.cache/cco/vault-audit.json) and, ONLY when it trips an escalation
// threshold (exit 1 = NEEDS ATTENTION), injects a concise informational nudge into the
// MODEL via additionalContext (same binary-valid SessionStart contract as
// cco-cerebrum-recall: hookSpecificOutput.additionalContext + hookEventName).
//
// Informational only (D-10): no context-pressure / "hurry/wrap-up" language; never blocks
// (SessionStart cannot block anyway). Silent when the vault is HEALTHY, absent, or checked
// within the week. Productionizes the Practices/Vault-Audit weekly cadence so rot is caught
// without the operator running the Obsidian GUI plugins (which Claude can't drive).
//
// cco-* spine (mirrored): line-2 version marker; `const start`; 5s stdin-timeout -> exit 0;
// V5 session_id traversal guard; ~/vault global-fire gate (no-op when absent); fail-safe
// process.exit(0) on every path; defensive cco-log.js require.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let logEvent = () => {};
try {
  ({ logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js")));
} catch (e) {}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const start = Date.now();
let input = "";
const t = setTimeout(() => process.exit(0), 5000); // pipe-hang guard (#775/#1162) -> exit 0
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input || "{}");
    const sid = data.session_id || "";
    if (/[/\\]|\.\./.test(sid)) process.exit(0); // V5 traversal guard

    const vault = path.join(os.homedir(), "vault");
    if (!fs.existsSync(vault)) process.exit(0); // global-fire: no-op without the canonical vault

    const auditScript = path.join(os.homedir(), ".claude", "bin", "cco-vault-audit");
    if (!fs.existsSync(auditScript)) process.exit(0);

    // Throttle: run the walk at most once per 7 days (the Vault-Audit weekly cadence).
    const cacheDir = path.join(os.homedir(), ".cache", "cco");
    const cacheFile = path.join(cacheDir, "vault-audit.json");
    try {
      const prev = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (prev && prev.checked && Date.now() - prev.checked < WEEK_MS) process.exit(0);
    } catch (e) {}

    // Read-only audit (JSON). exit 0 healthy / 1 needs-attention / 2 no vault.
    const res = spawnSync("python3", [auditScript, "--json"], { encoding: "utf8", timeout: 8000 });
    const status = res.status;
    let report = null;
    try { report = JSON.parse(res.stdout || "{}"); } catch (e) {}

    try {
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ checked: Date.now(), status }));
    } catch (e) {}

    if (status !== 1 || !report) process.exit(0); // healthy / no-vault / unparseable -> stay silent

    // Concise informational nudge — only the non-zero contributing factors.
    const parts = [];
    const orphans = (report.curated_orphans || []).length;
    const nbroken = Object.values(report.broken_links || {}).reduce((a, v) => a + v.length, 0);
    const miss = Object.keys(report.curated_missing || {}).length;
    if (orphans) parts.push(`${orphans} curated orphan(s)`);
    if (nbroken) parts.push(`${nbroken} broken link(s)`);
    if (miss) parts.push(`${miss}/${report.n_curated} curated notes missing frontmatter`);
    if (!parts.length) process.exit(0);

    const msg =
      "Vault hygiene (weekly cco-vault-audit): NEEDS ATTENTION — " + parts.join(", ") +
      ". Run `cco-vault-audit` for the list, or do a cleanup pass (promote durable session " +
      "notes into curated Projects/Reference notes, then prune).";

    try {
      logEvent({
        hook: "cco-vault-audit-nudge",
        event: "SessionStart",
        sid,
        latency_ms: Date.now() - start,
        decision: "info",
        matched: "needs-attention",
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
