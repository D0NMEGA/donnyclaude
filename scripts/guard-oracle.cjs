// usage: node guard-fuzz.cjs <v3-guard.js> <new-guard.js> [count] [seed]
//
// Oracle test for the guard's state tracking. A random prefix is built from a fixed pool of
// HARMLESS statements (cd, assignments, read, printf -v, unset, readonly, let, eval of a cd,
// function definitions and calls, subshells, pipelines). The prefix alone is run in real bash
// and zsh, which print the resulting $PWD and $x. No delete is ever executed: the final
// `rm ...` only reaches the guard functions as a string.
//
// truth  = the guard's own policy applied to a literal delete in the real end state
// tested = the guard given "prefix; delete" and the starting directory
const { spawnSync } = require("child_process");
const os = require("os");
const oldG = require(process.argv[2]);
const newG = require(process.argv[3]);
const COUNT = Number(process.argv[4] || 3000);
let seed = Number(process.argv[5] || 20261110);
// which shell is the truth: "zsh", "bash", or "both" (destructive if either would destroy).
// The guard reads $SHELL to know how the last command of a pipeline runs, so it is set to match.
const MODE = process.argv[6] || "both";
if (MODE !== "both") process.env.SHELL = "/bin/" + MODE;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const H = os.homedir();
const POOL = [
  "cd ~", "cd /tmp", "cd ..", 'cd "$FZ_UNSET"', "cd $FZ_UNSET", "cd /tmp/..",
  "x=~", "x=/tmp/a", "x=", "x=$HOME/Documents", "x=$(pwd)", "x={/tmp,~}", "x=${FZ_UNSET:-~}", 'x="${FZ_UNSET:-~}"',
  "unset x", "readonly x", "readonly x=~", "export x", "declare -r x=/tmp/r",
  "read x </dev/null", "read -t 0 x", "read x <<< /tmp/b", "printf -v x %s /tmp/c", "printf -vx %s /tmp/c",
  "let x=1", "((x=2))", ': "${x:=/tmp/d}"', ': "${x=/tmp/e}"', ': "${x:=$HOME}"',
  "(cd /tmp)", "(x=/tmp/f)", "(cd ~)", "{ cd /tmp; }", "cd /tmp | cat", "true | cd /tmp", "true | read x", "cd /tmp &",
  'eval "cd /tmp"', "eval 'x=/tmp/g'", 'eval "(cd /tmp)"', 'eval "cd ~"', "eval 'x=~'",
  "f() { cd /tmp; }", "f() { x=/tmp/h; }", "f() { cd ~; }", "f() { x=~; }", "f() { local x=/tmp/i; }",
  "f() { read x </dev/null; }", "f() { unset x; }", "f", "unset -f f",
  "set -u", "set +u", "true", "for x in /tmp/j /tmp/k; do :; done", "for x in ~ /tmp/l; do :; done",
  "if true; then cd /tmp; fi", "if false; then cd ~; fi", "x=/tmp/m true", "y=$x", "x=$y",
  "false && cd /tmp", "true || cd /tmp", "true && cd ~", "false && unset x", "false && read x </dev/null",
  "false && let x=3", "false && x=/tmp/n", 'false && : "${x:=/tmp/p}"', 'eval "false && cd /tmp"', "eval 'true || x=/tmp/o'",
];
const FINALS = ['rm -rf *', 'rm -rf "$x"', 'rm -rf "$x"/*', "rm -rf ./*"];
// the home folder and the directory this is run from (run it from a project two levels below home)
const STARTS = [H, process.cwd()];

const ENV = { PATH: process.env.PATH, HOME: H, TMPDIR: process.env.TMPDIR || "/tmp" };
const SHOW = 'printf "\\n@@%s@@%s@@%s@@\\n" "$PWD" "${x-<unset>}" "$-"';
const cache = new Map();
function realState(shell, prefix, cwd) {
  const key = shell + "\u0001" + cwd + "\u0001" + prefix;
  if (cache.has(key)) return cache.get(key);
  const script = prefix + (prefix.endsWith("&") ? " " : "; ") + SHOW;
  const args = shell === "bash" ? ["--norc", "--noprofile", "-c", script] : ["-f", "-c", script];
  const p = spawnSync(shell, args, { cwd, env: ENV, input: "", encoding: "utf8", timeout: 4000 });
  const m = /@@([^@]*)@@([^@]*)@@([^@]*)@@\s*$/.exec(p.stdout || "");
  const st = m ? { pwd: m[1], x: m[2] === "<unset>" ? null : m[2], nounset: m[3].includes("u") } : null; // null: aborted
  cache.set(key, st);
  return st;
}
const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
// would this delete be destructive in the real end state? (policy only, literal operands)
function truth(st, fin) {
  if (!st) return false; // the shell stopped before reaching the delete
  if (fin === "rm -rf *" || fin === "rm -rf ./*") return !!newG.detectCatastrophe(fin, st.pwd);
  if (st.x === null && st.nounset) return false; // $x aborts under set -u
  const x = st.x === null ? "" : st.x;
  if (fin === 'rm -rf "$x"') return x === "" ? false : !!newG.detectCatastrophe("rm -rf " + q(x), st.pwd);
  return !!newG.detectCatastrophe("rm -rf " + (x === "" ? "" : q(x)) + "/*", st.pwd);
}

const seen = new Set();
const out = { regress: [], miss: [], fp: [], fpBoth: 0, ok: 0, split: 0 };
for (let n = 0; n < COUNT; n++) {
  const k = 1 + Math.floor(rnd() * 5);
  // `cmd &` is followed by a blank, not by `;` (`&;` is a syntax error in bash)
  const join = (a, s) => a + (a ? (a.endsWith("&") ? " " : "; ") : "") + s;
  const prefix = Array.from({ length: k }, () => pick(POOL)).reduce(join, "");
  const fin = pick(FINALS);
  const start = pick(STARTS);
  const id = start + "|" + prefix + "|" + fin;
  if (seen.has(id)) continue;
  seen.add(id);
  const tb = MODE === "zsh" ? false : truth(realState("bash", prefix, start), fin);
  const tz = MODE === "bash" ? false : truth(realState("zsh", prefix, start), fin);
  if (MODE === "both" && tb !== tz) out.split++;
  const full = join(prefix, fin);
  const a = !!oldG.detectCatastrophe(full, start);
  const b = !!newG.detectCatastrophe(full, start);
  const where = start === H ? "H" : "P";
  const line =
    MODE === "both"
      ? `[${where}] ${full}   (bash ${tb ? "destroys" : "safe"}, zsh ${tz ? "destroys" : "safe"})`
      : `[${where}] ${full}   (${MODE} ${tb || tz ? "destroys" : "safe"})`;
  if ((tb || tz) && !b) (a ? out.regress : out.miss).push(line);
  else if (!tb && !tz && b) {
    if (a) out.fpBoth++;
    else out.fp.push(line);
  } else out.ok++;
}
const show = (title, list, max) => {
  console.log(`${title}: ${list.length}`);
  for (const l of list.slice(0, max)) console.log("  " + l.split(H).join("~"));
};
console.log(`programs ${seen.size}; agree with the shells ${out.ok}; bash and zsh differ on ${out.split}`);
show("REGRESSION (a shell would destroy, v3 blocked, new allows)", out.regress, 25);
show("miss in both v3 and new (a shell would destroy)", out.miss, 12);
show("new false block (both shells safe, v3 allowed, new blocks)", out.fp, 12);
console.log(`false block in both v3 and new: ${out.fpBoth}`);
// optional 7th argument: the number of regressions allowed; more than that fails the run
if (process.argv[7] != null && out.regress.length > Number(process.argv[7])) {
  console.log(`FAIL: ${out.regress.length} regressions, ${process.argv[7]} allowed`);
  process.exit(1);
}
