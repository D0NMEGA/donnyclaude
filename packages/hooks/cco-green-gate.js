#!/usr/bin/env node
// cco-hook-version: 1
// Green-Before-Done gate (FORCE-01/02) on BOTH Stop (main agent) and SubagentStop (a finishing
// subagent, e.g. a gsd-executor). At the moment work is declared "done", it re-checks the project's
// lint/test bar — the SAME ruff/type/pytest bar cco-lint-loop already computes (D-02; this file
// MIRRORS those helpers inline so the v1 PostToolUse chain stays byte-for-byte untouched) — scoped
// to the project at the input `cwd`. If the bar is RED it BLOCKS completion with the binary-verified
// { "decision": "block", "reason": <text> } (surfaced to the model as "Stop hook feedback:").
//
// THE BLOCK CONTRACT (binary-verified live, claude 2.1.179):
//   {"decision":"block","reason":<actionable>}  -> blocks "done"; reason fed back to the model.
//   The reason is ACTIONABLE: the failing command + a short output tail + "fix before done".
//   It carries NO pressure/deadline wording (Phase-4 D-03 — the harness never injects such cues).
//
// CHEAP EVERYDAY GATE (D-04 cost separation): this runs ONLY the lint/test bar that already runs in
// the v1 loop. It NEVER invokes the judge panel, never starts a `claude` process, a Task tool, or a
// review agent, and never makes an LLM/network call. (Plan 07-02's panel is the opt-in heavy layer.)
//
// THREE-LAYER ESCAPE HATCH — it can NEVER trap the operator on an unfixable red bar (FORCE-02, D-03):
//   (1) stop_hook_active === true  -> return success (de-escalate; native-aligned, see below).
//   (2) operator override: CCO_GREEN_GATE_OFF=1 env  OR a `.cco/green-gate-off` file in cwd -> bypass.
//   (3) the NATIVE backstop: the harness caps consecutive re-blocks at 8
//       (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, base-10, Number.isNaN?8 — verified in the 2.1.179 binary).
//
// FAIL-OPEN (the inverse of cco-permission-guard's fail-CLOSED, chosen deliberately): on ANY error,
// malformed stdin, stdin timeout, or traversal session_id -> process.exit(0) emitting NO block. A
// green-gate bug must ALLOW "done", never wedge the session.
//
// HONEST SCOPE (D-00c): this gates the INTERACTIVE REPL. Whether settings.json Stop/SubagentStop
// hooks fire (and how a block behaves) under headless `-p`/cron is UNVERIFIED — a Phase-8 concern,
// NOT claimed here. The binary's "...not yet supported outside REPL" strings name *inline* hook defs.
//
// Plain Node stdlib + child_process.execFileSync (ARGV form ONLY — never a shell string on a path).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// cco-log: defensive require so a logging failure can NEVER change the exit code (metadata-only).
let logEvent = () => {};
try {
  ({ logEvent } = require(path.join(os.homedir(), ".claude", "hooks", "cco-log.js")));
} catch (e) {}

const TOOL_TIMEOUT = 8000; // per-tool budget (mirrors cco-lint-loop); whole-hook stays under the 20s registered timeout

// ---- bar helpers (mirror cco-lint-loop's resolveBin / run; D-02 same commands, same red/green) ----
function resolveBin(bin) {
  try {
    const local = path.join(os.homedir(), ".local", "bin", bin);
    if (fs.existsSync(local)) return local;
  } catch (e) {}
  try {
    const p = execFileSync("/usr/bin/which", [bin], { encoding: "utf8", timeout: 3000 }).trim();
    if (p) return p.split("\n")[0];
  } catch (e) {}
  return null;
}

function run(bin, args, cwd) {
  try {
    const out = execFileSync(bin, args, {
      timeout: TOOL_TIMEOUT, killSignal: "SIGKILL", maxBuffer: 1 << 20,
      encoding: "utf8", cwd: cwd || undefined, stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: out || "" };
  } catch (err) {
    return { code: typeof err.status === "number" ? err.status : 1, out: (err.stdout || "") + (err.stderr || "") };
  }
}

function tail(s, n) {
  return String(s || "").trim().split("\n").slice(-n).join("\n");
}

// Does a lint/test bar even apply to this project? (a ruff/pytest config marker present anywhere
// from cwd up to the repo root). If not -> GREEN/allow (the everyday no-op for non-Python dirs).
function barApplies(cwd) {
  try {
    let dir = path.resolve(cwd);
    const markers = ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini", "ruff.toml", ".ruff.toml"];
    for (let i = 0; i < 12; i++) {
      const has = markers.some((m) => { try { return fs.existsSync(path.join(dir, m)); } catch (e) { return false; } });
      let hasTests = false;
      try { hasTests = fs.existsSync(path.join(dir, "tests")); } catch (e) {}
      if (has || hasTests) return dir; // return the project root the bar applies at
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (e) {}
  return null;
}

// Locate a project-scoped pytest invocation (venv pytest preferred), mirroring cco-lint-loop's findPytest
// but PROJECT-scoped (Stop has no single file): run the whole project's tests/ (or the root) — gated,
// so it only runs where a venv/pytest + a test surface actually exist.
function findProjectPytest(root) {
  try {
    const venvPytest = path.join(root, ".venv", "bin", "pytest");
    let bin = null;
    if (fs.existsSync(venvPytest)) bin = venvPytest;
    else bin = resolveBin("pytest");
    if (!bin) return null;
    let target = root;
    try { if (fs.existsSync(path.join(root, "tests"))) target = path.join(root, "tests"); } catch (e) {}
    return { bin, target };
  } catch (e) {}
  return null;
}

// Evaluate the SAME ruff -> type(ty|pyright|mypy) -> pytest bar as cco-lint-loop, but at PROJECT scope.
// Returns { red:boolean, sections:[{cmd, out}] }. NO new checks beyond the v1 bar (D-02). Each tool is
// time-boxed; absent tools degrade silently (-> not red). No bar applies -> {red:false} (allow).
function evaluateBar(cwd) {
  const sections = [];
  const root = barApplies(cwd);
  if (!root) return { red: false, sections, noBar: true };

  // LINT: ruff check over the project (concise). RED iff exit 1 with output (exit 2 = misconfig -> skip).
  const ruff = resolveBin("ruff");
  if (ruff) {
    const r = run(ruff, ["check", "--output-format", "concise", "."], root);
    if (r.code === 1 && r.out.trim()) sections.push({ cmd: "ruff check", out: tail(r.out, 12) });
  }

  // TYPE: first present of ty -> pyright -> mypy, over the project. RED iff non-zero with output.
  const ty = resolveBin("ty");
  const pyright = ty ? null : resolveBin("pyright");
  const mypy = ty || pyright ? null : resolveBin("mypy");
  if (ty) {
    const r = run(ty, ["check", "--output-format", "concise", "."], root);
    if (r.code === 1 && r.out.trim()) sections.push({ cmd: "ty check", out: tail(r.out, 12) }); // exit 2/101 = crash/misconfig -> skip
  } else if (pyright) {
    const r = run(pyright, ["."], root);
    if (r.code !== 0 && r.out.trim()) sections.push({ cmd: "pyright", out: tail(r.out, 12) });
  } else if (mypy) {
    const r = run(mypy, ["."], root);
    if (r.code !== 0 && r.out.trim()) sections.push({ cmd: "mypy", out: tail(r.out, 12) });
  }

  // TEST: gated, project-scoped, time-boxed pytest. RED iff non-zero with output — BUT pytest
  // exit code 5 means "no tests were collected", which is an EMPTY test surface, NOT a failing one
  // (a project with no tests has a green test bar). Treat exit 5 as not-red (mirrors cco-lint-loop,
  // which only runs pytest when a matching test file exists).
  const proj = findProjectPytest(root);
  if (proj) {
    const r = run(proj.bin, ["-q", "-x", "--no-header", proj.target], root);
    if (r.code !== 0 && r.code !== 5 && r.out.trim()) sections.push({ cmd: "pytest", out: tail(r.out, 12) });
  }

  return { red: sections.length > 0, sections, root };
}

// Build the ACTIONABLE, pressure-free block reason (D-03): failing command(s) + a short output tail +
// the literal "fix before done" guidance. NO deadline/pressure wording (asserted in the tests).
function buildReason(sections) {
  const cmds = sections.map((s) => s.cmd).join(", ");
  const body = sections.map((s) => `$ ${s.cmd}\n${s.out}`).join("\n\n");
  return (
    `The lint/test bar is red — ${cmds} reported problems. ` +
    `Fix these before done (this is the green-before-done gate; "done" means the bar is green):\n\n` +
    body +
    `\n\nResolve the failures above, then finish. ` +
    `(To bypass: set CCO_GREEN_GATE_OFF=1 or create .cco/green-gate-off in this project.)`
  );
}

// ---- spine: collect stdin, time-box, then decide (whole body fail-OPEN) ----
let input = "";
const start = Date.now();
const t = setTimeout(() => process.exit(0), 5000); // pipe-hang guard (#775/#1162) -> fail OPEN
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  let sid = "";
  let event = "Stop";
  try {
    const data = JSON.parse(input);
    sid = data.session_id || "";
    if (/[/\\]|\.\./.test(sid)) process.exit(0); // V5 traversal guard -> fail OPEN
    event = data.hook_event_name || "Stop";
    const cwd = data.cwd || process.cwd();

    // ESCAPE LAYER 1 — de-escalation: the harness signals it is already retrying this Stop. Yield.
    // (Native-aligned: "check stop_hook_active ... and return success while it's true." + native cap=8.)
    if (data.stop_hook_active === true) {
      logEvent({ hook: "cco-green-gate", event, sid, latency_ms: Date.now() - start, decision: "info", matched: "escape:stop_hook_active" });
      process.exit(0);
    }

    // ESCAPE LAYER 2 — operator override: env sentinel OR a per-project .cco/green-gate-off file.
    let overridden = process.env.CCO_GREEN_GATE_OFF === "1";
    if (!overridden) {
      try { overridden = fs.existsSync(path.join(cwd, ".cco", "green-gate-off")); } catch (e) {}
    }
    if (overridden) {
      logEvent({ hook: "cco-green-gate", event, sid, latency_ms: Date.now() - start, decision: "info", matched: "escape:override" });
      process.exit(0);
    }

    // EVALUATE THE BAR over the project at cwd (D-02 reuse; no new checks; cheap + time-boxed).
    const bar = evaluateBar(cwd);

    // GREEN / no bar applies -> allow (the everyday no-op).
    if (!bar.red) {
      logEvent({ hook: "cco-green-gate", event, sid, latency_ms: Date.now() - start, decision: "none", matched: bar.noBar ? "no-bar" : "green" });
      process.exit(0);
    }

    // RED -> BLOCK with the actionable, pressure-free reason. (ESCAPE LAYER 3 = native cap=8 + Layer-1
    // guarantee this cannot loop forever: a still-red bar re-blocks at most up to the native cap,
    // after which the harness stops re-blocking and the operator can fix or override.)
    const reason = buildReason(bar.sections);
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    logEvent({ hook: "cco-green-gate", event, sid, latency_ms: Date.now() - start, decision: "block", matched: "red" });
    process.exit(0); // the block is delivered via stdout; exit 0 (the decision, not the code, blocks)
  } catch (e) {
    // FAIL-OPEN: a gate bug must allow "done", never wedge it. Emit no block.
    try { logEvent({ hook: "cco-green-gate", event, sid, latency_ms: Date.now() - start, decision: "none", matched: "error" }); } catch (e2) {}
    process.exit(0);
  }
});
