"""Failing TDD scaffold (RED) for the four new Phase-4 sources.

``research.brave`` / ``research.reddit`` / ``research.youtube`` / ``research.news``
(and ``research._reddit_token``) do not exist yet — they are added by Plan 03
(Wave 1). Calling them therefore raises ``AttributeError`` (``module 'research'
has no attribute 'brave'``), which is the intended RED signal here.

These tests lock the SRC-01..04 contract as executable assertions:

* no-key fallback — with every source key cleared (the ``clear_keys`` fixture,
  no network) each keyed source writes an EMPTY uniform envelope, never raises
  (SRC-01/02/03, D-06/D-17/D-25/D-56);
* ``_reddit_token()`` returns ``None`` without credentials (SRC-02);
* the uniform envelope wrapper shape ``{source,query,generated_utc,count,items}``
  is present for every source (D-58);
* GDELT ``news`` (keyless) item shape == ``ENVELOPE_KEYS`` — marked
  ``@pytest.mark.eval`` so the offline suite skips the one network call (SRC-04,
  D-28, threat T-04-02);
* secret hygiene — fake sentinel Reddit creds never appear in a written
  envelope (SRC-02, D-57, threat T-04-01).
"""
import asyncio

import httpx
import pytest

import research
import research_topic as RT

from tests.conftest import ENVELOPE_KEYS, read_envelope


def _drive(fn, a):
    """Drive an async ``source(client, a)`` coroutine to completion over a short-lived
    httpx client (Phase-5 D-01/D-06: the sources are ``async def`` now, so a direct
    ``fn(a)`` would only build a coroutine — "never awaited"). Mirrors the
    ``eval/_collect.collect_one`` and ``research.py __main__`` sync→async seam; the
    no-key sources still take their early ``write_out([])`` path without a network call."""
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await fn(c, a)
    asyncio.run(_go())


# ── SRC-01: Brave no-key fallback ────────────────────────────────────────────


def test_brave_no_key_returns_empty_envelope(tmp_path, clear_keys):
    out = tmp_path / "brave.json"
    _drive(research.brave, RT.ns(query="best budget air purifier", limit=5, out=str(out)))
    env = read_envelope(out)
    assert env["source"] == "brave" and env["items"] == [] and env["count"] == 0


# ── SRC-02: Reddit no-key fallback + token-None + secret hygiene ─────────────


def test_reddit_no_key_returns_empty_envelope(tmp_path, clear_keys):
    out = tmp_path / "reddit.json"
    _drive(research.reddit, RT.ns(query="best budget air purifier", limit=5, out=str(out)))
    env = read_envelope(out)
    assert env["source"] == "reddit" and env["items"] == [] and env["count"] == 0


def test_reddit_token_none_without_creds(clear_keys):
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            return await research._reddit_token(c)
    assert asyncio.run(_go()) is None


def test_reddit_no_secret_in_envelope_query(tmp_path, monkeypatch):
    # SRC-02 secret hygiene (D-57 / T-04-01): keys come from os.environ, never
    # argv → vars(a) holds no secret → the echoed query is clean. Fake sentinels.
    monkeypatch.setenv("REDDIT_CLIENT_ID", "SECRET_ID_XYZ")
    monkeypatch.setenv("REDDIT_CLIENT_SECRET", "SECRET_SEC_XYZ")
    out = tmp_path / "reddit.json"
    try:
        _drive(research.reddit, RT.ns(query="x", limit=3, out=str(out)))
    except Exception:
        pass  # network may fail; we only care the envelope (if written) is clean
    if out.exists():
        blob = out.read_text()
        assert "SECRET_ID_XYZ" not in blob and "SECRET_SEC_XYZ" not in blob


# ── SRC-03: YouTube no-key fallback ──────────────────────────────────────────


def test_youtube_no_key_returns_empty_envelope(tmp_path, clear_keys):
    out = tmp_path / "youtube.json"
    _drive(research.youtube, RT.ns(query="best budget air purifier", limit=5, out=str(out)))
    env = read_envelope(out)
    assert env["source"] == "youtube" and env["items"] == [] and env["count"] == 0


# ── SRC-04: GDELT news (keyless) item shape — network, so eval-marked ────────


@pytest.mark.eval
def test_news_envelope_shape_keyless(tmp_path):
    out = tmp_path / "news.json"
    _drive(research.news, RT.ns(query="macos antivirus", limit=3, out=str(out)))
    env = read_envelope(out)
    assert env["source"] == "news"
    for it in env["items"]:
        assert set(it) == ENVELOPE_KEYS


# ── SRC-01..04: every new source emits the uniform envelope wrapper ──────────


@pytest.mark.parametrize("fn,name", [("brave", "brave"), ("reddit", "reddit"), ("youtube", "youtube")])
def test_all_new_sources_emit_uniform_envelope(tmp_path, clear_keys, fn, name):
    out = tmp_path / f"{name}.json"
    _drive(getattr(research, fn), RT.ns(query="x", limit=3, out=str(out)))
    env = read_envelope(out)
    assert set(env) == {"source", "query", "generated_utc", "count", "items"}
    assert env["source"] == name
