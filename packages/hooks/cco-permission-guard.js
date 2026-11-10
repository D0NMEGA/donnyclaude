#!/usr/bin/env node
// cco-hook-version: 4
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
// v4 (2026-11-10, after a 190-string probe of v3): a variable that nothing in the command or the
// environment sets expands to nothing, as it does in the shell (`rm -rf "$BUILD_DIR"/*` is
// `rm -rf /*` when the variable did not survive from an earlier Bash call); `$(pwd)`,
// `${VAR:-x}`, `${VAR%/}`, brace lists and $'...' are expanded; a subshell's `cd` no longer
// leaks into the commands after it; and here-strings, `su -c`, `osascript ... do shell script`,
// `find -exec <command>`, `env -S`, `arch`, `noglob`, `nocorrect` and `=cmd` are followed to the
// command they run.
//
// Deliberately kept as in v3, after a review loop and an oracle test against real shells showed
// that modelling them precisely kept producing new mistakes: a function body is read in line
// where it is defined (calls are not followed, `local` is an ordinary assignment); `eval` text
// is judged on a copy of the state; and a value given by a plain assignment changes only
// through another plain assignment, because the guard cannot tell whether `false && unset x`
// ran. Conditions are not evaluated: a `cd` after `&&` or inside `if` counts as run.
// Also not followed: process substitution (`bash <(...)`), other interpreters, trap handlers,
// and a brace group or loop used as a pipeline element. The probe table records these as
// limits (rows marked L), and .fixtures/guard-oracle.cjs measures them against real shells.
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
const S = "\u0002"; // placeholder: the output of a command substitution (unknowable)
const P = "\u0003"; // placeholder: the output of `$(pwd)` (the tracked cwd)
const D = "\u0004"; // prefix: the ${...} that follows sat inside double quotes
const GONE = Symbol("unset"); // value of a variable removed with `unset`
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const SKIP_WORDS = new Set([
  "command", "builtin", "exec", "time", "nohup", "caffeinate", "stdbuf",
  "noglob", "nocorrect", "setsid", "unbuffer",
  "do", "then", "else", "elif", "if", "while", "until", "!", "{", "}",
]);

const LABEL_RM = "rm -r on / ~ $HOME or a system dir";
const LABEL_SUDO = "sudo rm on a catastrophic target";
const LABEL_CHMOD = "chmod 777 recursive or on a system root";
const LABEL_GLOB = "rm of a wildcard directly under a protected folder";
const LABEL_FIND = "find with -delete or -exec rm rooted at a protected folder";
const LABEL_XARGS = "xargs feeding rm -r from a listing that is not provably project-relative";
// Variables the shell sets by itself: never treated as unset.
const SHELL_SET =
  /^(OLDPWD|RANDOM|SECONDS|LINENO|REPLY|reply|OPTARG|OPTIND|IFS|HOST|HOSTNAME|UID|EUID|GID|EGID|USERNAME|PPID|_|argv|status|pipestatus|match|MATCH|MBEGIN|MEND|CDPATH|BASH\w*|ZSH\w*|EPOCH\w*)$/;

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
  return word.split(M).join("").split(D).join("");
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
// Expand `~`, variables, `${VAR<op>word}` and the `$(pwd)` placeholder. Returns the text with
// live wildcards prefixed by G, or null when the word holds an expansion we cannot know.
function matchBrace(s, open) {
  let depth = 0;
  const stop = Math.min(s.length, open + 2000); // an expansion is short; keep the scan bounded
  for (let j = open; j < stop; j++) {
    const c = s[j];
    if (c === M || c === "\\") j++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j;
  }
  return -1;
}

// Record a variable. `strong` marks a value v3 would also have known (a plain assignment built
// from literals, ~, $HOME, $PWD and other strong variables). Builtins that set a variable to
// something unknowable may replace a weak value, never a strong one: what v3 saw, v4 still sees.
function setVar(env, name, value, strong) {
  env.vars.set(name, value);
  if (!env.strong) env.strong = new Set();
  if (strong && typeof value === "string") env.strong.add(name);
  else env.strong.delete(name);
}
function v3Knows(word, env) {
  if (/[\u0002\u0003\u0004]/.test(word) || /\$\{[A-Za-z_][A-Za-z0-9_]*[^}A-Za-z0-9_]/.test(word)) return false;
  const refs = word.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*/g) || [];
  return refs.every((r) => {
    const n = r.replace(/^\$\{?/, "");
    return n === "HOME" || n === "PWD" || !!(env.strong && env.strong.has(n));
  });
}

// Value of a variable at this point: a string, "" when nothing in this command or in the
// environment sets it (the shell expands it to nothing), or null when its value is unknowable.
function lookupVar(name, env) {
  if (name === "HOME") return HOME_DIR;
  const known = env.vars.get(name);
  if (known !== GONE) {
    if (env.vars.has(name)) return known == null ? null : known;
    if (name === "PWD") return env.cwd;
    if (env.loose || env.inFn || SHELL_SET.test(name)) return null;
    if (typeof process.env[name] === "string") return process.env[name];
  }
  env.unset = name;
  return "";
}
// Set, possibly to the empty string: `${x-word}` and `${x:-word}` differ exactly here.
function isSetVar(name, env) {
  if (name === "HOME" || name === "PWD") return true;
  return env.vars.has(name) ? env.vars.get(name) !== GONE : typeof process.env[name] === "string";
}

// ${v%pat} ${v%%pat} ${v#pat} ${v##pat}; `pat` carries G-marked wildcards. null = not modelled.
function stripPattern(v, pat, op) {
  if (v.length > 512) return null;
  let re = "";
  let stars = 0;
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === G) {
      const c = pat[++i];
      if (c === "*" && ++stars <= 2) re += "[\\s\\S]*";
      else if (c === "?") re += "[\\s\\S]";
      else return null;
    } else re += pat[i].replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  }
  const rx = new RegExp("^" + re + "$");
  const n = v.length;
  const longest = op.length === 2;
  for (let k = 0; k <= n; k++) {
    if (op[0] === "%") {
      const i = longest ? k : n - k;
      if (rx.test(v.slice(i))) return v.slice(0, i);
    } else {
      const i = longest ? n - k : k;
      if (rx.test(v.slice(0, i))) return v.slice(i);
    }
  }
  return v;
}

// The word after an operator inside ${...} keeps its quoting: `${x:-'~'}` and `"${x:-~}"` are a
// literal tilde, `${x:-"$HOME"}` still expands. `dq` says the whole ${...} sat inside double
// quotes, where a single quote is an ordinary character. A nested ${...} is passed through whole.
function unquoteArg(arg, dq) {
  const lit = (c) => (/[~*?[${},]/.test(c) ? M + c : c);
  let out = "";
  let q = null;
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    const quoted = dq || q === '"';
    if (c === M) out += c + (arg[++i] || "");
    else if (q === "'") {
      if (c === "'") q = null;
      else out += lit(c);
    } else if (c === "$" && arg[i + 1] === "{" && matchBrace(arg, i + 1) !== -1) {
      const e = matchBrace(arg, i + 1);
      out += (quoted ? D : "") + arg.slice(i, e + 1);
      i = e;
    } else if (c === "\\" && i + 1 < arg.length) out += lit(arg[++i]);
    else if (c === '"') q = q === '"' || dq ? null : '"';
    else if (quoted) out += c === "$" ? c : lit(c);
    else if (c === "'") q = c;
    else out += c;
  }
  return out;
}

function expandWord(word, env) {
  let out = "";
  let first = true;
  let dqNext = false;
  for (let i = 0; i < word.length; ) {
    const ch = word[i];
    if (ch === D) {
      dqNext = true;
      i++;
      continue;
    }
    if (ch === M) {
      out += word[i + 1] === undefined ? "" : word[i + 1];
      i += 2;
    } else if (ch === S) {
      return null;
    } else if (ch === P) {
      if (!env.cwd) return null;
      out += env.cwd;
      i++;
    } else if (ch === "~" && first) {
      let j = i + 1;
      let user = "";
      while (j < word.length && word[j] !== "/" && word[j] !== M) user += word[j++];
      if (user === "+") {
        if (!env.cwd) return null;
        out += env.cwd;
        i = j;
      } else if (user === "-") {
        return null;
      } else if (user && !/^[A-Za-z0-9._-]+$/.test(user)) {
        out += ch;
        i++;
      } else {
        out += user ? "/Users/" + user : HOME_DIR;
        i = j;
      }
    } else if (ch === "$") {
      const inDq = dqNext;
      dqNext = false;
      let name;
      let op = "";
      let arg = "";
      let len;
      if (word[i + 1] === "{") {
        const end = matchBrace(word, i + 1);
        const m =
          end === -1
            ? null
            : /^([A-Za-z_][A-Za-z0-9_]*)(:?[-=+?]|%%?|##?)?([\s\S]*)$/.exec(word.slice(i + 2, end));
        if (!m || (!m[2] && m[3])) return null; // ${#x}, ${x[1]}, ${x/a/b}, ${x:1:2}: not modelled
        name = m[1];
        op = m[2] || "";
        arg = m[3];
        len = end - i + 1;
      } else {
        const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(word.slice(i));
        if (!m) return null;
        name = m[1];
        len = m[0].length;
      }
      let v = lookupVar(name, env);
      if (v == null) return null;
      // under `set -u` an unset variable stops the shell unless the expansion supplies a value
      if (env.nounset && v === "" && !isSetVar(name, env) && !/[-=+]$/.test(op)) return null;
      if (op) {
        const kind = op[op.length - 1];
        // with a colon the test is "unset or empty"; without it, "unset" only
        const missing = op[0] === ":" ? v === "" : !isSetVar(name, env);
        if (op[0] === "%" || op[0] === "#") {
          const pat = expandWord(unquoteArg(arg, false), env); // a pattern even inside quotes
          v = pat == null ? null : stripPattern(v, pat, op);
        } else if (kind === "-" || kind === "=") {
          if (missing) {
            env.unset = null;
            v = expandWord(unquoteArg(arg, inDq), env);
            if (kind === "=") {
              if (env.ro && env.ro.has(name)) return null; // assigning to a readonly variable fails
              // a value from a plain assignment stays (the command holding this may be skipped)
              if (!(env.strong && env.strong.has(name))) {
                setVar(env, name, v == null ? undefined : v.split(G).join(""), false);
              }
            }
          }
        } else if (kind === "+") {
          v = missing ? "" : expandWord(unquoteArg(arg, inDq), env);
        } else if (missing) {
          return null; // ${x:?}: the shell stops with an error instead of running the command
        }
        if (v == null) return null;
      }
      out += v;
      i += len;
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

// Brace lists (`{a,b}`) on a lexed word; quoted braces carry M and `${...}` is skipped. The shell
// expands braces before `~`, so `{~,/tmp/x}` reaches the home folder.
function braceExpand(word, limit = 64) {
  if (word.length > 4096) return [word];
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === M) {
      i++;
      continue;
    }
    if (ch === "$" && word[i + 1] === "{") {
      const e = matchBrace(word, i + 1);
      if (e === -1) return [word];
      i = e;
      continue;
    }
    if (ch !== "{") continue;
    let depth = 0;
    let end = -1;
    const commas = [];
    for (let j = i; j < word.length; j++) {
      const c = word[j];
      if (c === M) j++;
      else if (c === "$" && word[j + 1] === "{") {
        const e = matchBrace(word, j + 1);
        if (e === -1) break;
        j = e;
      } else if (c === "{") depth++;
      else if (c === "}") {
        if (--depth === 0) {
          end = j;
          break;
        }
      } else if (c === "," && depth === 1) commas.push(j);
    }
    if (end === -1 || !commas.length) continue; // `{}` or `{a..b}`: left as written
    const out = [];
    let s = i + 1;
    for (const cut of [...commas, end]) {
      for (const w of braceExpand(word.slice(0, i) + word.slice(s, cut) + word.slice(end + 1), limit)) {
        out.push(w);
        if (out.length >= limit) return out;
      }
      s = cut + 1;
    }
    return out;
  }
  return [word];
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
  const t = resolveOperand(String(tok), { cwd: null, vars: new Map(), loose: true });
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
  const stack = []; // open scopes: {kind: "(" subshell | ")" $(...) | "`", id, q, saved, start}
  let ids = 0;
  let waiting = []; // heredocs whose body starts at the next newline
  // `quoted[k]` records that word k had quotes: an empty quoted word is still an argument
  const newCmd = (sep) => ({ words: [], quoted: [], sep, heredocs: [], scopes: stack.map((e) => e.id) });
  let current = newCmd("start");
  let cur = "";
  let has = false;
  let q = null;
  let redirNext = false;
  let hereNext = false;
  let wq = false;
  const literal = (c) => (/[~*?[${},]/.test(c) ? M + c : c);
  const pushWord = () => {
    if (has) {
      if (hereNext) {
        // a here-string is stdin, like a heredoc body; kept as a word so it can be expanded
        (current.herestrings = current.herestrings || []).push(cur);
        hereNext = false;
      } else if (redirNext) redirNext = false;
      else {
        current.words.push(cur);
        current.quoted.push(wq);
      }
    }
    cur = "";
    has = false;
    wq = false;
  };
  const endCmd = (sep) => {
    pushWord();
    redirNext = false;
    hereNext = false;
    // an empty command is dropped, but the separator before it is kept for the next one:
    // in `a | (b)` the command `b` is led by "|"
    const lead = current.words.length ? null : current.lead || current.sep;
    if (current.words.length) cmds.push(current);
    current = newCmd(sep);
    if (lead) current.lead = lead;
  };
  // A command substitution runs first and its output lands inside the word being built, so the
  // outer command is parked, the inner commands are lexed, and a placeholder joins the word.
  const openSubst = (kind) => {
    stack.push({ kind, id: ++ids, q, saved: { current, cur, has, redirNext, hereNext, wq }, start: cmds.length });
    current = newCmd("subst");
    cur = "";
    has = false;
    wq = false;
    redirNext = false;
    hereNext = false;
    q = null;
  };
  const closeSubst = (top) => {
    pushWord();
    if (current.words.length) cmds.push(current);
    const inner = cmds.slice(top.start);
    const pwd = inner.length === 1 && inner[0].words.length === 1 && plain(inner[0].words[0]) === "pwd";
    ({ current, cur, has, redirNext, hereNext, wq } = top.saved);
    cur += pwd ? P : S;
    has = true;
    q = top.q;
  };
  // `((x = 1))` and `$((x += 1))` assign variables. The text is still lexed as nested groups,
  // so anything in it is judged; this only records what it assigns, as a `let` command.
  const noteArith = (open) => {
    let depth = 0;
    const stop = Math.min(src.length, open + 2000);
    for (let j = open; j < stop; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) {
        if (src[j - 1] === ")") {
          cmds.push({
            arith: true,
            words: ["let", src.slice(open + 2, j - 1)],
            quoted: [false, true],
            sep: ";",
            heredocs: [],
            scopes: stack.map((e) => e.id),
          });
        }
        return;
      }
    }
  };
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (q === "'") {
      if (ch === "'") q = null;
      else cur += literal(ch);
      continue;
    }
    if (ch === "`") {
      const top = stack[stack.length - 1];
      if (top && top.kind === "`") closeSubst(stack.pop());
      else openSubst("`");
      continue;
    }
    if (ch === "$" && src[i + 1] === "(") {
      if (src[i + 2] === "(") noteArith(i + 1);
      openSubst(")");
      i++;
      continue;
    }
    if (ch === "$" && src[i + 1] === "{") {
      // parameter expansion: keep it whole, expandWord interprets it
      const end = matchBrace(src, i + 1);
      // a substitution inside it still runs, so that case is lexed character by character
      if (end !== -1 && !/\$\(|`|[<>]\(/.test(src.slice(i, end + 1))) {
        cur += (q === '"' ? D : "") + src.slice(i, end + 1);
        has = true;
        i = end;
        continue;
      }
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
    if (ch === "$" && src[i + 1] === "'") {
      // $'...': ANSI-C quoting
      i += 2;
      while (i < n && src[i] !== "'") {
        let c = src[i];
        if (c === "\\" && i + 1 < n) {
          c = src[++i];
          const hex = c === "x" ? /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 1, i + 3)) : null;
          if (hex) {
            const code = parseInt(hex[0], 16);
            c = code < 4 ? "" : String.fromCharCode(code);
            i += hex[0].length;
          } else if ("ntr".includes(c)) c = c === "n" ? "\n" : c === "t" ? "\t" : "\r";
        }
        cur += literal(c);
        i++;
      }
      has = true;
      wq = true;
      continue;
    }
    if (ch === "$" && src[i + 1] === '"') continue; // $"...": the quotes that follow do the work
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
      wq = true;
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
      // `name=(` with nothing between: an array assignment, not a subshell after `name=`
      const array = has && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(cur);
      pushWord();
      if (array) current.arrayOpen = true;
      if (src[i + 1] === "(" && current.words.every((w) => SKIP_WORDS.has(w))) noteArith(i);
      // `name()` or `function name()`: a definition; its body runs later, with other variables
      if (current.words.length && current.words.length <= 2 && /^\s*\)/.test(src.slice(i + 1, i + 8))) {
        current.fn = true;
      }
      stack.push({ kind: "(", id: ++ids });
      endCmd("(");
      continue;
    }
    if (ch === ")") {
      const top = stack[stack.length - 1];
      if (top && top.kind === ")") closeSubst(stack.pop());
      else {
        if (top && top.kind === "(") stack.pop();
        endCmd(")");
      }
      continue;
    }
    if (ch === "|") {
      if (src[i + 1] === "|") {
        i++;
        endCmd("||");
      } else {
        if (src[i + 1] === "&") i++;
        current.piped = true; // feeds a pipe: it runs in a subshell of its own
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
      } else {
        current.bg = true; // a background job: a subshell of its own
        endCmd("&");
      }
      continue;
    }
    if (ch === "<" && src[i + 1] === "<" && src[i + 2] === "<") {
      // here-string: the next word is the command's stdin
      pushWord();
      i += 2;
      hereNext = true;
      continue;
    }
    if (ch === "<" && src[i + 1] === "<") {
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
  // an unterminated substitution: the parked outer commands still have to be judged
  while (stack.length) {
    const top = stack.pop();
    if (!top.saved) continue;
    ({ current, cur, has, redirNext, hereNext, wq } = top.saved);
    cur += S;
    has = true;
    endCmd("end");
  }
  return cmds;
}

// ─── Command resolution ──────────────────────────────────────────────────────────────────────
const IS_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=/;
function recordAssignment(word, env) {
  const m = IS_ASSIGNMENT.exec(word);
  if (env.ro && env.ro.has(m[1])) return; // assigning to a readonly variable fails
  const rhs = word.slice(m[0].length);
  const v = expandWord(rhs, env);
  const val = v == null ? undefined : v.split(G).join("");
  const strong = v3Knows(rhs, env);
  if (m[2]) {
    const prev = env.vars.has(m[1]) ? env.vars.get(m[1]) : "";
    const old = prev === GONE ? "" : prev;
    const was = !env.vars.has(m[1]) || !!(env.strong && env.strong.has(m[1]));
    setVar(env, m[1], val == null || old == null ? undefined : old + val, strong && was);
  } else setVar(env, m[1], val, strong);
}

// `env -S` splits its string itself: blanks separate words, quotes and backslashes group, and
// no shell reads the result, so `;`, `~` and wildcards in it are plain characters.
function splitEnvString(text) {
  const lit = (c) => (/[~*?[{},]/.test(c) ? M + c : c);
  const out = [];
  let cur = "";
  let has = false;
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < text.length) cur += lit(text[++i]);
      else cur += lit(c);
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === "\\" && i + 1 < text.length) {
      cur += lit(text[++i]);
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += lit(c);
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

// Skip assignments and wrappers to find the real command word.
// Returns {name, args, isSudo, viaXargs} or null when the segment has no command.
function resolveCommand(words, env) {
  let i = 0;
  let isSudo = false;
  let viaXargs = false;
  const flag = () => i < words.length && plain(words[i]).startsWith("-");
  while (i < words.length) {
    const w = plain(words[i]);
    const b = baseCmd(w).replace(/^=/, ""); // zsh `=rm` is the path of rm
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
    } else if (b === "function") {
      i += 2; // `function name { body`: the body is read in line, like `name() { body`
    } else if (b === "nice") {
      i++;
      while (flag()) if (plain(words[i++]) === "-n") i++;
    } else if (b === "arch") {
      i++;
      while (flag()) if (/^-[de]$/.test(plain(words[i++]))) i++;
    } else if (b === "env") {
      i++;
      while (i < words.length) {
        const f = plain(words[i]);
        if (/^-S/.test(f) || /^--split-string(=|$)/.test(f)) {
          // `env -S "cmd args"` splits the string on blanks itself; no shell reads it, so
          // separators, `~` and wildcards inside it are plain characters
          const glued = f === "-S" || f === "--split-string" ? null : f.replace(/^(-S|--split-string=)/, "");
          const parts = splitEnvString(glued == null ? plain(words[i + 1] || "") : glued);
          words = [...words.slice(0, i), ...parts, ...words.slice(i + (glued == null ? 2 : 1))];
          continue;
        }
        if (f.startsWith("-")) {
          i++;
          if (/^-[uCP]$/.test(f)) i++;
        } else if (IS_ASSIGNMENT.test(words[i])) {
          recordAssignment(words[i], env);
          i++;
        } else break;
      }
    } else if (b === "timeout" || b === "gtimeout") {
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
  return { starts: starts.length ? starts : ["."], expr: p.slice(k), raw: args.slice(k) };
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
// The variable names a builtin assigns, and only those: `read a b`, `read -a arr`,
// `printf -v name`, `getopts spec name`, `mapfile arr`, `for name`, `select name`.
function assignedNames(cmd, pargs) {
  const ident = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s || "");
  const out = [];
  if (cmd === "for" || cmd === "select") {
    if (ident(pargs[0])) out.push(pargs[0]);
  } else if (cmd === "printf") {
    if (pargs[0] === "-v" && ident(pargs[1])) out.push(pargs[1]);
    else if (/^-v./.test(pargs[0] || "") && ident(pargs[0].slice(2))) out.push(pargs[0].slice(2));
  } else {
    // option letters that take a value; `read -a NAME` names an array to fill
    const takes = cmd === "read" ? "adinNptu" : cmd === "getopts" ? "" : "dnOsuCc";
    const rest = [];
    for (let k = 0; k < pargs.length; k++) {
      const p = pargs[k];
      if (p.length > 1 && p.startsWith("-")) {
        const last = p[p.length - 1];
        if (takes.includes(last)) {
          k++;
          if (cmd === "read" && last === "a" && ident(pargs[k])) out.push(pargs[k]);
        }
      } else rest.push(p.replace(/\?.*$/, "")); // zsh `read name?prompt`
    }
    if (cmd === "getopts") rest.shift(); // the option spec
    if (cmd !== "read") rest.splice(1);
    for (const p of rest) if (ident(p)) out.push(p);
  }
  return out;
}

// The variables an arithmetic expression assigns: `x=1`, `x+=2`, `x++`, `--x`. `value` is the
// number when the assignment is a plain `x=<decimal>`, else null (not worked out).
function arithTargets(expr) {
  const out = [];
  const re =
    /(?:\+\+|--)\s*([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)\s*(\+\+|--|(?:[-+*\/%&|^]|<<|>>)?=(?!=))\s*(-?(?:0|[1-9]\d*)(?![\w.#]))?/g;
  for (let m = re.exec(expr); m; m = re.exec(expr)) {
    const plainSet = m[2] && m[3] === "=" && m[4] != null && /^\s*([,)]|$)/.test(expr.slice(re.lastIndex));
    out.push({ name: m[1] || m[2], value: plainSet ? m[4] : null });
  }
  return out;
}

function analyze(src, env, depth) {
  return analyzeCmds(lex(src), env, depth);
}

function analyzeCmds(cmds, env, depth) {
  if (depth > 4) return null;
  const open = []; // subshell and substitution scopes we are inside: {id, cwd, vars}
  let fnPending = false; // the previous command was `name()`
  let fnDepth = 0; // brace depth inside the function body being read
  let fnEnds = false; // that body closed on the previous command
  let undo = null; // state to put back after a command that ran in a subshell of its own
  // A builtin that sets a variable to something we cannot know makes an unknown variable
  // unknowable. It never discards a value the command assigned: v3 kept that value, and a
  // `read` that fails or only tests for input (`read -t 0`) leaves it in place.
  // A value given by a plain assignment changes only through another plain assignment, as in
  // v3. The guard cannot tell whether `false && unset x` ran, so nothing else may discard it.
  const isStrong = (name) => !!(env.strong && env.strong.has(name) && typeof env.vars.get(name) === "string");
  const forget = (name) => {
    if (env.ro && env.ro.has(name)) return;
    if (isStrong(name)) return;
    setVar(env, name, undefined, false);
  };
  // a word the shell expands before another shell reads it (a -c string, a here-string)
  const expandText = (w) => {
    const v = expandWord(w, env);
    return v == null ? plain(w) : v.split(G).join("");
  };
  // the state a subshell cannot change for its parent
  const snap = () => ({
    cwd: env.cwd,
    vars: new Map(env.vars),
    loose: env.loose,
    nounset: env.nounset,
    cdUnset: env.cdUnset,
    ro: new Set(env.ro || []),
    strong: new Set(env.strong || []),
  });
  const restore = (o) => {
    env.cwd = o.cwd;
    env.vars = o.vars;
    env.loose = o.loose;
    env.nounset = o.nounset;
    env.cdUnset = o.cdUnset;
    env.ro = o.ro;
    env.strong = o.strong;
  };
  for (let ci = 0; ci < cmds.length; ci++) {
    const c = cmds[ci];
    if (undo) {
      restore(undo);
      undo = null;
    }
    if (fnEnds) {
      env.inFn = false;
      fnEnds = false;
    }
    // What a subshell or a command substitution does to the cwd and to variables ends with it.
    let keep = 0;
    while (keep < open.length && keep < c.scopes.length && open[keep].id === c.scopes[keep]) keep++;
    if (keep < open.length) {
      restore(open[keep]);
      open.length = keep;
    }
    for (let s = keep; s < c.scopes.length; s++) open.push({ id: c.scopes[s], ...snap() });
    // A command that feeds a pipe or runs in the background has a subshell of its own, and so
    // does the last command of a pipeline except in zsh and ksh: what it does to the cwd and
    // to variables is put back after it.
    const apart = !!c.piped || !!c.bg || (c.sep === "|" && !env.lastpipe);
    if (apart) undo = snap();

    // an assignment word (`dir={a,b}`) is not brace-expanded, before the command word or as an
    // argument of export, local, declare, typeset and readonly
    let lead = true;
    let decl = false;
    const lists = c.words.map((w) => {
      if (IS_ASSIGNMENT.test(w) && (lead || decl)) return [w];
      if (lead && !SKIP_WORDS.has(plain(w))) {
        lead = false;
        decl = /^(export|local|declare|typeset|readonly)$/.test(plain(w));
      }
      return braceExpand(w);
    });
    c.quoted = lists.flatMap((l, k) => l.map(() => !!(c.quoted && c.quoted[k])));
    c.words = lists.flat();
    // A function body runs later, if at all, with the caller's variables. It is read in line, as
    // v3 read it: its `cd` and its assignments count as if it ran here. Inside it an unknown
    // variable stays unknown, and the v4 rules that forget, unset or relax variables are not
    // applied, so a definition can never make the guard see less than v3 did. Calls are not
    // followed.
    const opens = c.words.filter((w) => w === "{").length;
    const closes = c.words.filter((w) => w === "}").length;
    if (!env.inFn && opens && (fnPending || plain(c.words[0]) === "function")) {
      env.inFn = true;
      fnDepth = 0;
    }
    fnPending = !!c.fn;
    const r = (c.r = resolveCommand(c.words, env));
    const lastWord = c.words[c.words.length - 1];
    const arr = lastWord ? IS_ASSIGNMENT.exec(lastWord) : null;
    if (c.arrayOpen && arr && arr[0].length === lastWord.length) {
      setVar(env, arr[1], undefined, false); // NAME=( ... ): an array, not modelled
    }
    if (env.inFn) {
      fnDepth += opens - closes;
      if (fnDepth <= 0) fnEnds = true;
    }
    const top = !env.inFn; // outside a function body: the v4 state rules apply
    if (top && r && r.name === "for" && !r.args.length) env.loose = true; // `for ((...))`: not modelled
    if (!r) continue;
    const args = r.args;
    const pargs = args.map(plain);
    // The commands piped into this one, skipping substitutions nested in them. Built only when
    // asked for (a shell reading stdin, `xargs rm`), so a long pipeline stays linear.
    let pipeMemo = null;
    const pipeOf = () => {
      if (pipeMemo) return pipeMemo;
      pipeMemo = [];
      for (let j = ci - 1, link = c; j >= 0 && link.sep === "|"; j--) {
        if (cmds[j].scopes.length > c.scopes.length) continue;
        if (cmds[j].scopes.length < c.scopes.length) break;
        pipeMemo.push(cmds[j]);
        link = cmds[j];
      }
      return pipeMemo.reverse();
    };
    // the state a new shell starts with; `nounset` is true when it is started with -u
    // `lastpipe`: the last command of a pipeline runs in the shell itself (zsh, ksh)
    const sub = (cwd, loose, nounset, lastpipe) => ({
      cwd,
      vars: new Map(env.vars),
      loose: loose || env.loose || !!env.inFn,
      nounset: !!nounset,
      lastpipe: !!lastpipe,
      ro: new Set(env.ro || []),
      strong: new Set(env.strong || []),
    });
    const inner = (text, cwd, loose, nounset, lastpipe) =>
      analyze(text, sub(cwd, loose, nounset, lastpipe), depth + 1);
    // Text a shell reading stdin on this command would run: heredocs, here-strings, piped echo.
    const fed = () => {
      const texts = [...c.heredocs, ...(c.herestrings || []).map(expandText)];
      for (const p of pipeOf()) {
        texts.push(...p.heredocs);
        if (p.r && (p.r.name === "echo" || p.r.name === "printf")) texts.push(p.r.args.map(plain).join(" "));
      }
      return texts;
    };
    const anyHit = (texts, cwd, loose, nounset, lastpipe) => {
      for (const t of texts) {
        const hit = t ? inner(t, cwd, loose, nounset, lastpipe) : null;
        if (hit) return hit;
      }
      return null;
    };

    if (r.name === "cd" || r.name === "pushd") {
      const a = args.filter((w) => plain(w) === "-" || !plain(w).startsWith("-"));
      if (!a.length) env.cwd = HOME_DIR;
      else if (plain(a[0]) === "-") env.cwd = null;
      else {
        env.unset = null;
        if (expandWord(a[0], env) === "") {
          // Quoted, an empty argument leaves the shell where it is. Unquoted, the word
          // vanishes and `cd` goes to the home folder.
          const at = c.words.indexOf(a[0]);
          if (at === -1 || !(c.quoted || [])[at]) {
            env.cwd = HOME_DIR;
            env.cdUnset = env.unset;
          }
        } else {
          const t = resolveOperand(a[0], env);
          env.cwd = t && !t.glob ? t.path : null;
          env.cdUnset = null;
        }
      }
    } else if (r.name === "popd") {
      env.cwd = null;
    } else if (r.name === "let") {
      for (const t of top ? arithTargets(pargs.join(" ")) : []) {
        // v3 saw the assignment inside `((x=2))`, not the one in `let x=2`
        const may = c.arith || !isStrong(t.name);
        if (t.value != null && may && !(env.ro && env.ro.has(t.name))) setVar(env, t.name, t.value, !!c.arith);
        else forget(t.name);
      }
    } else if (r.name === "set") {
      // `set -u`: an unset variable stops the shell instead of expanding to nothing
      // options end at the first word that is not one: `set foo -u` sets two positional arguments
      for (let k = 0; top && k < pargs.length && /^[-+]/.test(pargs[k]) && pargs[k] !== "--"; k++) {
        const p = pargs[k];
        if (/^[-+][A-Za-z]*u/.test(p)) env.nounset = p[0] === "-";
        if (/^[-+][A-Za-z]*o$/.test(p)) {
          if (pargs[k + 1] === "nounset") env.nounset = p[0] === "-";
          k++; // the option name
        }
      }
    } else if (r.name === "unset") {
      // plain `unset NAME` (or -v) only; a readonly variable and an assigned value stay
      if (top && !pargs.some((p) => p.startsWith("-") && p !== "-v")) {
        for (const p of pargs) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) && !(env.ro && env.ro.has(p)) && !isStrong(p)) {
            setVar(env, p, GONE, false);
          }
        }
      }
    } else if (["export", "local", "declare", "readonly", "typeset"].includes(r.name)) {
      const ro = r.name === "readonly" || pargs.some((p) => /^-[A-Za-z]*r/.test(p));
      for (const w of args) {
        const m = IS_ASSIGNMENT.exec(w);
        if (m) recordAssignment(w, env);
        else if (top && /[$\u0002\u0003]/.test(plain(w))) env.loose = true; // names computed at run time
        const name = m ? m[1] : plain(w);
        // a readonly variable keeps its value: later assignments and `unset` fail
        if (ro && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) (env.ro = env.ro || new Set()).add(name);
      }
    } else if (r.name === "for" && pargs[1] === "in") {
      // remember the most dangerous candidate so `for d in ~ x; do rm -rf "$d"` is seen
      const cands = args.slice(2).map((w) => resolveOperand(w, env)).filter(Boolean);
      const hit = cands.find((t) => isProtectedPath(t.path)) || cands[0];
      setVar(env, pargs[0], hit ? hit.path : undefined, true);
    } else if (["for", "select", "read", "mapfile", "readarray", "getopts", "printf"].includes(r.name)) {
      // these set variables to values we cannot know; only their destinations are forgotten
      if (top) for (const name of assignedNames(r.name, pargs)) forget(name);
    } else if (SHELLS.has(r.name)) {
      let f = 0;
      let cmdString = null;
      let strict = false; // started with -u or -o nounset
      while (f < args.length && /^[-+]/.test(pargs[f])) {
        const p = pargs[f];
        const cluster = !p.startsWith("--");
        // options apply in order: `-u +u` ends with nounset off
        if (cluster && p.includes("u")) strict = p[0] === "-";
        if (cluster && p.endsWith("o")) {
          if (pargs[f + 1] === "nounset") strict = p[0] === "-";
          f++; // the option name that follows -o
        }
        if (cluster && p[0] === "-" && p.includes("c")) {
          cmdString = args[f + 1];
          break;
        }
        f++;
      }
      // with no script operand the shell reads its commands from stdin
      const own = /^(zsh|ksh)$/.test(r.name);
      const hit =
        cmdString != null
          ? inner(expandText(cmdString), env.cwd, false, strict, own)
          : f >= args.length
            ? anyHit(fed(), env.cwd, false, strict, own)
            : null;
      if (hit) return hit;
    } else if (r.name === "eval") {
      // eval expands its arguments once and runs the result in this shell. The text is judged
      // on a copy of the state, as in v3, and what it changes here is not kept: keeping it was
      // tried and made the guard see less than v3 when a later, unfollowed function call undid
      // it. Afterwards an unknown variable is unknowable, not unset.
      const parts = args.map((w) => expandWord(w, env));
      const text = parts.map((p, k) => (p == null ? pargs[k] : p.split(G).join(""))).join(" ");
      const hit = inner(text, env.cwd, false, env.nounset, env.lastpipe);
      if (hit) return hit;
      if (top) env.loose = true;
    } else if (r.name === "." || r.name === "source") {
      if (/^\/dev\/(stdin|fd\/0)$/.test(pargs[0] || "")) {
        const hit = anyHit(fed(), env.cwd, false, env.nounset, env.lastpipe);
        if (hit) return hit;
      }
      if (top) env.loose = true; // a sourced file may set any variable
    } else if (r.name === "su") {
      const k = pargs.indexOf("-c");
      const hit = k !== -1 && args[k + 1] != null ? inner(plain(args[k + 1]), env.cwd, true) : null;
      if (hit) return hit;
    } else if (r.name === "osascript") {
      // `do shell script "..."` runs the string with /bin/sh in /
      const re = /do shell script\s+"((?:[^"\\]|\\.)*)"/g;
      for (const text of [...pargs, ...c.heredocs]) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const hit = inner(m[1].replace(/\\(["\\])/g, "$1"), "/", true);
          if (hit) return hit;
        }
      }
    } else if (r.name === "ssh") {
      // the remote command starts in the remote home; judge it as if it ran in ours
      const host = pargs.findIndex((p) => !p.startsWith("-"));
      const hit = anyHit([pargs.slice(host + 1).join(" "), ...c.heredocs], HOME_DIR, true);
      if (hit) return hit;
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
        env.unset = null;
        const t = resolveOperand(op, env);
        if (!t) continue;
        const why = env.unset
          ? `rm target built from the unset variable $${env.unset}, which expands to nothing here`
          : env.cdUnset
            ? `rm after cd to the unset variable $${env.cdUnset}, which is empty here (an unquoted empty cd goes to the home folder)`
            : null;
        if (t.glob) {
          if (globParentBlocks(t.path, rec)) return why || (rec ? LABEL_RM : LABEL_GLOB);
        } else if (isProtectedPath(t.path)) {
          if (rec) return why || LABEL_RM;
          if (r.isSudo) return LABEL_SUDO;
        }
      }
      if (r.viaXargs && rec && !sourceIsSafe(pipeOf(), env)) return LABEL_XARGS;
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
      const { starts, expr, raw } = findStarts(args);
      let destructive = expr.includes("-delete");
      for (let e = 0; e < expr.length; e++) {
        if (!/^-(exec|execdir|ok|okdir)$/.test(expr[e])) continue;
        let j = e + 1;
        while (j < expr.length && expr[j] !== ";" && expr[j] !== "+") j++;
        for (let x = e + 1; x < j; x++) {
          if (baseCmd(expr[x]) === "rm" || /(^|[\s;&|])rm\s/.test(expr[x])) destructive = true;
        }
        // the command find runs is judged like any other (`-exec sh -c '...' \;`); each `{}`
        // becomes an unknown path and the rest of the word is kept
        const block = raw
          .slice(e + 1, j)
          .map((w) => w.split(M + "{" + M + "}").join(S).split("{}").join(S));
        const hit = block.length
          ? analyzeCmds(
              [{ words: block, quoted: [], sep: "start", heredocs: [], scopes: [] }],
              // -execdir runs in the directory of each match, which is not known here
              sub(/dir$/.test(expr[e]) ? null : env.cwd, true),
              depth + 1
            )
          : null;
        if (hit) return hit;
        e = j;
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
    // `: "${VAR:=default}"` assigns as a side effect of being expanded. This runs after the
    // command's own operands were judged, so expansion within one command stays left to right.
    for (const w of c.words) if (/\$\{[A-Za-z_][A-Za-z0-9_]*:?=/.test(w)) expandWord(w, env);
  }
  // A subshell or a function definition still open when the list ends is over now: the state
  // handed back (to an eval that keeps it) is the state outside them.
  if (undo) restore(undo);
  if (open.length) restore(open[0]);
  env.inFn = false;
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
function detect(cmd, cwd, loose) {
  // the marker characters are private to the lexer
  const text = String(cmd).replace(/[\u0000-\u0004]/g, "");
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
    // Claude Code runs the command with the user's shell
    const lastpipe = /(^|\/)(zsh|ksh)[^/]*$/.test(process.env.SHELL || "");
    return analyze(text, { cwd: start, vars: new Map(), loose, lastpipe }, 0);
  } catch (e) {
    return legacySegments(norm);
  }
}
function detectCatastrophe(cmd, cwd = null) {
  return detect(cmd, cwd, false);
}

// HARDEN-02 raw backstop: detect a catastrophe in the UNPARSED stdin (which may be malformed JSON,
// truncated, or arbitrary garbage that WRAPS the command). Precise pass first, then a deliberately
// COARSER flat token scan for the embedded-text case. It KEEPS the catastrophic-root requirement
// (and the recursive-flag / sudo / 777 requirement), so a benign-unparseable blob and a normal
// local destructive command are NOT matched and the caller still FAILS OPEN (no Bash wedge).
function rawCatastrophe(rawInput) {
  // The payload's own cwd and transcript_path are paths under home; they are not operands.
  const raw = String(rawInput).replace(/"(cwd|transcript_path)"\s*:\s*"[^"]*"/g, '""');
  const precise = detect(raw, null, true); // the backstop keeps unknown variables unknown
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
