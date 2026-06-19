#!/usr/bin/env node
// cco-hook-version: 1
// PreToolUse(Write|Edit) cerebrum pre-write check (RECALL-01 / D-06). Slices ~/vault/cerebrum.md's
// ## Do-Not-Repeat section, extracts patterns from each entry line, and if the about-to-be-written
// content matches one, WARNS the MODEL via additionalContext ("Do-Not-Repeat match — <entry>. Verify
// before writing.") so it can self-correct. It NEVER blocks the write and NEVER emits
// permissionDecision:"deny" — warn-only by design (D-06/D-10): a Do-Not-Repeat list is a heuristic
// reminder, not policy, and a hard deny would wedge legitimate edits. The write always proceeds.
//
// D-10 (Phase-4 D-03): the warning is CORRECTIVE + INFORMATIONAL — never context-pressure / "hurry"
// language. Pattern extraction (clean-room from OpenWolf's checkCerebrum, no source copied):
//   per entry line, capture backtick spans /`([^`]+)`/g and double-quoted spans /"([^"]+)"/g,
//   PLUS the X in /(?:never use|avoid|don't use|do not use)\s+([^\s,.;]+)/ig.
//   Each extracted token (length >= 3, to avoid matching everything — T-05-16) is tested against the
//   write content with a word-boundary, case-insensitive regex; the FIRST match warns once.
//
// cco-* spine (mirrored EXACTLY): line-2 version marker; `const start`; 5s stdin-timeout -> exit 0;
// V5 session_id traversal guard (`/[/\\]|\.\./`); ~/vault global-fire gate (no-op when absent, since
// the hook fires in EVERY repo); fail-safe `process.exit(0)` on every path.
const fs = require("fs");
const os = require("os");
const path = require("path");

// OBS-01 logger (Plan 01). require()'d defensively so a missing/edited helper can never break the hook.
let logEvent = () => {};
try {
  ({ logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js")));
} catch (e) {}

// Slice the body of a `## <name>` section: everything after the header line up to the next `## `.
function section(md, name) {
  const after = md.split("## " + name)[1];
  if (after == null) return "";
  return after.split("\n## ")[0];
}

// Escape a string for safe use inside a RegExp.
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Extract candidate tokens from a single Do-Not-Repeat entry line (clean-room).
function extractTokens(line) {
  const out = [];
  let m;
  const bt = /`([^`]+)`/g; // backtick spans
  while ((m = bt.exec(line)) !== null) out.push(m[1]);
  const dq = /"([^"]+)"/g; // double-quoted spans
  while ((m = dq.exec(line)) !== null) out.push(m[1]);
  const ph = /(?:never use|avoid|don't use|do not use)\s+([^\s,.;]+)/gi; // "never use X" phrasing
  while ((m = ph.exec(line)) !== null) out.push(m[1]);
  // Normalize: trim, require length >= 3 (avoid noise that matches everything — T-05-16), dedup.
  const seen = new Set();
  const toks = [];
  for (let tok of out) {
    tok = String(tok).trim();
    if (tok.length >= 3 && !seen.has(tok.toLowerCase())) {
      seen.add(tok.toLowerCase());
      toks.push(tok);
    }
  }
  return toks;
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
    if (!fs.existsSync(cerebrumPath)) process.exit(0);

    // Build the about-to-be-written content from Write (content) + Edit (old_string/new_string).
    const ti = data.tool_input || {};
    const content = [ti.content, ti.old_string, ti.new_string]
      .filter((x) => typeof x === "string")
      .join("\n");
    if (!content) process.exit(0); // nothing to scan -> silent

    let md = "";
    try {
      md = fs.readFileSync(cerebrumPath, "utf8");
    } catch (e) {
      process.exit(0);
    }

    const dnrBody = section(md, "Do-Not-Repeat");
    if (!dnrBody.trim()) process.exit(0); // empty section -> nothing to match

    // Scan each entry line for a matching token; warn on the FIRST hit.
    let warned = null; // { entry, token }
    for (const raw of dnrBody.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^<!--.*-->$/.test(line)) continue; // skip placeholders/blank
      const toks = extractTokens(line);
      for (const tok of toks) {
        const re = new RegExp("\\b" + escapeRe(tok) + "\\b", "i"); // word-boundary, case-insensitive
        if (re.test(content)) {
          // Strip a leading "- " bullet for a cleaner message.
          warned = { entry: line.replace(/^-\s*/, ""), token: tok };
          break;
        }
      }
      if (warned) break;
    }

    try {
      logEvent({
        hook: "cco-cerebrum-check",
        event: "PreToolUse",
        sid,
        latency_ms: Date.now() - start,
        decision: warned ? "warn" : "none",
        matched: "Write|Edit",
      });
    } catch (e) {}

    if (warned) {
      // WARN-ONLY (D-06/D-10): corrective + informational, NEVER permissionDecision:"deny",
      // NEVER pressure. The write always proceeds (exit 0).
      const msg = `Do-Not-Repeat match — ${warned.entry}. Verify before writing.`;
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
        })
      );
    }
    process.exit(0); // always: the write proceeds (silent when no match)
  } catch (e) {
    process.exit(0); // FAIL SAFE — never block the write
  }
});
