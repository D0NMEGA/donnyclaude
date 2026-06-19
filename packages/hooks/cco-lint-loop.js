#!/usr/bin/env node
// cco-hook-version: 1
// PostToolUse lint/type/test loop (LOOP-01/02). After a Write/Edit/MultiEdit to a *.py file,
// runs ruff + a type check (ty -> pyright -> mypy) on the single file + a gated/scoped pytest,
// and injects findings as additionalContext (the green/red metric). Non-blocking (PostToolUse
// cannot block), exit 0 always, degrades silently when tools/projects are absent (fires in
// EVERY project). Argv execFileSync only (no shell-string interpolation of the file path).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const TIMEOUT = 8000;

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
      timeout: TIMEOUT, killSignal: "SIGKILL", maxBuffer: 1 << 20,
      encoding: "utf8", cwd: cwd || undefined, stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: out || "" };
  } catch (err) {
    return { code: typeof err.status === "number" ? err.status : 1, out: (err.stdout || "") + (err.stderr || "") };
  }
}

function findPytest(fp) {
  try {
    let dir = path.dirname(path.resolve(fp));
    for (let i = 0; i < 12; i++) {
      const markers = ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"];
      const has = markers.some((m) => { try { return fs.existsSync(path.join(dir, m)); } catch (e) { return false; } });
      let hasTests = false;
      try { hasTests = fs.existsSync(path.join(dir, "tests")); } catch (e) {}
      if (has || hasTests) {
        const venvPytest = path.join(dir, ".venv", "bin", "pytest");
        let bin = null;
        if (fs.existsSync(venvPytest)) bin = venvPytest;
        else bin = resolveBin("pytest");
        if (!bin) return null;
        const base = path.basename(fp, ".py");
        const cand = [path.join(dir, "tests", `test_${base}.py`), path.join(dir, "tests", `${base}_test.py`)];
        const target = cand.find((c) => { try { return fs.existsSync(c); } catch (e) { return false; } }) || dir;
        return { cwd: dir, bin, target };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (e) {}
  return null;
}

let input = "";
const t = setTimeout(() => process.exit(0), 10000); // pipe-hang guard
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || "";
    if (/[/\\]|\.\./.test(sessionId)) process.exit(0); // V5 guard
    const fp = (data.tool_input && data.tool_input.file_path) || "";
    if (!fp.endsWith(".py")) process.exit(0); // single-file scope (D-02)
    if (!fs.existsSync(fp)) process.exit(0);

    // throttle (D-06): skip re-run on same file+mtime within 3s
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(fp).mtimeMs; } catch (e) {}
    const hash = crypto.createHash("md5").update(fp).digest("hex").slice(0, 12);
    const flagPath = path.join(os.tmpdir(), `claude-lint-${hash}.json`);
    try {
      const f = JSON.parse(fs.readFileSync(flagPath, "utf8"));
      if (f.mtimeMs === mtimeMs && Date.now() - f.ranAt < 3000) process.exit(0);
    } catch (e) {}
    try { fs.writeFileSync(flagPath, JSON.stringify({ mtimeMs, ranAt: Date.now() })); } catch (e) {}

    const sections = [];

    // LINT (D-03): ruff
    const ruff = resolveBin("ruff");
    if (ruff) {
      const r = run(ruff, ["check", "--output-format", "concise", fp]);
      if (r.code === 1 && r.out.trim()) sections.push("ruff:\n" + r.out.trim());
      // exit 0 clean; exit 2 misconfig -> skip silently
    }

    // TYPE (D-03 fallback: ty -> pyright -> mypy, first present only)
    const ty = resolveBin("ty");
    const pyright = ty ? null : resolveBin("pyright");
    const mypy = ty || pyright ? null : resolveBin("mypy");
    if (ty) {
      const r = run(ty, ["check", "--output-format", "concise", fp]);
      if (r.code === 1 && r.out.trim()) sections.push("type (ty):\n" + r.out.trim());
      // exit 2 / 101 -> skip silently (Beta crash/misconfig)
    } else if (pyright) {
      const r = run(pyright, [fp]);
      if (r.code !== 0 && r.out.trim()) sections.push("type (pyright):\n" + r.out.trim());
    } else if (mypy) {
      const r = run(mypy, [fp]);
      if (r.code !== 0 && r.out.trim()) sections.push("type (mypy):\n" + r.out.trim());
    }

    // TEST (D-04, LOOP-02): gated + scoped + time-boxed pytest
    const proj = findPytest(fp);
    if (proj) {
      const r = run(proj.bin, ["-q", "-x", "--no-header", proj.target], proj.cwd);
      if (r.code !== 0 && r.out.trim()) {
        const tail = r.out.trim().split("\n").slice(-12).join("\n");
        sections.push("pytest:\n" + tail);
      }
    }

    if (sections.length) {
      const msg = `LINT/TYPE/TEST for ${path.basename(fp)}:\n` + sections.join("\n") +
        "\n-> Fix these before continuing (single green/red metric).";
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }));
    }
    process.exit(0);
  } catch (e) {
    process.exit(0); // never interfere with the tool loop
  }
});
