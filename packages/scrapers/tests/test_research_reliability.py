"""RED-first reliability unit tests for Phase 19 (REL-01 / REL-02 / REL-03).

These pin the three always-on source/route reliability fixes the 5-topic dogfood
exposed, BEFORE the code is written, so the implementation lands against a fixed
contract instead of exploring:

  * REL-02 — ``research.npm()`` sanitizes the ``text=`` query: npm's ``/-/v1/search``
    ``text`` parameter is a documented HARD limit of 2..64 chars (live-verified
    2026-06-27: ``>64`` -> HTTP 400 "must be between 2 and 64 characters"). A
    keyphrase-rich topic can still exceed 64 even after Phase-17 ``kq`` shaping, so
    npm must truncate on a WORD boundary (no mid-token cut) and fall back to a safe
    default on a ``<2``-char query.
  * REL-03 — ``research.rss()`` caps the flood: at most ``_RSS_ITEMS_PER_FEED`` (==8)
    items survive per feed AND at most ``_RSS_TOTAL_CAP`` (~25) items total, sorted
    freshest-first by ``created_utc`` (None sorts last).
  * REL-01 — ``news`` is retired from the always-on route (absent from
    ``research_topic.SOURCES`` / ``routing.SOURCE_TIERS`` / the route) but KEPT as a
    dormant ``build_parser`` CLI subcommand (the ``lobsters``/``medium`` precedent).
    (The ``news`` retirement edits land in Task 2; the contract assertion lives here
    with the other reliability pins.)

Offline only: ``research._get_json`` / ``research._get_rss`` are monkeypatched (no
network); ``research.write_out`` is monkeypatched to capture items in-memory (mirror
``tests/test_rss.py`` / ``tests/test_sources_phase18.py``). No new dependency, no bare
``except``.
"""

import urllib.parse

import asyncio

import httpx

import research
import research_topic as RT
import routing


# ── shared offline harness (mirrors tests/test_rss.py) ───────────────────────


def _drive(fn, a):
    """Drive an async ``source(client, a)`` coroutine to completion over a short-lived
    httpx client (Phase-5 D-01/D-06: the sources are ``async def``)."""
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await fn(c, a)
    asyncio.run(_go())


def _capture_writes(monkeypatch):
    """Monkeypatch ``research.write_out`` to capture ``(source, items)`` in-memory."""
    captured = {}

    def _fake_write_out(source, query, items, out=None):
        captured["source"] = source
        captured["items"] = items

    monkeypatch.setattr(research, "write_out", _fake_write_out)
    return captured


def _capture_npm_url(monkeypatch, objects=None):
    """Monkeypatch ``research._get_json`` to RECORD the URL npm builds (so the test can
    decode the ``text=`` param) and return a minimal valid ``/-/v1/search`` payload."""
    captured = {}

    async def _fake_get_json(client, url, headers=None):
        captured["url"] = url
        return {"objects": objects or []}

    monkeypatch.setattr(research, "_get_json", _fake_get_json)
    return captured


def _text_param(url: str) -> str:
    """Decode the ``text`` query parameter out of a captured npm search URL."""
    qs = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    assert "text" in qs, f"npm URL has no text param: {url}"
    return qs["text"][0]


# ── REL-02: npm text-param sanitizer (2..64 chars, word boundary) ────────────


def test_npm_long_query_truncated_to_64_on_word_boundary(tmp_path, monkeypatch):
    # A 70-char multi-word query (exceeds npm's 64-char hard limit). The text param
    # sent to npm must be <=64 chars AND end on a whole word (no mid-token cut).
    long_q = "ai agent startup ideas defensible moat market opportunity venture saas"
    assert len(long_q) == 70, len(long_q)
    captured = _capture_npm_url(monkeypatch)

    _drive(research.npm,
           RT.ns(query=long_q, limit=10, out=str(tmp_path / "x.json")))

    sent = _text_param(captured["url"])
    assert len(sent) <= 64, f"npm text must be <=64 chars, got {len(sent)}: {sent!r}"
    # Word-boundary: the sent string is a whole-word prefix of the original query
    # (no partial trailing token).
    assert long_q.startswith(sent), f"{sent!r} is not a prefix of the query"
    assert not long_q[len(sent):].lstrip().startswith(sent.split(" ")[-1][1:] or "\0"), \
        "trailing token must be whole"
    # Concretely: the next original char after the cut is a space (clean boundary)
    # OR we consumed the whole string.
    assert len(sent) == len(long_q) or long_q[len(sent)] == " ", \
        f"truncation not on a word boundary: {sent!r}"


def test_npm_short_query_passed_through_unchanged(tmp_path, monkeypatch):
    # A normal short dev query must be sent verbatim — no truncation, no default.
    q = "rust async runtime"
    captured = _capture_npm_url(monkeypatch)

    _drive(research.npm,
           RT.ns(query=q, limit=10, out=str(tmp_path / "x.json")))

    assert _text_param(captured["url"]) == q


def test_npm_sub_two_char_query_falls_back_to_default(tmp_path, monkeypatch):
    # npm rejects a <2-char text param too (lower bound of the 2..64 window) -> the
    # sanitizer must fall back to the safe "framework" default.
    captured = _capture_npm_url(monkeypatch)

    _drive(research.npm,
           RT.ns(query="x", limit=10, out=str(tmp_path / "x.json")))

    assert _text_param(captured["url"]) == "framework"


# ── REL-03: RSS per-feed cap (==8) + total-RSS cap (freshness-sorted) ─────────


def _atom_feed(host_token: str, n: int) -> bytes:
    """Build an Atom feed of ``n`` entries with ids unique to ``host_token`` (so the
    per-run dedup in ``rss()`` does not collapse entries across feeds) and STRICTLY
    DECREASING freshness (entry 0 newest), so a freshness-sorted total cap is testable."""
    entries = []
    for i in range(n):
        # year descends 2099..; entry 0 is the newest. ids are feed-unique.
        year = 2099 - i
        entries.append(
            f'<entry><title>{host_token}-{i}</title>'
            f'<id>tag:{host_token},{year}:{i}</id>'
            f'<link rel="alternate" href="https://{host_token}.example/e/{i}"/>'
            f'<published>{year}-01-01T00:00:00Z</published>'
            f'<content type="html">{host_token} entry {i} agent model body</content>'
            '</entry>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<feed xmlns="http://www.w3.org/2005/Atom">'
        f'<title>{host_token}</title>'
        + "".join(entries)
        + '</feed>'
    ).encode()


def _patch_rss_unique_per_feed(monkeypatch, n_per_feed: int):
    """Serve EVERY allowlist feed an Atom doc of ``n_per_feed`` feed-unique entries."""
    async def _fake_get_rss(client, url, timeout=30.0):
        host = urllib.parse.urlsplit(url).hostname or "feed"
        token = host.replace(".", "-")
        return _atom_feed(token, n_per_feed)

    monkeypatch.setattr(research, "_get_rss", _fake_get_rss)


def test_rss_per_feed_cap_is_eight(tmp_path, monkeypatch):
    # Each of the 12 feeds offers 30 entries; at most 8 may survive PER FEED.
    _patch_rss_unique_per_feed(monkeypatch, 30)
    captured = _capture_writes(monkeypatch)

    _drive(research.rss,
           RT.ns(query="ai agents", limit=150, out=str(tmp_path / "x.json")))

    items = captured["items"]
    # group by feed token (the title prefix encodes the feed)
    per_feed: dict[str, int] = {}
    for it in items:
        feed_token = it["title"].rsplit("-", 1)[0]
        per_feed[feed_token] = per_feed.get(feed_token, 0) + 1
    assert per_feed, "expected RSS items"
    worst = max(per_feed.values())
    assert worst <= 8, f"per-feed cap must be <=8, a feed contributed {worst}: {per_feed}"


def test_rss_total_cap_freshness_sorted(tmp_path, monkeypatch):
    # 12 feeds * 8 surviving = up to 96 candidates; the total-RSS cap bounds the
    # envelope to <= _RSS_TOTAL_CAP, sorted freshest-first (None last).
    _patch_rss_unique_per_feed(monkeypatch, 30)
    captured = _capture_writes(monkeypatch)

    _drive(research.rss,
           RT.ns(query="ai agents", limit=150, out=str(tmp_path / "x.json")))

    items = captured["items"]
    cap = research._RSS_TOTAL_CAP
    assert len(items) <= cap, f"total RSS must be <= {cap}, got {len(items)}"
    # freshness-sorted (descending created_utc; None sorts last)
    keys = [(it.get("created_utc") is None, -(it.get("created_utc") or 0)) for it in items]
    assert keys == sorted(keys), "RSS items must be freshness-sorted (newest first, None last)"


def test_rss_total_cap_orders_none_created_last(tmp_path, monkeypatch):
    # A feed whose entries carry NO published date (created_utc is None) must rank
    # below dated entries when the total cap slices.
    dated = _atom_feed("dated", 8)

    undated_entries = "".join(
        f'<entry><title>undated-{i}</title>'
        f'<id>tag:undated:{i}</id>'
        f'<link rel="alternate" href="https://undated.example/e/{i}"/>'
        f'<content type="html">undated entry {i}</content>'
        '</entry>'
        for i in range(8)
    )
    undated = (
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">'
        '<title>undated</title>' + undated_entries + '</feed>'
    ).encode()

    async def _fake_get_rss(client, url, timeout=30.0):
        if "dated" in url and "undated" not in url:
            return dated
        if "huggingface" in url:  # arbitrary second feed serves the undated set
            return undated
        return b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'

    monkeypatch.setattr(research, "_get_rss", _fake_get_rss)
    captured = _capture_writes(monkeypatch)

    _drive(research.rss,
           RT.ns(query="ai agents", limit=150, out=str(tmp_path / "x.json")))

    items = captured["items"]
    dated_titles = [it["title"] for it in items if it.get("created_utc") is not None]
    undated_titles = [it["title"] for it in items if it.get("created_utc") is None]
    if undated_titles and dated_titles:
        first_undated = next(i for i, it in enumerate(items)
                             if it.get("created_utc") is None)
        last_dated = max(i for i, it in enumerate(items)
                         if it.get("created_utc") is not None)
        assert last_dated < first_undated, "dated entries must precede undated ones"


# ── REL-01: news retired from the route but kept as a dormant CLI subcommand ──


def test_news_retired_from_route_but_kept_as_cli():
    # news must be GONE from the always-on route surfaces ...
    assert "news" not in RT.SOURCES, "news must be removed from research_topic.SOURCES"
    assert "news" not in routing.SOURCE_TIERS, "news must be removed from routing.SOURCE_TIERS"
    assert "news" not in routing.route("best budget air purifier 2026 HEPA"), \
        "news must not fire on a consumer/general route"
    # ... but STILL reachable as a dormant CLI subcommand (lobsters/medium precedent).
    parser = research.build_parser()
    subparser_action = next(
        a for a in parser._subparsers._group_actions if hasattr(a, "choices")
    )
    assert "news" in subparser_action.choices, \
        "news must stay a build_parser CLI subcommand (dormant-CLI contract)"
