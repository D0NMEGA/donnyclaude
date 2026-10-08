#!/usr/bin/env python3
# cco-tool-version: 1
# RED-before-GREEN pytest suite for cco-dream-eval (AUTO-01, the /dream keep/discard brain).
# Proves the load-bearing decision facts BEFORE the implementation is trusted:
#   - D-05  KEEP iff (metric improved in the declared direction) AND (green===true); else DISCARD.
#           A red bar, a tie/regression, or an unscoreable metric is NEVER kept.
#   - D-06  Termination is BOUNDED four ways (target / max-iters / total-budget / per-iter-budget)
#           and NEVER open-ended — defaults (max_iters=6) hold even when every cap is null/invalid.
#   - parse_metric FAILS CLOSED: empty / non-numeric / non-finite -> None -> discard (never a crash,
#           never a silent improvement).
#   - The CLI FAILS SAFE: any internal error -> {"decision":"discard","loop":"stop", why eval-error},
#           exit 0.
# The script under test has no `.py` extension, so it is loaded via SourceFileLoader (the cco-ledger
# pytest pattern this repo uses).
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

EVAL_PATH = Path(__file__).with_name("cco-dream-eval")


def _load_eval() -> ModuleType:
    """Import the extension-less cco-dream-eval script as a module (suffix-less path needs an
    explicit SourceFileLoader — importlib cannot infer a loader from the name)."""
    loader = importlib.machinery.SourceFileLoader("cco_dream_eval", str(EVAL_PATH))
    spec = importlib.util.spec_from_loader("cco_dream_eval", loader)
    assert spec is not None, f"cannot load {EVAL_PATH}"
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def ev() -> ModuleType:
    return _load_eval()


def _state(**kw):
    """A complete, in-bounds, improving+green default state; override per test."""
    base = {
        "best": 10,
        "new_metric": 12,
        "direction": "higher",
        "green": True,
        "iter": 1,
        "max_iters": 6,
        "total_spent": 0,
        "total_ceiling": 200000,
        "iter_spent": 1000,
        "per_iter_budget": 50000,
        "target": None,
    }
    base.update(kw)
    return base


# --------------------------------------------------------------------------------------------------
# Behavior 1-6: the KEEP/DISCARD decision (D-05) + the metric parser (fail-closed)
# --------------------------------------------------------------------------------------------------
def test_1_improve_and_green_keeps(ev):
    """Improvement in-direction AND green -> KEEP, improved true, loop continue."""
    d = ev.decide(_state(best=10, new_metric=12, direction="higher", green=True))
    assert d["decision"] == "keep"
    assert d["improved"] is True
    assert d["loop"] == "continue"


def test_2_improve_but_red_discards(ev):
    """Improvement but the green bar is RED -> DISCARD (green-before-keep; D-05: a red iteration is
    NEVER kept)."""
    d = ev.decide(_state(best=10, new_metric=12, direction="higher", green=False))
    assert d["decision"] == "discard"


def test_3_regression_or_tie_discards(ev):
    """A regression OR an exact tie is NOT an improvement -> DISCARD (no churn on no-progress)."""
    regress = ev.decide(_state(best=10, new_metric=9, direction="higher", green=True))
    assert regress["decision"] == "discard"
    assert regress["improved"] is False
    tie = ev.decide(_state(best=10, new_metric=10, direction="higher", green=True))
    assert tie["decision"] == "discard"
    assert tie["improved"] is False


def test_4_direction_lower(ev):
    """direction lower: smaller is better. 0.40 < 0.50 improves (keep); 0.60 > 0.50 regresses
    (discard). Catches a flipped comparison."""
    better = ev.decide(_state(best=0.50, new_metric=0.40, direction="lower", green=True))
    assert better["decision"] == "keep"
    assert better["improved"] is True
    worse = ev.decide(_state(best=0.50, new_metric=0.60, direction="lower", green=True))
    assert worse["decision"] == "discard"


def test_5_first_iteration_baseline(ev):
    """First iteration has no prior best (best=null): any scored+green attempt establishes the
    baseline (improved); an unscoreable first attempt (new_raw empty) is discarded."""
    baseline = ev.decide(_state(best=None, new_metric=7, direction="higher", green=True))
    assert baseline["decision"] == "keep"
    assert baseline["improved"] is True
    unscoreable = ev.decide(
        _state(best=None, new_metric=None, new_raw="", direction="higher", green=True)
    )
    assert unscoreable["decision"] == "discard"


def test_6_metric_parse_fail_closed(ev):
    """new_raw parses to the LAST numeric token; an empty / non-numeric raw yields None -> DISCARD,
    never a crash, never improved."""
    parsed = ev.decide(
        _state(best=10, new_metric=None, new_raw="passed: 42", direction="higher", green=True)
    )
    assert parsed["new_metric"] == 42.0
    assert parsed["decision"] == "keep"  # 42 > 10 and green
    for bad in ("", "n/a", "no number here"):
        d = ev.decide(
            _state(best=10, new_metric=None, new_raw=bad, direction="higher", green=True)
        )
        assert d["new_metric"] is None
        assert d["decision"] == "discard"
        assert d["improved"] is False


# --------------------------------------------------------------------------------------------------
# Behavior 7-11: the four termination bounds (D-06) + defaults-never-unbounded
# --------------------------------------------------------------------------------------------------
def test_7_bound_max_iters(ev):
    d = ev.decide(_state(iter=6, max_iters=6))
    assert d["loop"] == "stop"
    assert d["stop_reason"] == "max-iters"


def test_8_bound_total_budget(ev):
    d = ev.decide(_state(total_spent=200000, total_ceiling=200000))
    assert d["loop"] == "stop"
    assert d["stop_reason"] == "total-budget"


def test_9_bound_per_iter_budget(ev):
    d = ev.decide(_state(iter_spent=60000, per_iter_budget=50000))
    assert d["loop"] == "stop"
    assert d["stop_reason"] == "per-iter-budget"


def test_10_bound_target_reached(ev):
    """direction higher: best at-or-past target -> stop, reason target."""
    d = ev.decide(_state(best=100, new_metric=100, direction="higher", target=100))
    assert d["loop"] == "stop"
    assert d["stop_reason"] == "target"


def test_11_defaults_never_unbounded(ev):
    """THE all-caps-null case: every cap null AND iter at the built-in default (6) -> STILL stop
    (max_iters defaults to 6). There is no continue-forever path. Negative/NaN caps also fall back."""
    all_null = ev.decide(
        _state(iter=6, max_iters=None, total_ceiling=None, per_iter_budget=None, target=None)
    )
    assert all_null["loop"] == "stop"
    assert all_null["stop_reason"] == "max-iters"
    # A negative max_iters is invalid -> falls back to the default 6, so iter=6 still stops.
    neg = ev.decide(_state(iter=6, max_iters=-1))
    assert neg["loop"] == "stop"
    # Below the defaulted ceiling the loop still has headroom (proves the default is a real bound,
    # not an accidental always-stop).
    headroom = ev.decide(
        _state(iter=2, max_iters=None, total_ceiling=None, per_iter_budget=None)
    )
    assert headroom["loop"] == "continue"


# --------------------------------------------------------------------------------------------------
# Behavior 12: the CLI fails SAFE (T-08-05) — exercised end-to-end through stdin
# --------------------------------------------------------------------------------------------------
def _run_cli(stdin_text: str) -> dict:
    """Drive the real CLI the way the runner will (JSON on stdin, JSON on stdout, exit 0)."""
    proc = subprocess.run(
        [sys.executable, str(EVAL_PATH)],
        input=stdin_text,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"CLI must exit 0, got {proc.returncode}: {proc.stderr}"
    return json.loads(proc.stdout)


def test_12_cli_fail_safe_on_malformed_input(ev):
    """Malformed stdin (not JSON) -> the CLI must NOT crash: discard + stop + why startswith
    'eval-error', exit 0 (fail-safe, T-08-05)."""
    out = _run_cli("this is not json {{{")
    assert out["decision"] == "discard"
    assert out["loop"] == "stop"
    assert out["why"].startswith("eval-error")


def test_12b_cli_happy_path(ev):
    """The CLI end-to-end on a valid improving+green state -> keep + continue (the shape the runner
    pipes)."""
    state = _state(best=10, new_metric=12, direction="higher", green=True)
    out = _run_cli(json.dumps(state))
    assert out["decision"] == "keep"
    assert out["loop"] == "continue"


def test_12c_cli_improve_but_red(ev):
    """The CLI end-to-end: improvement with green=false -> discard (green-before-keep, proven through
    the real process boundary)."""
    state = _state(best=10, new_metric=12, direction="higher", green=False)
    out = _run_cli(json.dumps(state))
    assert out["decision"] == "discard"


# --------------------------------------------------------------------------------------------------
# Pure-function spot checks (the test imports these directly; signatures must stay stable)
# --------------------------------------------------------------------------------------------------
def test_parse_metric_pure(ev):
    assert ev.parse_metric("passed: 42") == 42.0
    assert ev.parse_metric("score=0.83 (ok)") == 0.83
    assert ev.parse_metric("-3.5 done") == -3.5
    assert ev.parse_metric("") is None
    assert ev.parse_metric("no number") is None
    assert ev.parse_metric(None) is None


def test_improved_pure(ev):
    assert ev.improved(10, 12, "higher") is True
    assert ev.improved(10, 9, "higher") is False
    assert ev.improved(10, 10, "higher") is False  # tie
    assert ev.improved(0.5, 0.4, "lower") is True
    assert ev.improved(0.5, 0.6, "lower") is False
    assert ev.improved(None, 7, "higher") is True  # baseline
    assert ev.improved(None, None, "higher") is False  # unscoreable baseline


def test_coerce_cap_pure(ev):
    assert ev.coerce_cap(50000, 6) == 50000
    assert ev.coerce_cap(None, 6) == 6
    assert ev.coerce_cap(-1, 6) == 6
    assert ev.coerce_cap(float("nan"), 6) == 6
    assert ev.coerce_cap("12", 6) == 12  # base-10 string


def test_target_reached_pure(ev):
    assert ev.target_reached(100, 100, "higher") is True
    assert ev.target_reached(99, 100, "higher") is False
    assert ev.target_reached(0.40, 0.50, "lower") is True
    assert ev.target_reached(0.60, 0.50, "lower") is False
    assert ev.target_reached(100, None, "higher") is False  # no target -> never reached
    assert ev.target_reached(None, 100, "higher") is False  # no best yet -> not reached


def test_math_isfinite_guard(ev):
    """A non-finite new metric must read as None (fail-closed), never inf/nan leaking into compare."""
    assert ev.parse_metric("inf") is None or not math.isinf(ev.parse_metric("inf") or 0)
