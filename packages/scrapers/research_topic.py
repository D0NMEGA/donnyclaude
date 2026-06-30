#!/usr/bin/env python3
"""One-shot multi-source research on a TOPIC.

Runs every open-API source in research.py for a topic, merges them into one
JSON, and emits a ranked markdown digest. For login/blocked sources (reddit, x)
it prints the browser-harness commands to run separately.

    python3 research_topic.py "llm agents" --limit 12

Outputs:
    out/topic_<slug>.json   (merged structured data)
    out/topic_<slug>.md     (human/agent-readable digest)
"""
import argparse, asyncio, json, os, re, sys, time, types, urllib.parse


# ── Environment self-bootstrap (run it from anywhere, any interpreter) ─────────────
# This tool depends on the project's uv-managed stack (httpx/hishel/bm25s/model2vec/…),
# so it MUST run inside the uv environment. It is frequently invoked as a bare
# ``python3 ~/.claude/scrapers/research_topic.py`` from another project's CWD, whose
# interpreter lacks those deps — the classic ``ModuleNotFoundError: No module named
# 'hishel'``. To make the documented command work regardless of how it is launched,
# transparently re-exec under ``uv run --project <this dir>`` (which resolves + syncs the
# env) when a core dep is missing. No-op when the deps are already importable (already
# under uv), so the library-import paths (eval/_collect, tests, record_regression) and
# normal ``uv run`` invocations are completely unaffected.
def _ensure_uv_env() -> None:
    import importlib.util

    if importlib.util.find_spec("hishel") is not None:
        return  # deps present → already inside the uv env; do nothing
    # Only re-exec when launched AS A SCRIPT (not imported as a library by a bare interp).
    if os.path.abspath(sys.argv[0] or "") != os.path.abspath(__file__):
        return
    if os.environ.get("_SCRAPERS_UV_BOOTSTRAPPED") == "1":
        return  # already re-exec'd once — let the real ImportError below surface
    import shutil

    here = os.path.dirname(os.path.abspath(__file__))
    uv = shutil.which("uv")
    if uv is None:
        sys.stderr.write(
            "[scrapers] dependencies missing and 'uv' is not on PATH.\n"
            f"           Run it inside the project env:  cd {here} && "
            f"uv run python {os.path.basename(__file__)} ...\n"
        )
        return  # fall through to the import below, which names the missing module
    os.execve(  # replace this process with the uv-managed one (deps resolved + synced)
        uv,
        [uv, "run", "--project", here, "python", os.path.abspath(__file__), *sys.argv[1:]],
        {**os.environ, "_SCRAPERS_UV_BOOTSTRAPPED": "1"},
    )


_ensure_uv_env()

import httpx  # noqa: E402  (the self-bootstrap above must run before any uv-managed import)
from hishel import AsyncSqliteStorage, BaseFilter, FilterPolicy, SpecificationPolicy  # noqa: E402
from hishel.httpx import AsyncCacheTransport  # noqa: E402
import query_norm  # noqa: E402  (stdlib-only re; on the import-light path, not a heavy import)
import research as R  # noqa: E402
import routing  # noqa: E402
from routing import ALWAYS_ON  # noqa: E402
from rank import rank_items  # noqa: E402

# Global in-flight concurrency cap (ROB-01 / D-03), env-overridable. 05-04's async
# fan-out gates the routed sources at this many concurrent requests; per-host limits
# (research._HOST_LIMITS) are a SEPARATE mechanism (D-07 vs D-03).
CAP = int(os.environ.get("RESEARCH_MAX_CONCURRENCY", "8"))

# Per-source wall-clock budget (PERF-01 / D-9-01,02). A SAFETY CEILING: above GDELT/news'
# normal 13-16s (so a slow-but-working source still returns and live `collected` stays
# stable), below the 30s per-request httpx timeout in _make_client. Env-overridable —
# never hard-code as permanent (PROJECT volatility constraint). Read once at import,
# mirroring CAP / transcripts._PER_CALL. A timeout is NON-FATAL: it trips the existing
# per-source breaker in _run_async._one (catch asyncio.TimeoutError -> status=failed +
# "timeout after Ns"), reusing the ROB-05 verdict so the status enum stays stable (D-9-03).
_SOURCE_TIMEOUT = float(os.environ.get("RESEARCH_SOURCE_TIMEOUT", "20.0"))

# Canonical registry of ALL source names this tool can query (D-42). Single
# source of truth (D-31): the eval imports this. Phase 4: grown from the 8 Phase-2
# survivors to the full 12 (added brave/reddit/youtube/news). The per-run FIRING
# set is DERIVED by routing.route(topic) (ALWAYS_ON ∪ tier-eligible) — it is a
# SUBSET of this registry, NOT equal to it (the old equality assertion is replaced
# by the two D-43 invariants in run(): fired ⊆ SOURCES and ALWAYS_ON ⊆ fired).
# Phase 2 (ENDP-08, D-01/D-02/D-03) had pruned to the 8 always-on survivors;
# github_trending stays deleted from research.py (D-02), lobsters/devto/medium
# kept-but-deprecated there for Phase-4 site: reuse (D-03).
SOURCES = (
    "brave", "reddit", "hackernews", "github", "arxiv", "openalex",
    "semanticscholar", "huggingface", "npm", "stackoverflow", "youtube",
    "bluesky", "discourse", "rss", "europepmc", "entity", "ddg",
)   # Phase 19 (REL-01): `news` retired from the always-on path (kept as a CLI subcommand)

OUT_DIR = os.path.expanduser("~/.claude/scrapers/out")

# On-disk hishel cache under out/ → already gitignored (D-12); survives between the cold
# and warm run so 05-05's warm-cache timing proof works. Never committed.
_CACHE_DIR = os.path.join(OUT_DIR, ".httpcache")


class _CacheAll(BaseFilter):
    """A hishel filter that caches EVERYTHING — force-cache, bypassing RFC 9111.

    Required because the source APIs send header-less JSON (no Cache-Control): under
    hishel 1.3.0's default SpecificationPolicy such a 200 gets heuristic-freshness 0 and
    is immediately stale → the warm run re-hits the origin and ROB-03 silently fails. The
    cache-all FilterPolicy stores unconditionally; the per-request X-Hishel-Ttl header
    (research._ttl_for, set in research._get) then sets each row's storage TTL (D-11).
    Proven live against the installed wheel by the 05-01 force-cache spike.
    """

    def needs_body(self) -> bool:
        return False

    def apply(self, item, body) -> bool:  # noqa: ANN001 - hishel filter signature
        return True


# Auth material that must NEVER be persisted to the on-disk cache (D-13 / threat T-05-01).
# hishel keys NOT on auth, but it DOES serialize the full request (headers + url) into the
# Entry `data` blob for Vary/metadata — so without redaction a real BRAVE/S2/Reddit/GitHub
# credential lands in out/.httpcache. These headers are never Vary-listed by our APIs and
# the cache_key is a SHA-256 of the ORIGINAL url, so stripping them from the STORED request
# neither breaks retrieval nor leaks via the key.
_SENSITIVE_HEADERS = frozenset({
    "authorization", "proxy-authorization", "cookie",
    "x-api-key", "x-subscription-token",
})
# Sources that carry their key in a query param (youtube `&key=`, line ~420) leak via the
# stored request.url; mask those param VALUES too.
_SECRET_QUERY_PARAMS = frozenset({"key", "api_key", "apikey", "access_token", "token"})


def _redact_request_in_place(request) -> None:  # noqa: ANN001 - hishel Request (non-frozen dataclass)
    """Strip auth headers + secret query-param values from a hishel Request before it is
    persisted, so no credential ever reaches out/.httpcache (D-13 / threat T-05-01)."""
    for name in list(request.headers.keys()):
        if name.lower() in _SENSITIVE_HEADERS:
            request.headers.pop(name, None)
    url = request.url
    head, sep, query = url.partition("?")
    if sep and query:
        pairs = urllib.parse.parse_qsl(query, keep_blank_values=True)
        if any(k.lower() in _SECRET_QUERY_PARAMS for k, _ in pairs):
            request.url = head + "?" + urllib.parse.urlencode(
                [(k, "REDACTED" if k.lower() in _SECRET_QUERY_PARAMS else v) for k, v in pairs])


def _neutralize_vary_in_place(response) -> None:  # noqa: ANN001 - hishel Response (non-frozen dataclass)
    """Drop auth field-names from the STORED response's ``Vary`` (or drop ``Vary`` entirely
    when it lists only auth) so hishel's retrieval Vary-match (hishel._core._spec.vary_headers_match)
    no longer compares the redacted ``Authorization`` header -> a warm GitHub GET HITS cache while
    the token stays stripped from storage (PERF-02 / D-9-06). Only what is STORED changes; the
    request bytes sent to origin are untouched (D-26/D-9-08). The GitHub case is semantically safe:
    our single-owner cache's search results don't depend on WHICH valid token is used (D-9-06).

    Pitfall 1 (verified, hishel 1.3.0): ``Headers.__setitem__`` APPENDS — a plain
    ``response.headers["vary"] = ...`` would leave the old auth value in place and silently defeat
    the fix. We MUST ``del`` the key first, then optionally re-set a benign remainder."""
    headers = response.headers                       # hishel Headers (MutableMapping[str,str])
    vary = headers.get("vary")                       # case-insensitive; key stored lowercased
    if not vary:
        return                                       # no Vary -> already matches; leave other sources untouched
    keep = [t.strip() for t in vary.split(",")
            if t.strip() and t.strip().lower() not in _SENSITIVE_HEADERS]
    del headers["vary"]                              # MUST delete first — __setitem__ APPENDS (Pitfall 1)
    if keep:
        headers["vary"] = ", ".join(keep)            # safe: key was just deleted


class _RedactingSqliteStorage(AsyncSqliteStorage):
    """AsyncSqliteStorage that redacts auth material from the request before hishel writes
    the Entry (D-13 / T-05-01). hishel computes the cache_key (SHA-256 of the original url)
    BEFORE create_entry, so redacting the stored request neither leaks via the key nor breaks
    retrieval; the request body was already sent to origin, so post-fetch redaction is safe.

    PERF-02 (D-9-06): also neutralizes ``Vary: Authorization`` on the stored RESPONSE at the
    same boundary so a warm GitHub GET hits cache while the token stays redacted (the response
    edit touches only the Vary header NAME-list, never a credential value)."""

    async def create_entry(self, request, response, key, id_=None):  # noqa: ANN001 - hishel storage signature
        _redact_request_in_place(request)            # existing (D-13): strip auth from the stored REQUEST
        _neutralize_vary_in_place(response)          # PERF-02 (D-9-06): drop auth from the stored RESPONSE Vary
        return await super().create_entry(request, response, key, id_)


def _make_client() -> httpx.AsyncClient:
    """The shared per-run httpx.AsyncClient wrapping a hishel cache transport (D-02/D-10).

    Force-caches header-less API JSON via a cache-all FilterPolicy + per-source TTLs (the
    X-Hishel-Ttl header set in research._get), backed by an on-disk SQLite store under the
    gitignored out/.httpcache/. The store is a _RedactingSqliteStorage: hishel serializes the
    full request (headers + url) into the Entry, so auth material (Authorization / x-api-key /
    X-Subscription-Token / youtube ?key=) is stripped at create_entry BEFORE persistence —
    nothing secret reaches the cache dir (D-13 / threat T-05-01). 05-05's byte-exact secret
    scan over the cache dir is the gate. The global CAP bounds the connection pool (ROB-01)."""
    os.makedirs(_CACHE_DIR, exist_ok=True)
    storage = _RedactingSqliteStorage(database_path=os.path.join(_CACHE_DIR, "hishel_cache.db"),
                                      default_ttl=900)       # safe default TTL (D-11)
    policy = FilterPolicy(request_filters=[_CacheAll()], response_filters=[_CacheAll()])
    transport = AsyncCacheTransport(next_transport=httpx.AsyncHTTPTransport(),
                                    storage=storage, policy=policy)
    return httpx.AsyncClient(transport=transport,
                             headers={"User-Agent": R.UA},
                             timeout=httpx.Timeout(30.0, connect=10.0),
                             limits=httpx.Limits(max_connections=CAP))


def _make_rss_client() -> httpx.AsyncClient:
    """RSS feed client: a SECOND hishel transport in RFC-9111 mode (SpecificationPolicy)
    so feed hosts revalidate via ETag/Last-Modified/304 instead of the _CacheAll force-cache
    (D-13-01, RSS-03). Shares the same _RedactingSqliteStorage as _make_client (the secret-at-
    rest boundary still holds — feeds carry no auth, so there is nothing to strip). Verified
    against the installed hishel 1.3.0 wheel: FilterPolicy has NO revalidation code path
    (it pass-throughs on a filter miss → zero caching), only SpecificationPolicy does the
    conditional-GET state machine — so a host-aware _CacheAll predicate would give feeds NO
    caching, not 304. A dedicated client is the smallest blast radius: the 14 API sources'
    force-cache client (_make_client) is untouched. The RSS GET path also omits X-Hishel-Ttl
    (research._get_rss → force_cache_ttl=False), which is inert under SpecificationPolicy but
    mandated by D-13-01."""
    os.makedirs(_CACHE_DIR, exist_ok=True)
    storage = _RedactingSqliteStorage(database_path=os.path.join(_CACHE_DIR, "hishel_cache.db"),
                                      default_ttl=900)
    transport = AsyncCacheTransport(next_transport=httpx.AsyncHTTPTransport(),
                                    storage=storage, policy=SpecificationPolicy())
    # follow_redirects=True (Rule 2 — RSS-01 correctness): several allowlist feeds
    # 301-redirect (Substack /feed→/feed/, OpenAI /blog/rss.xml→/news/rss.xml, and
    # UKPLab/sentence-transformers→huggingface/sentence-transformers — observed live
    # 2026-06-23). httpx defaults to NOT following, which raises on the 3xx and silently
    # drops those feeds. The 14 API sources use absolute non-redirecting URLs, so this is
    # scoped to the RSS client only (the force-cache _make_client is unchanged).
    return httpx.AsyncClient(transport=transport,
                             headers={"User-Agent": R.UA},
                             timeout=httpx.Timeout(30.0, connect=10.0),
                             follow_redirects=True,
                             limits=httpx.Limits(max_connections=CAP))


def ns(**kw):
    d = dict(limit=15, days=120, query="", tag="", category="", comments=0, answers=0, out=None)
    d.update(kw)
    return types.SimpleNamespace(**d)


# Sources that REQUIRE a key: absent key → [] + a `no_key` status (not a silent
# empty, D-21). All other sources work keyless (or via the gh CLI fallback), so a
# 0-result run for them is `empty`, not `no_key`.
_KEYED = {"brave", "reddit", "youtube"}


def _has_key(name):
    """True if the keyed source `name` has its credential(s) in the environment.

    Read-only env probe for the status `no_key` classification (D-21) — mirrors each
    source's own os.environ.get(...) gate (research.brave/reddit/youtube). Never logs
    or returns the secret value, only its presence."""
    if name == "brave":
        return bool(os.environ.get("BRAVE_API_KEY") or os.environ.get("BRAVE_SEARCH_API_KEY"))
    if name == "reddit":
        return bool(os.environ.get("REDDIT_CLIENT_ID") and os.environ.get("REDDIT_CLIENT_SECRET"))
    if name == "youtube":
        return bool(os.environ.get("YOUTUBE_API_KEY") or os.environ.get("YT_API_KEY"))
    return True


def _status_for(name, items):
    """Map a source's result to a status verdict (D-19/D-21): `ok` when it returned
    items; `no_key` when a keyed source returned nothing and its key is absent (visible,
    not silent); `empty` otherwise. The `failed` verdict is assigned by the breaker."""
    if items:
        return "ok"
    if name in _KEYED and not _has_key(name):
        return "no_key"
    return "empty"


# Auth-material patterns scrubbed from an error repr before it reaches the status row,
# the digest, or the JSON (D-19 / threat T-05-01). A source-exception repr normally
# carries no secret, but a URL with an embedded credential could in principle appear —
# strip it defensively, then the caller truncates.
_SECRET_RE = re.compile(
    r"(?i)(bearer|basic|token|x-api-key|x-subscription-token)\s*[:=]?\s*\S+")


def _scrub(s):
    return _SECRET_RE.sub(r"\1 [redacted]", s)


# --- Conditional-fire sources (SRC-10 entity gate) — the NEW pattern ----------
# Until Phase 18 every source fired unconditionally by tier. The `entity` source
# (SRC-10) fires ONLY for a detected person/org query; otherwise its thunk takes the
# no-network empty path. The thunk early-returns [] (writing an empty `entity`
# envelope via the patched R.write_out) so routing/fixtures stay uniform and the
# route-blind fixture replay sees a [] entity on every non-entity (incl. frozen) topic
# → byte-identical (18-RESEARCH §6 #8).


async def _empty_source(name: str):
    """Write an empty envelope for `name` with NO network (conditional-fire empty path).

    Calls R.write_out, which _run_async monkeypatches to ``collected[name] = items`` for
    the fan-out — so this records ``collected[name] = []`` with zero network, exactly like
    a source that returned nothing. SRC-10 self-limit gate."""
    R.write_out(name, {}, [], None)


def _entity_thunk(topic, limit):
    """Build the CONDITIONAL `entity` registry thunk (SRC-10).

    Returns a ``thunk(client)`` coroutine factory: it fires ``R.entity`` with the FULL
    ``topic`` (the resolver shapes internally) ONLY when ``query_norm.detect_entity_query``
    is true, else it takes the ``_empty_source`` no-network empty path. detect_entity_query
    is import-light (re only) so the gate adds no heavy import to the runner."""
    return (lambda c: R.entity(c, ns(query=topic, limit=limit))
            if query_norm.detect_entity_query(topic)
            else _empty_source("entity"))


async def _run_async(topic, limit, *, route_override=None):
    """Async fan-out core (D-04/ROB-01..06). Sets a FRESH per-run limiter ContextVar
    store (R._LIMITERS.set({}) — no cross-run/cross-test AsyncLimiter token-bucket state,
    Issue 2), fans the routed sources out CONCURRENTLY under a global Semaphore(CAP) over
    ONE shared hishel client (_make_client, D-02), wraps each source in a never-fatal
    circuit breaker (ROB-05/D-17), and collects a structured per-source status row —
    including the REAL hishel hit/miss from R._LAST_CACHE_HIT (Issue 1/D-12) — for every
    fired source. Returns (slug, collected, status); the sync run() drops status to keep
    its 2-tuple (ROB-08/Pitfall 1). Routing/registry semantics are frozen (Phase 4)."""
    R._LIMITERS.set({})                            # fresh per-run token-buckets (Issue 2)
    slug = topic.lower().replace(" ", "-")[:40]
    collected, status = {}, []
    orig = R.write_out
    # Phase 17 query shaping (QU-02/QU-03), computed ONCE before the registry:
    #  * expanded = topic + appended spelled-out acronym forms (augment, not replace);
    #    feeds the CLASSIFIER + web/academic query so "LIFU" routes academic (QU-03).
    #  * kq = the <=6 salient keyphrases of the expanded query, joined; the SHAPED query
    #    for the six raw-query keyword sources so a long NL query stops collapsing them to
    #    [] (QU-02, highest leverage). Falls back to the full topic when keyphrases is
    #    empty (all-stopword query) so a keyword source never gets an empty q=.
    expanded = query_norm.expand_acronyms(topic)
    kq = " ".join(query_norm.keyphrases(expanded)) or topic
    registry = {                                   # name -> thunk(client); the full 15-source REGISTRY (D-42)
        # Web/free-text sources keep the FULL topic — Brave's index wants the natural
        # phrasing (it rescued every dogfood topic; RESEARCH §3); reddit/youtube/news/rss too.
        "brave":           lambda c: R.brave(c, ns(query=topic, limit=limit)),
        "reddit":          lambda c: R.reddit(c, ns(query=topic, limit=limit)),
        # Keyword sources get the keyphrase-SHAPED query `kq` (QU-02).
        "hackernews":      lambda c: R.hn(c, ns(query=kq, days=365, limit=limit, comments=2)),
        "github":          lambda c: R.github(c, ns(query=f"{kq} stars:>50", limit=limit)),  # shape THEN append stars:>50
        # Academic self-normalizers keep the FULL topic — arxiv/openalex/s2 call
        # salient_tokens(a.query) internally; double-normalizing would starve their
        # fielded builders (RESEARCH §3 pitfall 5).
        "arxiv":           lambda c: R.arxiv(c, ns(query=topic, limit=limit)),
        "openalex":        lambda c: R.openalex(c, ns(query=topic, limit=limit)),
        "semanticscholar": lambda c: R.semanticscholar(c, ns(query=topic, limit=limit)),
        # Europe PMC self-normalizes (salient_tokens internally) → FULL topic, NOT kq
        # (18-RESEARCH §6 #5 / §8: don't double-shape academic queries). Keyless → on a
        # 0-result run it is `empty`, never `no_key` (NOT added to _KEYED).
        "europepmc":       lambda c: R.europepmc(c, ns(query=topic, limit=limit)),
        # Entity resolution (SRC-10) is CONDITIONAL-FIRE: _entity_thunk fires R.entity ONLY
        # when query_norm.detect_entity_query(topic) is true, else takes the no-network empty
        # path (_empty_source). FULL topic (the resolver shapes internally). Keyless → on a
        # 0-result run it is `empty`, never `no_key` (NOT added to _KEYED).
        "entity":          _entity_thunk(topic, limit),
        # Keyless web fallback (SRC-09) is CONDITIONAL-FIRE on Brave-absence (the same
        # no-network empty-path pattern as entity, 18-RESEARCH §5 #2): fire R.ddg with the
        # FULL topic ONLY when Brave has no key (not _has_key("brave")) — so DDG carries the
        # web tier exactly when Brave can't — else take the _empty_source no-network path.
        # Keyless → on a 0-result run it is `empty`, never `no_key` (NOT added to _KEYED).
        "ddg":             (lambda c: R.ddg(c, ns(query=topic, limit=limit))
                            if not _has_key("brave") else _empty_source("ddg")),
        "huggingface":     lambda c: R.huggingface(c, ns(query=topic, limit=limit)),
        "npm":             lambda c: R.npm(c, ns(query=kq, limit=limit)),                     # shorter query also cuts the F-13 400-rate
        # SO prefers --query over tag= (research.py); pass the SHAPED kq via query= so SO
        # gets keyphrases, not a dash-mangled full topic.
        "stackoverflow":   lambda c: R.stackoverflow(c, ns(query=kq, limit=limit, answers=1)),
        "youtube":         lambda c: R.youtube(c, ns(query=topic, limit=limit)),
        "bluesky":         lambda c: R.bluesky(c, ns(query=kq, limit=min(100, max(limit, 50)))),
        "discourse":       lambda c: R.discourse(c, ns(query=kq, limit=min(150, max(limit, 50)))),  # D-11-05 larger pool over 3 instances
        # RSS fires through the SPEC-POLICY client (_rss_client, opened in the async-with
        # below), NOT the passed force-cache client `c` — feed hosts must revalidate via
        # 304, not be force-cached (D-13-01 / RSS-03). The lambda closes over _rss_client
        # by reference (late-bound): it is read at call time inside _one, after the
        # async-with has bound it. Larger pool over 12 feeds mirrors Discourse (D-11-05).
        # RSS keeps the full topic (free-text/web-shaped freshness tier).
        "rss":             lambda c: R.rss(_rss_client, ns(query=topic, limit=min(150, max(limit, 50)))),
    }
    # Feed routing the EXPANDED topic so acronyms route correctly (QU-01/QU-03). On the
    # 10 frozen topics (no acronyms/scientific vocab) classify(expanded)==classify(topic)
    # and route(expanded)==route(topic) → byte-identical fired set (Task-4 fixture proof).
    active = routing.classify(expanded)
    # QU-05: an optional keyword-only route_override (a {tier/sources/all_sources} dict from
    # the CLI) forces the firing set via resolve_route; absent → the frozen classifier path.
    # run()'s 2-tuple is unaffected (it never passes route_override).
    if route_override is not None:
        fired = routing.resolve_route(expanded, **route_override)
        src = "forced via override"
    else:
        fired = routing.route(expanded)            # ALWAYS_ON ∪ tier-eligible (D-42)
        src = "classifier"
    print(f"[route] topic={topic!r} tiers={sorted(active)} sources={fired} keyphrases={kq!r} ({src})")   # D-39 auditable
    assert set(fired) <= set(SOURCES), "fired source not in registry"          # D-43 invariant 1
    # D-43 invariant 2 (ALWAYS_ON ⊆ fired) holds for the default + --tier paths, but an
    # explicit --sources is a DELIBERATE verbatim override (ALWAYS_ON is NOT force-added,
    # RESEARCH §7) — so gate the assert on the override shape.
    if route_override is None or not route_override.get("sources"):
        assert ALWAYS_ON <= set(fired), "always-on source missing from fired set"  # D-43 invariant 2
    # Monkey-patch R.write_out to collect in-memory ONLY now — after route resolution
    # (resolve_route can raise ValueError on a bad --sources name, T-17-03) and the D-43
    # asserts, which must NOT leave R.write_out patched if they raise. The try/finally below
    # is the restore guard (T-05-02); the registry lambdas capture `collected` by closure and
    # don't run until _one() inside that try, so patching here is sufficient. (A raise in the
    # resolve_route/assert window previously leaked the patched R.write_out globally.)
    R.write_out = lambda source, query, items, out=None: collected.__setitem__(source, items)
    try:
        # Open BOTH clients for the run: the force-cache client for the 14 API sources and
        # the spec-policy client for RSS (D-13-01). The `rss` thunk closes over _rss_client
        # (late-bound — read at call time inside _one, after this with-statement binds it).
        async with _make_client() as client, _make_rss_client() as _rss_client:
            sem = asyncio.Semaphore(CAP)           # global in-flight cap (ROB-01/D-03)

            async def _one(name):
                t0 = time.time()
                # Reset the cache flag for THIS source's task: asyncio.gather wraps each
                # _one in a Task that COPIES the current context, so the set/get below are
                # isolated per source and never race across the fan-out. A source that
                # issues no GET then reports cache False (not a stale prior value).
                R._LAST_CACHE_HIT.set(False)
                try:
                    async with sem:                                   # queue-wait NOT counted (D-9-01)
                        await asyncio.wait_for(registry[name](client), _SOURCE_TIMEOUT)
                    items = collected.get(name, [])
                    status.append({"source": name, "status": _status_for(name, items),
                                   "latency_ms": int((time.time() - t0) * 1000),
                                   "n_results": len(items), "error": None,
                                   "cache": R._LAST_CACHE_HIT.get()})   # real hit/miss (Issue 1)
                except asyncio.TimeoutError:                          # PERF-01 budget hit — SPECIFIC catch FIRST (D-9-03)
                    collected[name] = []
                    status.append({"source": name, "status": "failed",
                                   "latency_ms": int((time.time() - t0) * 1000),
                                   "n_results": 0, "error": f"timeout after {_SOURCE_TIMEOUT}s",
                                   "cache": None})
                    print(f"  ! {name:16} TIMEOUT after {_SOURCE_TIMEOUT}s", file=sys.stderr)
                except Exception as e:             # ROB-05 breaker — never fatal (D-17)
                    collected[name] = []
                    status.append({"source": name, "status": "failed",
                                   "latency_ms": int((time.time() - t0) * 1000),
                                   "n_results": 0, "error": _scrub(repr(e))[:120],
                                   "cache": None})
                    print(f"  ! {name:16} FAILED: {_scrub(repr(e))[:70]}", file=sys.stderr)

            await asyncio.gather(*[_one(n) for n in fired])
    finally:
        R.write_out = orig                         # restore even if the body raised (T-05-02)
    return slug, collected, status


def run(topic, limit):                             # SIGNATURE + 2-tuple UNCHANGED (D-04/ROB-08/Pitfall 1)
    slug, collected, _status = asyncio.run(_run_async(topic, limit))
    return slug, collected


def run_with_status(topic, limit, *, route_override=None):   # ADDITIVE status channel (D-19/ROB-08)
    # route_override is keyword-only with a default → eval/_collect and the existing tests
    # (which call run_with_status(topic, limit)) are unaffected; only main() passes it (QU-05).
    return asyncio.run(_run_async(topic, limit, route_override=route_override))   # (slug, collected, status)


def digest(topic, collected, status=None, scope=None):
    lines = [f"# Research digest — {topic}",
             f"_generated {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}_", ""]
    # Phase 17 (QU-04/ROB-08): an ADDITIVE out-of-scope banner. `scope` is optional
    # (keyword-default) so the legacy 2-arg/3-arg digest calls still work. When the topic
    # looks like a private-document improvement task, prepend a clearly-marked banner right
    # after the title block — never removing the status/ranked/footer blocks.
    if scope:
        lines.insert(2, "> ⚠ Looks like a request to improve a private document — web "
                        "retrieval can't read your artifact; hand it to the driving agent. "
                        "Topic searched anyway.")
    # Phase 5 (ROB-06/D-20): a per-source status table at the TOP of the digest (above
    # the ranked block) so every fired source's fate is visible — no silent empties. The
    # `cache` column renders the REAL hishel hit/miss the status dict carries (Issue 1/
    # D-12): True→hit, False→miss, None (a failed source)→-. `status` is optional so the
    # legacy 2-arg digest(topic, collected) call still works (additive, ROB-08).
    if status:
        lines += ["## source status", "",
                  "| source | status | latency | results | cache | error |",
                  "|---|---|---|---|---|---|"]
        for s in sorted(status, key=lambda s: s["source"]):
            cache = s.get("cache")
            cache_txt = "hit" if cache is True else ("miss" if cache is False else "-")
            lines.append(f"| {s['source']} | {s['status']} | {s['latency_ms']}ms | "
                         f"{s['n_results']} | {cache_txt} | {(s.get('error') or '')[:40]} |")
        lines.append("")
    # Phase 3 (RANK-05): one unified cross-source ranked top-N via rank.rank_items —
    # RRF-ordered (not the old per-source raw-score sort), de-duplicated, with an
    # auditable score badge + "also seen on" provenance. Additive/ROB-08: rank_items
    # only enriches each item's extra in place; main()'s JSON writer still dumps the
    # raw per-source `collected`. The browser-only footer below is kept verbatim.
    ranked = rank_items(topic, collected)[:25]
    lines.append(f"## ranked results  ({len(ranked)})")
    for it in ranked:
        extra = it.get("extra") or {}
        title = (it.get("title") or "").strip().replace("\n", " ")[:100]
        rrf, bm25 = extra.get("rrf"), extra.get("bm25")
        badge = f" [rrf={rrf} bm25={bm25}]" if rrf is not None else ""
        also = extra.get("also_seen_on") or []
        also_sfx = f" (also: {', '.join(also)})" if also else ""
        lines.append(f"- {title}{badge} — {it.get('url') or ''}{also_sfx}")
    lines.append("")
    # Phase 4 (D-60): Reddit is now an in-core API source (fires automatically via
    # routing), so it is no longer listed as browser-only. X stays browser-only
    # (out of the automatic flow, ToS), and reddit_scrape.py remains an optional
    # manual deep-comment scrape for when the API source's titles aren't enough.
    lines += ["## browser-only / manual sources (run separately)",
              f"- X:       `MODE=search Q=\"{topic}\" browser-harness < ~/.claude/scrapers/x_scrape.py`",
              "- Reddit (deep comments): `SUB=<sub> T=year MAX_POSTS=50 browser-harness < ~/.claude/scrapers/reddit_scrape.py` — optional; the in-core Reddit API source already runs automatically", ""]
    return "\n".join(lines)


def main():
    # Load a project/CWD .env into os.environ ONCE at startup (ROB-07 / D-22), without
    # clobbering already-exported vars (override=False → a real env var always wins). Every
    # existing os.environ.get(...) read is unchanged — dotenv just pre-populates. usecwd=True
    # is the deterministic discovery form (the no-arg load_dotenv walks the caller frame and
    # is fragile — 05-01 finding).
    from dotenv import find_dotenv, load_dotenv
    load_dotenv(find_dotenv(usecwd=True), override=False)
    p = argparse.ArgumentParser()
    p.add_argument("topic")
    p.add_argument("--limit", type=int, default=12)
    p.add_argument(
        "--rerank",
        action="store_true",
        help="opt-in cross-encoder rerank of the top results (default OFF; needs the "
             "[semantic] extra: `uv sync --extra semantic`)",
    )
    # QU-05 routing overrides — thread a route_override descriptor through to resolve_route.
    p.add_argument("--tier", action="append", choices=["dev", "academic", "consumer", "general"],
                   help="force tier(s) (repeatable); bypasses the classifier. "
                        "Precedence: --all > --sources > --tier > classifier.")
    p.add_argument("--sources", type=str, default=None,
                   help="comma-separated explicit source list (validated against the registry); "
                        "honored verbatim (ALWAYS_ON not force-added).")
    p.add_argument("--all", dest="all_sources", action="store_true",
                   help="fire every registered source.")
    a = p.parse_args()
    if a.rerank:
        os.environ["RESEARCH_RERANK"] = "1"   # explicit CLI wins (D-04); else env, else OFF
    # Build the override descriptor honoring precedence (--all > --sources > --tier);
    # None → the frozen classifier path (QU-05 / RESEARCH §7).
    route_override = None
    if a.all_sources:
        route_override = {"all_sources": True}
    elif a.sources:
        route_override = {"sources": [s.strip() for s in a.sources.split(",") if s.strip()]}
    elif a.tier:
        route_override = {"tier": a.tier}
    print(f"[research] topic={a.topic!r} across open-API sources...")
    try:
        # resolve_route validates --sources/--tier against the registry; fail FAST (non-zero
        # exit) on an unknown name rather than proceeding with an invalid override (T-17-03).
        slug, collected, status = run_with_status(a.topic, a.limit, route_override=route_override)   # additive 3-tuple channel (D-19)
    except ValueError as e:
        sys.exit(f"[route] {e}")
    # Phase 17 (QU-04): detect a document-task / out-of-scope query on the RAW topic
    # (the literal intent is in the user's phrasing — not kq/expanded) and surface it
    # ADDITIVELY (stderr + JSON `scope` + digest banner). None when in-scope.
    scope = query_norm.detect_scope(a.topic)
    if scope is not None:
        print(f"[scope] {a.topic!r} looks like a document-task ({scope}) — this tool does "
              "WEB RETRIEVAL, not local-document editing; hand the artifact to your agent. "
              "Searching the topic anyway.", file=sys.stderr)
    total = sum(len(v) for v in collected.values())
    os.makedirs(OUT_DIR, exist_ok=True)
    jpath = os.path.join(OUT_DIR, f"topic_{slug}.json")
    mpath = os.path.join(OUT_DIR, f"topic_{slug}.md")
    with open(jpath, "w") as f:
        json.dump({"topic": a.topic, "generated_utc": time.time(),
                   "total_items": total, "sources": collected,
                   "source_status": status, "scope": scope}, f, indent=2, ensure_ascii=False)   # source_status + scope ADDITIVE (D-20/ROB-08)
    with open(mpath, "w") as f:
        f.write(digest(a.topic, collected, status, scope))
    print(f"[research] {total} items across {sum(1 for v in collected.values() if v)} sources")
    print(f"[research] -> {jpath}")
    print(f"[research] -> {mpath}")


if __name__ == "__main__":
    main()
