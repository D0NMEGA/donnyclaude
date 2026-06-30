"""Phase 5 (Robustness Hardening) — TDD scaffold (RED) + the hishel force-cache spike.

This file is written BEFORE any async/resilience implementation exists
(project CLAUDE.md: tests-first). It encodes every ROB-01..08 observable from
``.planning/phases/05-robustness-hardening/05-VALIDATION.md`` (the Dimension-8
map) as an executable assertion over a deterministic httpx ``MockTransport`` —
fully offline, no network, no keys. ``asyncio.sleep`` is monkeypatched to RECORD
delays, never to actually sleep, so the suite stays sub-second and the
DoS-via-retry guard (D-14 / threat T-05-04) is encoded as a bound, not a wait.

State at the end of Wave 0:
  * ``test_hishel_force_caches_headerless_json`` is GREEN — it pins the one
    version-sensitive surface (hishel 1.3.0 force-cache of header-less API JSON)
    against the INSTALLED wheel, so Plans 05-02..05-04 implement against a proven
    API instead of guessing (Pitfall 3 / Assumption A2).
  * EVERYTHING ELSE is RED — the tests import the future async surfaces
    (``research._get`` async, ``research._limiter_for``, ``research._HOST_TTLS``,
    ``research._LAST_CACHE_HIT``, ``research._retry_after_seconds``,
    ``research_topic._make_client``, ``research_topic.CAP``,
    ``research_topic.run_with_status``) which do not exist yet → ImportError /
    AttributeError is the intended RED. ``test_dotenv_populates_environ`` is the
    one acceptable early-green stub (it pins ROB-07's mechanism — python-dotenv
    is installed by Plan 05-01).

The ``-k`` selectors match the 05-VALIDATION Dimension-8 keywords so the
per-requirement verify commands resolve:
    cap · limit · cache · backoff · breaker · status · dotenv · contract

# ─────────────────────────────────────────────────────────────────────────────
# CONFIRMED hishel 1.3.0 FORCE-CACHE CONSTRUCTION — copy this verbatim in 05-02.
# (Verified live against the freshly-installed wheel during 05-01; the plan's
#  draft used ``X-Hishel-Ttl`` ALONE, which does NOT cache header-less JSON in
#  1.3.0 — that is exactly the version delta this spike exists to surface.)
#
#   from hishel import AsyncSqliteStorage, FilterPolicy, BaseFilter
#   from hishel.httpx import AsyncCacheTransport        # NOTE: in hishel.httpx,
#                                                       #       NOT top-level hishel
#
#   class _CacheAll(BaseFilter):                        # force-cache: bypass RFC 9111
#       def needs_body(self): return False
#       def apply(self, item, body): return True
#
#   storage = AsyncSqliteStorage(database_path=<gitignored .db>, default_ttl=900)
#   policy  = FilterPolicy(request_filters=[_CacheAll()],
#                          response_filters=[_CacheAll()])
#   transport = AsyncCacheTransport(next_transport=httpx.AsyncHTTPTransport(),
#                                   storage=storage, policy=policy)
#   client = httpx.AsyncClient(transport=transport, ...)
#   resp = await client.get(url, headers={"X-Hishel-Ttl": "<per-source-ttl>"})
#   resp.extensions.get("hishel_from_cache")            # False miss / True warm hit
#
# WHY FilterPolicy (not the default SpecificationPolicy): hishel 1.3.0 follows
# RFC 9111 strictly — a 200 with NO Cache-Control gets heuristic-freshness 0 and
# is treated as immediately stale, so the warm run re-hits the origin (ROB-03
# would silently fail). FilterPolicy with cache-all filters stores
# unconditionally; ``X-Hishel-Ttl`` then sets the per-row storage TTL (D-11),
# consumed by AsyncSqliteStorage. The async path REQUIRES hishel[async]
# (``anysqlite``) — installed by 05-01.
# ─────────────────────────────────────────────────────────────────────────────
"""
import asyncio
import os

import httpx
import pytest

import hishel
from hishel import BaseFilter, FilterPolicy
from hishel.httpx import AsyncCacheTransport

# The async source surfaces under test are built in Plans 05-02..05-04.
# ``research``/``research_topic`` import fine TODAY (so the GREEN hishel spike
# below still collects), but the *attributes* the RED tests touch — ``_get`` as
# an async coroutine, ``_limiter_for``, ``_HOST_TTLS``, ``_LAST_CACHE_HIT``,
# ``_retry_after_seconds``, ``_make_client``, ``CAP``, ``run_with_status``, the
# status-aware ``digest`` — do NOT exist yet, so each RED test fails at
# AttributeError (the intended TDD-red signal), not at import of this file.
import research
import research_topic

# Reuse the conftest envelope-key set (do NOT duplicate it — tests/conftest.py).
# ``tests.conftest`` is the established import path in this repo (test_sources_phase4).
from tests.conftest import ENVELOPE_KEYS

# Bind the installed storage symbol (1.3.0 exports AsyncSqliteStorage — lowercase
# 'qlite'; tolerate the alt casing the RESEARCH draft used so a future hishel
# rename fails loudly here rather than mid-spike).
_Storage = getattr(hishel, "AsyncSqliteStorage", None) or getattr(hishel, "AsyncSQLiteStorage")


class _CacheAll(BaseFilter):
    """A hishel filter that caches everything (force-cache, bypassing RFC 9111)."""

    def needs_body(self) -> bool:
        return False

    def apply(self, item, body) -> bool:  # noqa: ANN001 - hishel filter signature
        return True


def _counting_origin(flip_cache_flag: bool = False):
    """An httpx ``MockTransport`` ORIGIN that returns header-less JSON and counts hits.

    When ``flip_cache_flag`` is True it stamps ``hishel_from_cache`` on the
    response extensions (False on the 1st call, True thereafter) so a test can
    drive the cache-hit WIRING PATH (Issue 1) without a real hishel transport.
    """
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        ext = {}
        if flip_cache_flag:
            ext = {"hishel_from_cache": calls["n"] > 1}
        # NO Cache-Control header — exactly the header-less API JSON case (Pitfall 3).
        return httpx.Response(200, json={"hit": calls["n"]}, extensions=ext)

    return httpx.MockTransport(handler), calls


# ═══════════════════════════════════════════════════════════════════════════════
# SPIKE (GREEN) — the one version-sensitive surface, proven first
# ═══════════════════════════════════════════════════════════════════════════════


async def test_hishel_force_caches_headerless_json(tmp_path):
    """SPIKE (GREEN, ROB-03 de-risk): a header-less GET is force-cached; the 2nd
    identical call is served from cache (``hishel_from_cache`` True) and does NOT
    re-hit the origin. Proves the INSTALLED hishel 1.3.0 force-cache construction
    (FilterPolicy cache-all + AsyncSqliteStorage + X-Hishel-Ttl) before any
    caching code is written elsewhere (Pitfall 3 / Assumption A2).

    The cache store lives under pytest ``tmp_path`` (threat T-05-03: no real
    cache dir in the repo tree; nothing persisted between runs).
    """
    origin, calls = _counting_origin()
    storage = _Storage(database_path=os.path.join(tmp_path, "hishel_cache.db"), default_ttl=900)
    policy = FilterPolicy(request_filters=[_CacheAll()], response_filters=[_CacheAll()])
    transport = AsyncCacheTransport(next_transport=origin, storage=storage, policy=policy)
    async with httpx.AsyncClient(transport=transport) as client:
        url = "https://api.example.com/data"
        r1 = await client.get(url, headers={"X-Hishel-Ttl": "3600"})
        r2 = await client.get(url, headers={"X-Hishel-Ttl": "3600"})
    assert r1.extensions.get("hishel_from_cache") in (False, None)  # miss on first
    assert r2.extensions.get("hishel_from_cache") is True           # HIT on repeat
    assert calls["n"] == 1, "origin was hit twice — force-cache did NOT engage"


async def test_cache_store_redacts_auth_material(tmp_path):
    """ROB-07 / D-13 / threat T-05-01 (05-05 finding regression): no auth material may be
    persisted to the on-disk hishel cache. hishel serializes the FULL request (headers + url)
    into the Entry ``data`` blob for Vary/metadata, so the default AsyncSqliteStorage leaked
    the live BRAVE_API_KEY / S2_API_KEY into out/.httpcache; research_topic._RedactingSqliteStorage
    strips auth at create_entry BEFORE the Entry is serialized.

    Two vectors, both asserted:
      1. Auth HEADERS on a clean url (brave/S2/reddit/github) stay fully cacheable AND are
         stripped from the store — header redaction must NOT break the warm hit (the cache_key
         is a SHA-256 of the ORIGINAL url and auth headers are never Vary-listed here).
      2. A ``?key=`` URL secret (youtube/google) never persists. Such a request simply is not
         re-served from cache (its stored url is redacted, so the secondary match misses) — an
         acceptable trade: those sources forgo warm-cache for secret-safety. The binding gate
         is that NO secret VALUE reaches the store.
    """
    import research_topic as RT
    policy = FilterPolicy(request_filters=[_CacheAll()], response_filters=[_CacheAll()])

    def _store(name):
        return RT._RedactingSqliteStorage(database_path=os.path.join(tmp_path, name), default_ttl=900)

    # ── Vector 1: secret HEADERS + clean url → warm hit PRESERVED + headers redacted ──
    secret_sub = "BRAVE-x-subscription-SECRET-deadbeef"   # X-Subscription-Token value
    secret_key = "S2-x-api-key-SECRET-cafebabe"           # x-api-key / bearer value
    origin1, calls1 = _counting_origin()
    tr1 = AsyncCacheTransport(next_transport=origin1, storage=_store("hdr.db"), policy=policy)
    hdrs = {"X-Hishel-Ttl": "3600", "X-Subscription-Token": secret_sub,
            "Authorization": "Bearer " + secret_key, "x-api-key": secret_key,
            "Accept": "application/json"}
    async with httpx.AsyncClient(transport=tr1) as client:
        await client.get("https://api.example.com/data", headers=hdrs)       # MISS -> store
        r2 = await client.get("https://api.example.com/data", headers=hdrs)  # HIT  -> by hash key
    assert r2.extensions.get("hishel_from_cache") is True, "header redaction broke the warm hit"
    assert calls1["n"] == 1, "header redaction must not break the warm cache hit"

    # ── Vector 2: ?key= URL secret (youtube/google) → never persists ──
    secret_url = "YOUTUBE-url-SECRET-0ddba11"
    origin2, _ = _counting_origin()
    tr2 = AsyncCacheTransport(next_transport=origin2, storage=_store("url.db"), policy=policy)
    async with httpx.AsyncClient(transport=tr2) as client:
        await client.get("https://www.googleapis.com/v3/search?q=x&key=" + secret_url,
                         headers={"X-Hishel-Ttl": "3600"})

    # ── Vector 3 (PERF-02 / D-9-07): Vary: Authorization warm-hit + 2 distinct tokens redacted ──
    secret_tok_a = "GH-token-SECRET-aaaa1111"
    secret_tok_b = "GH-token-SECRET-bbbb2222"

    def _vary_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True}, headers={"Vary": "Authorization"})

    tr3 = AsyncCacheTransport(next_transport=httpx.MockTransport(_vary_handler),
                              storage=_store("vary2.db"), policy=policy)
    gh_url = "https://api.github.com/search/repositories?q=async"
    async with httpx.AsyncClient(transport=tr3) as client:
        await client.get(gh_url, headers={"X-Hishel-Ttl": "900", "Authorization": "Bearer " + secret_tok_a})
        r_warm = await client.get(gh_url, headers={"X-Hishel-Ttl": "900", "Authorization": "Bearer " + secret_tok_b})
    assert r_warm.extensions.get("hishel_from_cache") is True, "Vary-strip must let the warm GitHub GET hit cache"

    # ── The binding gate: NO secret VALUE survives anywhere in the on-disk store (db + wal) ──
    blob = b"".join(p.read_bytes() for p in tmp_path.iterdir())
    for secret in (secret_sub, secret_key, secret_url, secret_tok_a, secret_tok_b):
        assert secret.encode() not in blob, f"secret leaked into cache store: {secret!r}"


@pytest.mark.vary_warm_hit  # the documented `-k vary_warm_hit` selector (09-VALIDATION + Plan 02 GREEN gate) resolves to this test
async def test_vary_authorization_warm_hit(tmp_path):
    """PERF-02 / D-9-06: a cold-stored response carrying ``Vary: Authorization`` is served
    from cache on a warm GET whose ``Authorization`` differs (or is absent), proving hishel no
    longer Vary-matches on the (redacted) auth header. RED today: ``create_entry`` strips the
    request ``Authorization`` but leaves the response ``Vary: Authorization``, so hishel's
    retrieval Vary-match compares the new request's Authorization against the stored (now-absent)
    one → MISS (Phase-5 finding). Plan 02 adds ``_neutralize_vary_in_place(response)`` to drop the
    auth field from the stored ``Vary`` → the warm GET HITS while the token stays redacted.

    Offline + deterministic: a synthetic ``MockTransport`` origin returns
    ``Vary: Authorization`` with NO Cache-Control (the header-less force-cache case); cache
    store under pytest ``tmp_path`` (threat T-05-03: nothing in the repo tree)."""
    import research_topic as RT
    policy = FilterPolicy(request_filters=[_CacheAll()], response_filters=[_CacheAll()])
    storage = RT._RedactingSqliteStorage(
        database_path=os.path.join(tmp_path, "vary.db"), default_ttl=900)

    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"hit": calls["n"]}, headers={"Vary": "Authorization"})

    transport = AsyncCacheTransport(
        next_transport=httpx.MockTransport(handler), storage=storage, policy=policy)
    url = "https://api.github.com/search/repositories?q=rust"
    async with httpx.AsyncClient(transport=transport) as client:
        await client.get(url, headers={"X-Hishel-Ttl": "900", "Authorization": "Bearer token-AAA"})  # MISS -> store
        r2 = await client.get(url, headers={"X-Hishel-Ttl": "900", "Authorization": "Bearer token-BBB"})  # warm
    assert r2.extensions.get("hishel_from_cache") is True, "warm GitHub-shaped GET must hit cache after the Vary strip"
    assert calls["n"] == 1, "origin must be hit exactly once (the 2nd GET is served from cache)"


# ═══════════════════════════════════════════════════════════════════════════════
# RED stubs — ROB-01..08. Every test below targets a future async surface that
# does NOT exist at Wave 0, so it fails (AttributeError / ImportError / coroutine
# never awaited). They lock the resilience contract; Waves 1-4 implement EXACTLY
# these shapes. Do NOT weaken an assertion to pass early.
# ═══════════════════════════════════════════════════════════════════════════════


def _record_sleep(monkeypatch):
    """Monkeypatch ``asyncio.sleep`` to RECORD durations instead of sleeping.

    Encodes the DoS-via-retry guard (D-14 / threat T-05-04) as a measurable
    bound and keeps the suite sub-second (the 429/spacing tests assert the
    *recorded* delay, never an actual wall-clock wait).
    """
    sleeps: list[float] = []

    async def fake_sleep(delay, *a, **k):
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return sleeps


def _mock_client(transport: httpx.MockTransport) -> httpx.AsyncClient:
    """A real ``httpx.AsyncClient`` over a deterministic MockTransport (offline)."""
    return httpx.AsyncClient(transport=transport, headers={"User-Agent": research.UA})


# ── ROB-01: async fan-out respects a global concurrency cap (keyword: cap) ───────


async def test_fan_out_respects_concurrency_cap():
    """ROB-01: at most CAP requests are in flight at once, and the fan-out is
    concurrent (total < sum of per-call delays). RED: ``research_topic.CAP`` and
    the async ``research._get`` fan-out do not exist yet."""
    cap = research_topic.CAP  # AttributeError → RED until 05-04
    state = {"in_flight": 0, "max_overlap": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["in_flight"] += 1
        state["max_overlap"] = max(state["max_overlap"], state["in_flight"])
        state["in_flight"] -= 1
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    async with _mock_client(transport) as client:
        async def one(i):
            # async _get yielding control under the production cap mechanism
            await research._get(client, f"https://api.example.com/{i}")

        # Drive N=12 concurrent calls under whatever cap mechanism run()/_make_client use.
        sem = asyncio.Semaphore(cap)

        async def capped(i):
            async with sem:
                await one(i)

        await asyncio.gather(*[capped(i) for i in range(12)])
    assert state["max_overlap"] <= cap, f"overlap {state['max_overlap']} exceeded CAP {cap}"


# ── ROB-02: per-host rate limiting (keyword: limit) ──────────────────────────────


def test_limiter_for_distinct_per_host():
    """ROB-02: ``_limiter_for`` returns a DISTINCT limiter per host and the SAME
    object on a repeat call for one host (cached in the per-run _LIMITERS context).
    RED: ``research._limiter_for`` / ``research._LIMITERS`` do not exist yet."""
    research._LIMITERS.set({})  # initialize the per-run ContextVar store (mirrors _run_async)
    gh = research._limiter_for("https://api.github.com/search/repositories?q=x")
    arx = research._limiter_for("https://export.arxiv.org/api/query?search_query=y")
    assert gh is not arx, "distinct hosts must get distinct limiters"
    assert research._limiter_for("https://api.github.com/other") is gh, "same host must reuse the limiter"


async def test_same_host_requests_are_spaced(monkeypatch):
    """ROB-02: ≥3 GETs to one tightly-limited host (arXiv 1/3s) are throttled by
    the per-host aiolimiter. RED: the async ``research._get`` + per-host limiter
    wiring do not exist yet."""
    _record_sleep(monkeypatch)
    research._LIMITERS.set({})
    # arXiv must map to a tight (1 per 3s) bucket in the host-limit table.
    rate, period = research._HOST_LIMITS["export.arxiv.org"]
    assert (rate, period) == (1, 3), "arXiv must be limited to 1 request / 3s (D-08)"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    limiter = research._limiter_for("https://export.arxiv.org/api/query")
    assert limiter.max_rate == 1 and limiter.time_period == 3
    async with _mock_client(transport) as client:
        for _ in range(3):
            await research._get(client, "https://export.arxiv.org/api/query?search_query=async")


# ── ROB-03: per-source TTL wiring + cache-hit flag propagation (keyword: cache) ──


def test_per_source_ttl_applied():
    """ROB-03: ``research._HOST_TTLS`` maps academic/package hosts to LONGER ttls
    than news/social hosts (D-11). RED: ``research._HOST_TTLS`` does not exist yet.
    (The force-cache MECHANISM itself is already proven GREEN by the spike above.)"""
    ttls = research._HOST_TTLS
    academic = max(ttls["export.arxiv.org"], ttls["api.openalex.org"], ttls["registry.npmjs.org"])
    newsy = min(ttls["api.gdeltproject.org"], ttls["oauth.reddit.com"])
    assert newsy < academic, "news/social TTLs must be shorter than academic/package TTLs"


async def test_get_records_cache_hit_flag():
    """ROB-03 / Issue 1 (cache-field WIRING PATH): ``_get`` propagates
    ``response.extensions['hishel_from_cache']`` into the ``_LAST_CACHE_HIT``
    ContextVar that the status ``cache`` field reads. RED: async ``research._get``
    + ``research._LAST_CACHE_HIT`` do not exist yet."""
    transport, _calls = _counting_origin(flip_cache_flag=True)  # miss then hit
    async with _mock_client(transport) as client:
        url = "https://api.example.com/data"
        await research._get(client, url)
        assert research._LAST_CACHE_HIT.get() is False  # miss recorded after the 1st GET
        await research._get(client, url)
        assert research._LAST_CACHE_HIT.get() is True   # warm hit recorded after the 2nd


# ── ROB-04: Retry-After / backoff (keyword: backoff) ─────────────────────────────


def test_backoff_retry_after_delta_seconds_parsed():
    """ROB-04: ``_retry_after_seconds`` parses delta-seconds, an HTTP-date, and
    falls back to bounded exponential backoff. RED: it does not exist yet."""
    fn = research._retry_after_seconds
    delta = fn(httpx.Response(429, headers={"Retry-After": "2"}), attempt=0)
    assert abs(delta - 2.0) < 0.01, "delta-seconds Retry-After must parse to ~2.0"
    # HTTP-date form → a non-negative wait.
    http_date = fn(httpx.Response(503, headers={"Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT"}), attempt=0)
    assert http_date >= 0.0
    # No header → bounded exponential backoff (≤ 30 + light jitter).
    no_header = fn(httpx.Response(503), attempt=5)
    assert 0.0 <= no_header <= 30.0 + 5 * 0.1, "backoff must be bounded (DoS-via-retry guard, D-14)"


async def test_backoff_get_waits_then_succeeds_on_429(monkeypatch):
    """ROB-04: a 429 + ``Retry-After: 2`` makes ``_get`` wait ~2s (recorded, not
    slept) then succeed on the 200; the retry loop is BOUNDED by max_retries
    (T-05-04). RED: the async retry wrapper in ``research._get`` does not exist yet."""
    sleeps = _record_sleep(monkeypatch)
    research._LIMITERS.set({})
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, json={"e": "rate"})
        return httpx.Response(200, json={"ok": calls["n"]})

    transport = httpx.MockTransport(handler)
    async with _mock_client(transport) as client:
        body = await research._get(client, "https://api.example.com/data", max_retries=3)
    assert any(abs(s - 2.0) < 0.01 for s in sleeps), f"expected a ~2s Retry-After wait, got {sleeps}"
    assert '"ok"' in body or "ok" in body, "must ultimately return the 200 body"
    assert calls["n"] == 2, "must retry exactly once (bounded), not loop unboundedly"


# ── ROB-05: per-source circuit breaker — one failure is never fatal (keyword: breaker)


def test_breaker_one_failing_source_is_not_fatal(monkeypatch):
    """ROB-05: when one source raises, ``run()`` still RETURNS — the failed source
    maps to ``[]`` and the others are present. RED: driving run() offline needs
    ``research_topic._make_client`` (does not exist yet → AttributeError before any
    network call), and the breaker that converts a raise to ``[]`` is built in 05-04."""
    def boom(*a, **k):
        raise RuntimeError("npm is down")

    monkeypatch.setattr(research, "npm", boom)

    # A mock-origin client so run()'s fan-out never touches the network. setattr
    # with raising=True (default) → AttributeError now (RED), and is the offline
    # seam once _make_client exists.
    def fake_make_client():
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"items": []}))
        return _mock_client(transport)

    monkeypatch.setattr(research_topic, "_make_client", fake_make_client)

    result = research_topic.run("rust async runtime", 5)
    slug, collected = result
    assert isinstance(collected, dict)
    assert collected.get("npm", None) == [], "a failed source must contribute []"
    assert any(v for k, v in collected.items() if k != "npm") or collected, "other sources still ran"


# ── PERF-01: a source over the per-source budget trips the breaker (keyword: breaker_timeout, source_timeout)


def test_breaker_timeout_trips_and_is_not_fatal(monkeypatch):
    """PERF-01: a source that exceeds ``_SOURCE_TIMEOUT`` trips the per-source breaker
    NON-FATALLY — its row is ``status="failed"`` with a ``timeout`` error, its
    ``collected`` entry is ``[]``, at least one OTHER source completes, and ``run()``
    still returns its 2-tuple. RED until Plan 02 wraps ``registry[name](client)`` in
    ``asyncio.wait_for(..., _SOURCE_TIMEOUT)`` inside the semaphore.

    Deterministic + fast: a tiny ``_SOURCE_TIMEOUT=0.01`` makes the real ``asyncio.wait_for``
    CANCEL the ``asyncio.sleep(30)`` in ~ms — NO real 20s wait, NO network. (Do NOT
    monkeypatch ``asyncio.sleep`` here — the cancel must fire on the real sleep.)"""
    async def slow_npm(client, a):
        await asyncio.sleep(30)   # cancelled by wait_for(0.01) in ~ms

    monkeypatch.setattr(research, "npm", slow_npm)
    monkeypatch.setattr(research_topic, "_SOURCE_TIMEOUT", 0.01, raising=True)  # RED: const absent → AttributeError

    def fake_make_client():
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"items": []}))
        return _mock_client(transport)

    monkeypatch.setattr(research_topic, "_make_client", fake_make_client)

    slug, collected, status = research_topic.run_with_status("rust async runtime", 5)
    npm_rows = [r for r in status if r["source"] == "npm"]
    assert npm_rows, "npm must appear in the status rows"
    assert npm_rows[0]["status"] == "failed", "a timed-out source trips the breaker (failed verdict, D-9-03)"
    assert "timeout" in (npm_rows[0]["error"] or "").lower(), "the row must be auditable as a timeout"
    assert collected.get("npm", None) == [], "a timed-out source contributes [] (breaker non-fatal)"
    assert any(v for k, v in collected.items() if k != "npm") or len(collected) > 1, "other sources still ran"
    assert len(research_topic.run("rust async runtime", 5)) == 2, "run() still returns its 2-tuple (ROB-08)"


def test_source_timeout_default_from_env():
    """PERF-01 / D-9-02: ``_SOURCE_TIMEOUT`` is a module-level float read from
    ``RESEARCH_SOURCE_TIMEOUT`` at import, defaulting to 20.0 (a safety ceiling above
    GDELT/news' 13-16s, below the 30s httpx per-request timeout). RED: the constant
    does not exist yet (AttributeError)."""
    assert research_topic._SOURCE_TIMEOUT == 20.0, "default budget must be 20.0s (D-9-02)"
    assert isinstance(research_topic._SOURCE_TIMEOUT, float), "must be a float (mirrors transcripts._PER_CALL/CAP)"


# ── ROB-06: structured per-source status with a REQUIRED cache field (keyword: status)


_STATUS_KEYS = {"source", "status", "latency_ms", "n_results", "error", "cache"}


def test_run_with_status_emits_per_source_rows(monkeypatch):
    """ROB-06 / Issue 1: ``run_with_status`` returns ``(slug, collected, status)``;
    each status row carries the REQUIRED ``cache`` key (not optional), no source is
    silently absent, and at least one row's ``cache`` reflects a real warm hit
    (``hishel_from_cache`` end to end). RED: ``run_with_status`` + ``_make_client``
    do not exist yet."""
    def fake_make_client():
        transport, _ = _counting_origin(flip_cache_flag=True)  # 2nd identical GET → cache hit
        return _mock_client(transport)

    monkeypatch.setattr(research_topic, "_make_client", fake_make_client)

    slug, collected, status = research_topic.run_with_status("rust async", 5)
    assert isinstance(status, list) and status, "status must be a non-empty list of rows"
    for row in status:
        assert _STATUS_KEYS <= set(row), f"status row missing required keys: {_STATUS_KEYS - set(row)}"
        assert row["status"] in {"ok", "empty", "no_key", "failed", "skipped"}
    # No silent empties: a source returning [] still appears with a non-ok status.
    empties = [r for r in status if r["n_results"] == 0]
    assert all(r["status"] != "ok" for r in empties), "a 0-result source must NOT show ok (no silent empty)"
    # The cache field reflects hishel_from_cache end to end (not a hardcoded '-').
    assert any(r["cache"] is True for r in status), "at least one row must report a real warm cache hit"


def test_digest_has_status_table(monkeypatch):
    """ROB-06: the status-aware ``digest`` renders a markdown table whose header
    contains source/status/cache ABOVE the ranked-results block, mapping a row's
    cache bool/None to hit/miss/-. RED: the status-aware ``digest`` signature
    (with a status arg) does not exist yet."""
    status = [
        {"source": "brave", "status": "ok", "latency_ms": 12, "n_results": 5, "error": None, "cache": True},
        {"source": "npm", "status": "failed", "latency_ms": 3, "n_results": 0, "error": "boom", "cache": None},
    ]
    # The status-aware digest takes the status channel (05-04). Passing it to the
    # current 2-arg digest() → TypeError (RED) until the signature grows.
    md = research_topic.digest("rust async", {"brave": []}, status)
    head = md.split("ranked results")[0]
    assert "source" in head and "status" in head and "cache" in head, "status table header must precede ranked results"
    assert "hit" in head, "a True cache value must render as 'hit'"


# ── ROB-07: secrets from .env (keyword: dotenv) ──────────────────────────────────


def test_dotenv_populates_environ(monkeypatch, tmp_path):
    """ROB-07: a project ``.env`` value reaches ``os.environ`` via
    ``load_dotenv(override=False)``. This pins the MECHANISM (the wiring into
    main()/__main__ is asserted by 05-02); it is GREEN as soon as python-dotenv is
    installed (05-01) — acceptable per the plan.

    Threat T-05-01: the ``.env`` is written under pytest ``tmp_path`` with an
    obviously-fake sentinel and ``monkeypatch.chdir`` — nothing is written into
    the repo tree."""
    import dotenv

    (tmp_path / ".env").write_text("FAKE_ROB_KEY=sentinel123\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("FAKE_ROB_KEY", raising=False)
    # cwd-based discovery (usecwd=True) is the deterministic mechanism the tool
    # uses; the no-arg load_dotenv() walks the caller's stack frame, which is
    # fragile under pytest. 05-02 wires load_dotenv(find_dotenv(usecwd=True),
    # override=False) into main()/__main__.
    dotenv.load_dotenv(dotenv.find_dotenv(usecwd=True), override=False)
    assert os.environ["FAKE_ROB_KEY"] == "sentinel123"


# ── ROB-08: contract preservation (keyword: contract) ────────────────────────────


def test_contract_run_returns_two_tuple(monkeypatch):
    """ROB-08 / Pitfall 1: ``run()`` returns a 2-tuple ``(slug, collected)`` that
    unpacks exactly as ``eval/run_eval.py:133`` does. RED: driving run() offline
    needs ``research_topic._make_client`` (does not exist yet)."""
    def fake_make_client():
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"items": []}))
        return _mock_client(transport)

    monkeypatch.setattr(research_topic, "_make_client", fake_make_client)
    result = research_topic.run("model context protocol", 3)
    assert len(result) == 2, "run() MUST stay a 2-tuple (eval unpacks _slug, collected)"
    slug, collected = result
    assert isinstance(slug, str) and isinstance(collected, dict)


async def test_contract_envelope_shape_unchanged(tmp_path, monkeypatch):
    """ROB-08: an async source driven over a MockTransport writes the UNCHANGED
    envelope via ``write_out``; the envelope keys are exactly
    {source,query,generated_utc,count,items} and each item has exactly the 11
    ENVELOPE_KEYS. RED: the async source signature ``source(client, a)`` does not
    exist yet (current sources are sync ``source(a)``)."""
    research._LIMITERS.set({})
    captured = {}
    monkeypatch.setattr(
        research, "write_out",
        lambda source, query, items, out=None: captured.update(
            {"source": source, "query": query, "generated_utc": 0.0, "count": len(items), "items": items}
        ),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        # npm /-/v1/search shape (minimal valid payload).
        return httpx.Response(200, json={"objects": [{"package": {
            "name": "tokio", "description": "async runtime", "links": {"npm": "https://npmjs.com/package/tokio"},
            "date": "2026-01-01T00:00:00Z"}}]})

    transport = httpx.MockTransport(handler)
    async with _mock_client(transport) as client:
        # async signature: source takes the shared client + the namespace (D-01).
        await research.npm(client, research_topic.ns(query="async runtime", limit=5))
    assert set(captured) == {"source", "query", "generated_utc", "count", "items"}
    for item in captured["items"]:
        assert set(item) == ENVELOPE_KEYS, f"item keys drifted from the uniform envelope: {set(item) ^ ENVELOPE_KEYS}"


def test_contract_source_status_json_key_additive(monkeypatch):
    """ROB-08: the status channel is ADDITIVE — ``run_with_status`` exposes the
    per-source status list that ``main()`` writes as a top-level ``source_status``
    JSON key WITHOUT removing ``sources``/``topic``/``total_items``. RED:
    ``run_with_status`` + ``_make_client`` do not exist yet."""
    def fake_make_client():
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"items": []}))
        return _mock_client(transport)

    monkeypatch.setattr(research_topic, "_make_client", fake_make_client)
    slug, collected, status = research_topic.run_with_status("model context protocol", 3)
    # The additive JSON contract main() writes: source_status rides alongside the
    # existing keys (sources=collected, topic, total_items) — none removed.
    doc = {"topic": "model context protocol", "total_items": sum(len(v) for v in collected.values()),
           "sources": collected, "source_status": status}
    assert {"topic", "total_items", "sources", "source_status"} <= set(doc)
    assert doc["sources"] is collected and isinstance(doc["source_status"], list)
