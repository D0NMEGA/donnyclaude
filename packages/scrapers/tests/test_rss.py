"""Wave-0 TDD (RED) for the curated RSS/Atom freshness source (RSS-01/03/04).

``research.rss`` does not exist yet — it is added by Plan 02 Task 2 (GREEN).
Calling it therefore raises ``AttributeError`` (``module 'research' has no
attribute 'rss'``), which is the intended RED signal here (exactly like
``tests/test_discourse.py`` pinned ``discourse`` and ``tests/test_bluesky.py``
pinned ``bluesky`` before they existed). ``import research`` itself must still
succeed — the failure is the missing ``research.rss`` attribute inside ``_drive``,
NOT a collection-time ImportError.

These tests lock the RSS-01/03/04 fetcher contract as executable assertions:

* ``test_envelope_mapping`` (RSS-01) — parsing the recorded ``.atom`` fixture maps
  onto the uniform envelope: ``title`` == entry title, ``url`` == entry link,
  ``text`` == HTML-stripped content, ``id`` starts with ``"rss:"``, ``score is
  None``, ``num_comments is None``, ``top_comments == []``, ``created_utc`` is an
  epoch float; item keys == ``ENVELOPE_KEYS``.
* ``test_bozo_degrades`` (RSS-01) — a feed whose ``d.bozo == 1`` but ``d.entries``
  is non-empty STILL contributes its entries (degrade, not discard); a bozo feed
  with empty ``d.entries`` is skipped.
* ``test_score_none`` (RSS-04) — every emitted item has ``score is None`` (feeds
  carry no popularity signal).
* ``test_struct_time_to_epoch`` (RSS-04) — a known ``published_parsed`` UTC
  ``struct_time`` maps to ``calendar.timegm(st)`` (the exact epoch), and is NOT
  the tz-skewed ``time.mktime(st)`` value.
* ``test_dedup_no_new_code`` (RSS-04) — an RSS item and a GitHub-release item
  sharing one canonical URL collapse via the EXISTING ``rank.rank_items`` path to
  a single survivor carrying ``extra.also_seen_on``. No new rank code.
* ``test_rss_no_force_cache_ttl`` (RSS-03) — the RSS GET path does NOT send the
  ``X-Hishel-Ttl`` header (capture outbound headers; assert absent).
* ``test_rss_spec_policy_304`` (RSS-03) — the ``rss`` source is wired to fetch
  through a ``SpecificationPolicy``-backed client: ``research_topic._make_rss_client()``
  returns a client whose hishel transport policy is a ``SpecificationPolicy``
  instance (the offline WIRING; live validator headers are a Manual-Only check per
  13-VALIDATION.md).
* ``test_per_feed_failsoft`` + ``test_total_failure_empty`` (RSS-04) — one dead
  feed → others still contribute; all feeds dead → ``[]`` envelope, never raises.

Offline only: the RSS raw-bytes GET helper (``research._get_rss``) is monkeypatched
to return recorded fixture bytes (no network); ``research.write_out`` is
monkeypatched to capture items in-memory (mirror ``test_discourse._capture_writes``).
No bare ``except``.
"""
import calendar
import pathlib
import time

import asyncio

import httpx

import research
import research_topic as RT

from tests.conftest import ENVELOPE_KEYS

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "rss_github_releases.atom"


def _drive(fn, a):
    """Drive an async ``source(client, a)`` coroutine to completion over a short-lived
    httpx client (Phase-5 D-01/D-06: the sources are ``async def``). Mirrors the
    ``tests/test_discourse.py`` helper."""
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await fn(c, a)
    asyncio.run(_go())


def _load_fixture_bytes() -> bytes:
    return _FIXTURE.read_bytes()


def _capture_writes(monkeypatch):
    """Monkeypatch ``research.write_out`` to capture ``(source, items)`` in-memory,
    mirroring the ``_run_async`` collect seam. Returns the mutable capture dict."""
    captured = {}

    def _fake_write_out(source, query, items, out=None):
        captured["source"] = source
        captured["items"] = items

    monkeypatch.setattr(research, "write_out", _fake_write_out)
    return captured


def _patch_rss_get(monkeypatch, body, seen=None):
    """Monkeypatch the RSS raw-bytes GET helper (``research._get_rss``) so the fetcher
    parses ``body`` for EVERY feed in the allowlist with no network. ``body`` may be a
    single value (returned for all feeds) or a callable ``(url) -> bytes|str``. When
    ``seen`` is provided, each outbound ``url`` is appended to it."""
    async def _fake_get_rss(client, url, timeout=30.0):
        if seen is not None:
            seen.append(url)
        return body(url) if callable(body) else body

    monkeypatch.setattr(research, "_get_rss", _fake_get_rss)


# ── RSS-01: feedparser entry → uniform envelope mapping ──────────────────────


def test_envelope_mapping(tmp_path, monkeypatch):
    # Only ONE feed serves the fixture; the rest return an empty feed so the
    # asserted item is unambiguous (mirror the discourse single-instance pattern).
    raw = _load_fixture_bytes()
    empty = b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'

    def _body(url):
        return raw if "claude-code" in url else empty

    _patch_rss_get(monkeypatch, _body)
    captured = _capture_writes(monkeypatch)

    _drive(research.rss,
           RT.ns(query="claude code mcp", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "rss"
    items = captured["items"]
    assert len(items) >= 3, f"fixture has 3 entries, got {len(items)}"

    # The v1.2.0 entry (newest, carries the <span>MCP</span> + &amp; content).
    item = next(it for it in items if it["title"] == "v1.2.0")

    assert item["id"].startswith("rss:"), item["id"]
    assert item["url"] == "https://github.com/anthropics/claude-code/releases/tag/v1.2.0"
    # text is HTML-stripped to plain text (no tags, entity unescaped).
    assert "<span" not in item["text"] and "</p>" not in item["text"]
    assert "MCP" in item["text"]
    assert "&amp;" not in item["text"] and "&" in item["text"]  # entity → '&'
    assert item["score"] is None                                # RSS has no popularity (RSS-04)
    assert item["num_comments"] is None
    assert item["top_comments"] == []
    assert isinstance(item["created_utc"], (int, float))        # epoch float
    assert item["tags"] == ["release"]
    assert set(item.keys()) == ENVELOPE_KEYS


# ── RSS-01: bozo feed degrades (non-empty entries still contribute) ──────────


def test_bozo_degrades(tmp_path, monkeypatch):
    # A malformed-but-recoverable feed: a stray unescaped ampersand in body text
    # sets d.bozo == 1, but feedparser still recovers the entry. Must contribute.
    bozo_with_entries = (
        b'<?xml version="1.0" encoding="UTF-8"?>'
        b'<feed xmlns="http://www.w3.org/2005/Atom">'
        b'<title>Bozo feed</title>'
        b'<entry><title>Recoverable release</title>'
        b'<id>tag:example,2026:1</id>'
        b'<link rel="alternate" href="https://example.com/r/1"/>'
        b'<published>2026-05-01T00:00:00Z</published>'
        b'<content type="html">Tom &amp; Jerry &raw ampersand</content>'
        b'</entry></feed>'
    )
    # A bozo feed with NO entries → skipped (no items contributed from it).
    bozo_empty = b'<<<not xml at all>>>'

    def _body(url):
        if "claude-code" in url:
            return bozo_with_entries
        return bozo_empty

    _patch_rss_get(monkeypatch, _body)
    captured = _capture_writes(monkeypatch)

    # MUST NOT raise — a bozo feed degrades, never crashes (ROADMAP SC#1).
    _drive(research.rss,
           RT.ns(query="release", limit=50, out=str(tmp_path / "x.json")))

    items = captured["items"]
    titles = {it["title"] for it in items}
    assert "Recoverable release" in titles, "bozo-but-non-empty feed must contribute"
    # The fully-broken (empty-entries) feed contributed nothing — only the one entry.
    assert len(items) == 1, f"only the recoverable entry should survive, got {titles}"


# ── RSS-04: every item has score=None (no popularity signal) ─────────────────


def test_score_none(tmp_path, monkeypatch):
    _patch_rss_get(monkeypatch, _load_fixture_bytes())
    captured = _capture_writes(monkeypatch)

    _drive(research.rss,
           RT.ns(query="claude code", limit=50, out=str(tmp_path / "x.json")))

    items = captured["items"]
    assert items, "fixture must yield items"
    assert all(it["score"] is None for it in items), "RSS items carry no score (RSS-04)"


# ── RSS-04: struct_time → epoch via calendar.timegm (NOT time.mktime) ────────


def test_struct_time_to_epoch(tmp_path, monkeypatch):
    _patch_rss_get(monkeypatch, _load_fixture_bytes())
    captured = _capture_writes(monkeypatch)

    _drive(research.rss,
           RT.ns(query="claude code", limit=50, out=str(tmp_path / "x.json")))

    item = next(it for it in captured["items"] if it["title"] == "v1.2.0")

    # The fixture's <published> is 2026-05-10T18:30:00Z (UTC). The correct epoch is
    # calendar.timegm of that UTC struct_time — NOT time.mktime (which assumes local
    # time and leaks the box's tz offset; verified non-zero skew off-UTC).
    st = time.struct_time((2026, 5, 10, 18, 30, 0, 6, 130, 0))
    expected = calendar.timegm(st)
    assert item["created_utc"] == expected, (item["created_utc"], expected)
    # On any non-UTC box this guards the tz-skew pitfall; on a UTC box they coincide,
    # so only assert inequality when the box actually has an offset.
    if time.mktime(st) != calendar.timegm(st):
        assert item["created_utc"] != time.mktime(st), "must use timegm, not mktime"


# ── RSS-04: dedup against a GitHub-release item via the EXISTING rank path ────


def test_dedup_no_new_code(tmp_path, monkeypatch):
    # An RSS item and a github-source item sharing the SAME canonical URL must
    # collapse via rank.rank_items (the existing canonical_url + MinHash path) to a
    # single survivor whose extra.also_seen_on records the other source. Zero new
    # rank code. rank_items takes {source: [items]} and returns the deduped survivors.
    import rank

    shared_url = "https://github.com/anthropics/claude-code/releases/tag/v1.2.0"
    rss_item = {
        "id": "rss:github.com:tag:1/v1.2.0", "title": "claude-code v1.2.0",
        "author": None, "score": None, "num_comments": None,
        "created_utc": 1778437800, "url": shared_url,
        "text": "Adds the MCP server and OAuth support to claude code.",
        "top_comments": [], "tags": ["release"], "extra": {},
    }
    gh_item = {
        "id": "github:anthropics/claude-code", "title": "anthropics/claude-code v1.2.0",
        "author": "anthropics", "score": 120, "num_comments": None,
        "created_utc": 1778437800, "url": shared_url,
        "text": "claude code agent CLI — v1.2.0 release with MCP and OAuth.",
        "top_comments": [], "tags": [], "extra": {},
    }
    collected = {"rss": [rss_item], "github": [gh_item]}

    survivors = rank.rank_items("claude code mcp", collected, k=10)

    same_url = [it for it in survivors if it["url"] == shared_url]
    assert len(same_url) == 1, f"same canonical URL must collapse to one, got {len(same_url)}"
    also = same_url[0]["extra"].get("also_seen_on") or []
    assert "rss" in also or "github" in also, (
        f"the collapsed survivor must record the other source in also_seen_on, got {also}")


# ── RSS-03: the RSS GET path omits X-Hishel-Ttl ──────────────────────────────


def test_rss_no_force_cache_ttl(tmp_path, monkeypatch):
    # Drive the RSS path through the REAL research._get_rss (Task 2 helper) but
    # intercept the underlying client.get to capture the outbound headers. The RSS
    # path must NOT inject X-Hishel-Ttl (D-13-01) — that header drives the force-cache
    # TTL and is the wrong behavior for a freshness feed.
    seen_headers = []
    raw = _load_fixture_bytes()

    class _CapatureTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            seen_headers.append(dict(request.headers))
            return httpx.Response(200, content=raw,
                                  headers={"content-type": "application/atom+xml"})

    # Patch _RSS_FEEDS down to a single feed so we make exactly one GET, and stub
    # write_out so the fetcher doesn't touch disk (this test only inspects headers).
    monkeypatch.setattr(research, "_RSS_FEEDS",
                        ("https://github.com/anthropics/claude-code/releases.atom",))
    _capture_writes(monkeypatch)

    async def _go():
        async with httpx.AsyncClient(transport=_CapatureTransport(),
                                     headers={"User-Agent": research.UA}) as c:
            await research.rss(c, RT.ns(query="claude code",
                                        limit=50, out=str(tmp_path / "x.json")))

    asyncio.run(_go())

    assert seen_headers, "the RSS path must issue at least one GET"
    for h in seen_headers:
        keys = {k.lower() for k in h}
        assert "x-hishel-ttl" not in keys, f"RSS path must omit X-Hishel-Ttl, got {keys}"


# ── RSS-03: the rss source is wired through a SpecificationPolicy client ──────


def test_rss_spec_policy_304(monkeypatch):
    # Offline WIRING assertion (the live warm-304 is a Manual-Only check per
    # 13-VALIDATION.md): research_topic._make_rss_client() must build an httpx client
    # whose hishel transport runs RFC-9111 mode — policy is a SpecificationPolicy
    # (NOT the _CacheAll force-cache FilterPolicy the 14 API sources use).
    from hishel import SpecificationPolicy

    client = RT._make_rss_client()
    try:
        transport = client._transport
        # hishel 1.3.0: AsyncCacheTransport holds the policy on its internal
        # AsyncCacheProxy (verified against the installed wheel: handle_request
        # branches on self.policy). Be tolerant of either layout across patch versions.
        proxy = getattr(transport, "_cache_proxy", None)
        policy = (getattr(proxy, "policy", None) if proxy is not None
                  else getattr(transport, "policy", None))
        assert isinstance(policy, SpecificationPolicy), (
            f"rss client must use SpecificationPolicy (RFC-9111 304), got {policy!r}")
    finally:
        # close the client (and its hishel storage) cleanly.
        asyncio.run(client.aclose())


# ── RSS-04: per-feed fail-soft — one dead feed, others survive ───────────────


def test_per_feed_failsoft(tmp_path, monkeypatch):
    raw = _load_fixture_bytes()
    empty = b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'

    async def _fake_get_rss(client, url, timeout=30.0):
        if "claude-code" in url:                       # one feed is down
            raise httpx.HTTPError("503 from github")
        if "langchain" in url:                         # one feed serves the fixture
            return raw
        return empty                                   # the rest are empty-but-alive

    monkeypatch.setattr(research, "_get_rss", _fake_get_rss)
    captured = _capture_writes(monkeypatch)

    # MUST NOT raise — a single feed failing is non-fatal (D-13-02b).
    _drive(research.rss,
           RT.ns(query="langchain", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "rss"
    items = captured["items"]
    assert items != [], "survivors must still contribute when one feed fails"


# ── RSS-04: total failure → [] envelope, never raises ────────────────────────


def test_total_failure_empty(tmp_path, monkeypatch):
    async def _boom(client, url, timeout=30.0):
        raise httpx.HTTPError("all feeds down")

    monkeypatch.setattr(research, "_get_rss", _boom)
    captured = _capture_writes(monkeypatch)

    # MUST NOT raise — total failure still writes a [] envelope (D-13-02b).
    _drive(research.rss,
           RT.ns(query="anything", limit=50, out=str(tmp_path / "x.json")))

    assert captured["source"] == "rss"
    assert captured["items"] == []
