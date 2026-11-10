#!/usr/bin/env node
// cco-hook-version: 3
// PreToolUse permission guard (GUARD-01/02). Denies ONLY catastrophic Bash (exit 2 + a stderr
// reason); ALLOWS ordinary local destructive commands; FAILS OPEN (exit 0) on any non-match, parse
// error, missing field, traversal session_id, or timeout, because a guard bug must never wedge all
// Bash (DoS-on-self, T-02-07). Pattern matching only: NO eval, NO child_process, NO shell-out on
// tool_input.command (T-02-06). A `Bash` matcher also delivers Monitor commands as Bash calls.
//
// v2 (kept): flags and target are bound to the SAME command, and the raw backstop (HARDEN-02)
// denies a catastrophe embedded in malformed input before every fail-open error path. One clean
// block path (HARDEN-05): exit 2 + stderr, no stdout JSON.
//
// v3 (2026-11-10 audit): the v2 matcher only knew `~`, `$HOME`, `/` and system dirs as bare rm
// operands, so `rm -rf ~/*`, `~/Library`, the literal home path, `bash -c "..."`, `find ~ -delete`,
// `xargs rm -rf`, `cd ~ && rm -rf .`, wrappers such as `timeout`, subshells and later lines of a
// multi-line command all passed. It also stripped quotes before splitting, so a quoted mention
// (a commit message containing `; rm -rf ~`) was blocked. v3 lexes the command with quoting
// honoured, resolves operands to absolute paths (known variables, `..`, a tracked cwd), and applies
// one protected-path policy. A static guard cannot see a path computed at run time; that limit is
// why the sandbox, not this hook, is the real containment.
//
// SINGLE SOURCE OF TRUTH: detectCatastrophe(cmd[, cwd]) holds the catastrophe set. The parsed path,
// rawCatastrophe() and ~/.claude/bin/cco-dream (one-argument call, string-or-null result) all use it.

const path = require("path");
const os = require("os");

const HOME_DIR = String(process.env.HOME || os.homedir() || "").replace(/\/+$/, "") || "/nonexistent-home";
// First-level home folders that are caches by convention; everything else directly under home is
// protected (owner decision 2026-11-10: unknown valuable folders matter more than a blocked cleanup).
const DISPOSABLE_HOME_CHILDREN = new Set([
  ".cache", ".npm", ".pnpm-store", ".yarn", ".bun", ".gradle", ".m2", ".Trash", ".node-gyp",
]);
const TOP_ROOTS = new Set(["/", "/Users", "/Volumes", "/Applications"]);
const SYSTEM_DIR = /^\/(System|usr|bin|sbin|etc|var|Library|dev|opt|private|cores)(\/|$)/;
const TEMP_BELOW = /^\/(private\/)?(tmp|var\/tmp|var\/folders)\/.+/;
const TEMP_ROOT = /^\/(private\/)?(tmp|var\/tmp|var\/folders)$/;
const M = "\u0000"; // prefix: this character was made literal by quotes or a backslash
const G = "\u0001"; // prefix: this character is a live wildcard
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const SKIP_WORDS = new Set([
  "command", "builtin", "exec", "time", "nohup", "caffeinate", "stdbuf",
  "do", "then", "else", "elif", "if", "while", "until", "!", "{", "}",
]);

const LABEL_RM = "rm -r on / ~ $HOME or a system dir";
const LABEL_SUDO = "sudo rm on a catastrophic target";
const LABEL_CHMOD = "chmod 777 recursive or on a system root";
const LABEL_GLOB = "rm of a wildcard directly under a protected folder";
const LABEL_FIND = "find with -delete or -exec rm rooted at a protected folder";
const LABEL_XARGS = "xargs feeding rm -r from a listing that is not provably project-relative";

function hasRecursiveFlag(flags) {
  return flags.some(
    (f) => /^--recursive$/i.test(f) || /^--no-preserve-root$/i.test(f) || /^-[a-zA-Z]*r/i.test(f)
  );
}
function baseCmd(tok) {
  const i = tok.lastIndexOf("/");
  return i >= 0 ? tok.slice(i + 1) : tok;
}
function plain(word) {
  return word.split(M).join("");
}

// ─── Protected-path policy (absolute, normalized paths) ──────────────────────────────────────
// A path BELOW a temp root is scratch space (2026-10-07: also Claude Code's scratchpad).
function isTempPath(p) {
  return TEMP_BELOW.test(p);
}
function isHomeChildProtected(p) {
  if (!p.startsWith(HOME_DIR + "/")) return false;
  const rest = p.slice(HOME_DIR.length + 1);
  return !rest.includes("/") && !DISPOSABLE_HOME_CHILDREN.has(rest);
}
// Roots where even a filtered delete is refused: /, home, /Users, /Volumes, /Applications, another
// user's home or a mounted volume, and system dirs with their subpaths (v2 behaviour).
function isTopRoot(p) {
  if (isTempPath(p)) return false;
  return p === HOME_DIR || TOP_ROOTS.has(p) || /^\/(Users|Volumes)\/[^/]+$/.test(p) || SYSTEM_DIR.test(p);
}
function isProtectedPath(p) {
  if (!p || isTempPath(p)) return false;
  return isTopRoot(p) || isHomeChildProtected(p);
}
// `parent` is the directory a wildcard would expand in. System dirs keep the v2 rule (recursive
// only); home, volumes and first-level home folders are refused even for a plain `rm -f`.
function globParentBlocks(parent, recursive) {
  if (isTempPath(parent) || TEMP_ROOT.test(parent)) return false;
  if (parent === HOME_DIR || TOP_ROOTS.has(parent) || /^\/(Users|Volumes)\/[^/]+$/.test(parent)) return true;
  if (isHomeChildProtected(parent)) return true;
  return recursive && isProtectedPath(parent);
}

// ─── Word expansion ──────────────────────────────────────────────────────────────────────────
// Expand `~`, $HOME, ${HOME}, $PWD and variables assigned earlier in the same command. Returns the
// text with live wildcards prefixed by G, or null when the word holds an expansion we cannot know.
function expandWord(word, env) {
  let out = "";
  let first = true;
  for (let i = 0; i < word.length; ) {
    const ch = word[i];
    if (ch === M) {
      out += word[i + 1] === undefined ? "" : word[i + 1];
      i += 2;
    } else if (ch === "~" && first) {
      let j = i + 1;
      let user = "";
      while (j < word.length && word[j] !== "/" && word[j] !== M) user += word[j++];
      if (user && !/^[A-Za-z0-9._-]+$/.test(user)) {
        out += ch;
        i++;
      } else {
        out += user ? "/Users/" + user : HOME_DIR;
        i = j;
      }
    } else if (ch === "$") {
      const rest = word.slice(i);
      const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest) || /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
      if (!m) return null;
      let v;
      if (m[1] === "HOME") v = HOME_DIR;
      else if (env.vars.has(m[1])) v = env.vars.get(m[1]);
      else if (m[1] === "PWD") v = env.cwd;
      if (v == null) return null;
      out += v;
      i += m[0].length;
    } else if (ch === "*" || ch === "?" || ch === "[") {
      out += G + ch;
      i++;
    } else {
      out += ch;
      i++;
    }
    first = false;
  }
  return out;
}

// Resolve a word to {path, glob}. With glob=true, `path` is the directory the first wildcard
// component expands in. Returns null when the path cannot be known statically (unknown variable,
// or a relative path with no tracked cwd): unknown is never treated as catastrophic.
function resolveOperand(word, env) {
  const s = expandWord(word, env);
  if (s == null || s === "") return null;
  let p = s;
  let glob = false;
  const gi = p.indexOf(G);
  if (gi !== -1) {
    glob = true;
    const cut = p.lastIndexOf("/", gi);
    p = cut === -1 ? "." : cut === 0 ? "/" : p.slice(0, cut);
  }
  p = p.split(G).join("");
  if (!p.startsWith("/")) {
    if (!env.cwd) return null;
    p = env.cwd + "/" + p;
  }
  p = path.posix.normalize(p);
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return { path: p, glob };
}

// v2-compatible export: is this bare token a catastrophic rm target? Used by the raw backstop.
function isCatastrophicTarget(tok) {
  const t = resolveOperand(String(tok), { cwd: null, vars: new Map() });
  if (!t) return false;
  return t.glob ? globParentBlocks(t.path, true) : isProtectedPath(t.path);
}

// ─── Lexer ───────────────────────────────────────────────────────────────────────────────────
// Split a command line into simple commands with quoting honoured. Each command is
// {words, sep, heredocs}; `sep` is the separator that preceded it ("|" means piped from the one
// before). Redirection targets are dropped (they are not operands). Heredoc bodies are attached
// to their command and are NOT lexed here; the analyzer decides whether a shell will read them.
function lex(src) {
  const cmds = [];
  const stack = []; // open command substitutions: {kind: ")" | "`", q}
  let waiting = []; // heredocs whose body starts at the next newline
  let current = { words: [], sep: "start", heredocs: [] };
  let cur = "";
  let has = false;
  let q = null;
  let redirNext = false;
  const literal = (c) => (/[~*?[$]/.test(c) ? M + c : c);
  const pushWord = () => {
    if (has) {
      if (redirNext) redirNext = false;
      else current.words.push(cur);
    }
    cur = "";
    has = false;
  };
  const endCmd = (sep) => {
    pushWord();
    redirNext = false;
    if (current.words.length) cmds.push(current);
    current = { words: [], sep, heredocs: [] };
  };
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (q === "'") {
      if (ch === "'") q = null;
      else cur += literal(ch);
      continue;
    }
    if (ch === "`" ) {
      const top = stack[stack.length - 1];
      if (top && top.kind === "`") {
        stack.pop();
        endCmd("subst");
        q = top.q;
      } else {
        stack.push({ kind: "`", q });
        endCmd("subst");
        q = null;
      }
      continue;
    }
    if (ch === "$" && src[i + 1] === "(") {
      stack.push({ kind: ")", q });
      endCmd("subst");
      q = null;
      i++;
      continue;
    }
    if (q === '"') {
      if (ch === '"') q = null;
      else if (ch === "\\" && i + 1 < n && /["\\$`\n]/.test(src[i + 1])) {
        i++;
        if (src[i] !== "\n") cur += literal(src[i]);
      } else if (ch === "$") cur += ch;
      else cur += literal(ch);
      has = true;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 < n) {
        i++;
        if (src[i] !== "\n") {
          cur += literal(src[i]);
          has = true;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      has = true;
      continue;
    }
    if (ch === "\n") {
      endCmd("\n");
      for (const w of waiting) {
        const body = [];
        let j = i + 1;
        while (j <= n) {
          let k = src.indexOf("\n", j);
          if (k === -1) k = n;
          const line = src.slice(j, k);
          j = k + 1;
          if ((w.strip ? line.replace(/^\t+/, "") : line) === w.delim) break;
          body.push(line);
          if (k === n) break;
        }
        w.cmd.heredocs.push(body.join("\n"));
        i = j - 1;
      }
      waiting = [];
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      pushWord();
      continue;
    }
    if (ch === "#" && !has) {
      while (i + 1 < n && src[i + 1] !== "\n") i++;
      continue;
    }
    if (ch === ";") {
      endCmd(";");
      continue;
    }
    if (ch === "(") {
      endCmd("(");
      continue;
    }
    if (ch === ")") {
      const top = stack[stack.length - 1];
      if (top && top.kind === ")") {
        stack.pop();
        endCmd("subst");
        q = top.q;
      } else endCmd(")");
      continue;
    }
    if (ch === "|") {
      if (src[i + 1] === "|") {
        i++;
        endCmd("||");
      } else {
        if (src[i + 1] === "&") i++;
        endCmd("|");
      }
      continue;
    }
    if (ch === "&") {
      if (src[i + 1] === "&") {
        i++;
        endCmd("&&");
      } else if (src[i + 1] === ">") {
        // `&>file`: a redirection, handled by the next iteration's ">" branch
        pushWord();
      } else endCmd("&");
      continue;
    }
    if (ch === "<" && src[i + 1] === "<" && src[i + 2] !== "<") {
      // heredoc: << [-] DELIM, with the delimiter possibly quoted
      if (has && /^\d+$/.test(cur)) {
        cur = "";
        has = false;
      } else pushWord();
      i += 2;
      let strip = false;
      if (src[i] === "-") {
        strip = true;
        i++;
      }
      while (src[i] === " " || src[i] === "\t") i++;
      let delim = "";
      while (i < n && !/[\s;|&()<>]/.test(src[i])) {
        if (src[i] !== "'" && src[i] !== '"' && src[i] !== "\\") delim += src[i];
        i++;
      }
      i--;
      if (delim) waiting.push({ cmd: current, delim, strip });
      continue;
    }
    if (ch === "<" || ch === ">") {
      // redirection: drop an fd number glued to it, swallow the operator, skip the target word
      if (has && /^\d+$/.test(cur)) {
        cur = "";
        has = false;
      } else pushWord();
      while (i + 1 < n && /[<>&|]/.test(src[i + 1])) i++;
      redirNext = true;
      continue;
    }
    cur += ch;
    has = true;
  }
  endCmd("end");
  return cmds;
}

// ─── Command resolution ──────────────────────────────────────────────────────────────────────
function recordAssignment(word, env) {
  const eq = word.indexOf("=");
  const v = expandWord(word.slice(eq + 1), env);
  env.vars.set(word.slice(0, eq), v == null ? undefined : v.split(G).join(""));
}
const IS_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Skip assignments and wrappers to find the real command word.
// Returns {name, args, isSudo, viaXargs} or null when the segment has no command.
function resolveCommand(words, env) {
  let i = 0;
  let isSudo = false;
  let viaXargs = false;
  const flag = () => i < words.length && plain(words[i]).startsWith("-");
  while (i < words.length) {
    const w = plain(words[i]);
    const b = baseCmd(w);
    if (IS_ASSIGNMENT.test(words[i])) {
      recordAssignment(words[i], env);
      i++;
    } else if (b === "sudo" || b === "doas") {
      isSudo = true;
      i++;
      while (flag()) if (/^-[ughpCRTr]$/.test(plain(words[i++]))) i++;
    } else if (SKIP_WORDS.has(b)) {
      i++;
      while (flag()) {
        const f = plain(words[i++]);
        if (b === "caffeinate" && /^-[tw]$/.test(f)) i++;
      }
    } else if (b === "nice") {
      i++;
      while (flag()) if (plain(words[i++]) === "-n") i++;
    } else if (b === "env") {
      i++;
      while (i < words.length) {
        const f = plain(words[i]);
        if (f.startsWith("-")) {
          i++;
          if (/^-[uCSP]$/.test(f)) i++;
        } else if (IS_ASSIGNMENT.test(words[i])) {
          recordAssignment(words[i], env);
          i++;
        } else break;
      }
    } else if (b === "timeout") {
      i++;
      while (flag()) if (/^-[sk]$/.test(plain(words[i++]))) i++;
      i++; // the duration
    } else if (b === "xargs") {
      viaXargs = true;
      i++;
      while (flag()) if (/^-[IJLnPRSsdEa]$/.test(plain(words[i++]))) i++;
    } else {
      return { name: b, args: words.slice(i + 1), isSudo, viaXargs };
    }
  }
  return null;
}

// Is this word a listing root that cannot reach a protected folder: relative (and, when the cwd
// is known, not resolving to a protected path) or below a temp root?
function relSafe(word, env) {
  const pw = plain(word);
  const t = resolveOperand(word, env);
  if (t) {
    if (isTempPath(t.path)) return true;
    if (/^[/~]/.test(pw) || pw.includes("$")) return false;
    return !isProtectedPath(t.path);
  }
  return !/^[/~]/.test(pw) && !pw.includes("$");
}
function findStarts(args) {
  const p = args.map(plain);
  let k = 0;
  while (k < p.length && /^-[HLPEXdsx]+$/.test(p[k])) k++;
  const starts = [];
  while (k < p.length && !/^[-(!]/.test(p[k])) starts.push(args[k++]);
  return { starts: starts.length ? starts : ["."], expr: p.slice(k) };
}
// `xargs rm -r` is allowed only when the pipeline starts from a listing rooted at a relative or
// temp path. xargs splits on whitespace, so an absolute listing with a space in a path can hand rm
// a parent directory (the 2026-11 `~/Library` incident).
function sourceIsSafe(pipe, env) {
  const src = pipe.length ? pipe[0].r : null;
  if (!src) return false;
  if (src.name === "git") return true;
  if (src.name === "find") return findStarts(src.args).starts.every((w) => relSafe(w, env));
  if (["ls", "fd", "echo", "printf", "grep", "rg"].includes(src.name)) {
    const ops = src.args.filter((w) => !plain(w).startsWith("-"));
    return (ops.length ? ops : ["."]).every((w) => relSafe(w, env));
  }
  return false;
}

// ─── Analyzer ────────────────────────────────────────────────────────────────────────────────
function analyze(src, env, depth) {
  if (depth > 4) return null;
  const cmds = lex(src);
  for (let ci = 0; ci < cmds.length; ci++) {
    const c = cmds[ci];
    const r = (c.r = resolveCommand(c.words, env));
    if (!r) continue;
    const args = r.args;
    const pargs = args.map(plain);
    let k = ci;
    while (k > 0 && cmds[k].sep === "|") k--;
    const pipe = cmds.slice(k, ci);
    const inner = (text, cwd) => analyze(text, { cwd, vars: new Map(env.vars) }, depth + 1);

    if (r.name === "cd" || r.name === "pushd") {
      const a = args.filter((w) => plain(w) === "-" || !plain(w).startsWith("-"));
      if (!a.length) env.cwd = HOME_DIR;
      else if (plain(a[0]) === "-") env.cwd = null;
      else {
        const t = resolveOperand(a[0], env);
        env.cwd = t && !t.glob ? t.path : null;
      }
    } else if (r.name === "popd") {
      env.cwd = null;
    } else if (["export", "local", "declare", "readonly", "typeset"].includes(r.name)) {
      for (const w of args) if (IS_ASSIGNMENT.test(w)) recordAssignment(w, env);
    } else if (r.name === "for" && pargs[1] === "in") {
      // remember the most dangerous candidate so `for d in ~ x; do rm -rf "$d"` is seen
      const cands = args.slice(2).map((w) => resolveOperand(w, env)).filter(Boolean);
      const hit = cands.find((t) => isProtectedPath(t.path)) || cands[0];
      env.vars.set(pargs[0], hit ? hit.path : undefined);
    } else if (SHELLS.has(r.name)) {
      let f = 0;
      let cmdString = null;
      while (f < args.length && pargs[f].startsWith("-")) {
        if (!pargs[f].startsWith("--") && pargs[f].includes("c")) {
          cmdString = args[f + 1];
          break;
        }
        f++;
      }
      if (cmdString != null) {
        const hit = inner(plain(cmdString), env.cwd);
        if (hit) return hit;
      } else if (f >= args.length) {
        // no script operand: the shell reads commands from a heredoc or from the pipe
        const fed = [...c.heredocs];
        for (const p of pipe) {
          fed.push(...p.heredocs);
          if (p.r && (p.r.name === "echo" || p.r.name === "printf")) fed.push(p.r.args.map(plain).join(" "));
        }
        for (const text of fed) {
          const hit = inner(text, env.cwd);
          if (hit) return hit;
        }
      }
    } else if (r.name === "eval") {
      const hit = inner(pargs.join(" "), env.cwd);
      if (hit) return hit;
    } else if (r.name === "ssh") {
      // the remote command starts in the remote home; judge it as if it ran in ours
      const host = pargs.findIndex((p) => !p.startsWith("-"));
      const remote = [pargs.slice(host + 1).join(" "), ...c.heredocs];
      for (const text of remote) {
        const hit = text ? inner(text, HOME_DIR) : null;
        if (hit) return hit;
      }
    } else if (r.name === "rm") {
      const flags = [];
      const ops = [];
      let dd = false;
      for (let a = 0; a < args.length; a++) {
        if (!dd && pargs[a] === "--") dd = true;
        else if (!dd && pargs[a].startsWith("-")) flags.push(pargs[a]);
        else ops.push(args[a]);
      }
      const rec = hasRecursiveFlag(flags);
      for (const op of ops) {
        const t = resolveOperand(op, env);
        if (!t) continue;
        if (t.glob) {
          if (globParentBlocks(t.path, rec)) return rec ? LABEL_RM : LABEL_GLOB;
        } else if (isProtectedPath(t.path)) {
          if (rec) return LABEL_RM;
          if (r.isSudo) return LABEL_SUDO;
        }
      }
      if (r.viaXargs && rec && !sourceIsSafe(pipe, env)) return LABEL_XARGS;
    } else if (r.name === "chmod") {
      const flags = pargs.filter((x) => x.startsWith("-"));
      const ops = args.filter((w) => !plain(w).startsWith("-"));
      const rec = hasRecursiveFlag(flags);
      const has777 = pargs.includes("777") || flags.some((f) => /777/.test(f));
      const cata = ops.some((w) => {
        const t = resolveOperand(w, env);
        return t && isProtectedPath(t.path);
      });
      if (has777 && (rec || cata)) return LABEL_CHMOD;
    } else if (r.name === "find") {
      const { starts, expr } = findStarts(args);
      let destructive = expr.includes("-delete");
      for (let e = 0; e < expr.length && !destructive; e++) {
        if (!/^-(exec|execdir|ok|okdir)$/.test(expr[e])) continue;
        for (let j = e + 1; j < expr.length && expr[j] !== ";" && expr[j] !== "+"; j++) {
          if (baseCmd(expr[j]) === "rm" || /(^|[\s;&|])rm\s/.test(expr[j])) destructive = true;
        }
      }
      if (destructive) {
        const narrowed = expr.some((x) =>
          /^-(name|iname|path|ipath|regex|iregex|newer|mtime|mmin|size|empty)$/.test(x)
        );
        for (const s of starts) {
          const t = resolveOperand(s, env);
          if (!t) continue;
          if (isTopRoot(t.path) || (isProtectedPath(t.path) && !narrowed)) return LABEL_FIND;
        }
      }
    }
  }
  return null;
}

// v2 segment matcher, kept verbatim as the fallback if the analyzer ever throws: a bug in the new
// code must not leave the guard weaker than it was.
function legacySegments(norm) {
  const segments = norm.split(/[;&|]+/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const toks = seg.split(" ").filter(Boolean);
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
      if (rec && cata) return LABEL_RM;
      if (isSudo && cata) return LABEL_SUDO;
    } else if (name === "chmod") {
      const rec = hasRecursiveFlag(flags);
      const has777 = operands.includes("777") || flags.some((f) => /777/.test(f));
      if (has777 && (rec || operands.some(isCatastrophicTarget))) return LABEL_CHMOD;
    }
  }
  return null;
}

// Returns a label string on a catastrophe match, else null. `cwd` is optional: the hook passes
// the payload's cwd; cco-dream and the raw backstop call with the command only.
function detectCatastrophe(cmd, cwd = null) {
  const text = String(cmd);
  // Normalize for the intrinsic patterns: drop quotes/backslashes, collapse whitespace.
  const norm = text.replace(/['"\\]/g, "").replace(/\s+/g, " ").trim();

  // 1) Whole-command, self-contained patterns (intrinsically catastrophic, low false-positive).
  //    These run first and on the un-lexed string, so later separator handling cannot hide them.
  if (/:\(\)\s*\{.*\|.*&.*\}\s*;\s*:/.test(norm)) return "fork bomb";
  if (/\bdd\b[^;&|]*\bof=\/dev\/(disk|sd|rdisk|nvme|hd)/i.test(norm)) return "dd to a raw device";
  if (/\bmkfs(\.[a-z0-9]+)?\b[^;&|]*\/dev\//i.test(norm)) return "mkfs on a device";
  if (/>\s*\/dev\/(disk|sd|rdisk|nvme|hd)\b/i.test(norm)) return "redirect over a raw device";

  // 2) Quote-aware analysis of every simple command.
  let start = null;
  if (typeof cwd === "string" && cwd.startsWith("/")) {
    start = path.posix.normalize(cwd);
    if (start.length > 1) start = start.replace(/\/+$/, "");
  }
  try {
    return analyze(text, { cwd: start, vars: new Map() }, 0);
  } catch (e) {
    return legacySegments(norm);
  }
}

// HARDEN-02 raw backstop: detect a catastrophe in the UNPARSED stdin (which may be malformed JSON,
// truncated, or arbitrary garbage that WRAPS the command). Precise pass first, then a deliberately
// COARSER flat token scan for the embedded-text case. It KEEPS the catastrophic-root requirement
// (and the recursive-flag / sudo / 777 requirement), so a benign-unparseable blob and a normal
// local destructive command are NOT matched and the caller still FAILS OPEN (no Bash wedge).
function rawCatastrophe(rawInput) {
  // The payload's own cwd and transcript_path are paths under home; they are not operands.
  const raw = String(rawInput).replace(/"(cwd|transcript_path)"\s*:\s*"[^"]*"/g, '""');
  const precise = detectCatastrophe(raw);
  if (precise) return precise;

  const norm = raw.replace(/['"\\]/g, "").replace(/\s+/g, " ").trim();
  const toks = norm.split(" ").filter(Boolean);
  const hasRm = toks.some((t) => baseCmd(t) === "rm" || t === "rm" || /(^|[^a-z])rm$/.test(t));
  const hasChmod = toks.some((t) => baseCmd(t) === "chmod" || t === "chmod" || /(^|[^a-z])chmod$/.test(t));
  const hasSudo = toks.includes("sudo");
  const flags = toks.filter((x) => x.startsWith("-"));
  const operands = toks.filter((x) => !x.startsWith("-"));
  const cataRoot = operands.some(isCatastrophicTarget);
  const recursive = hasRecursiveFlag(flags);
  const has777 = operands.includes("777") || flags.some((f) => /777/.test(f));

  if (hasRm && cataRoot && (recursive || hasSudo)) return LABEL_RM;
  if (hasChmod && has777 && (recursive || cataRoot)) return LABEL_CHMOD;
  return null;
}

// HARDEN-05: the ONE clean block path. exit 2 discards stdout JSON, so we write ONLY the stderr
// reason and exit 2. Used by BOTH the parsed deny and the raw backstop.
function denyAndExit(label) {
  const reason =
    `Destructive command blocked by cco-permission-guard: matched [${label}]. ` +
    `If this is intentional, run it yourself manually outside the agent.`;
  try { process.stderr.write(reason + "\n"); } catch (e) {}
  process.exit(2);
}

// Pure-predicate export for the test harness and for cco-dream. When this file is run directly
// (as the PreToolUse hook), require.main === module and we DO read stdin below. When it is
// require()d, we expose the pure helpers and SKIP the stdin reader (no hang, no exit).
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
  // pipe-hang guard. HARDEN-02: backstop on the input-so-far before failing open.
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
    // Only gate Bash. A `Bash` matcher also delivers Monitor commands here as Bash calls.
    if (data.tool_name !== "Bash") process.exit(0);
    const sessionId = data.session_id || "";
    if (/[/\\]|\.\./.test(sessionId)) {
      // V5 traversal guard. HARDEN-02: backstop the raw input before failing open.
      const label = rawCatastrophe(input);
      if (label) denyAndExit(label);
      process.exit(0);
    }
    const cmd = (data.tool_input && data.tool_input.command) || "";
    if (!cmd) process.exit(0); // empty command: benign no-op, fail open

    const label = detectCatastrophe(cmd, data.cwd);
    if (label) denyAndExit(label);
    process.exit(0); // no match: allow silently
  } catch (e) {
    // HARDEN-02: a malformed-but-catastrophic command lands here. Backstop on the raw input.
    const label = rawCatastrophe(input);
    if (label) denyAndExit(label);
    process.exit(0); // FAIL OPEN for benign-unparseable input (T-02-07)
  }
});
