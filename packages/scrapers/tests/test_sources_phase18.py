"""Shared Wave-0 TDD module for the Phase-18 source-coverage trio (SRC-08/09/10).

This is the SHARED scaffold the three Phase-18 plans extend: 18-01 (Europe PMC,
this file's first block), 18-02 (entity resolution), and 18-03 (keyless web
fallback) each APPEND their own ``-k``-selectable test functions here without
restructuring the existing ones.

18-01 — Europe PMC (SRC-08): these tests are RED until ``research.europepmc``
exists (Task 2 GREEN). Calling it before then raises ``AttributeError``
(``module 'research' has no attribute 'europepmc'``) — the intended RED signal,
exactly like ``tests/test_bluesky.py`` pinned BSKY before it existed.

They lock the SRC-08 envelope contract as executable assertions:

* ``test_europepmc_envelope_maps_core_row`` — a populated ``resultType=core`` row
  maps onto the uniform envelope: ``europepmc.org``/``doi.org`` URL (the gold-
  matching lift mechanism), ``doi``/``pmid``/``pmcid``/``is_oa`` in ``extra``,
  ``abstractText`` capped at 800 chars, author trimmed to <=4 names, journal title
  in ``tags``, ``citedByCount``→``score`` (kept for RRF, never sorted on, D-26).
* ``test_europepmc_failsoft_on_sparse_row`` — a sparse row (no doi/abstract)
  still emits an item with a non-empty fallback URL and an empty body, no raise.
* ``test_europepmc_empty_on_no_results`` — a ``hitCount 0`` payload writes an
  empty envelope, no raise.
* ``test_europepmc_registered_academic_tier`` — pins the tier assignment by a
  named test (``routing.SOURCE_TIERS["europepmc"] == {"academic"}``).

Offline only: ``research._get_json`` is monkeypatched (no network); ``write_out``
is monkeypatched to capture items in-memory. No new dependency. No bare ``except``.
"""
import json
import pathlib

import asyncio

import httpx

import research
import research_topic as RT

from tests.conftest import ENVELOPE_KEYS

# ─────────────────────────── 18-01 — Europe PMC (SRC-08) ─────────────────────

_EPMC_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "europepmc_core_sample.json"


def _drive(fn, a):
    """Drive an async ``source(client, a)`` coroutine to completion over a short-lived
    httpx client (Phase-5 D-01/D-06: the sources are ``async def``). Mirrors the
    ``tests/test_sources_phase4.py`` / ``tests/test_bluesky.py`` helper.

    Resets the per-run ``_LIMITERS`` ContextVar to a fresh dict first — exactly what
    production ``research_topic._run_async`` does once per run (``R._LIMITERS.set({})``).
    A source like ``ddg`` that calls ``_limiter_for`` directly would otherwise re-use an
    ``AsyncLimiter`` bound to a PRIOR test's ``asyncio.run`` event loop (a benign but noisy
    cross-loop RuntimeWarning), since each ``_drive`` spins a fresh loop in one process."""
    research._LIMITERS.set({})
    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await fn(c, a)
    asyncio.run(_go())


def _load_epmc_fixture():
    return json.loads(_EPMC_FIXTURE.read_text())


def _capture_writes(monkeypatch):
    """Monkeypatch ``research.write_out`` to capture ``(source, items)`` in-memory,
    mirroring the ``_run_async`` collect seam. Returns the mutable capture dict."""
    captured = {}

    def _fake_write_out(source, query, items, out=None):
        captured["source"] = source
        captured["items"] = items

    monkeypatch.setattr(research, "write_out", _fake_write_out)
    return captured


def _patch_get_json(monkeypatch, payload):
    async def _fake_get_json(client, url, headers=None):
        return payload

    monkeypatch.setattr(research, "_get_json", _fake_get_json)


def test_europepmc_envelope_maps_core_row(tmp_path, monkeypatch):
    """europepmc_envelope: a populated resultType=core row → the uniform envelope."""
    fixture = _load_epmc_fixture()
    _patch_get_json(monkeypatch, fixture)
    captured = _capture_writes(monkeypatch)

    _drive(research.europepmc,
           RT.ns(query="glymphatic clearance focused ultrasound", limit=25,
                 out=str(tmp_path / "x.json")))

    assert captured["source"] == "europepmc"
    items = captured["items"]
    assert len(items) >= 1
    row = fixture["resultList"]["result"][0]
    item = items[0]

    # The URL is the lift mechanism: europepmc.org / doi.org.
    assert item["url"].startswith("https://europepmc.org/") or item["url"].startswith("https://doi.org/")

    # Structured biomedical metadata rides `extra`.
    assert item["extra"]["doi"] == row["doi"]
    assert item["extra"]["pmid"] == row["pmid"]
    assert item["extra"]["pmcid"] == row["pmcid"]
    assert item["extra"]["is_oa"] is True            # mapped from isOpenAccess == "Y"
    assert item["extra"]["source"] == row["source"]

    # abstractText capped at 800 chars (the row's abstract is deliberately longer).
    assert len(row["abstractText"]) > 800            # fixture sanity: the cap is testable
    assert item["text"] == row["abstractText"][:800]
    assert len(item["text"]) <= 800

    # authorString trimmed to <= 4 names.
    assert item["author"]
    assert len([n for n in item["author"].split(", ") if n]) <= 4

    assert item["title"] == row["title"]
    assert item["created_utc"] == row["firstPublicationDate"]   # firstPublicationDate preferred
    assert item["score"] == row["citedByCount"]                 # kept for RRF, NOT sorted on (D-26)

    # journal title surfaced in tags.
    assert row["journalInfo"]["journal"]["title"] in item["tags"]

    assert set(item.keys()) == ENVELOPE_KEYS


def test_europepmc_failsoft_on_sparse_row(tmp_path, monkeypatch):
    """A sparse row (no doi/abstract) → a non-empty fallback URL + empty body, no raise."""
    fixture = _load_epmc_fixture()
    _patch_get_json(monkeypatch, fixture)
    captured = _capture_writes(monkeypatch)

    _drive(research.europepmc,
           RT.ns(query="glymphatic clearance focused ultrasound", limit=25,
                 out=str(tmp_path / "x.json")))

    items = captured["items"]
    # The sparse PPR row is the second result row.
    assert len(items) >= 2
    sparse = items[1]
    assert sparse["url"]                  # non-empty fallback (europepmc.org/article/{source}/{id})
    assert sparse["text"] == ""           # no abstractText
    assert set(sparse.keys()) == ENVELOPE_KEYS


def test_europepmc_empty_on_no_results(tmp_path, monkeypatch):
    """A hitCount 0 payload → an empty envelope, no raise (self-limiting on CS topics)."""
    _patch_get_json(monkeypatch, {"hitCount": 0, "resultList": {"result": []}})
    captured = _capture_writes(monkeypatch)

    _drive(research.europepmc,
           RT.ns(query="reciprocal rank fusion", limit=25, out=str(tmp_path / "x.json")))

    assert captured["source"] == "europepmc"
    assert captured["items"] == []


def test_europepmc_registered_academic_tier():
    """europepmc is registered as an academic-tier source (pins the tier by a named test)."""
    import routing

    assert "europepmc" in routing.SOURCE_TIERS
    assert routing.SOURCE_TIERS["europepmc"] == frozenset({"academic"})


# ─────────────────────── 18-02 — entity resolution (SRC-10) ──────────────────
#
# ONE merged `entity` source (18-RESEARCH §4): OpenAlex-authors (the core win —
# openalex.org/A... + orcid.org URLs) + ORCID expanded-search + ROR v2, fired ONLY
# for a detected person/org query and self-limiting (returns [] with NO network on a
# non-entity query). RED until research.entity + query_norm.detect_entity_query exist
# (Task 2 GREEN) — calling research.entity raises AttributeError, the intended signal.
#
# Offline only: research._get_json is monkeypatched per-URL; write_out is captured
# in-memory. No new dependency. No bare except. All `-k entity`-selectable.

_ENTITY_FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def _patch_get_json_by_url(monkeypatch):
    """Dispatch research._get_json on the URL substring to the matching committed sample
    (OpenAlex authors / ORCID expanded-search / ROR v2). Unknown URL -> {} (fail-soft)."""
    openalex = json.loads((_ENTITY_FIXTURES / "openalex_author_sample.json").read_text())
    orcid = json.loads((_ENTITY_FIXTURES / "orcid_expanded_sample.json").read_text())
    ror = json.loads((_ENTITY_FIXTURES / "ror_v2_sample.json").read_text())

    async def _fake_get_json(client, url, headers=None):
        if "api.openalex.org/authors" in url:
            return openalex
        if "pub.orcid.org" in url:
            return orcid
        if "api.ror.org" in url:
            return ror
        return {}

    monkeypatch.setattr(research, "_get_json", _fake_get_json)


def test_entity_envelope_maps_openalex_author(tmp_path, monkeypatch):
    """entity_envelope: OpenAlex-author -> openalex.org/A + orcid URLs; ROR v2 display name."""
    _patch_get_json_by_url(monkeypatch)
    captured = _capture_writes(monkeypatch)

    _drive(research.entity,
           RT.ns(query="Jordan Amadio Institute of Neuro Innovation UT Austin", limit=15,
                 out=str(tmp_path / "x.json")))

    assert captured["source"] == "entity"
    items = captured["items"]
    assert len(items) >= 1

    # The OpenAlex-author core win: some item carries openalex.org/A... AND the orcid URL
    # (in url or extra) — the two gold-matching URLs the dogfood found missing.
    haystacks = [
        " ".join(str(item.get(k) or "") for k in ("id", "url"))
        + " " + " ".join(str(v or "") for v in (item.get("extra") or {}).values())
        for item in items
    ]
    assert any("openalex.org/A" in h for h in haystacks), "an openalex.org/A author id must be emitted"
    assert any("orcid.org/0000-0003-3468-2620" in h for h in haystacks), "the ORCID URL must be emitted"

    # The ROR row maps the ror_display-typed v2 name, never the absent top-level `name`.
    titles = [item.get("title") for item in items]
    assert "University of Texas at Austin" in titles, "ROR v2 display name must be mapped"

    # Every emitted item is a uniform envelope (the same key set every source produces).
    for item in items:
        assert set(item.keys()) == ENVELOPE_KEYS


def test_entity_ror_uses_v2_display_name(tmp_path, monkeypatch):
    """The ROR row maps names[{types:['ror_display']}].value, never the absent top-level name."""
    _patch_get_json_by_url(monkeypatch)
    captured = _capture_writes(monkeypatch)

    _drive(research.entity,
           RT.ns(query="University of Texas at Austin", limit=15, out=str(tmp_path / "x.json")))

    ror_titles = [it.get("title") for it in captured["items"]
                  if "ror.org" in str((it.get("extra") or {}).get("ror") or "")]
    assert ror_titles, "a ROR item should be emitted"
    for title in ror_titles:
        assert title == "University of Texas at Austin"
        assert title not in (None, "", "undefined")


def test_entity_self_limit_no_network(tmp_path, monkeypatch):
    """The conditional thunk fires NO network for a non-entity query (self-limit before fetch)."""
    import research_topic

    called = {"n": 0}

    async def _boom(client, url, headers=None):
        called["n"] += 1
        raise AssertionError("entity must NOT hit the network on a non-entity query")

    monkeypatch.setattr(research, "_get_json", _boom)
    captured = _capture_writes(monkeypatch)

    # Drive the registry thunk directly for a NON-entity query: it must early-return the
    # empty path (via _empty_source) WITHOUT calling research.entity / the network.
    thunk = research_topic._entity_thunk("reciprocal rank fusion", limit=15)

    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await thunk(c)

    asyncio.run(_go())

    assert called["n"] == 0, "no network call may happen for a non-entity query"
    assert captured.get("source") == "entity"
    assert captured.get("items") == []


def test_entity_tier_is_broad():
    """entity is registered tier-broad — all 4 tiers (18-03 integration fix).

    The detect_entity_query conditional-fire thunk (not the tier) is the real gate,
    so entity must be eligible on general-tier person/org queries (e.g. amadio),
    which classify as `general`, not just academic ones. The thunk still bounds
    actual firing to true entity queries. (18-02 originally pinned this to
    {academic} only, which blocked entity from ever firing on amadio.)
    """
    import routing

    assert "entity" in routing.SOURCE_TIERS
    assert routing.SOURCE_TIERS["entity"] == frozenset(
        {"academic", "consumer", "dev", "general"}
    )


# ──────────────────── 18-03 — keyless web fallback (SRC-09) ───────────────────
#
# DDG-Lite (SRC-09): a hand-rolled POST to lite.duckduckgo.com/lite/ with the proven
# browser header set, parsed via stdlib html.parser; each result-link href is a
# `uddg=`-wrapped redirect URL-decoded to the real target. Fires ONLY when Brave is
# keyless (the conditional registry thunk); a 202/empty/challenge body fails soft to [].
# RED until research.ddg (+ _parse_ddg_lite) exist (Task 3 GREEN) — calling research.ddg
# raises AttributeError, the intended signal (cf. europepmc/entity above).
#
# Offline only: the shared httpx client's `post` is monkeypatched to return the committed
# HTML fixture (or a 202 / empty body); write_out is captured in-memory via _capture_writes.
# No new dependency. No bare except. All `-k ddg`-selectable.

_DDG_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ddg_lite_sample.html"


class _FakeResp:
    """Minimal httpx-Response stand-in: only the .status_code / .text the source reads."""

    def __init__(self, status_code, text):
        self.status_code = status_code
        self.text = text


def _patch_client_post(monkeypatch, status_code, text):
    """Monkeypatch httpx.AsyncClient.post to return a canned (status_code, text) — no network.

    research.ddg POSTs via the shared client (mirrors research._reddit_token), so patching
    the client method (not research._get_json, which is GET-only) is the right seam."""
    async def _fake_post(self, url, data=None, headers=None, timeout=None):
        return _FakeResp(status_code, text)

    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)


def test_ddg_parse_extracts_uddg_targets(tmp_path, monkeypatch):
    """ddg_parse: result-link rows decode to their real uddg= targets; the footer link is ignored."""
    html = _DDG_FIXTURE.read_text()
    _patch_client_post(monkeypatch, 200, html)
    captured = _capture_writes(monkeypatch)

    _drive(research.ddg,
           RT.ns(query="MoltGrid github", limit=15, out=str(tmp_path / "x.json")))

    assert captured["source"] == "ddg"
    items = captured["items"]
    assert len(items) >= 3, "all three result-link rows must be parsed"

    urls = [it.get("url") for it in items]
    # The uddg= param is decoded to the REAL target, NOT the //duckduckgo.com/l/ wrapper.
    assert "https://github.com/D0NMEGA/MoltGrid" in urls
    assert all("duckduckgo.com/l/" not in (u or "") for u in urls), "uddg wrapper must be decoded away"

    # The footer <a> (no result-link class) is NOT a result.
    assert all("duckduckgo.com/about" not in (u or "") for u in urls), "footer link must be ignored"

    # Every emitted item is a uniform envelope (the same key set every source produces).
    for it in items:
        assert set(it.keys()) == ENVELOPE_KEYS


def test_ddg_parse_helper_decodes_targets():
    """The module-level _parse_ddg_lite helper decodes uddg targets + drops the footer link."""
    html = _DDG_FIXTURE.read_text()
    parsed = research._parse_ddg_lite(html)
    urls = [it.get("url") for it in parsed]
    assert "https://github.com/D0NMEGA/MoltGrid" in urls
    assert "https://moltgrid.example.com/" in urls
    assert any("blog.example.org/moltgrid-deep-dive" in (u or "") for u in urls)
    assert all("duckduckgo.com/about" not in (u or "") for u in urls)


def test_ddg_failsoft_on_202(tmp_path, monkeypatch):
    """A 202 challenge response (typical bare-header rejection) → [] envelope, no raise."""
    _patch_client_post(monkeypatch, 202, "<html><body>challenge</body></html>")
    captured = _capture_writes(monkeypatch)

    _drive(research.ddg,
           RT.ns(query="MoltGrid github", limit=15, out=str(tmp_path / "x.json")))

    assert captured["source"] == "ddg"
    assert captured["items"] == []


def test_ddg_failsoft_on_empty_body(tmp_path, monkeypatch):
    """A 200 with an empty body → [] envelope, no raise."""
    _patch_client_post(monkeypatch, 200, "")
    captured = _capture_writes(monkeypatch)

    _drive(research.ddg,
           RT.ns(query="MoltGrid github", limit=15, out=str(tmp_path / "x.json")))

    assert captured["source"] == "ddg"
    assert captured["items"] == []


def test_ddg_tier_registered():
    """ddg is registered in the routing tier table (value pinned after the tier is chosen)."""
    import routing

    assert "ddg" in routing.SOURCE_TIERS


def test_ddg_self_limit_when_brave_keyed(tmp_path, monkeypatch):
    """The conditional registry thunk takes the no-network empty path when Brave IS keyed.

    Mirrors 18-02's entity self-limit: with BRAVE_API_KEY set, the ddg thunk fires
    _empty_source('ddg') and never POSTs (research.ddg / the network is not called)."""
    import research_topic

    monkeypatch.setenv("BRAVE_API_KEY", "test-key-present")

    async def _boom(self, url, data=None, headers=None, timeout=None):
        raise AssertionError("ddg must NOT hit the network when Brave is keyed")

    monkeypatch.setattr(httpx.AsyncClient, "post", _boom)
    captured = _capture_writes(monkeypatch)

    # The exact registry thunk expression (research_topic._run_async): fire R.ddg only when
    # Brave is keyless, else the no-network _empty_source('ddg') path.
    topic, limit = "MoltGrid github", 15

    def thunk(c):
        return (research.ddg(c, RT.ns(query=topic, limit=limit))
                if not research_topic._has_key("brave")
                else research_topic._empty_source("ddg"))

    async def _go():
        async with httpx.AsyncClient(headers={"User-Agent": research.UA}) as c:
            await thunk(c)

    asyncio.run(_go())

    assert captured.get("source") == "ddg"
    assert captured.get("items") == []
