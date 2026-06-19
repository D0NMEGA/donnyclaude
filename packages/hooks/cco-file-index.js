#!/usr/bin/env node
// cco-hook-version: 1
// PreToolUse(Read): anatomy lookup (CTX-01) + per-session repeat-read guard (CTX-02). Both surface
// to the MODEL via additionalContext (D-01/D-03: useful pre-read info, NEVER context-pressure /
// "hurry" language). WARN-ONLY — it never emits permissionDecision:"deny" and never blocks a Read
// (the hard-block remains an OFF-by-default toggle built elsewhere). Fail-safe exit 0 on EVERY path.
// Global-fire opt-in: no-ops instantly unless ~/.claude/cco-memory/ exists, so it adds nothing in
// non-harness repos. Clean-room from 05-RESEARCH.md's skeleton — no OpenWolf source copied.
const fs = require("fs");
const os = require("os");
const path = require("path");

const start = Date.now();
let input = "";
const t = setTimeout(() => process.exit(0), 5000); // pipe-hang guard (#775/#1162)
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));

// anatomy entry regex (EXACT, from the interfaces block): section `^## (.+)$`; entry captures
// file, optional description, token count. Em-dash, tilde, literal ` tok)`.
const ENTRY_RE = /^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/;
const SECTION_RE = /^## (.+)$/;

// Look up `norm` (a forward-slash path) in anatomy.md. Returns {desc, tokens} for the entry whose
// "<section>/<basename>" best suffix-matches the read path, or null. Best = longest matching suffix
// (so a/b/c.ts beats c.ts when both are present). Never throws.
function lookupAnatomy(anatomyPath, norm) {
  let text;
  try {
    text = fs.readFileSync(anatomyPath, "utf8");
  } catch (e) {
    return null;
  }
  const base = norm.split("/").pop();
  let section = "";
  let best = null;
  let bestLen = -1;
  for (const raw of text.split(/\r?\n/)) {
    const sm = SECTION_RE.exec(raw);
    if (sm) {
      section = sm[1].trim();
      continue;
    }
    const em = ENTRY_RE.exec(raw);
    if (!em) continue;
    if (em[1] !== base) continue; // basename must match
    // Build the entry's logical path: "<section>/<file>" (section "." or "" => just the file).
    let entryPath = em[1];
    if (section && section !== ".") entryPath = section.replace(/\/+$/, "") + "/" + em[1];
    const suffix = "/" + entryPath;
    // Match when the read path ends with the entry path (suffix match, on a path boundary).
    const matches = norm === entryPath || norm.endsWith(suffix);
    // A bare-basename entry (no section) always matches on basename as a weak fallback.
    const weak = !section || section === ".";
    if (matches || weak) {
      const score = matches ? entryPath.length : 0;
      if (score > bestLen) {
        bestLen = score;
        best = { desc: em[2] || "", tokens: parseInt(em[3], 10) || 0 };
      }
    }
  }
  return best;
}

process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const sid = data.session_id || "";
    if (/[/\\]|\.\./.test(sid)) process.exit(0); // V5 traversal guard — before any path use

    const root = path.join(os.homedir(), ".claude", "cco-memory");
    if (!fs.existsSync(root)) process.exit(0); // global-fire opt-in: no-op unless the store exists

    const ti = data.tool_input || {};
    const fp = ti.file_path || ti.path || "";
    if (!fp) process.exit(0);
    const norm = String(fp).replace(/\\/g, "/");

    // Per-session read state, KEYED BY session_id (Pitfall 3: never cross sessions).
    const sf = path.join(root, "hooks", `_session-${sid || "nosess"}.json`);
    let st = { files_read: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(sf, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.files_read) st = parsed;
    } catch (e) {
      /* miss or corrupt -> fresh state */
    }
    if (!st.files_read || typeof st.files_read !== "object") st.files_read = {};

    let msg = null;
    const base = norm.split("/").pop();

    if (st.files_read[norm]) {
      // CTX-02 repeat-read (D-03 WARN — useful, never pressure, never block).
      const prev = st.files_read[norm];
      const n = prev.tokens || 0;
      msg = `Already read ${base} this session (~${n} tok). Reuse existing knowledge unless it changed.`;
      prev.count = (prev.count || 1) + 1;
    } else {
      // CTX-01 first-read anatomy lookup.
      const hit = lookupAnatomy(path.join(root, "anatomy.md"), norm);
      if (hit) {
        const descPart = hit.desc ? `${hit.desc} ` : "";
        msg = `${base} — ${descPart}(~${hit.tokens} tok).`;
      }
      st.files_read[norm] = { count: 1, tokens: hit ? hit.tokens : 0 };
    }

    // Persist state — each fs op wrapped so a write failure can never change the exit.
    try {
      fs.mkdirSync(path.dirname(sf), { recursive: true });
      fs.writeFileSync(sf, JSON.stringify(st));
    } catch (e) {}

    // OBS-01: one metadata-only event line. The require itself is in try/catch so a missing helper
    // can never break the hook (fail-safe contract).
    try {
      const { logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js"));
      logEvent({
        hook: "cco-file-index",
        event: "PreToolUse",
        sid,
        latency_ms: Date.now() - start,
        decision: msg ? "info" : "none",
        matched: "Read",
      });
    } catch (e) {}

    // Model channel (Pitfall 1: stderr would only reach the operator). WARN-ONLY — no
    // permissionDecision, so the Read always proceeds.
    if (msg) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
        })
      );
    }
    process.exit(0);
  } catch (e) {
    process.exit(0); // FAIL SAFE — never wedge a Read
  }
});
