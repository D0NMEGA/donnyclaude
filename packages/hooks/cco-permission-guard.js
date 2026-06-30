#!/usr/bin/env node
// cco-hook-version: 2
// PreToolUse permission guard (GUARD-01/02). Mirrors donny-prompt-guard.js's spine but DENIES
// (permissionDecision:"deny" + process.exit(2)) instead of advising. Denies ONLY catastrophic
// Bash; ALLOWS ordinary local destructive commands; FAILS OPEN (exit 0) on any non-match, parse
// error, missing field, traversal session_id, or timeout — a guard bug must NEVER wedge all Bash
// (DoS-on-self, T-02-07). Regex-only over the command string: NO eval, NO child_process, NO
// shell-out on tool_input.command (T-02-06). Emit BOTH deny + exit 2 (R-1, observed to block
// live under bypassPermissions).
//
// v2 — false-positive fix: flags and target are bound to the SAME command via lightweight
// tokenization. v1 checked "rm present" + "any -r flag" + "any catastrophic path" INDEPENDENTLY
// across the whole string, so a benign compound like `grep -rl X $D && node "$HOME/h.js"; rm -f x`
// falsely matched (grep's -r + the $HOME path + the unrelated rm). v2 only flags an rm/chmod whose
// OWN flags are recursive AND whose OWN operand is a catastrophic root.
//
// v2-hardening (09-02, HARDEN-02/05):
//  HARDEN-02 (fail-CLOSED for the catastrophe set): a catastrophe-only gate that FAILS OPEN on a
//   parse error means a malformed-but-catastrophic command is ALLOWED. So before EVERY fail-OPEN
//   ERROR path (the 5s stdin-timeout, the traversal guard, and the catch), a raw-substring check
//   `rawCatastrophe(input)` runs on the UNPARSED input against the SAME narrow signals the parsed
//   path denies (MIRRORED via shared predicates — NOT a second/expanded set). A raw match -> DENY
//   (exit 2 + stderr). Genuinely benign-unparseable input STILL fails OPEN (exit 0) so a guard bug
//   never wedges all Bash (DoS-on-self, T-02-07). The raw backstop is NOT added to the BENIGN
//   allows (tool_name!=="Bash"; the parsed no-catastrophe allow) — those are legitimate allows.
//  HARDEN-05 (one clean block path): exit 2 DISCARDS stdout JSON, so the old permissionDecision
//   stdout JSON was dead code. It is removed; the empirically-blocking exit-2 + stderr path is kept,
//   centralized in denyAndExit(label). Behavior-preserving (the deny still blocks exactly as before).
//
// SINGLE SOURCE OF TRUTH: detectCatastrophe(cmd) holds the one catastrophe-pattern set; BOTH the
// parsed path AND rawCatastrophe() call it. No pattern is duplicated or expanded.

// Catastrophic destruction targets: home/root/system ROOTS (and system-dir subpaths), NOT every
// subpath under home (rm -rf ~/.cache is the user's call). Tokens are post-normalization (quotes
// stripped, whitespace collapsed).
function isCatastrophicTarget(tok) {
  return (
    /^~\/?$/.test(tok) ||                 // ~ or ~/
    /^\$HOME\/?$/.test(tok) ||            // $HOME or $HOME/
    /^\/\*?$/.test(tok) ||                // / or /*
    /^\/(System|usr|bin|sbin|etc|var|Library|dev|opt|private|cores)(\/|$)/.test(tok) // system dir (+subpaths)
  );
}
function hasRecursiveFlag(flags) {
  return flags.some(
    (f) => /^--recursive$/i.test(f) || /^--no-preserve-root$/i.test(f) || /^-[a-zA-Z]*r/i.test(f)
  );
}
function baseCmd(tok) {
  const i = tok.lastIndexOf("/");
  return i >= 0 ? tok.slice(i + 1) : tok;
}

// SINGLE SOURCE OF TRUTH for the catastrophe set (used by BOTH the parsed path and the raw
// backstop). Returns a label string on a catastrophe match, else null. Pure: regex-only over a
// string, NO eval / NO child_process / NO shell-out (T-02-06). `cmd` is the command text (parsed
// path) OR the raw unparsed stdin (rawCatastrophe) — either way it is only pattern-matched.
function detectCatastrophe(cmd) {
  // Normalize: drop quotes/backslashes, collapse whitespace (defeats rm\ -rf, "rm" -rf, rm  -rf).
  const norm = String(cmd).replace(/['"\\]/g, "").replace(/\s+/g, " ").trim();

  // 1) Whole-command, self-contained patterns (intrinsically catastrophic, low false-positive).
  if (/:\(\)\s*\{.*\|.*&.*\}\s*;\s*:/.test(norm)) return "fork bomb";
  if (/\bdd\b[^;&|]*\bof=\/dev\/(disk|sd|rdisk|nvme|hd)/i.test(norm)) return "dd to a raw device";
  if (/\bmkfs(\.[a-z0-9]+)?\b[^;&|]*\/dev\//i.test(norm)) return "mkfs on a device";
  if (/>\s*\/dev\/(disk|sd|rdisk|nvme|hd)\b/i.test(norm)) return "redirect over a raw device";

  // 2) Segment-scoped rm / chmod — flags+target bound to the SAME command (v2 fix).
  const segments = norm.split(/[;&|]+/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const toks = seg.split(" ").filter(Boolean);
    // Find the command token: skip leading var-assignments and benign wrappers/keywords.
    let i = 0;
    while (
      i < toks.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) ||
        /^(sudo|command|time|nohup|nice|env|builtin|exec|do|then|else|elif|\{|\()$/.test(toks[i]))
    ) {
      i++;
    }
    if (i >= toks.length) continue;
    const isSudo = toks.slice(0, i).includes("sudo");
    const name = baseCmd(toks[i]);
    const rest = toks.slice(i + 1);
    const flags = rest.filter((x) => x.startsWith("-"));
    const operands = rest.filter((x) => !x.startsWith("-"));

    if (name === "rm") {
      const rec = hasRecursiveFlag(flags);
      const cata = operands.some(isCatastrophicTarget);
      if (rec && cata) return "rm -r on / ~ $HOME or a system dir";
      if (isSudo && cata) return "sudo rm on a catastrophic target";
    } else if (name === "chmod") {
      const rec = hasRecursiveFlag(flags);
      const has777 = operands.includes("777") || flags.some((f) => /777/.test(f));
      const cata = operands.some(isCatastrophicTarget);
      if (has777 && (rec || cata)) return "chmod 777 recursive or on a system root";
    }
  }
  return null;
}

// HARDEN-02 raw backstop: detect a catastrophe in the UNPARSED stdin (which may be malformed JSON,
// truncated, or arbitrary garbage that WRAPS the command — there is no clean parsed `command`
// field). MIRRORS the parsed signals (same predicates + same four regexes; NO new pattern set), but
// is deliberately COARSER for the embedded-text case: it scans the whole normalized blob for the
// catastrophe tokens rather than requiring them to be a clean segment-leading command. CRUCIALLY it
// KEEPS the catastrophic-ROOT requirement (and the recursive-flag / sudo / 777 requirement) so a
// benign-unparseable blob and a normal local destructive command (`rm -f x`, `rm -rf ~/.cache`,
// `echo hi`, `chmod 777 ./file`) are NOT matched -> the caller still FAILS OPEN (no Bash wedge).
function rawCatastrophe(rawInput) {
  // 1) Precise pass first (catches the four whole-command regexes anywhere + any input that DOES
  //    tokenize as a clean command). Reuses the single shared detector — no duplicate patterns.
  const precise = detectCatastrophe(rawInput);
  if (precise) return precise;

  // 2) Coarse pass for a catastrophe EMBEDDED in surrounding text (JSON noise, truncation). Same
  //    normalization, then a flat token scan over the WHOLE blob. Mirrors the parsed rm/chmod rule
  //    (recursive-flag AND catastrophic-root; sudo rm at a root; chmod 777 recursive/at a root) but
  //    without segment-leading-command binding, since raw text has no reliable segment structure.
  const norm = String(rawInput).replace(/['"\\]/g, "").replace(/\s+/g, " ").trim();
  const toks = norm.split(" ").filter(Boolean);
  const hasRm = toks.some((t) => baseCmd(t) === "rm" || t === "rm" || /(^|[^a-z])rm$/.test(t));
  const hasChmod = toks.some((t) => baseCmd(t) === "chmod" || t === "chmod" || /(^|[^a-z])chmod$/.test(t));
  const hasSudo = toks.includes("sudo");
  const flags = toks.filter((x) => x.startsWith("-"));
  const operands = toks.filter((x) => !x.startsWith("-"));
  const cataRoot = operands.some(isCatastrophicTarget);
  const recursive = hasRecursiveFlag(flags);
  const has777 = operands.includes("777") || flags.some((f) => /777/.test(f));

  if (hasRm && cataRoot && (recursive || hasSudo)) return "rm -r on / ~ $HOME or a system dir";
  if (hasChmod && has777 && (recursive || cataRoot)) return "chmod 777 recursive or on a system root";
  return null;
}

// HARDEN-05: the ONE clean block path. exit 2 discards stdout JSON, so we write ONLY the stderr
// reason (the empirically-blocking, regression-covered path) and exit 2. Used by BOTH the parsed
// deny and the raw backstop -> a single source of the block behavior.
function denyAndExit(label) {
  const reason =
    `Destructive command blocked by cco-permission-guard: matched [${label}]. ` +
    `If this is intentional, run it yourself manually outside the agent.`;
  try { process.stderr.write(reason + "\n"); } catch (e) {}
  process.exit(2);
}

// Pure-predicate export for the test harness (HARDEN-02 Test 3/4). When this file is run directly
// (as the PreToolUse hook), require.main === module and we DO read stdin below. When it is
// require()d by a test, we expose the pure helpers and SKIP the stdin reader (no hang, no exit).
if (require.main !== module) {
  module.exports = {
    isCatastrophicTarget,
    hasRecursiveFlag,
    baseCmd,
    detectCatastrophe,
    rawCatastrophe,
  };
  return;
}

let input = "";
const t = setTimeout(() => {
  // pipe-hang guard. HARDEN-02: backstop on the input-so-far before failing open — a partial
  // catastrophe still denies; a partial/benign input fails OPEN (exit 0), never wedging Bash.
  const label = rawCatastrophe(input);
  if (label) denyAndExit(label);
  process.exit(0);
}, 5000);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== "Bash") process.exit(0); // only gate Bash
    const sessionId = data.session_id || "";
    if (/[/\\]|\.\./.test(sessionId)) {
      // V5 traversal guard. HARDEN-02: backstop the raw input before failing open.
      const label = rawCatastrophe(input);
      if (label) denyAndExit(label);
      process.exit(0);
    }
    const cmd = (data.tool_input && data.tool_input.command) || "";
    if (!cmd) process.exit(0); // empty command -> benign no-op, fail open (cmd is empty: N/A for raw)

    // Parsed catastrophe detection — the v2 tokenizer, now via the SINGLE shared detector.
    const label = detectCatastrophe(cmd);
    if (label) denyAndExit(label); // HARDEN-05: ONE clean block path (exit 2 + stderr; no dead JSON)
    process.exit(0); // no match -> allow silently (BENIGN no-match: no raw backstop here)
  } catch (e) {
    // HARDEN-02: ANY parse/throw error is the MOST IMPORTANT fail-open site — a malformed-but-
    // catastrophic command lands here. Backstop on the raw unparsed input before failing open.
    const label = rawCatastrophe(input);
    if (label) denyAndExit(label);
    process.exit(0); // FAIL OPEN for benign-unparseable — never wedge Bash (T-02-07)
  }
});
