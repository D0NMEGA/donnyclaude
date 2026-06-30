"""Phase 14 (REDDIT-02) fail-soft pin: absent Reddit creds degrade to a `no_key`
status + a `[]` uniform envelope, never raising, and the enriched fail-soft stderr
notice carries the *why* (policy reason + the reserved browser-harness fallback).

The `[]` envelope itself is already pinned by tests/test_sources_phase4.py
(test_reddit_no_key_returns_empty_envelope + the parametrized uniform-envelope
test). This file's REASON TO EXIST is the NET-NEW `no_key` *status* assertion
(research_topic._status_for("reddit", []) == "no_key"); it re-asserts the envelope
and captures the enriched stderr as belt-and-suspenders. Offline only (no network),
mirrors the test_sources_phase4.py `clear_keys`/`_drive` shape; runs <8s (cco
green-gate). T-14-01: asserts on PRESENCE/ABSENCE only — no secret value is ever
written into a fixture, assertion, or stderr capture.
"""
import asyncio

import httpx

import research
import research_topic as RT

from tests.conftest import read_envelope


def _drive(fn, a):
    """Drive an async source(client, a) to completion over a short-lived offline
    httpx client (mirrors tests/test_sources_phase4.py). The no-key path takes its
    early write_out([]) branch without a network call."""
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await fn(c, a)
    asyncio.run(_go())


def test_reddit_absent_creds_status_is_no_key(clear_keys):
    # NET-NEW pin (REDDIT-02): a keyed source returning nothing with its key absent
    # surfaces as `no_key` (visible, not a silent `empty`) — research_topic.py:272-273.
    assert RT._status_for("reddit", []) == "no_key"


def test_reddit_failsoft_envelope_and_enriched_stderr(tmp_path, clear_keys, capsys):
    # Belt-and-suspenders: the [] envelope + never-raises (already pinned in
    # test_sources_phase4.py) PLUS the enriched stderr notice (D-14-03) — proving the
    # message grew while control flow stayed byte-identical (still returns []).
    out = tmp_path / "reddit.json"
    _drive(research.reddit, RT.ns(query="best budget air purifier", limit=5, out=str(out)))

    env = read_envelope(out)
    assert env["source"] == "reddit" and env["items"] == [] and env["count"] == 0

    err = capsys.readouterr().err
    assert "reddit_scrape.py" in err            # the reserved fallback is named
    assert "Responsible Builder Policy" in err  # the policy *why* is present
    assert "fail-soft" in err
    assert "2025-11-11" not in err               # the refuted date must NOT appear
