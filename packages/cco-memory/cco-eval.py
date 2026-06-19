#!/usr/bin/env python3
# cco-tool-version: 1
# clean-room port of the agent-eval PATTERN — provenance: https://github.com/vercel-labs/agent-eval
# (License: None / all-rights-reserved -> ideas-only, D-14). No source copied. The implementation is
# re-derived from the 13-RESEARCH.md S-1 prose abstraction (the four pillars below), NOT from the
# upstream source file (the D-15 clean-room firewall: abstract, then implement; never transcribe).
#
# LABS-02 — cco-eval turns CCO's single green/red BOOLEAN into a MEASURED PASS-RATE + A/B signal,
# the richer signal the Phase-12 instinct eval-gate (cco-instinct.py eval_opportunities/eval_wins)
# and cco-dream-eval lack today. It ships the MEASUREMENT PRIMITIVE only; wiring its pass-rate into
# cco-instinct.py's eval_wins is a LOGGED BACKLOG item (deferred to avoid churning the just-hardened
# Phase-12 metadata-only invariant), NOT this plan.
#
# THE FOUR PORTED PILLARS (re-derived clean-room from the S-1 abstraction):
#   1. Declarative eval unit = a directory holding prompt.txt + assertions.txt. discover_evals scans
#      the eval-set dir and returns unit ids (folder names) — vs CCO's single green/red bar.
#   2. Pass-rate across N runs of one unit -> passes/N (a RATE, richer than a boolean).
#   3. A/B run comparison -> per-eval delta = pass_rate_b - pass_rate_a.
#   4. Transcript-based assertion (tool-calls / text), not just an exit code. A crashed/None
#      transcript is FAIL-CLOSED to a fail (an unscoreable run is NEVER a pass) — the same
#      fail-closed discipline cco-dream-eval.parse_metric uses.
#
# SAFETY (T-13-01 / D-22): _metadata_only(rec) is an ALLOWLIST mirroring the cco-log.js
# anti-payload-smuggling contract — it keeps ONLY {eval,label,pass_rate,passes,runs,delta} and DROPS
# every other key, so a prompt body / transcript body / secret can NEVER ride into the event log.
# cco-eval is a STANDALONE CLI in cco-memory/: it registers NO hook and edits NO settings.json
# (T-13-04 / EVOLVE-05 metadata-only + human-gated line preserved). The agent step is a DETERMINISTIC
# substitutable stand-in (--agent-cmd scripted echo), never an unbounded shell eval of unit content
# (T-13-02); assertions are simple `tool_call:<Name>` / `text:<substr>` predicates — no eval, no
# shell interpolation of unit text.
#
# FAIL-SAFE (mirrors cco-dream-eval, T-08-05): ANY internal error in the CLI body -> a clean
# non-zero exit + one-line stderr message, NEVER a traceback dump. Pure functions live up top
# (test_cco_eval.py imports them — keep signatures STABLE); the argparse CLI is below under
# if __name__ == "__main__". stdlib only; no eval, no shell injection.
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from collections.abc import Callable
from typing import Any

TOOL_VERSION = 1

# A captured transcript is a dict {tool_calls: list[str], text: str} or None (the agent crashed
# pre-output — agent-eval's results.o11y == null case). An Agent is any callable prompt -> transcript.
Transcript = dict[str, Any] | None
Agent = Callable[[str], Transcript]

# The metadata-only allowlist (T-13-01): the ONLY keys that may be serialized into the event log.
# Mirrors the cco-log.js fixed field set — every other key is dropped (anti-payload-smuggling), so a
# prompt body / transcript body / secret can never leak through a cco-eval emission.
_ALLOWED_RECORD_KEYS = ("eval", "label", "pass_rate", "passes", "runs", "delta")

_UNIT_FILES = ("prompt.txt", "assertions.txt")


# ---------------------------------------------------------------------------
# Pillar 1 — declarative eval-unit discovery (unit = a dir with prompt.txt + assertions.txt)
# ---------------------------------------------------------------------------
def discover_evals(eval_set_dir: str) -> list[str]:
    """Scan `eval_set_dir` for eval units and return their ids (folder names), sorted.

    A unit is a sub-directory containing BOTH prompt.txt and assertions.txt (the declarative idiom).
    FAIL-CLOSED: a missing / non-directory / unreadable eval-set dir -> [] (the CLI reports the empty
    set, never crashes); a sub-folder missing either file is not a unit and is skipped.
    """
    if not eval_set_dir or not os.path.isdir(eval_set_dir):
        return []
    try:
        entries = sorted(os.listdir(eval_set_dir))
    except OSError:
        return []
    units: list[str] = []
    for name in entries:
        unit_dir = os.path.join(eval_set_dir, name)
        if not os.path.isdir(unit_dir):
            continue
        if all(os.path.isfile(os.path.join(unit_dir, f)) for f in _UNIT_FILES):
            units.append(name)
    return units


def _read_assertions(unit_dir: str) -> list[str]:
    """Read assertions.txt as a list of non-blank, non-comment predicate lines.

    Each line is a predicate like `tool_call:Bash` or `text:hello`. Blank lines and `#` comments are
    ignored. FAIL-CLOSED: an unreadable file yields [] (no assertions -> nothing can pass, see
    evaluate_assertions, which treats an empty assertion set as a non-pass)."""
    path = os.path.join(unit_dir, "assertions.txt")
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except OSError:
        return []
    out: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            out.append(stripped)
    return out


def _read_prompt(unit_dir: str) -> str:
    """Read prompt.txt (the text handed to the agent stand-in). FAIL-CLOSED: unreadable -> ""."""
    path = os.path.join(unit_dir, "prompt.txt")
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


# ---------------------------------------------------------------------------
# Pillar 4 — transcript-based assertion (assert on tool-calls / text, never an exit code)
# ---------------------------------------------------------------------------
def assertion_passes(assertion: str, transcript: Transcript) -> bool:
    """True iff `assertion` holds against `transcript`. FAIL-CLOSED on a crashed/None transcript.

    Supported predicates (parsed simply — no eval, no shell):
      - `tool_call:<Name>`  passes iff <Name> appears in transcript["tool_calls"].
      - `text:<substr>`     passes iff <substr> is a substring of transcript["text"].
    A None transcript (the agent crashed pre-output) -> False for EVERY assertion (an unscoreable run
    is never a pass). An unknown predicate kind -> False (fail-closed; never silently passes).
    """
    if transcript is None:
        return False
    kind, sep, arg = assertion.partition(":")
    if not sep:
        return False
    kind = kind.strip().lower()
    if kind == "tool_call":
        tool_calls = transcript.get("tool_calls") or []
        return arg.strip() in tool_calls
    if kind == "text":
        text = transcript.get("text") or ""
        return arg in text
    return False


def evaluate_assertions(assertions: list[str], transcript: Transcript) -> bool:
    """A run PASSES iff there is at least one assertion AND every assertion passes (ALL-must-hold).

    An empty assertion set -> False (a unit with no assertions can never be scored a pass; this is
    the fail-closed counterpart to discover_evals only admitting well-formed units). A None
    transcript fails every assertion, so a crashed run is always a fail (T-13 fail-closed)."""
    if not assertions:
        return False
    return all(assertion_passes(a, transcript) for a in assertions)


# ---------------------------------------------------------------------------
# Pillar 2 — pass-rate across N runs of one unit (a RATE, not a boolean)
# ---------------------------------------------------------------------------
def run_unit(unit_dir: str, agent: Agent, n: int) -> dict[str, Any]:
    """Run `agent` against the unit prompt `n` times; aggregate passes/n into a pass-rate row.

    Each run: hand the unit prompt to the agent stand-in, capture its transcript (a dict or None on
    crash), evaluate the unit's assertions against that transcript (Pillar 4). A crashed/None
    transcript is fail-closed to a fail. Returns {eval, passes, runs, pass_rate}. `n` is clamped to
    >= 1 (a non-positive run count would make a rate meaningless)."""
    runs = n if isinstance(n, int) and n >= 1 else 1
    eval_id = os.path.basename(os.path.normpath(unit_dir))
    prompt = _read_prompt(unit_dir)
    assertions = _read_assertions(unit_dir)
    passes = 0
    for _ in range(runs):
        transcript = _capture_transcript(agent, prompt)
        if evaluate_assertions(assertions, transcript):
            passes += 1
    return {
        "eval": eval_id,
        "passes": passes,
        "runs": runs,
        "pass_rate": passes / runs,
    }


def _capture_transcript(agent: Agent, prompt: str) -> Transcript:
    """Call the agent stand-in once; return its transcript, or None if it raised/returned no dict.

    The agent boundary is the ONLY place an exception is broadly caught: a stand-in that raises is
    treated as a CRASHED run (None transcript -> fail-closed), exactly mirroring agent-eval's
    null-o11y-on-crash semantics. This is intentional (a flaky agent must not abort the eval); it is
    NOT a swallow of cco-eval's own logic errors, which propagate to the fail-safe CLI boundary."""
    try:
        transcript = agent(prompt)
    except Exception:  # noqa: BLE001 — a crashed agent is a fail-closed run (None), never an eval abort
        return None
    if isinstance(transcript, dict):
        return transcript
    return None


def run_eval_set(eval_set_dir: str, agent: Agent, n: int, label: str) -> list[dict[str, Any]]:
    """Map run_unit over every discovered unit; tag each row with the run `label`.

    Returns one pass-rate row per unit: {eval, passes, runs, pass_rate, label}. An empty / malformed
    eval-set dir yields [] (via discover_evals' fail-closed contract)."""
    rows: list[dict[str, Any]] = []
    for unit_id in discover_evals(eval_set_dir):
        row = run_unit(os.path.join(eval_set_dir, unit_id), agent, n)
        row["label"] = label
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Pillar 3 — A/B run comparison with per-eval deltas
# ---------------------------------------------------------------------------
def compare(run_a: list[dict[str, Any]], run_b: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-eval delta = pass_rate_b - pass_rate_a, over evals present in BOTH runs.

    Returns rows {eval, a, b, delta} sorted by eval id. A unit absent from either run is skipped
    (you can only compare what both runs measured)."""
    a_by_eval = {r["eval"]: r.get("pass_rate", 0.0) for r in run_a}
    b_by_eval = {r["eval"]: r.get("pass_rate", 0.0) for r in run_b}
    rows: list[dict[str, Any]] = []
    for eval_id in sorted(set(a_by_eval) & set(b_by_eval)):
        a_rate = a_by_eval[eval_id]
        b_rate = b_by_eval[eval_id]
        rows.append({"eval": eval_id, "a": a_rate, "b": b_rate, "delta": b_rate - a_rate})
    return rows


# ---------------------------------------------------------------------------
# Safety — metadata-only emission (the cco-log.js anti-payload-smuggling allowlist, ported)
# ---------------------------------------------------------------------------
def _metadata_only(rec: dict[str, Any]) -> dict[str, Any]:
    """Project `rec` onto the metadata-only ALLOWLIST (T-13-01); DROP every non-allowlisted key.

    Keeps ONLY {eval,label,pass_rate,passes,runs,delta}. Mirrors the cco-log.js fixed-field-set
    contract: a prompt body, a transcript body, or a planted secret in `rec` is dropped and can NEVER
    reach the serialized event-log record. This is the ONLY shape any emission path serializes."""
    return {k: rec[k] for k in _ALLOWED_RECORD_KEYS if k in rec}


def emit_record(rec: dict[str, Any], stream: Any = None) -> dict[str, Any]:
    """Write the metadata-only projection of `rec` as one JSON line to `stream` (default stdout).

    Returns the projected (allowlisted) record so callers can also report it. The serialized line is
    GUARANTEED to carry only allowlisted metadata (T-13-01)."""
    out = _metadata_only(rec)
    target = stream if stream is not None else sys.stdout
    target.write(json.dumps(out) + "\n")
    return out


# ---------------------------------------------------------------------------
# Agent stand-in builders — a DETERMINISTIC, substitutable local "agent" (no real `claude -p` call)
# ---------------------------------------------------------------------------
def make_cmd_agent(agent_cmd: str) -> Agent:
    """Build an Agent from a shell command that PRINTS a transcript JSON to stdout.

    The substitutable-LLM-step discipline cco-dream's --attempt-cmd uses: the command is run once per
    eval run (cwd inherited), its stdout parsed as a transcript dict. A non-zero exit, empty stdout,
    or non-JSON/non-dict stdout -> a None (crashed) transcript -> fail-closed. The command is parsed
    with shlex and run WITHOUT shell=True (no shell injection); the eval prompt is NOT interpolated
    into the command (T-13-02 — unit content never drives an unbounded shell)."""
    argv = shlex.split(agent_cmd)

    def _run(prompt: str) -> Transcript:  # noqa: ARG001 — prompt is not interpolated (T-13-02 safety)
        try:
            proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.SubprocessError):
            return None
        if proc.returncode != 0:
            return None
        out = (proc.stdout or "").strip()
        if not out:
            return None
        try:
            parsed = json.loads(out)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    return _run


# ===========================================================================
# CLI — argparse subcommands `run` and `compare`. The body is wrapped FAIL-SAFE: any internal error
# -> a clean one-line stderr message + non-zero exit, NEVER a traceback dump (mirrors cco-dream-eval,
# T-08-05). Emission is metadata-only (emit_record). No eval, no shell=True.
# ===========================================================================
def _cmd_run(args: argparse.Namespace) -> int:
    """`run` subcommand: run an eval set N times, print one metadata-only pass-rate line per unit."""
    units = discover_evals(args.eval_set)
    if not units:
        sys.stderr.write(f"cco-eval: no eval units found under {args.eval_set!r}\n")
        return 2
    agent = make_cmd_agent(args.agent_cmd) if args.agent_cmd else _null_agent
    rows = run_eval_set(args.eval_set, agent, args.runs, args.label)
    for row in rows:
        emit_record(row)
    return 0


def _cmd_compare(args: argparse.Namespace) -> int:
    """`compare` subcommand: run A and B over the same eval set, print per-eval pass-rate deltas."""
    units = discover_evals(args.eval_set)
    if not units:
        sys.stderr.write(f"cco-eval: no eval units found under {args.eval_set!r}\n")
        return 2
    run_a = run_eval_set(args.eval_set, make_cmd_agent(args.a_cmd), args.runs, "A")
    run_b = run_eval_set(args.eval_set, make_cmd_agent(args.b_cmd), args.runs, "B")
    for row in compare(run_a, run_b):
        emit_record(row)
    return 0


def _null_agent(prompt: str) -> Transcript:  # noqa: ARG001 — the no-agent default crashes every run
    """The default agent when no --agent-cmd is given: always a crashed (None) transcript.

    With no real agent wired, every run is fail-closed to a fail (pass_rate 0.0) — an honest "nothing
    ran" result, never a false pass."""
    return None


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cco-eval",
        description=(
            "LABS-02 structured-eval CLI (clean-room port of the agent-eval pattern). Turns CCO's "
            "single green/red boolean into a measured pass-rate + A/B delta over declarative eval "
            "units (a dir of prompt.txt + assertions.txt). Emission is metadata-only."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="run an eval set N times; print a pass-rate per unit")
    p_run.add_argument("--eval-set", required=True, help="eval-set directory (holds unit folders)")
    p_run.add_argument("--runs", type=int, default=1, help="number of runs per unit (N)")
    p_run.add_argument("--label", default="run", help="label tagging this run")
    p_run.add_argument(
        "--agent-cmd",
        default=None,
        help="command that PRINTS a transcript JSON to stdout (deterministic stand-in)",
    )
    p_run.set_defaults(func=_cmd_run)

    p_cmp = sub.add_parser("compare", help="run A vs B over one eval set; print per-eval deltas")
    p_cmp.add_argument("--eval-set", required=True, help="eval-set directory (holds unit folders)")
    p_cmp.add_argument("--runs", type=int, default=1, help="number of runs per unit (N)")
    p_cmp.add_argument("--a-cmd", required=True, help="agent-cmd for run A (prints transcript JSON)")
    p_cmp.add_argument("--b-cmd", required=True, help="agent-cmd for run B (prints transcript JSON)")
    p_cmp.set_defaults(func=_cmd_compare)

    return parser


def main(argv: list[str] | None = None) -> int:
    """Parse args and dispatch. FAIL-SAFE: any internal error -> a clean one-line stderr message +
    exit 1, never a traceback (T-08-05). argparse's own SystemExit (e.g. --help, bad args) passes
    through unchanged."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as err:  # noqa: BLE001 — fail-safe boundary: a clean message, never a traceback
        sys.stderr.write(f"cco-eval: error: {type(err).__name__}: {err}\n")
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        raise SystemExit(130) from None
