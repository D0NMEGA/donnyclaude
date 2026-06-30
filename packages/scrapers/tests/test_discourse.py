"""Wave-0 TDD (RED) for the Discourse per-instance ``/search.json`` source.

``research.discourse`` does not exist yet — it is added by Plan 02 (GREEN).
Calling it therefore raises ``AttributeError`` (``module 'research' has no
attribute 'discourse'``), which is the intended RED signal here (exactly like
``tests/test_bluesky.py`` pinned the Phase-11 source before it existed).

These tests lock the DISC-01/DISC-02 fetcher contract as executable assertions:

* ``test_search_request_shape`` (DISC-01) — one ``_get_json`` GET per instance
  whose URL hits ``/search.json?q=`` with the URL-encoded topic, across the 3
  allowlist hosts (``community.openai.com``, ``discuss.huggingface.co``,
  ``forum.cursor.com``), and **never** an auth header (keyless).
* ``test_envelope_mapping`` (DISC-01/02) — a known post→topic join maps onto the
  uniform envelope: ``title`` from the joined topic, ``url`` ==
  ``https://<instance>/t/<slug>/<id>``, ``text`` == HTML-stripped ``blurb``,
  ``score`` == post ``like_count``, ``num_comments`` == topic ``reply_count``,
  ``created_utc`` == post ``created_at``, ``id`` == ``discourse:<instance>:<tid>``;
  item keys == ``ENVELOPE_KEYS``.
* ``test_dedup_by_topic`` — two posts sharing one ``topic_id`` yield exactly ONE
  item for that topic (relevance order preserved — the first post wins).
* ``test_blurb_html_stripped`` — the ``search-highlight`` wrapped blurb is
  stripped to plain text (no ``<span``, no ``&amp;``).
* ``test_per_instance_fail_soft`` (DISC-01) — when ONE instance's ``_get_json``
  raises ``httpx.HTTPError`` the other instances still contribute (NOT ``[]``);
  never raises.
* ``test_total_fail_soft`` — when ALL instances raise, the source writes a ``[]``
  envelope and never raises.

Offline only: ``_get_json`` is monkeypatched (no network), ``write_out`` is
monkeypatched to capture items in-memory. No new dependency. No bare ``except``.
"""
import json
import pathlib

import asyncio

import httpx

import research
import research_topic as RT

from tests.conftest import ENVELOPE_KEYS

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "discourse_search.json"

# The D-12-01 allowlist the fetcher fans out over (live-verified in 12-RESEARCH.md).
_ALLOWLIST = ("community.openai.com", "discuss.huggingface.co", "forum.cursor.com")


def _drive(fn, a):
    """Drive an async ``source(client, a)`` coroutine to completion over a short-lived
    httpx client (Phase-5 D-01/D-06: the sources are ``async def``). Mirrors the
    ``tests/test_bluesky.py`` helper."""
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


def _instance_of(url):
    """The allowlist host present in an outbound URL (or None)."""
    return next((h for h in _ALLOWLIST if h in url), None)


# ── DISC-01: per-instance request shape — /search.json?q= x3 hosts, keyless ──


def test_search_request_shape(tmp_path, monkeypatch):
    seen = []

    async def _fake_get_json(client, url, headers=None):
        seen.append({"url": url, "headers": headers})
        return _load_fixture()

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    _capture_writes(monkeypatch)

    _drive(research.discourse,
           RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    # One GET per allowlist instance.
    hosts_hit = {_instance_of(c["url"]) for c in seen}
    assert hosts_hit == set(_ALLOWLIST), f"must hit all 3 instances, hit {hosts_hit}"

    for c in seen:
        assert "/search.json?q=" in c["url"], f"query-honoring endpoint, got {c['url']}"
        assert "q=mcp" in c["url"], "URL-encoded topic present"
        # keyless — no auth header on any instance call (DISC-01).
        assert c["headers"] is None


# ── DISC-01/02: envelope mapping for a known post→topic join ─────────────────


def test_envelope_mapping(tmp_path, monkeypatch):
    async def _fake_get_json(client, url, headers=None):
        # Only the OpenAI instance returns the fixture; the others return an empty
        # payload so the asserted item maps to that single known instance.
        if "community.openai.com" in url:
            return _load_fixture()
        return {"posts": [], "topics": [], "grouped_search_result": {"post_ids": []}}

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    captured = _capture_writes(monkeypatch)

    _drive(research.discourse,
           RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "discourse"
    items = captured["items"]
    # 4 distinct topics in the fixture (the 2nd post shares topic 70001).
    assert len(items) >= 3

    instance = "community.openai.com"
    tid = 70001
    item = next(it for it in items if it["id"] == f"discourse:{instance}:{tid}")

    assert item["id"] == f"discourse:{instance}:{tid}"
    assert item["title"] == "Remote MCP server over OAuth + SSE"   # from topics[].title
    assert item["author"] == "atdev"                                # first post's username
    assert item["score"] == 31                                      # post like_count
    assert item["num_comments"] == 8                                # topic reply_count
    assert item["created_utc"] == "2026-05-12T14:03:22.000Z"        # post created_at
    assert item["url"] == f"https://{instance}/t/remote-mcp-server-over-oauth-sse/{tid}"
    assert item["text"].startswith("Connecting a remote MCP server over OAuth")
    assert "<span" not in item["text"]                              # blurb HTML stripped
    assert item["tags"] == ["mcp", "oauth"]                         # from the topic
    assert item["top_comments"] == []

    assert set(item.keys()) == ENVELOPE_KEYS


# ── dedup-by-topic: two posts on one topic → exactly one item ────────────────


def test_dedup_by_topic(tmp_path, monkeypatch):
    async def _fake_get_json(client, url, headers=None):
        if "community.openai.com" in url:
            return _load_fixture()
        return {"posts": [], "topics": [], "grouped_search_result": {"post_ids": []}}

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    captured = _capture_writes(monkeypatch)

    _drive(research.discourse,
           RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    instance = "community.openai.com"
    # Posts 901001 + 901002 BOTH live on topic 70001 → must collapse to one item.
    topic_items = [it for it in captured["items"]
                   if it["id"] == f"discourse:{instance}:70001"]
    assert len(topic_items) == 1, "two posts on one topic must yield exactly one item"
    # Relevance order: the FIRST post (901001 / atdev) wins.
    assert topic_items[0]["author"] == "atdev"
    assert topic_items[0]["score"] == 31


# ── blurb HTML / entities stripped to plain text ────────────────────────────


def test_blurb_html_stripped(tmp_path, monkeypatch):
    async def _fake_get_json(client, url, headers=None):
        if "community.openai.com" in url:
            return _load_fixture()
        return {"posts": [], "topics": [], "grouped_search_result": {"post_ids": []}}

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    captured = _capture_writes(monkeypatch)

    _drive(research.discourse,
           RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    instance = "community.openai.com"
    item = next(it for it in captured["items"]
                if it["id"] == f"discourse:{instance}:70001")
    text = item["text"]
    assert "<span" not in text and "</span>" not in text   # tags gone
    assert "search-highlight" not in text                  # attribute gone
    assert "&amp;" not in text and "&" in text             # entity unescaped to '&'
    assert "MCP" in text                                   # highlighted term survives as text


# ── DISC-01: per-instance fail-soft — one instance down, others survive ──────


def test_per_instance_fail_soft(tmp_path, monkeypatch):
    async def _fake_get_json(client, url, headers=None):
        if "forum.cursor.com" in url:                      # one instance is down
            raise httpx.HTTPError("503 from cursor")
        return _load_fixture()                              # the other two contribute

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    captured = _capture_writes(monkeypatch)

    # MUST NOT raise — a single instance failing is non-fatal (DISC-01).
    _drive(research.discourse,
           RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "discourse"
    items = captured["items"]
    assert items != [], "survivors must still contribute when one instance fails"
    # The two surviving instances both serve the fixture → both contribute their topics.
    ids = {it["id"] for it in items}
    assert any("community.openai.com" in i for i in ids)
    assert any("discuss.huggingface.co" in i for i in ids)
    assert not any("forum.cursor.com" in i for i in ids)


# ── total fail-soft — every instance down → [] envelope, never raises ────────


def test_total_fail_soft(tmp_path, monkeypatch):
    async def _boom(client, url, headers=None):
        raise httpx.HTTPError("all instances down")

    monkeypatch.setattr(research, "_get_json", _boom)
    captured = _capture_writes(monkeypatch)

    # MUST NOT raise — total failure still writes a [] envelope (Phase-11 guard).
    _drive(research.discourse,
           RT.ns(query="mcp", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "discourse"
    assert captured["items"] == []
