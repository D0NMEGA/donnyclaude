#!/usr/bin/env node
// cco-hook-version: 4
// SessionEnd + PreCompact vault capture (MEMORY-01/02). Writes a skeletal "lab-notebook" session
// note to ~/vault/Sessions/ matching the OBSERVED vault convention (type/date/projects/duration_min/
// tags + `# {date} — {Title}` + `>` blockquote). Curated metadata ONLY (cwd, git branch, phase/resume
// from STATE.md, trigger, transcript PATH pointer) — NEVER transcript contents or secrets (D-15).
// Branches on hook_event_name and ALWAYS exits 0 on BOTH branches: SessionEnd cannot block; PreCompact
// CAN block and MUST NOT (DoS-on-self, T-02-12). Idempotent: one note per cwd+day; a re-fire updates
// the same note (appends to its Events log) rather than duplicating. Fires in EVERY repo, so it
// no-ops when ~/vault is absent and degrades to a minimal note in non-GSD dirs.
//
// v2 — date + title fixes: (1) uses LOCAL calendar date (a real /compact at 22:50 CT was 03:50Z, so
// UTC `toISOString().slice(0,10)` produced tomorrow's date and broke the date-keyed note); (2) Title is
// the cwd basename + a short "Phase NN" (not the whole STATE `Phase:` line); (3) the title cleaner
// preserves the convention's spaces/hyphens/em-dash, stripping only filesystem-illegal chars.
//
// v3 — RECALL-01 cerebrum scaffolding (D-04 EXTEND, do NOT replace): after the existing session-note
// write succeeds, a best-effort `ensureCerebrum(vault)` GUARANTEES a 4-section ~/vault/cerebrum.md
// exists (## User Preferences / ## Key Learnings / ## Do-Not-Repeat / ## Decision Log) — creating it
// from a template when absent, otherwise leaving the operator's hand-written bodies untouched (at most
// refreshing the `> Last updated:` line). D-12 METADATA-ONLY: it writes ONLY the section scaffolding +
// a timestamp — NEVER transcript text, prompts, file contents, or secrets (the model/operator authors
// Do-Not-Repeat entries by hand or via a future Phase-6 flow; this hook only guarantees file+sections).
// ensureCerebrum is wrapped in its OWN try/catch so a cerebrum failure can NEVER change the existing
// exit-0 behavior, break the session note, or block PreCompact (T-05-13). The cco-cerebrum-recall
// (SessionStart) + cco-cerebrum-check (pre-write) hooks read this file back.
//
// v4 — ROT FIX (vault hygiene). Three changes that stop the SessionEnd hook from manufacturing vault
// rot, plus a re-order so cerebrum is still guaranteed everywhere:
//   (1) SKIP non-project cwds. Sessions launched from $HOME, the standard macOS user folders
//       (Desktop/Downloads/…), dotdirs (.planning), and temp dirs no longer write a note at all —
//       they were producing fake `[[Projects/<cwd-basename>]]` backlinks (d0nmega/Desktop/tmp/…).
//   (2) RESOLVE the project backlink against a REAL note in ~/vault/Projects/ (case-corrected to the
//       actual filename). No matching note -> `projects: []`, NEVER a broken link.
//   (3) ONE note per cwd+DAY. Every session that shares a day+title appends to a single note's Events
//       log (each line tagged with its 8-char session id) instead of spawning a `(hexhash)`-suffixed
//       file per session. The marker is now a stable, non-session sentinel so any prior cco note for
//       this day+title is recognised and appended to (legacy `<!-- cco-session: -->` notes still match).
// cerebrum scaffolding now runs BEFORE the non-project skip, so learning memory is guaranteed in
// EVERY session — including the ones that intentionally write no session note.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// OBS-01 logger (Plan 01). require()'d defensively so a missing/edited helper can NEVER break capture.
let logEvent = () => {};
try {
  ({ logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js")));
} catch (e) {}

// ensureCerebrum: guarantee a 4-section ~/vault/cerebrum.md exists. METADATA-ONLY (D-12) —
// writes ONLY section scaffolding + a `> Last updated:` timestamp; never copies transcript/file/
// prompt/secret content. Best-effort: the SINGLE caller wraps it so any throw is swallowed and the
// existing session-note + exit-0 behavior is preserved. Returns "created" | "touched" | "noop".
const CEREBRUM_SECTIONS = ["## User Preferences", "## Key Learnings", "## Do-Not-Repeat", "## Decision Log"];
function ensureCerebrum(vault, nowISO) {
  const cerebrumPath = path.join(vault, "cerebrum.md");
  if (!fs.existsSync(cerebrumPath)) {
    // Fresh scaffold — the verified 4-section template (clean-room from OpenWolf's format, not source).
    const template =
`# Cerebrum
> Learning memory. Last updated: ${nowISO}

## User Preferences
<!-- code style, tools, patterns, communication -->

## Key Learnings
<!-- project conventions discovered -->

## Do-Not-Repeat
<!-- [YYYY-MM-DD] What went wrong and what to do instead. -->

## Decision Log
<!-- why X over Y -->
`;
    fs.writeFileSync(cerebrumPath, template, { mode: 0o600 });
    return "created";
  }
  // Exists: NEVER clobber the operator's section bodies. At most refresh the single `> Last updated:`
  // line. If a section is somehow missing (hand-edited file), APPEND only the missing headers (never
  // touch existing content), so recall/check can always slice all four sections.
  let txt = fs.readFileSync(cerebrumPath, "utf8");
  const before = txt;
  if (/^>\s*Learning memory\. Last updated:.*$/m.test(txt)) {
    txt = txt.replace(/^(>\s*Learning memory\. Last updated:).*$/m, `$1 ${nowISO}`);
  }
  for (const h of CEREBRUM_SECTIONS) {
    // Match the header as a whole line (avoid matching a substring inside an entry).
    const re = new RegExp("^" + h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m");
    if (!re.test(txt)) txt += (txt.endsWith("\n") ? "" : "\n") + "\n" + h + "\n";
  }
  if (txt !== before) fs.writeFileSync(cerebrumPath, txt, { mode: 0o600 });
  return txt !== before ? "touched" : "noop";
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "session";
}
function safeTitle(s) {
  // Preserve the vault convention's spaces/hyphens/em-dash (exemplars: "Harness Config Audit",
  // "browser-harness — Phase 2"); strip ONLY filesystem-illegal chars (/, \, :, control chars),
  // collapse whitespace, trim. v4 fix: the old class `[\\/: -]` also ate spaces AND hyphens, which
  // mangled the " — " separator into "-—-" (e.g. "browser-harness-—-Phase-2") — exactly the opposite
  // of the documented intent. Now only truly-illegal characters are replaced.
  return String(s).replace(/[\\/:\x00-\x1f]/g, "-").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "") || "session";
}
function readEvents(p) {
  try {
    const t = fs.readFileSync(p, "utf8");
    const i = t.indexOf("## Events");
    if (i < 0) return [];
    return t.slice(i).split("\n").filter((l) => l.startsWith("- "));
  } catch (e) { return []; }
}
// v4: resolve the project backlink against an ACTUAL note in ~/vault/Projects/, case-corrected to the
// real filename. No matching note -> null -> the caller emits `projects: []` rather than a broken
// `[[Projects/<cwd-basename>]]` link. This is the per-write half of the rot fix (the skip-list below is
// the other half); together they guarantee the hook never writes a [[Projects/X]] that doesn't resolve.
function resolveProject(vault, base) {
  try {
    const want = String(base).toLowerCase() + ".md";
    for (const f of fs.readdirSync(path.join(vault, "Projects"))) {
      if (f.toLowerCase() === want) return f.slice(0, -3);
    }
  } catch (e) {}
  return null;
}

let input = "";
const startTs = Date.now(); // OBS-01 latency baseline (v3)
const t = setTimeout(() => process.exit(0), 5000); // pipe-hang guard -> exit 0 (never block)
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || "";
    if (/[/\\]|\.\./.test(sessionId)) process.exit(0); // V5 traversal guard -> write nothing
    const ev = data.hook_event_name || "";
    const cwd = data.cwd || process.cwd();

    // GLOBAL-FIRE SAFETY: no-op when the vault is absent (hook runs in every project).
    const vault = path.join(os.homedir(), "vault");
    if (!fs.existsSync(vault)) process.exit(0);
    const sess = path.join(vault, "Sessions");
    try { fs.mkdirSync(sess, { recursive: true }); } catch (e) {}

    const trigger = ev === "SessionEnd" ? (data.reason || "other") : (data.trigger || "manual");

    // LOCAL calendar date/time (NOT UTC — see v2 header note).
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const nowISO = `${today} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const base = path.basename(cwd) || "session";
    const sid8 = sessionId ? sessionId.slice(0, 8) : "nosess";

    // git branch — argv form (never shell-interpolate cwd), time-boxed, "-" on any failure
    let branch = "-";
    try {
      branch = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
        { timeout: 2000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "-";
    } catch (e) {}

    // phase / resume — best-effort from cwd/.planning/STATE.md; "-" in non-GSD dirs.
    // Capture just the phase NUMBER for the Title; keep the focus/resume lines for the body.
    let phaseNum = "", focus = "", resume = "";
    try {
      const sp = path.join(cwd, ".planning", "STATE.md");
      if (fs.existsSync(sp)) {
        const st = fs.readFileSync(sp, "utf8");
        let m;
        if ((m = st.match(/^Phase:\s*([0-9]+(?:\.[0-9]+)?)/im))) phaseNum = m[1];
        else if ((m = st.match(/Current focus:\*\*\s*Phase\s*([0-9]+(?:\.[0-9]+)?)/i))) phaseNum = m[1];
        if ((m = st.match(/\*\*Current focus:\*\*\s*(.+)$/im))) focus = m[1].trim();
        if ((m = st.match(/Resume file:\s*(.+)$/im))) resume = m[1].trim();
      }
    } catch (e) {}
    // v4: normalise the phase number (strip leading zeros) so "Phase 03" and "Phase 3" key the SAME
    // note instead of two — the zero-pad inconsistency was a second source of same-day duplicates.
    if (phaseNum) phaseNum = phaseNum.replace(/^0+(?=\d)/, "");
    const phaseTok = phaseNum ? `Phase ${phaseNum}` : "";
    const phaseResume = [focus || phaseTok || "-", resume ? `(resume: ${resume})` : ""].filter(Boolean).join(" ") || "-";

    // v3 (RECALL-01, D-04): guarantee cerebrum.md FIRST — in its OWN try/catch — so learning memory is
    // ensured in EVERY session, INCLUDING the non-project sessions the v4 skip below writes no note for.
    // A cerebrum failure can never break the session note, change exit 0, or block PreCompact (T-05-13).
    let cerebrumResult = "skip";
    try { cerebrumResult = ensureCerebrum(vault, nowISO); } catch (e) {}

    // v4 ROT FIX — SKIP non-project cwds: never write a session note for $HOME, the standard macOS user
    // folders, dotdirs (.planning), or temp dirs. These were manufacturing fake
    // `[[Projects/<cwd-basename>]]` backlinks (d0nmega/Desktop/tmp/tmp.XXXX…). Exit 0, write no note.
    const NONPROJECT = new Set(["Desktop", "Downloads", "Documents", "Movies", "Music", "Pictures", "Public", "Applications", "Library", "tmp"]);
    const TMP_ROOTS = [os.tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
    const inTmp = TMP_ROOTS.some((r) => r && (cwd === r || cwd.startsWith(r + path.sep)));
    if (cwd === os.homedir() || NONPROJECT.has(base) || /^tmp[.\-_]/i.test(base) || base.startsWith(".") || inTmp) {
      try {
        logEvent({ hook: "cco-vault-capture", event: ev || "?", sid: sessionId, latency_ms: Date.now() - startTs, decision: "skip", matched: "nonproject:" + cerebrumResult });
      } catch (e) {}
      process.exit(0);
    }

    const Title = safeTitle(base + (phaseTok ? ` — ${phaseTok}` : ""));
    const SENTINEL = "<!-- cco-vault-capture -->";

    // v4 ROT FIX — ONE note per cwd+DAY: collapse every session that shares this day+title into a
    // single note (Events accumulate). Only fall back to a disambiguated path if a NON-cco note already
    // owns the name, so a hand-written note is never clobbered. Legacy `<!-- cco-session: -->` notes
    // are still recognised as "ours" and appended to.
    let notePath = path.join(sess, `${today} — ${Title}.md`);
    let mine = false;
    try {
      if (fs.existsSync(notePath)) {
        const existing = fs.readFileSync(notePath, "utf8");
        if (existing.includes(SENTINEL) || existing.includes("<!-- cco-session:")) {
          mine = true; // an earlier cco capture (this or another session today) -> append to it
        } else {
          notePath = path.join(sess, `${today} — ${Title} (${sid8}).md`); // human note owns the base name
          mine = fs.existsSync(notePath) && fs.readFileSync(notePath, "utf8").includes(SENTINEL);
        }
      }
    } catch (e) {}

    // Re-entry debounce: skip a rapid PreCompact re-fire (<3s); SessionEnd ALWAYS finalizes.
    const flag = path.join(os.tmpdir(), `claude-vault-${sessionId}.flag`);
    if (ev !== "SessionEnd") {
      try {
        const last = parseInt(fs.readFileSync(flag, "utf8"), 10);
        if (last && Date.now() - last < 3000) process.exit(0);
      } catch (e) {}
    }

    const events = mine ? readEvents(notePath) : [];
    events.push(`- ${nowISO} — ${ev || "?"} (${trigger}) [${sid8}]`);
    const eventsTail = events.slice(-50);

    // v4: resolve to a REAL project note (case-corrected) or emit an empty list — never a broken link.
    const proj = resolveProject(vault, base);
    const projects = proj ? `["[[Projects/${proj}]]"]` : "[]";
    const note =
`---
type: session
date: ${today}
projects: ${projects}
duration_min:
tags: [session, claude-code, ${slug(base)}]
---
${SENTINEL}

# ${today} — ${Title}

> Auto-captured by cco-vault-capture (${trigger}). Skeletal lab-notebook entry — enrich as needed.

- **cwd:** ${cwd}
- **git branch:** ${branch}
- **phase / resume:** ${phaseResume}
- **trigger:** ${ev} (${trigger})
- **transcript:** ${data.transcript_path || "-"}

## Events
${eventsTail.join("\n")}
`;

    try {
      fs.writeFileSync(notePath, note, { mode: 0o600 });
      fs.writeFileSync(flag, String(Date.now()), { mode: 0o600 });
    } catch (e) {}

    // OBS-01 parity (D-12 metadata-only): record the fire — NO transcript/file/secret content.
    try {
      logEvent({
        hook: "cco-vault-capture",
        event: ev || "?",
        sid: sessionId,
        latency_ms: Date.now() - startTs,
        decision: "info",
        matched: cerebrumResult,
      });
    } catch (e) {}

    process.exit(0); // BOTH branches: never block compaction, never fail the session-end flow
  } catch (e) {
    process.exit(0); // FAIL SAFE — write nothing rather than block
  }
});
