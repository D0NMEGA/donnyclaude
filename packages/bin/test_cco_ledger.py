#!/usr/bin/env python3
# cco-tool-version: 1
# pytest suite for cco-ledger (OBS-02). Proves the four load-bearing, ccusage-trap facts BEFORE
# implementation exists (TDD RED): requestId dedup (last-wins, #74), the 1h-vs-5m cache split (#899),
# the compute-because-no-costUSD path, and that NO >200K long-context surcharge is applied (2026).
# The script under test has no `.py` extension, so it is loaded via importlib.spec_from_file_location.
from __future__ import annotations

import importlib.machinery
import importlib.util
import math
from pathlib import Path
from types import ModuleType

import pytest

LEDGER_PATH = Path(__file__).with_name("cco-ledger")

# Research-verified Opus 4.8 (2026) price table ($/token). 1h-cache = 2x in, 5m-cache = 1.25x in,
# cache-read = 0.1x in; in=$5/1M, out=$25/1M. NO >200K surcharge. Mirrors litellm-prices.json.
PRICES: dict[str, dict[str, float]] = {
    "claude-opus-4-8": {
        "in": 5e-06,
        "out": 25e-06,
        "cache_5m": 6.25e-06,
        "cache_1h": 10e-06,
        "cache_read": 0.5e-06,
    }
}


def _load_ledger() -> ModuleType:
    """Import the extension-less cco-ledger script as a module. importlib cannot infer a loader
    from a suffix-less path, so an explicit SourceFileLoader is supplied."""
    loader = importlib.machinery.SourceFileLoader("cco_ledger", str(LEDGER_PATH))
    spec = importlib.util.spec_from_loader("cco_ledger", loader)
    assert spec is not None, f"cannot load {LEDGER_PATH}"
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def ledger() -> ModuleType:
    return _load_ledger()


def _usage(**kw: int) -> dict:
    """Build a message.usage dict with the verified local-schema keys; defaults are 0."""
    cc = {
        "ephemeral_1h_input_tokens": kw.pop("cache_1h", 0),
        "ephemeral_5m_input_tokens": kw.pop("cache_5m", 0),
    }
    return {
        "input_tokens": kw.pop("input_tokens", 0),
        "output_tokens": kw.pop("output_tokens", 0),
        "cache_creation_input_tokens": cc["ephemeral_1h_input_tokens"] + cc["ephemeral_5m_input_tokens"],
        "cache_read_input_tokens": kw.pop("cache_read", 0),
        "cache_creation": cc,
    }


# ---------------------------------------------------------------------------
# dedup_usages — duplicate requestId counts ONCE, last-wins (ccusage #74)
# ---------------------------------------------------------------------------
def test_dedup_usages_last_wins_not_summed(ledger: ModuleType) -> None:
    """Two assistant lines with the SAME requestId (100 then 500 output) -> ONE entry @ 500."""
    lines = [
        {"type": "assistant", "requestId": "req_dup", "message": {"model": "claude-opus-4-8", "usage": _usage(output_tokens=100)}},
        {"type": "assistant", "requestId": "req_dup", "message": {"model": "claude-opus-4-8", "usage": _usage(output_tokens=500)}},
    ]
    deduped = ledger.dedup_usages(lines)
    assert len(deduped) == 1, "duplicate requestId must collapse to ONE entry"
    model, usage = deduped["req_dup"]
    assert model == "claude-opus-4-8"
    assert usage["output_tokens"] == 500, "must keep the LAST occurrence, not the first and NOT the sum (600)"


def test_dedup_usages_distinct_request_ids_kept(ledger: ModuleType) -> None:
    """Different requestIds are independent entries."""
    lines = [
        {"type": "assistant", "requestId": "req_a", "message": {"model": "claude-opus-4-8", "usage": _usage(output_tokens=100)}},
        {"type": "assistant", "requestId": "req_b", "message": {"model": "claude-opus-4-8", "usage": _usage(output_tokens=200)}},
    ]
    deduped = ledger.dedup_usages(lines)
    assert set(deduped.keys()) == {"req_a", "req_b"}


def test_dedup_usages_falls_back_to_message_id(ledger: ModuleType) -> None:
    """When requestId is absent, dedup keys on message.id (ccusage fallback)."""
    lines = [
        {"type": "assistant", "message": {"id": "msg_1", "model": "claude-opus-4-8", "usage": _usage(output_tokens=100)}},
        {"type": "assistant", "message": {"id": "msg_1", "model": "claude-opus-4-8", "usage": _usage(output_tokens=400)}},
    ]
    deduped = ledger.dedup_usages(lines)
    assert len(deduped) == 1
    assert deduped["msg_1"][1]["output_tokens"] == 400


# ---------------------------------------------------------------------------
# line_cost — the 1h-vs-5m cache split (ccusage #899)
# ---------------------------------------------------------------------------
def test_line_cost_1h_cache_bucket_is_2x_input(ledger: ModuleType) -> None:
    """1,000,000 ephemeral_1h_input_tokens alone -> $10.00 (2x the $5/1M input rate)."""
    cost = ledger.line_cost("claude-opus-4-8", _usage(cache_1h=1_000_000), PRICES)
    assert math.isclose(cost, 10.00, rel_tol=1e-9), f"1h cache must be 2x input ($10.00), got {cost}"


def test_line_cost_5m_cache_bucket_is_1_25x_input(ledger: ModuleType) -> None:
    """1,000,000 ephemeral_5m_input_tokens alone -> $6.25 (1.25x the $5/1M input rate)."""
    cost = ledger.line_cost("claude-opus-4-8", _usage(cache_5m=1_000_000), PRICES)
    assert math.isclose(cost, 6.25, rel_tol=1e-9), f"5m cache must be 1.25x input ($6.25), got {cost}"


def test_line_cost_1h_and_5m_buckets_priced_differently(ledger: ModuleType) -> None:
    """The two cache buckets MUST NOT be priced at the same rate (the #899 bug)."""
    cost_1h = ledger.line_cost("claude-opus-4-8", _usage(cache_1h=1_000_000), PRICES)
    cost_5m = ledger.line_cost("claude-opus-4-8", _usage(cache_5m=1_000_000), PRICES)
    assert cost_1h != cost_5m, "1h and 5m cache-creation buckets must be priced differently"
    assert cost_1h > cost_5m


# ---------------------------------------------------------------------------
# line_cost — compute-because-no-costUSD path (ccusage `calculate` mode)
# ---------------------------------------------------------------------------
def test_line_cost_computes_without_costusd_field(ledger: ModuleType) -> None:
    """A usage dict with NO costUSD key still yields a non-zero cost (we computed it)."""
    usage = _usage(input_tokens=10_000, output_tokens=2_000)
    assert "costUSD" not in usage  # the local jsonl never has this
    cost = ledger.line_cost("claude-opus-4-8", usage, PRICES)
    # 10_000 * 5e-6 + 2_000 * 25e-6 = 0.05 + 0.05 = 0.10
    assert cost > 0, "must compute a non-zero cost even though no costUSD field is present"
    assert math.isclose(cost, 0.10, rel_tol=1e-9)


# ---------------------------------------------------------------------------
# line_cost — NO >200K long-context surcharge (2026)
# ---------------------------------------------------------------------------
def test_line_cost_no_long_context_surcharge(ledger: ModuleType) -> None:
    """1,000,000 input_tokens (a 1M-window context) -> exactly $5.00, NOT $10.00."""
    cost = ledger.line_cost("claude-opus-4-8", _usage(input_tokens=1_000_000), PRICES)
    assert math.isclose(cost, 5.00, rel_tol=1e-9), f"no >200K surcharge: 1M input must be $5.00 (not $10.00), got {cost}"


# ---------------------------------------------------------------------------
# line_cost — unknown model -> $0, flagged unpriced, no crash
# ---------------------------------------------------------------------------
def test_line_cost_unknown_model_is_zero_no_crash(ledger: ModuleType) -> None:
    """A model not in the price table contributes $0 and does not raise."""
    cost = ledger.line_cost("some-future-model-not-priced", _usage(input_tokens=1_000_000, output_tokens=1_000_000), PRICES)
    assert cost == 0.0, "unpriced model must contribute $0, not crash"


# ---------------------------------------------------------------------------
# session_cost — end-to-end on a small fixture (dedup + skip-malformed + non-assistant)
# ---------------------------------------------------------------------------
def test_session_cost_end_to_end_dedup_and_skips_malformed(ledger: ModuleType) -> None:
    """A small jsonl string: an assistant line, a DUPLICATE requestId, a non-assistant line,
    and a MALFORMED line. -> deduped, priced total; malformed line skipped without raising."""
    import json

    a1 = {"type": "assistant", "requestId": "r1", "message": {"model": "claude-opus-4-8", "usage": _usage(input_tokens=10_000, output_tokens=1_000)}}
    a1_dup = {"type": "assistant", "requestId": "r1", "message": {"model": "claude-opus-4-8", "usage": _usage(input_tokens=10_000, output_tokens=2_000)}}  # last wins
    a2 = {"type": "assistant", "requestId": "r2", "message": {"model": "claude-opus-4-8", "usage": _usage(input_tokens=20_000, output_tokens=4_000)}}
    user = {"type": "user", "message": {"content": "SHOULD NEVER BE READ"}}
    lines = [
        json.dumps(a1),
        json.dumps(a1_dup),
        "{ this is not valid json ]",  # malformed — must be skipped
        json.dumps(user),
        json.dumps(a2),
        "",  # blank line
    ]
    jsonl_text = "\n".join(lines)
    total = ledger.session_cost(jsonl_text, PRICES)
    # r1 (last): 10_000*5e-6 + 2_000*25e-6 = 0.05 + 0.05 = 0.10
    # r2:        20_000*5e-6 + 4_000*25e-6 = 0.10 + 0.10 = 0.20
    # NOT counting a1 first occurrence (would add 0.025 more). Total = 0.30
    assert math.isclose(total, 0.30, rel_tol=1e-9), f"end-to-end deduped total must be $0.30, got {total}"


def test_session_cost_empty_input_is_zero(ledger: ModuleType) -> None:
    """Empty / whitespace-only jsonl -> $0.0, never raises."""
    assert ledger.session_cost("", PRICES) == 0.0
    assert ledger.session_cost("\n\n   \n", PRICES) == 0.0
