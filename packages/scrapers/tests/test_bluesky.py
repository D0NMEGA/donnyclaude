"""Wave-0 TDD (RED) for the Bluesky AT-Protocol ``searchPosts`` source.

``research.bluesky`` does not exist yet — it is added by Plan 02 (Task 2, GREEN).
Calling it therefore raises ``AttributeError`` (``module 'research' has no
attribute 'bluesky'``), which is the intended RED signal here (exactly like the
``test_sources_phase4.py`` scaffold pinned the Phase-4 sources before they existed).

These four tests lock the BSKY-01/02/03 fetcher contract as executable assertions:

* ``test_searchposts_request_shape`` (BSKY-01) — the outbound URL hits
  ``api.bsky.app`` ``app.bsky.feed.searchPosts`` with ``sort=top&lang=en``, a
  ``limit<=100``, the URL-encoded topic, and **never** a ``cursor`` (atproto#2838).
* ``test_envelope_mapping`` (BSKY-02) — a known post maps onto the uniform
  envelope: synth title, ``likeCount``→``score``, ``indexedAt``→``created_utc``,
  permalink→``url`` (``rkey`` = trailing ``uri`` segment), full ``record.text``→
  ``text``, AT-Protocol counts in ``extra``; item keys == ``ENVELOPE_KEYS``.
* ``test_empty_text_post_title_none`` (BSKY-02 / SC#2) — an empty-``record.text``
  post yields ``title=None`` and an empty body (the post naturally sinks).
* ``test_fail_soft_empty_envelope`` (BSKY-03) — any ``httpx`` error fails soft to
  a ``[]`` envelope and never raises.

Offline only: ``_get_json`` is monkeypatched (no network), ``write_out`` is
monkeypatched to capture items in-memory. No new dependency (httpx +
pytest-asyncio are already present). No bare ``except`` anywhere.
"""
import json
import pathlib

import asyncio

import httpx

import research
import research_topic as RT

from tests.conftest import ENVELOPE_KEYS

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "bluesky_searchposts.json"


def _drive(fn, a):
    """Drive an async ``source(client, a)`` coroutine to completion over a short-lived
    httpx client (Phase-5 D-01/D-06: the sources are ``async def``). Mirrors the
    ``tests/test_sources_phase4.py`` helper."""
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await fn(c, a)
    asyncio.run(_go())


def _load_fixture():
    return json.loads(_FIXTURE.read_text())


def _capture_writes(monkeypatch):
    """Monkeypatch ``research.write_out`` to capture ``(source, items)`` in-memory,
    mirroring the ``_run_async`` collect seam. Returns the mutable capture dict."""
    captured = {}

    def _fake_write_out(source, query, items, out=None):
        captured["source"] = source
        captured["items"] = items

    monkeypatch.setattr(research, "write_out", _fake_write_out)
    return captured


# ── BSKY-01: request shape — api.bsky.app, sort=top&lang=en, no cursor ───────


def test_searchposts_request_shape(tmp_path, monkeypatch):
    seen = {}

    async def _fake_get_json(client, url, headers=None):
        seen["url"] = url
        seen["headers"] = headers
        return _load_fixture()

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    _capture_writes(monkeypatch)

    _drive(research.bluesky, RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    url = seen["url"]
    assert "api.bsky.app/xrpc/app.bsky.feed.searchPosts" in url
    assert "sort=top" in url
    assert "lang=en" in url
    assert "limit=50" in url            # min(50, 100) == 50, and limit<=100
    assert "q=mcp" in url               # URL-encoded topic present
    assert "cursor" not in url          # atproto#2838 — never send a cursor
    assert seen["headers"] is None      # keyless — no auth header (BSKY-01)


# ── BSKY-02: envelope mapping for a known post ───────────────────────────────


def test_envelope_mapping(tmp_path, monkeypatch):
    async def _fake_get_json(client, url, headers=None):
        return _load_fixture()

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    captured = _capture_writes(monkeypatch)

    _drive(research.bluesky, RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "bluesky"
    items = captured["items"]
    assert len(items) >= 3              # the 3 real posts (the 4th is empty-text)

    # Known post: den.dev (fixture index 0), uri rkey == 3mom6srkiqk2v.
    uri = "at://did:plc:rkjxbatkiros6f7pwtgsir54/app.bsky.feed.post/3mom6srkiqk2v"
    post = next(it for it in items if it["id"] == uri)

    assert post["id"] == uri
    assert post["title"] is not None and len(post["title"]) <= 100
    assert post["title"] == "Unreal. Our today's MCP announcement is top of HN right now."
    assert post["author"] == "den.dev"
    assert post["score"] == 24                       # likeCount
    assert post["num_comments"] == 0                 # replyCount
    assert post["created_utc"] == "2026-06-19T01:27:18.870Z"   # indexedAt
    assert post["url"] == "https://bsky.app/profile/den.dev/post/3mom6srkiqk2v"
    assert post["text"].startswith("Unreal. Our today's MCP announcement is top of HN right now.")
    assert "Zero-touch OAuth for MCP is live." in post["text"]   # FULL body, not just the title line
    assert post["tags"] == ["mcp", "anthropic"]
    assert post["top_comments"] == []

    extra = post["extra"]
    assert extra["repostCount"] == 1
    assert extra["quoteCount"] == 1
    assert extra["bookmarkCount"] == 2
    assert extra["cid"] == "bafyreidwbo4kxhr2s7gxample0a"
    assert extra["did"] == "did:plc:rkjxbatkiros6f7pwtgsir54"
    assert extra["langs"] == ["en"]

    assert set(post.keys()) == ENVELOPE_KEYS


# ── BSKY-02 (SC#2): empty record.text → title None, body empty ───────────────


def test_empty_text_post_title_none(tmp_path, monkeypatch):
    async def _fake_get_json(client, url, headers=None):
        return _load_fixture()

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    captured = _capture_writes(monkeypatch)

    _drive(research.bluesky, RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    empty_uri = "at://did:plc:imageonly0pk7xbictouvqlm6/app.bsky.feed.post/3moqvmi7ngk2m"
    post = next(it for it in captured["items"] if it["id"] == empty_uri)
    assert post["title"] is None     # SC#2: empty text → no synthesized title
    assert post["text"] == ""        # empty body → post naturally sinks downstream


# ── BSKY-03: HTTP error → [] envelope, never raises ──────────────────────────


def test_fail_soft_empty_envelope(tmp_path, monkeypatch):
    async def _boom(client, url, headers=None):
        raise httpx.HTTPError("boom")

    monkeypatch.setattr(research, "_get_json", _boom)
    captured = _capture_writes(monkeypatch)

    # MUST NOT raise — fail-soft is the whole contract (BSKY-03).
    _drive(research.bluesky, RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "bluesky"
    assert captured["items"] == []
