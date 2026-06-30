#!/usr/bin/env python3
"""Multi-source project-research scraper — open-API sources (no browser needed).

Sources that block server-side requests (reddit, x, medium) live in the
browser-harness scrapers (reddit_scrape.py, x_scrape via browser, etc.).
This tool covers sources with open HTTP APIs: fast, reliable, stdlib-only.

Usage:
    python3 research.py hn            --days 7   --limit 30 --comments 5
    python3 research.py devto         --tag ai   --days 30  --limit 30
    python3 research.py arxiv         --category cs.AI       --limit 30
    python3 research.py stackoverflow --tag llm  --limit 30  --answers 3
    python3 research.py github        --query "topic:llm stars:>200" --limit 30
    python3 research.py lobsters      --limit 30

Every source writes the SAME envelope:
    {source, query, generated_utc, count, items:[{id,title,author,score,url,
     created_utc,num_comments,text,top_comments:[...],tags,extra}]}
"""
import argparse, asyncio, base64, contextvars, json, os, shutil, sys, time, urllib.request, urllib.parse, urllib.error, subprocess
import xml.etree.ElementTree as ET
from html.parser import HTMLParser  # SRC-09 (Phase 18): stdlib DDG-Lite result parser (no bs4)
from urllib.parse import urlsplit

import httpx
from aiolimiter import AsyncLimiter

from query_norm import salient_tokens  # shared D-37 normalizer (sibling module)
import transcripts  # ENRICH-01 sibling module. Top-level OK for the import-light runner
# (ENRICH-02/SC#4) ONLY because transcripts keeps its youtube_transcript_api/requests
# import LAZY in-function — a top-level transcript-lib import here would leak into subagents.

OUT_DIR = os.path.expanduser("~/.claude/scrapers/out")
UA = "Mozilla/5.0 (project-research; browser-harness companion)"

# Hacker News client-side points floor (ENDP-05, D-32). The HN Algolia index
# does NOT support a server-side numeric filter on the points attribute — such a
# filter returns HTTP 400 ("invalid numeric attribute(points)") per RESEARCH ⚠ #1
# (only created_at_i is server-filterable). So the floor is applied in Python
# AFTER fetching the relevance-ranked hits,
# preserving Algolia's order (a floor *filter*, never a points re-sort — D-26),
# with a recall guard that drops the floor when it would starve the result set.
HN_POINTS_FLOOR = 5


# ───────────────────── Async HTTP core (Phase 5, ROB-01..04) ─────────────────────
# Per-host rate-limit table (D-08; verify live, tune freely — never hard-code a
# documented quota as permanent, PROJECT volatility constraint). (max_rate, period_s).
_HOST_LIMITS = {
    "export.arxiv.org": (1, 3), "api.github.com": (30, 60),
    "oauth.reddit.com": (100, 60), "api.semanticscholar.org": (1, 1),
    "api.openalex.org": (10, 1), "api.stackexchange.com": (25, 60),
    "api.bsky.app": (5, 1),  # conservative; generous public AppView, one call/run (BSKY/Phase-11 playbook)
    # Phase 12 open-ecosystem hosts — conservative (5,1), one call/instance/run (Discourse)
    "community.openai.com": (5, 1), "discuss.huggingface.co": (5, 1),
    "forum.cursor.com": (5, 1),
    # Phase 13 (RSS): GitHub releases.atom feeds are served from github.com — DISTINCT
    # from the api.github.com row above. One GET per feed per run, conservative (5,1).
    "github.com": (5, 1),
    # Phase 18 (SRC-08): Europe PMC REST. Conservative (5,1), one call/run; Europe PMC
    # publishes a soft limit — verify-at-integration, never hard-code (PROJECT volatility).
    "www.ebi.ac.uk": (5, 1),
    # Phase 18 (SRC-10): entity-resolution hosts — conservative (5,1), one call/run each.
    # OpenAlex-authors reuses the api.openalex.org row above.
    "pub.orcid.org": (5, 1), "api.ror.org": (5, 1),
    # Phase 18 (SRC-09): DDG-Lite keyless web fallback — VERY conservative (1,2), one
    # query/run (18-RESEARCH §5/§8; the compliant low-rate posture, robots /lite/ allowed).
    "lite.duckduckgo.com": (1, 2),
}
_DEFAULT_LIMIT = (5, 1)  # conservative fallback: brave/youtube/gdelt/npm/hf/hn-algolia (D-09)

# Per-run limiter store + last-cache-hit flag as ContextVars (NOT module-level dicts)
# — the deliberate fix for two checker findings: (Issue 2) a module-level `_limiters = {}`
# is global mutable state whose AsyncLimiter token-buckets persist across tests in one
# process → non-deterministic rate-limit tests, violating "no global mutable state";
# (Issue 1) the status `cache` field had no wiring path from _get's
# response.extensions["hishel_from_cache"] up to 05-04's _one() status dict. ContextVars
# solve both with ZERO signature churn across the 15 sources. asyncio.gather (05-04's
# fan-out) wraps each source in a Task, and each Task COPIES the current context at
# creation — so writes inside one source's _get are isolated to that source's task and
# never race across the concurrent fan-out; _run_async (05-04) does _LIMITERS.set({}) once
# per run → fresh token-buckets per run (eliminates cross-test interference, Issue 2).
_LIMITERS: contextvars.ContextVar[dict] = contextvars.ContextVar("research_limiters")
_LAST_CACHE_HIT: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "research_last_cache_hit", default=False)


def _limiter_for(url: str) -> AsyncLimiter:
    """Return the per-host AsyncLimiter for this URL, creating it lazily in the per-run
    _LIMITERS ContextVar store. Unknown hosts fall back to the conservative default (D-09)."""
    try:
        limiters = _LIMITERS.get()
    except LookupError:
        limiters = {}                       # CLI / collect_one path: lazy per-call dict
        _LIMITERS.set(limiters)
    host = urlsplit(url).hostname or ""
    if host not in limiters:
        rate, per = _HOST_LIMITS.get(host, _DEFAULT_LIMIT)
        limiters[host] = AsyncLimiter(rate, per)
    return limiters[host]


# Per-source cache TTL (seconds), force-cached via the X-Hishel-Ttl request header
# consumed by 05-02's hishel transport (D-11): academic/package long, news/social short.
_HOST_TTLS = {
    "export.arxiv.org": 86400, "api.openalex.org": 86400,
    "api.semanticscholar.org": 86400, "registry.npmjs.org": 43200,
    "huggingface.co": 43200, "www.googleapis.com": 3600,       # youtube moderate
    "api.search.brave.com": 900, "hn.algolia.com": 600,
    "api.gdeltproject.org": 300, "oauth.reddit.com": 300,
    "api.github.com": 900, "api.stackexchange.com": 900,
    "api.bsky.app": 300,  # short social TTL ≈ reddit (Phase-11)
    # Phase 12 open-ecosystem hosts — short social TTL ≈ reddit/bluesky (Discourse)
    "community.openai.com": 300, "discuss.huggingface.co": 300,
    "forum.cursor.com": 300,
    # Phase 18 (SRC-08): Europe PMC — academic-long TTL, mirrors openalex/arxiv/s2.
    "www.ebi.ac.uk": 86400,
    # Phase 18 (SRC-10): entity hosts — academic-long TTL (OpenAlex reuses its row above).
    "pub.orcid.org": 86400, "api.ror.org": 86400,
    # Phase 18 (SRC-09): DDG-Lite — web-short TTL ≈ brave (volatile web results).
    "lite.duckduckgo.com": 900,
}
_DEFAULT_TTL = 900


def _ttl_for(url: str) -> int:
    return _HOST_TTLS.get(urlsplit(url).hostname or "", _DEFAULT_TTL)


def _retry_after_seconds(resp, attempt: int) -> float:
    """Seconds to wait before the next attempt: honor a Retry-After delta-seconds or
    HTTP-date, else bounded exponential backoff + light jitter. The no-header path is
    capped at 30s and an HTTP-date in the past clamps to 0 — the DoS-via-retry guard
    (D-14 / threat T-05-04), since max_retries bounds how often it is entered."""
    ra = resp.headers.get("retry-after")
    if ra:
        try:
            return float(ra)                             # delta-seconds
        except ValueError:
            from email.utils import parsedate_to_datetime
            import time as _t
            try:
                return max(0.0, parsedate_to_datetime(ra).timestamp() - _t.time())
            except (TypeError, ValueError):
                pass
    return min(2 ** attempt, 30) + (attempt * 0.1)       # bounded expo backoff + jitter


async def _get(client: httpx.AsyncClient, url: str, headers=None, timeout: float = 30.0,
               max_retries: int = 3, force_cache_ttl: bool = True) -> str:
    """Async GET over the shared httpx client: per-host leaky-bucket throttle (ROB-02),
    per-source force-cache TTL header (ROB-03), the hishel hit/miss flag recorded on EVERY
    GET (the status cache-field wiring path, Issue 1), and a bounded Retry-After/backoff
    retry loop on 429/503 (ROB-04). The request BYTES are unchanged vs the old sync core —
    only the X-Hishel-Ttl cache hint is added (relevance frozen, D-26).

    ``force_cache_ttl`` (Phase 13 / D-13-01): the 14 API sources keep it ``True`` so the
    X-Hishel-Ttl header drives the _CacheAll force-cache TTL (byte-unchanged for them). The
    RSS path passes ``False`` (via ``_get_rss``) so feeds revalidate under the spec-policy
    transport's RFC-9111 conditional GET (ETag/Last-Modified/304) instead of being blindly
    force-cached to a TTL — the right behavior for a freshness layer."""
    base = {"X-Hishel-Ttl": str(_ttl_for(url))} if force_cache_ttl else {}
    hdrs = {**base, **(headers or {})}                              # force-cache TTL first; caller keys win
    limiter = _limiter_for(url)
    r = None
    for attempt in range(max_retries + 1):
        async with limiter:                              # per-host throttle (ROB-02)
            r = await client.get(url, headers=hdrs, timeout=timeout)
        _LAST_CACHE_HIT.set(bool(r.extensions.get("hishel_from_cache")))   # cache flag, every GET (Issue 1)
        if r.status_code in (429, 503) and attempt < max_retries:
            await asyncio.sleep(_retry_after_seconds(r, attempt))     # ROB-04
            continue
        r.raise_for_status()
        return r.text
    assert r is not None
    r.raise_for_status()
    return r.text


async def _get_json(client, url, headers=None, timeout: float = 30.0):
    return json.loads(await _get(client, url, headers, timeout))


async def _get_rss(client, url, timeout: float = 30.0) -> str:
    """Raw-bytes/text GET for the RSS freshness path (Phase 13 / RSS-03). Omits the
    X-Hishel-Ttl force-cache header (``force_cache_ttl=False``, D-13-01) so feed hosts
    revalidate via the spec-policy transport's conditional GET / 304 rather than being
    blindly force-cached. Mirrors the ``_get_json`` one-liner shape."""
    return await _get(client, url, force_cache_ttl=False, timeout=timeout)


def write_out(source, query, items, out=None):
    if isinstance(query, dict):
        query = {k: v for k, v in query.items()
                 if isinstance(v, (str, int, float, bool, type(None), list))}
    rec = {"source": source, "query": query, "generated_utc": time.time(),
           "count": len(items), "items": items}
    out = out or os.path.join(OUT_DIR, f"{source}_{int(time.time())}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(rec, f, indent=2, ensure_ascii=False)
    print(f"[{source}] wrote {len(items)} items -> {out} ({os.path.getsize(out):,} bytes)")
    return out


# ───────────────────────── Hacker News (Algolia) ─────────────────────────
async def hn(client, a):
    # Relevance-ranked Algolia endpoint (ENDP-05) — NOT /search_by_date.
    url = ("https://hn.algolia.com/api/v1/search?tags=story"
           f"&hitsPerPage={a.limit}")
    if a.query:
        url += "&query=" + urllib.parse.quote(a.query)
    # Recency window (RESEARCH open-Q #1): `created_at_i` is the ONLY server-side
    # numeric filter HN allows, but a relevance query should not be hard-cut by
    # age — a date window needlessly excludes great older threads and hurts
    # topical recall (the points floor already handles noise). So apply it ONLY
    # when the caller explicitly opts into recency. The research_topic ns() has no
    # `recency` field, so the default topical path applies NO recency filter.
    if getattr(a, "recency", False):
        since = int(time.time()) - a.days * 86400
        url += f"&numericFilters=created_at_i>{since}"
    # Preserve Algolia relevance order — never sorted(...key=points) (D-26).
    hits = (await _get_json(client, url)).get("hits", [])
    # Client-side points floor + recall guard (D-32; server-side points filter is
    # impossible — RESEARCH ⚠ #1). Keep relevance order; drop the floor entirely
    # if it would leave fewer than `limit` hits, so recall is never starved.
    kept = [h for h in hits if (h.get("points") or 0) >= HN_POINTS_FLOOR]
    if len(kept) < a.limit:
        kept = hits
    hits = kept[:a.limit]
    items = []
    for h in hits:
        oid = h.get("objectID")
        comments = []
        if a.comments and oid:
            try:
                kids = [c for c in ((await _get_json(
                    client, f"https://hn.algolia.com/api/v1/items/{oid}")).get("children") or [])
                    if c.get("text")]
                kids.sort(key=lambda c: c.get("points") or 0, reverse=True)
                comments = [{"author": c.get("author"), "score": c.get("points"),
                             "body": c.get("text")} for c in kids[:a.comments]]
            except Exception:
                pass
            await asyncio.sleep(0.15)
        items.append({"id": oid, "title": h.get("title"), "author": h.get("author"),
                      "score": h.get("points"), "num_comments": h.get("num_comments"),
                      "created_utc": h.get("created_at_i"), "url": h.get("url"),
                      "permalink": f"https://news.ycombinator.com/item?id={oid}",
                      "text": h.get("story_text") or "", "top_comments": comments,
                      "tags": h.get("_tags"), "extra": {}})
    write_out("hackernews", vars(a), items, a.out)


# ───────────────────────────── Dev.to ────────────────────────────────────
async def devto(client, a):
    # DEPRECATED (Phase 2, D-03): unwired from the always-on SOURCES (no free-text
    # search API — tag/top feed is topic-blind). Kept as a CLI subcommand for
    # Phase-4 `site:dev.to` reuse; do not re-add to research_topic.SOURCES.
    top_days = max(1, a.days)
    url = f"https://dev.to/api/articles?top={top_days}&per_page={a.limit}"
    if a.tag:
        url += "&tag=" + urllib.parse.quote(a.tag)
    arts = await _get_json(client, url)
    items = []
    for r in arts[:a.limit]:
        items.append({"id": r.get("id"), "title": r.get("title"),
                      "author": (r.get("user") or {}).get("username"),
                      "score": r.get("positive_reactions_count"),
                      "num_comments": r.get("comments_count"),
                      "created_utc": r.get("published_timestamp"),
                      "url": r.get("url"), "text": r.get("description") or "",
                      "top_comments": [], "tags": r.get("tag_list"),
                      "extra": {"reading_minutes": r.get("reading_time_minutes")}})
    write_out("devto", vars(a), items, a.out)


# ───────────────────────────── ArXiv ─────────────────────────────────────
async def arxiv(client, a):
    # Fielded relevance query (ENDP-02, D-29). arXiv's sortBy=relevance is literal:
    # a single broad token matches the WORD across unrelated domains (RESEARCH ⚠ #3 —
    # "transformer" surfaced math transform papers). So build a multi-salient-token
    # query from the shared D-37 normalizer and AND the per-token (ti: OR abs:)
    # clauses to disambiguate by concept, not by a single literal word (D-39 token-AND,
    # not a strict quoted phrase). Replaces the old all:<topic> + submittedDate path.
    toks = salient_tokens(a.query or "")
    if not toks:
        # Never emit an empty search_query — fall back to the raw query (or "AI").
        toks = [(a.query or "AI").strip()]
    fielded = " AND ".join("(ti:%s OR abs:%s)" % (t, t) for t in toks)
    if a.category:
        # Phase-4 cat: hook (D-29): the topical caller does NOT set --category, so this
        # stays unset by default; left here so Phase-4's classifier can gate by category.
        fielded += " AND cat:" + a.category
    # HTTPS host (was http — RESEARCH §3 / D-29). sortBy=relevance, not submittedDate.
    url = ("https://export.arxiv.org/api/query?search_query="
           + urllib.parse.quote(fielded)
           + f"&sortBy=relevance&max_results={a.limit}")
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(await _get(client, url))
    items = []
    for e in root.findall("a:entry", ns):
        authors = [x.findtext("a:name", default="", namespaces=ns)
                   for x in e.findall("a:author", ns)]
        items.append({"id": e.findtext("a:id", default="", namespaces=ns),
                      "title": (e.findtext("a:title", default="", namespaces=ns) or "").strip(),
                      "author": ", ".join(authors[:4]),
                      "score": None, "num_comments": None,
                      "created_utc": e.findtext("a:published", default="", namespaces=ns),
                      "url": e.findtext("a:id", default="", namespaces=ns),
                      "text": (e.findtext("a:summary", default="", namespaces=ns) or "").strip(),
                      "top_comments": [], "tags": [c.get("term") for c in e.findall("a:category", ns)],
                      "extra": {}})
    write_out("arxiv", vars(a), items, a.out)


# ──────────────────────── Stack Overflow ─────────────────────────────────
async def stackoverflow(client, a):
    # Free-text relevance endpoint (ENDP-04, D-31): /2.3/search/advanced?q=<topic>
    # &sort=relevance — REPLACES the old /questions?tagged=&sort=votes tag-only path
    # that ignored the free-text topic. filter=withbody keeps `body` populated so
    # `text` stays filled after the switch (RESEARCH §5).
    base = "https://api.stackexchange.com/2.3"
    # The topical caller (research_topic.run) passes the topic via `tag=`
    # (dash-joined), while the CLI passes `--query`. Support both: prefer an explicit
    # --query, else recover the topic from the dash-joined tag. Default to a benign
    # term so we never emit an empty q= (RESEARCH §5 — bare q= returns nothing useful).
    topic = a.query or (a.tag or "").replace("-", " ")
    topic = topic.strip() or "programming"
    url = ("https://api.stackexchange.com/2.3/search/advanced?q="
           + urllib.parse.quote(topic)
           + "&site=stackoverflow&sort=relevance&order=desc&filter=withbody"
           + f"&pagesize={a.limit}")
    # Key (D-18/D-23): STACKEXCHANGE_KEY lifts the quota 300/day -> 10000/day. Read
    # from env ONLY and appended solely as the API's required key param — never logged,
    # never in argv (so the vars(a) echo can't capture it), never written to out/
    # (D-25/T-02-14). Keyless still works (300/day) — never skip the source for no key.
    key = os.environ.get("STACKEXCHANGE_KEY")
    if key:
        url += "&key=" + urllib.parse.quote(key)
    data = await _get_json(client, url)
    # Honor the dynamic backoff signal (D-21): `backoff` is ABSENT on a normal
    # response (RESEARCH §5) — only present when throttled. When present, sleep that
    # many seconds before the next same-method call (the per-question answers fetch).
    if data.get("backoff"):
        await asyncio.sleep(int(data["backoff"]))
    qs = data.get("items", [])
    items = []
    for q in qs[:a.limit]:
        answers = []
        if a.answers and q.get("question_id"):
            try:
                au = (f"{base}/questions/{q['question_id']}/answers?order=desc&sort=votes"
                      f"&site=stackoverflow&pagesize={a.answers}&filter=withbody")
                ans_data = await _get_json(client, au)
                # The answers wrapper may also carry `backoff` when throttled — honor
                # it before the next request (D-21).
                if ans_data.get("backoff"):
                    await asyncio.sleep(int(ans_data["backoff"]))
                for ans in ans_data.get("items", [])[:a.answers]:
                    answers.append({"author": (ans.get("owner") or {}).get("display_name"),
                                    "score": ans.get("score"),
                                    "body": ans.get("body", "")[:4000]})
            except Exception:
                pass
            await asyncio.sleep(0.2)
        items.append({"id": q.get("question_id"), "title": q.get("title"),
                      "author": (q.get("owner") or {}).get("display_name"),
                      "score": q.get("score"), "num_comments": q.get("answer_count"),
                      "created_utc": q.get("creation_date"), "url": q.get("link"),
                      "text": q.get("body", "")[:4000], "top_comments": answers,
                      "tags": q.get("tags"),
                      "extra": {"is_answered": q.get("is_answered"), "views": q.get("view_count")}})
    write_out("stackoverflow", vars(a), items, a.out)


# ───────────────────────────── GitHub (search API over urllib) ───────────
def _github_token():
    """Resolve a GitHub token (D-19), or None for the unauthenticated path.

    Order: GITHUB_TOKEN -> GH_TOKEN env -> `gh auth token` (only if the gh CLI
    is on PATH) -> None. The `gh auth token` fallback makes the user's machine
    work with no env var; the env-var path makes it subagent-safe with no `gh`
    login. The token is read here ONLY and used solely in the Authorization
    header — never logged, never put in argv, never written to out/ (D-25).
    """
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token.strip()
    if shutil.which("gh"):
        try:
            res = subprocess.run(["gh", "auth", "token"],
                                 capture_output=True, text=True, timeout=10)
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except (FileNotFoundError, subprocess.SubprocessError):
            pass  # gh present but unusable -> fall through to unauthenticated
    return None


async def github(client, a):
    # Stdlib urllib (NOT the gh subprocess) over the repo search API (ENDP-07).
    # The caller passes "{topic} stars:>50", so the stars:>50 quality floor (D-34)
    # arrives in a.query — do NOT strip it. We send NO sort/order param, so the
    # API returns best-match relevance — surfacing topical repos over star-count
    # noise (RESEARCH ⚠ #5). One request/run, no pagination loop (30/min, D-20).
    q = a.query or "stars:>100 pushed:>2026-01-01"
    url = ("https://api.github.com/search/repositories?q="
           + urllib.parse.quote(q) + f"&per_page={a.limit}")
    headers = {"Accept": "application/vnd.github+json"}
    token = _github_token()
    if token:
        headers["Authorization"] = "token " + token
    # Keyless path still works (10/min, D-18) — never skip the source for no key.
    # On failure _get_json raises normally; research_topic.run's per-source
    # try/except converts it to [] (fail-soft, D-18) — no SystemExit here.
    data = await _get_json(client, url, headers=headers)
    items = []
    for r in data.get("items", [])[:a.limit]:
        items.append({"id": r.get("id"), "title": r.get("full_name"),
                      "author": (r.get("owner") or {}).get("login"),
                      "score": r.get("stargazers_count"), "num_comments": r.get("open_issues_count"),
                      "created_utc": r.get("created_at"), "url": r.get("html_url"),
                      "text": r.get("description") or "", "top_comments": [],
                      "tags": r.get("topics"),
                      "extra": {"language": r.get("language"), "forks": r.get("forks_count"),
                                "pushed_at": r.get("pushed_at")}})
    write_out("github", vars(a), items, a.out)


# ───────────────────────── Brave Search (general web) ────────────────────
async def brave(client, a):
    # SRC-01 general web (D-01..D-06). One request/run; raw topic (D-02);
    # description -> text for BM25 (D-03). The X-Subscription-Token is read from
    # env ONLY and passed solely in the request header — never logged, never in
    # argv (so the vars(a) echo can't capture it), never written to out/ (D-57).
    key = os.environ.get("BRAVE_API_KEY") or os.environ.get("BRAVE_SEARCH_API_KEY")
    if not key:
        print("[brave] no BRAVE_API_KEY — skipping (fail-soft)", file=sys.stderr)
        return write_out("brave", vars(a), [], a.out)        # [] envelope, never fatal (D-06)
    url = ("https://api.search.brave.com/res/v1/web/search?q="
           + urllib.parse.quote(a.query or "") + f"&count={min(a.limit, 20)}")
    data = await _get_json(client, url, headers={"X-Subscription-Token": key, "Accept": "application/json"})
    items = []
    for r in (data.get("web", {}).get("results", []))[:a.limit]:
        items.append({"id": r.get("url"), "title": r.get("title"),
                      "author": (r.get("profile") or {}).get("name"), "score": None,
                      "num_comments": None, "created_utc": None, "url": r.get("url"),
                      "text": r.get("description") or "", "top_comments": [],
                      "tags": [], "extra": {"age": r.get("age") or r.get("page_age")}})
    write_out("brave", vars(a), items, a.out)


# ───────────── DuckDuckGo Lite — keyless general-web fallback (SRC-09) ─────────
# Hand-rolled POST to lite.duckduckgo.com/lite/ with the proven browser header set
# (18-RESEARCH §5) — NOT the volatile ddgs dep (PROJECT warns against fast-moving search
# libs). The Lite results page is plain HTML: rows are <a class="result-link" href="...">
# where the href is a `uddg=`-wrapped redirect → URL-decode the uddg param to the real
# target. Parsed with the stdlib html.parser (no bs4 — matches _strip_html's habit).
class _DDGLiteParser(HTMLParser):
    """Extract DDG-Lite result rows: <a class='result-link' href='...uddg=...'>title</a> (stdlib only)."""

    def __init__(self):
        super().__init__()
        self.results: list[tuple[str, str]] = []     # list[(href, title)]
        self._href: str | None = None
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            d = dict(attrs)
            cls = d.get("class") or ""
            if "result-link" in cls:
                self._href = d.get("href")
                self._buf = []

    def handle_data(self, data):
        if self._href is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.results.append((self._href, "".join(self._buf).strip()))
            self._href = None


def _decode_uddg(href: str) -> str:
    """//duckduckgo.com/l/?uddg=<encoded real url> → the real url (stdlib; SSRF-safe parse-only).

    The decoded URL is stored as DATA only — it is NEVER fetched (T-18-SSRF: parse-only)."""
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        return qs.get("uddg", [href])[0]
    except (ValueError, TypeError):
        return href


def _parse_ddg_lite(html: str) -> list[dict]:
    p = _DDGLiteParser()
    p.feed(html or "")
    out = []
    for href, title in p.results:
        url = _decode_uddg(href)
        if url:
            out.append({"id": url, "title": title or url, "author": None, "score": None,
                        "num_comments": None, "created_utc": None, "url": url,
                        "text": "", "top_comments": [], "tags": [], "extra": {"via": "ddg-lite"}})
    return out


async def ddg(client, a):
    # SRC-09 (F-17/F-09): keyless general-web fallback via DDG Lite. Hand-rolled POST with the
    # proven browser header set (18-RESEARCH §5). Fail-soft: 202/empty/parse-miss → []. The
    # query is POST form-data (data={"q": ...}), NEVER interpolated into the host/path
    # (T-18-SSRF — host/path are constant literals); a typed except (NO bare/broad except) maps
    # a transport/parse hiccup to [], and the per-source breaker absorbs any top-level raise (D-17).
    headers = {
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://lite.duckduckgo.com/",
        "Origin": "https://lite.duckduckgo.com",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    items = []
    try:
        async with _limiter_for("https://lite.duckduckgo.com/lite/"):
            resp = await client.post("https://lite.duckduckgo.com/lite/",
                                     data={"q": a.query or ""}, headers=headers, timeout=30.0)
        if resp.status_code == 200 and resp.text:
            items = _parse_ddg_lite(resp.text)[:a.limit]
    except (httpx.HTTPError, ValueError, TypeError):
        items = []        # fail-soft (the breaker also catches a top-level raise, D-17)
    write_out("ddg", vars(a), items, a.out)


# ───────────────────────── YouTube (Data API v3) ─────────────────────────
async def youtube(client, a):
    # SRC-03 YouTube Data API v3 (D-20..D-25). key is a QUERY param; order=relevance
    # (D-24). The key is read from env ONLY and appended solely as the API's required
    # key param — never logged, never in argv, never written to out/ (D-57).
    key = os.environ.get("YOUTUBE_API_KEY") or os.environ.get("YT_API_KEY")
    if not key:
        print("[youtube] no YOUTUBE_API_KEY — skipping (fail-soft)", file=sys.stderr)
        return write_out("youtube", vars(a), [], a.out)
    url = ("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video"
           f"&order=relevance&maxResults={min(a.limit, 50)}&q="
           + urllib.parse.quote(a.query or "") + "&key=" + urllib.parse.quote(key))
    data = await _get_json(client, url)
    items = []
    for it in data.get("items", [])[:a.limit]:
        vid = (it.get("id") or {}).get("videoId")
        sn = it.get("snippet") or {}
        items.append({"id": vid, "title": sn.get("title"), "author": sn.get("channelTitle"),
                      "score": None, "num_comments": None, "created_utc": sn.get("publishedAt"),
                      "url": f"https://www.youtube.com/watch?v={vid}", "text": sn.get("description") or "",
                      "top_comments": [], "tags": [], "extra": {"published": sn.get("publishedAt")}})
    items = await transcripts.enrich(items)  # ENRICH-01: bounded, cached, fail-soft (no-op if disabled/blocked)
    write_out("youtube", vars(a), items, a.out)


# ───────────────────────── News (GDELT DOC 2.0, keyless) ──────────────────
async def news(client, a):
    # DEPRECATED (Phase 19, REL-01): unwired from the always-on SOURCES — GDELT DOC 2.0
    # 429'd + 13–15s latency 4/4 dogfood runs (F-05); Brave already covers web/news. Kept
    # as a CLI subcommand only; not in research_topic.SOURCES. Still keyless + fail-soft —
    # thin text=title (D-28); degrades to a [] envelope on any transient fetch error (HTTP
    # 429/5xx, network) rather than raising. One request/run; English only.
    url = ("https://api.gdeltproject.org/api/v2/doc/doc?mode=ArtList&format=json"
           f"&maxrecords={min(a.limit, 250)}&sort=HybridRel&query="
           + urllib.parse.quote((a.query or "") + " sourcelang:eng"))
    try:
        data = await _get_json(client, url)
    except httpx.HTTPError as e:
        print(f"[news] GDELT fetch failed ({e}) — fail-soft to []", file=sys.stderr)
        return write_out("news", vars(a), [], a.out)        # [] envelope, never fatal (D-30)
    items = []
    for art in data.get("articles", [])[:a.limit]:
        items.append({"id": art.get("url"), "title": art.get("title"),
                      "author": art.get("domain"), "score": None, "num_comments": None,
                      "created_utc": art.get("seendate"), "url": art.get("url"),
                      "text": art.get("title") or "", "top_comments": [], "tags": [],
                      "extra": {"published": art.get("seendate"), "country": art.get("sourcecountry")}})
    write_out("news", vars(a), items, a.out)


# ───────────────────────────── Lobsters ──────────────────────────────────
async def lobsters(client, a):
    # DEPRECATED (Phase 2, D-03): unwired from the always-on SOURCES (hottest.json
    # ignores the query; official search is ROBOTS_DISALLOWED). Kept as a CLI
    # subcommand for Phase-4 `site:lobste.rs` reuse; not in research_topic.SOURCES.
    data = await _get_json(client, "https://lobste.rs/hottest.json")
    items = []
    for s in data[:a.limit]:
        items.append({"id": s.get("short_id"), "title": s.get("title"),
                      "author": (s.get("submitter_user") or {}).get("username")
                      if isinstance(s.get("submitter_user"), dict) else s.get("submitter_user"),
                      "score": s.get("score"), "num_comments": s.get("comment_count"),
                      "created_utc": s.get("created_at"), "url": s.get("url"),
                      "text": s.get("description_plain") or "", "top_comments": [],
                      "tags": s.get("tags"), "extra": {"comments_url": s.get("comments_url")}})
    write_out("lobsters", vars(a), items, a.out)


# ───────────────────────────── Medium (RSS) ──────────────────────────────
async def medium(client, a):
    # DEPRECATED (Phase 2, D-03): unwired from the always-on SOURCES (RSS feed is
    # feed-as-search, topic-blind; no free-text search API). Kept as a CLI
    # subcommand for Phase-4 `site:medium.com` reuse; not in research_topic.SOURCES.
    import re, html
    if a.tag:
        feed = f"https://medium.com/feed/tag/{urllib.parse.quote(a.tag)}"
    elif a.query:
        q = a.query.strip()
        feed = (f"https://medium.com/feed/{q}" if q.startswith("@")
                else f"https://medium.com/feed/{urllib.parse.quote(q)}")
    else:
        feed = "https://medium.com/feed/tag/programming"
    ns = {"content": "http://purl.org/rss/1.0/modules/content/",
          "dc": "http://purl.org/dc/elements/1.1/"}
    root = ET.fromstring(await _get(client, feed, headers={"Accept": "application/rss+xml"}))
    items = []
    for it in root.findall(".//item")[:a.limit]:
        body_html = it.findtext("content:encoded", default="", namespaces=ns) or ""
        text = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", body_html))).strip()
        items.append({"id": it.findtext("guid") or it.findtext("link"),
                      "title": it.findtext("title"),
                      "author": it.findtext("dc:creator", default="", namespaces=ns),
                      "score": None, "num_comments": None,
                      "created_utc": it.findtext("pubDate"),
                      "url": it.findtext("link"), "text": text[:800],
                      "top_comments": [], "tags": [c.text for c in it.findall("category")],
                      "extra": {"feed": feed}})
    write_out("medium", vars(a), items, a.out)


# ───────────────────────── Hugging Face (models) ─────────────────────────
async def huggingface(client, a):
    # Search relevance (D-36): the old download-count popularity sort is DROPPED —
    # `search=` alone returns relevance-ranked models (RESEARCH §7, verified "llama" ->
    # Llama-3.x instruct in relevance order). Always-on this phase, flagged ML-tier for
    # Phase-4 gating.
    url = f"https://huggingface.co/api/models?limit={a.limit}"
    if a.query:
        url += "&search=" + urllib.parse.quote(a.query)
    items = []
    for m in (await _get_json(client, url))[:a.limit]:
        # Synthesize `text` for BM25 (D-27): the /api/models LIST item has
        # `pipeline_tag` (e.g. text-generation) + `tags` (~25) but NO `description`
        # (RESEARCH §7). Compose pipeline_tag + the first 8 tags; guard None/empty so
        # `text` is "" when both are absent (stays a string — D-41), never raises.
        pipeline_tag = m.get("pipeline_tag") or ""
        tags = m.get("tags") or []
        text = (pipeline_tag + ". tags: " + ", ".join(str(t) for t in tags[:8])
                if tags else pipeline_tag)
        items.append({"id": m.get("id"), "title": m.get("id"),
                      "author": (m.get("id") or "/").split("/")[0], "score": m.get("likes"),
                      "num_comments": None, "created_utc": m.get("createdAt"),
                      "url": f"https://huggingface.co/{m.get('id')}", "text": text,
                      "top_comments": [], "tags": tags,
                      "extra": {"downloads": m.get("downloads"),
                                "pipeline_tag": pipeline_tag}})
    write_out("huggingface", vars(a), items, a.out)


# ───────────────────────────── npm (search) ──────────────────────────────
async def npm(client, a):
    q = (a.query or "framework").strip()
    # npm 'text' is a documented HARD limit of 2..64 chars (live-verified 2026-06-27;
    # >64 -> HTTP 400 "must be between 2 and 64 characters"). The Phase-17 `kq` cuts
    # the rate but a keyphrase-rich topic can still exceed 64 -> truncate on a WORD
    # boundary so a multi-word query isn't cut mid-token (REL-02 / F-13).
    if len(q) > 64:
        q = q[:64].rsplit(" ", 1)[0] or q[:64]   # whole-word trunc; pathological 1-word>64 -> hard [:64]
    if len(q) < 2:                                # npm also rejects <2 chars
        q = "framework"
    data = await _get_json(client, f"https://registry.npmjs.org/-/v1/search?text={urllib.parse.quote(q)}&size={a.limit}")
    items = []
    for o in data.get("objects", [])[:a.limit]:
        p = o.get("package", {})
        items.append({"id": p.get("name"), "title": p.get("name"),
                      "author": (p.get("publisher") or {}).get("username"),
                      "score": round((o.get("score") or {}).get("final", 0), 3),
                      "num_comments": None, "created_utc": p.get("date"),
                      "url": (p.get("links") or {}).get("npm"),
                      "text": p.get("description") or "", "top_comments": [],
                      "tags": p.get("keywords"),
                      "extra": {"version": p.get("version"),
                                "downloads_weekly": (o.get("downloads") or {}).get("weekly")}})
    write_out("npm", vars(a), items, a.out)


# ───────────────────────── OpenAlex (academic) ───────────────────────────
def _openalex_abstract(inv):
    """Reconstruct plain-text abstract from OpenAlex's abstract_inverted_index (D-27).

    OpenAlex returns the abstract as an ``{token: [positions]}`` inverted index (or
    ``None``). Invert it to position->token, sort by position, and join with spaces to
    recover the ordered abstract text. This populates the ``text`` field so Phase-3's
    BM25 (title + abstract) has signal — it is a field-completeness fix, NOT a ranking
    change (D-27/D-28). Returns ``""`` for a null/malformed index (typed guard, never a
    bare except — threat T-02-13: bounded, pure dict/list iteration over untrusted JSON).
    """
    if not inv:
        return ""
    try:
        pos_to_tok = {}
        for tok, positions in inv.items():
            for p in positions:
                pos_to_tok[p] = tok
        return " ".join(pos_to_tok[p] for p in sorted(pos_to_tok))
    except (AttributeError, TypeError):
        return ""


async def openalex(client, a):
    # Relevance default (ENDP-03, D-26/D-30): OpenAlex `search=` ranks by relevance, so
    # the citation-count descending sort is DROPPED entirely — that re-sort is exactly
    # why off-topic high-citation papers dominated. score still <- cited_by_count (kept
    # for Phase-3 RRF, just not sorted on). No year filter is applied — recency is a
    # Phase-3 rank, not a Phase-2 hard cut (D-30). Page size 200 gives a larger relevance
    # pool to take the first a.limit from (both `per-page`/`per_page` work — RESEARCH ⚠ #2).
    q = a.query or "machine learning"
    # Precision constraint (ENDP-03 gap fix): keep `search=` for relevance ranking, but
    # CONSTRAIN the candidate pool to title/abstract matches over salient tokens (the same
    # query_norm contract arXiv uses — D-29/D-37). Broad `search=` alone pulled topically-
    # adjacent papers (LLM-agent surveys for "claude code"; medical RAG for "rrf") that sank
    # in-tier precision to 0.667; `filter=title_and_abstract.search:` lifts it to ~1.0 by
    # trading recall for precision on dev topics (mirrors arXiv's fielded query — academic
    # sources legitimately return few papers for pure-dev queries). Bare `search=` fallback
    # when there are no salient tokens.
    toks = salient_tokens(q)
    url = "https://api.openalex.org/works?search=" + urllib.parse.quote(q)
    if toks:
        url += ("&filter=title_and_abstract.search:"
                + urllib.parse.quote(" ".join(toks)))
    url += "&per-page=200"
    # mailto joins OpenAlex's polite pool (~10x throughput) — env-driven (D-24). Added
    # ONLY when OPENALEX_MAILTO is set; omitted otherwise (common pool still works). The
    # email is a non-secret politeness contact, read from env, never hard-coded/committed.
    mailto = os.environ.get("OPENALEX_MAILTO")
    if mailto:
        url += "&mailto=" + urllib.parse.quote(mailto)
    items = []
    for w in (await _get_json(client, url)).get("results", [])[:a.limit]:
        authors = [(au.get("author") or {}).get("display_name")
                   for au in (w.get("authorships") or [])[:4]]
        items.append({"id": w.get("id"), "title": w.get("title"),
                      "author": ", ".join(filter(None, authors)),
                      "score": w.get("cited_by_count"), "num_comments": None,
                      "created_utc": w.get("publication_date"),
                      "url": (w.get("primary_location") or {}).get("landing_page_url") or w.get("id"),
                      "text": _openalex_abstract(w.get("abstract_inverted_index")),
                      "top_comments": [],
                      "tags": [c.get("display_name") for c in (w.get("concepts") or [])[:6]],
                      "extra": {"doi": w.get("doi"), "is_oa": (w.get("open_access") or {}).get("is_oa")}})
    write_out("openalex", vars(a), items, a.out)


# ─────────────────── Semantic Scholar (academic, API-keyed) ──────────────
async def semanticscholar(client, a):
    # ONE search request (respects S2's 1 req/sec cumulative limit). Uses
    # SEMANTIC_SCHOLAR_API_KEY / S2_API_KEY from env if present (higher limits);
    # falls back to keyless (lower shared tier) otherwise.
    # Stopword-trim the query (D-33): long free-text queries dilute S2's lexical match
    # and return 0 (the documented "returns nothing" cause — RESEARCH §6). Keep only
    # salient terms via the shared D-37 normalizer; fall back to the raw/default query
    # when trimming yields nothing (e.g. an all-stopword topic) so query= is never empty.
    q_trimmed = " ".join(salient_tokens(a.query or "")) or (a.query or "machine learning")
    fields = "title,year,authors,abstract,citationCount,url,externalIds,openAccessPdf,venue"
    url = ("https://api.semanticscholar.org/graph/v1/paper/search?query="
           + urllib.parse.quote(q_trimmed) + f"&limit={min(max(a.limit, 1), 100)}&fields={fields}")
    key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY") or os.environ.get("S2_API_KEY")
    headers = {"x-api-key": key} if key else {}
    data = None
    for attempt in range(3):  # S2 free tier = 1 req/sec; back off + retry on 429
        try:
            data = await _get_json(client, url, headers=headers)
            break
        except Exception as e:
            if "429" in str(e) and attempt < 2:
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            raise
    # Preserve S2's native relevance order (D-26): the client-side citationCount
    # re-sort is DROPPED — it pushed high-citation-but-off-topic papers to the top.
    # score still <- citationCount below (kept for Phase-3 RRF), just not sorted on.
    rows = ((data or {}).get("data") or [])[:a.limit]
    items = []
    for p in rows:
        authors = [au.get("name") for au in (p.get("authors") or [])[:4]]
        ext = p.get("externalIds") or {}
        oa = p.get("openAccessPdf") or {}
        link = p.get("url") or (f"https://arxiv.org/abs/{ext['ArXiv']}" if ext.get("ArXiv")
                                else (f"https://doi.org/{ext['DOI']}" if ext.get("DOI") else ""))
        items.append({"id": p.get("paperId"), "title": p.get("title"),
                      "author": ", ".join(filter(None, authors)),
                      "score": p.get("citationCount"), "num_comments": None,
                      "created_utc": p.get("year"), "url": link,
                      "text": (p.get("abstract") or "")[:800], "top_comments": [],
                      "tags": [v for v in [p.get("venue")] if v],
                      "extra": {"doi": ext.get("DOI"), "arxiv": ext.get("ArXiv"),
                                "oa_pdf": oa.get("url"), "keyed": bool(key)}})
    write_out("semanticscholar", vars(a), items, a.out)


# ───────────────────── Europe PMC (academic, biomedical) ──────────────────
async def europepmc(client, a):
    # SRC-08 (F-03): biomedical literature via Europe PMC REST (keyless, HTTP-only).
    # resultType=core returns the rich scholarly fields; default sort is relevance (D-26 —
    # score kept for RRF, NOT sorted on). Self-normalizes long queries via salient_tokens
    # (mirrors openalex/arxiv — do NOT double-shape with kq upstream). pageSize (NOT
    # per-page). The URL is the lift mechanism: europepmc.org / doi.org / pmcid match MORE
    # of the biomedical gold substrings than OpenAlex's landing_page_url. The query is
    # urllib.parse.quote'd (T-18-SSRF) and the host/path are constant literals; every field
    # is read through a typed `.get(...)` guard so a malformed payload degrades to [] via
    # the per-source circuit breaker, never a bare/broad except (T-18-untrusted-JSON).
    q = a.query or "glymphatic"
    toks = salient_tokens(q)
    query = " ".join(toks) if toks else q
    url = ("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query="
           + urllib.parse.quote(query)
           + f"&format=json&resultType=core&pageSize={min(max(a.limit, 1), 100)}")
    data = await _get_json(client, url)
    rows = (((data or {}).get("resultList") or {}).get("result") or [])[:a.limit]
    items = []
    for r in rows:
        src = r.get("source") or ""
        rid = r.get("pmid") or r.get("pmcid") or r.get("id") or ""
        doi = r.get("doi")
        if src and rid:
            link = f"https://europepmc.org/article/{src}/{rid}"
        elif doi:
            link = f"https://doi.org/{doi}"
        elif rid:
            link = f"https://europepmc.org/abstract/{src}/{rid}"
        else:
            link = ""
        authors = (r.get("authorString") or "").split(", ")[:4]
        journal = ((r.get("journalInfo") or {}).get("journal") or {}).get("title")
        kw = ((r.get("keywordList") or {}).get("keyword") or [])[:6]
        items.append({
            "id": rid or r.get("id"),
            "title": r.get("title"),
            "author": ", ".join(filter(None, authors)),
            "score": r.get("citedByCount"),            # kept for RRF, NOT sorted on (D-26)
            "num_comments": None,
            "created_utc": r.get("firstPublicationDate") or r.get("pubYear"),
            "url": link,
            "text": (r.get("abstractText") or "")[:800],
            "top_comments": [],
            "tags": [t for t in (list(kw) + [journal]) if t],
            "extra": {"doi": doi, "pmid": r.get("pmid"), "pmcid": r.get("pmcid"),
                      "is_oa": r.get("isOpenAccess") == "Y", "source": src},
        })
    write_out("europepmc", vars(a), items, a.out)


# ──────────────── Entity resolution (person/org, academic) ────────────────
async def entity(client, a):
    # SRC-10 (F-19/F-22): ONE merged person/org entity resolver. The caller fires this
    # ONLY for a detected person/org query (the conditional _entity_thunk in
    # research_topic._run_async) — and it self-limits (a non-entity query routes through
    # the empty path before this runs). OpenAlex-authors is the CORE WIN (openalex.org/A +
    # orcid.org URLs — the structured scholarly identity the dogfood found missing); ORCID
    # expanded-search and ROR v2 are additive. All three APIs are KEYLESS, HTTP-only.
    #
    # SECURITY: the user query is urllib.parse.quote'd on every sub-call (T-18-SSRF) and the
    # hosts/paths are constant literals (the query is a value, never a URL). Each sub-fetch is
    # wrapped in a TYPED `except (httpx.HTTPError, ValueError, KeyError, TypeError)` — NEVER a
    # bare/broad except (global rule + T-18-untrusted-JSON) — so one API's malformed payload or
    # transport hiccup degrades only its sub-result; the whole source never raises.
    q = a.query or ""
    items = []
    # (1) OpenAlex authors — the core win (openalex.org/A... + orcid.org URLs).
    try:
        url = ("https://api.openalex.org/authors?search="
               + urllib.parse.quote(q) + "&per-page=3")
        for au in (await _get_json(client, url)).get("results", [])[:3]:
            inst = [i.get("display_name") for i in (au.get("last_known_institutions") or [])]
            items.append({
                "id": au.get("id"), "title": au.get("display_name"),
                "author": au.get("display_name"), "score": au.get("cited_by_count"),
                "num_comments": None, "created_utc": None,
                "url": au.get("orcid") or au.get("id"),
                "text": ", ".join(filter(None, inst)),
                "top_comments": [],
                "tags": [t.get("display_name") for t in (au.get("topics") or [])[:6]],
                "extra": {"openalex": au.get("id"), "orcid": au.get("orcid"),
                          "h_index": (au.get("summary_stats") or {}).get("h_index"),
                          "works_count": au.get("works_count")},
            })
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        pass
    # (2) ORCID public expanded-search (additive; confirms/augments the ORCID).
    try:
        url = ("https://pub.orcid.org/v3.0/expanded-search/?q="
               + urllib.parse.quote(q) + "&rows=2")
        data = await _get_json(client, url, headers={"Accept": "application/json"})
        for r in (data.get("expanded-result") or [])[:2]:
            oid = r.get("orcid-id")
            if not oid:
                continue
            name = r.get("credit-name") or " ".join(
                filter(None, [r.get("given-names"), r.get("family-names")]))
            items.append({
                "id": oid, "title": name, "author": name, "score": None,
                "num_comments": None, "created_utc": None,
                "url": f"https://orcid.org/{oid}", "text": "",
                "top_comments": [], "tags": (r.get("institution-name") or [])[:4],
                "extra": {"orcid": oid},
            })
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        pass
    # (3) ROR organizations — v2 schema: the display name is names[{types:["ror_display"]}],
    # NOT the deprecated top-level `name` (which reads undefined on v2).
    try:
        url = ("https://api.ror.org/organizations?query=" + urllib.parse.quote(q))
        data = await _get_json(client, url)
        for org in (data.get("items") or [])[:2]:
            disp = next((n.get("value") for n in (org.get("names") or [])
                         if "ror_display" in (n.get("types") or [])), None)
            if not disp:
                continue
            link = next((ln.get("value") for ln in (org.get("links") or [])), org.get("id"))
            items.append({
                "id": org.get("id"), "title": disp, "author": None, "score": None,
                "num_comments": None, "created_utc": None, "url": link or org.get("id"),
                "text": "", "top_comments": [], "tags": [],
                "extra": {"ror": org.get("id")},
            })
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        pass
    write_out("entity", vars(a), items, a.out)


# ───────────────────── Reddit (official OAuth Data API) ───────────────────
async def _reddit_token(client):
    """Application-only OAuth2 bearer for the Reddit Data API (D-10/D-13/D-16).

    POSTs client_credentials with HTTP Basic (client_id:client_secret) to
    reddit.com/api/v1/access_token and returns the bearer string, or None when
    REDDIT_CLIENT_ID/SECRET are absent (-> reddit() fails soft to [], D-17). The
    Basic-auth header + bearer are read from os.environ and used ONLY in request
    headers — never logged, never put in argv, never written to out/ (D-57)."""
    cid = os.environ.get("REDDIT_CLIENT_ID")
    sec = os.environ.get("REDDIT_CLIENT_SECRET")
    if not cid or not sec:
        return None
    ua = os.environ.get("REDDIT_USER_AGENT",
                        "python:research-scraper:1.0 (by /u/research-scraper)")
    basic = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    r = await client.post("https://www.reddit.com/api/v1/access_token",
                          data={"grant_type": "client_credentials"},
                          headers={"Authorization": f"Basic {basic}", "User-Agent": ua})
    r.raise_for_status()
    return r.json().get("access_token")


async def reddit(client, a):
    """The sanctioned routine-read Reddit path: the official OAuth Data API (HTTP, subagent-safe).

    Routing decision (REDDIT-01, Phase 14): OAuth is the default for routine reads *when an
    approved credential exists*; `reddit_scrape.py` (browser-harness) is the reserved, deliberate
    manual fallback — chosen because the core must be HTTP-only and browser-harness cannot run in
    a Donny subagent. Reddit's Responsible Builder Policy requires up-front approval (verified live
    2026-06-22: unauth `.json` 403s; the OAuth token endpoint needs a registered, approved token).
    The project holds no approved credential, so this stays fail-soft: absent `REDDIT_CLIENT_ID`/
    `REDDIT_CLIENT_SECRET` → a `[]` uniform envelope + a `no_key` status, never fatal (REDDIT-02/D-17).
    """
    # SRC-02 official OAuth Data API — always-on, HTTP, subagent-safe (D-10/D-11/D-15).
    # Site-wide relevance search; t=year window (OQ#4). The bearer + Basic-auth header
    # are passed ONLY to _get_json/_reddit_token request headers — NEVER to write_out
    # (which only receives vars(a), holding query/limit/out from argv, no secret) (D-57).
    tok = await _reddit_token(client)
    if not tok:
        print("[reddit] no REDDIT_CLIENT_ID/SECRET — skipping (fail-soft). Reddit's "
              "Responsible Builder Policy requires an approved OAuth credential (verified "
              "live 2026-06-22; the project holds none); reddit_scrape.py (browser-harness) "
              "remains the reserved, deliberate manual fallback for deep scrapes.",
              file=sys.stderr)
        return write_out("reddit", vars(a), [], a.out)        # [] envelope, never fatal (D-17)
    ua = os.environ.get("REDDIT_USER_AGENT",
                        "python:research-scraper:1.0 (by /u/research-scraper)")
    url = ("https://oauth.reddit.com/search?type=link&sort=relevance&t=year"
           f"&limit={a.limit}&q=" + urllib.parse.quote(a.query or ""))
    data = await _get_json(client, url, headers={"Authorization": f"bearer {tok}", "User-Agent": ua})
    items = []
    for child in (data.get("data", {}).get("children", []))[:a.limit]:
        d = child.get("data") or {}
        permalink = d.get("permalink")
        items.append({"id": d.get("name"), "title": d.get("title"),
                      "author": d.get("author"), "score": d.get("ups"),
                      "num_comments": d.get("num_comments"),
                      "created_utc": d.get("created_utc"),
                      "url": ("https://www.reddit.com" + permalink)
                             if permalink else d.get("url"),
                      "text": (d.get("selftext") or "")[:4000], "top_comments": [],
                      "tags": [d.get("subreddit")] if d.get("subreddit") else [],
                      "extra": {"num_comments": d.get("num_comments"),
                                "created_utc": d.get("created_utc")}})
    write_out("reddit", vars(a), items, a.out)


def _synth_title(text: str, n: int = 100) -> str | None:
    # D-11-04: truncated display title from record.text first line; None if empty
    # (image/link-only post) so SC#2's "body empty → post sinks" fallback holds.
    stripped = (text or "").strip()
    first = stripped.splitlines()[0] if stripped else ""
    if not first:
        return None
    return first if len(first) <= n else first[: n - 1].rstrip() + "…"


def _strip_html(s: str) -> str:
    # HTML → plain text (extends the `medium` fetcher idiom, research.py:502): drop
    # tags, unescape entities, collapse whitespace. Used by the Discourse `blurb`,
    # which carries inline <span class=search-highlight> markup on multi-term matches.
    # Lazy in-function import keeps the import-light discipline.
    #
    # Block/line-break boundaries (</p>, <br>, </div>, </li>) become a SPACE so
    # multi-paragraph bodies stay word-separated; all other (inline) tags are dropped
    # with NO space so inline markup like `#<span>mcp</span>` collapses to `#mcp` and a
    # search-highlight span doesn't split a matched word (a plain "<[^>]+>"→space split
    # would inject "# mcp" / break highlighted terms). Pinned by the Discourse blurb test.
    import re, html
    text = s or ""
    text = re.sub(r"(?i)</?(?:p|div|li|ul|ol|blockquote|h[1-6])\b[^>]*>|<br\s*/?>", " ", text)
    text = re.sub("<[^>]+>", "", text)             # remaining inline tags → no space
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


# ── Discourse — per-instance /search.json?q= over an AI/ML allowlist (DISC-01/02) ──
# Keyless, query-honoring (NOT /latest.json|/tag/|/c/ feeds — honors the v1.0 lesson
# that deleted topic-blind feed sources). One call per instance per run; per-instance
# fail-soft so one gated/down instance never starves the others (≥2-instance DISC-01
# bar holds with headroom). Modeled on `bluesky`.
_DISCOURSE = ("community.openai.com", "discuss.huggingface.co", "forum.cursor.com")


async def discourse(client, a):
    items: list[dict] = []
    seen: set[tuple[str, int]] = set()             # (instance, topic_id) — dedup-by-topic across the fan-out
    for instance in _DISCOURSE:
        url = (f"https://{instance}/search.json?q="
               + urllib.parse.quote(a.query or ""))
        try:
            data = await _get_json(client, url)    # cached/throttled/retrying GET
        except httpx.HTTPError as e:               # per-instance fail-soft (no key to gate on)
            print(f"[discourse] {instance} failed ({e}) — skip", file=sys.stderr)
            continue
        topics_by_id = {t["id"]: t for t in data.get("topics", [])}
        for p in data.get("posts", []):            # posts[] are in server relevance order
            tid = p.get("topic_id")
            key = (instance, tid)
            if key in seen or tid not in topics_by_id:
                continue
            seen.add(key)
            t = topics_by_id[tid]
            items.append({
                "id": f"discourse:{instance}:{tid}",
                "title": t.get("title") or t.get("fancy_title"),
                "author": p.get("username"),
                "score": p.get("like_count"),         # popularity RRF signal only (gated, D-11-03)
                "num_comments": t.get("reply_count"),  # reply_count lives on the TOPIC
                "created_utc": p.get("created_at"),
                "url": f"https://{instance}/t/{t.get('slug')}/{tid}",  # topic-level → clean canonical_url (D-12-08)
                "text": _strip_html(p.get("blurb") or ""),  # query-matched excerpt → BM25/dense
                "top_comments": [],
                "tags": t.get("tags") or [],
                "extra": {"instance": instance, "category_id": t.get("category_id"),
                          "posts_count": t.get("posts_count"), "post_number": p.get("post_number")},
            })
    write_out("discourse", vars(a), items, a.out)     # total failure → [] envelope, never fatal


# ── RSS/Atom freshness tier — one logical source fans a curated allowlist (RSS-01..04) ──
# Anchor-aligned curated allowlist (D-13-02, live-verified 2026-06-22): GitHub
# releases.atom for the repos behind the dev/academic eval anchors (claude-code/mcp/
# llm-agents/rrf-hybrid-retrieval) + a few high-signal AI lab/Substack feeds. Feeds carry
# NO query — relevance is recovered downstream by BM25/dense + rank.py's REL_QUANTILE gate
# (RSS-02), exactly like the v1.0 lesson demanded (no topic-blind feed source survives raw;
# this one rides the relevance machinery). Per-feed fail-soft; one GET per feed per run
# through the spec-policy client (D-13-01 — feeds revalidate via 304, NOT force-cache).
_RSS_FEEDS = (
    # dev anchors (GitHub releases.atom — strongest anchor-aligned signal)
    "https://github.com/anthropics/claude-code/releases.atom",
    "https://github.com/modelcontextprotocol/python-sdk/releases.atom",
    "https://github.com/langchain-ai/langchain/releases.atom",
    "https://github.com/microsoft/autogen/releases.atom",
    "https://github.com/tokio-rs/tokio/releases.atom",
    # academic anchor (IR/retrieval — the rrf-hybrid-retrieval make-or-break, D-13-03)
    "https://github.com/castorini/pyserini/releases.atom",
    "https://github.com/beir-cellar/beir/releases.atom",
    "https://github.com/UKPLab/sentence-transformers/releases.atom",
    # lab/company blogs (cap items per feed — these carry 800–1000+ entries)
    "https://huggingface.co/blog/feed.xml",
    "https://openai.com/news/rss.xml",
    # high-signal AI newsletters/blogs
    "https://www.interconnects.ai/feed",
    "https://simonwillison.net/atom/everything/",
)
_RSS_ITEMS_PER_FEED = 8    # REL-03 per-feed item cap (was 25; HF/OpenAI feeds carry 800–1000+ → 8 newest/feed)
_RSS_TOTAL_CAP = 25        # REL-03 total-RSS ceiling: 12 feeds x 8 can't dominate the top-25; freshness-sorted slice (D-13-04 / F-14)


async def rss(client, a):
    # Curated RSS/Atom freshness tier (RSS-01..04). One logical source fans the allowlist;
    # per-feed fail-soft; thread-parse (sync feedparser off the fan-out, like transcripts.py);
    # feeds revalidate via the spec-policy transport (D-13-01). Modeled on `discourse`.
    import calendar
    import feedparser                                   # lazy in-fn (import-light; mirror transcripts.py)
    from urllib.parse import urlsplit
    items: list[dict] = []
    seen: set[str] = set()                              # dedup by entry id within this run
    for feed_url in _RSS_FEEDS:
        try:
            raw = await _get_rss(client, feed_url)      # NO X-Hishel-Ttl (D-13-01)
        except httpx.HTTPError as e:                    # per-feed fail-soft
            print(f"[rss] {feed_url} failed ({e}) — skip", file=sys.stderr)
            continue
        d = await asyncio.to_thread(feedparser.parse, raw)   # sanitize_html=True default (security)
        if d.bozo:                                      # int 0/1 — log but DO NOT discard if entries exist
            print(f"[rss] {feed_url} bozo ({getattr(d, 'bozo_exception', '')}) — "
                  f"{len(d.entries)} entries", file=sys.stderr)
        if not d.entries:                               # skip only when truly empty
            continue
        host = urlsplit(feed_url).hostname or ""
        feed_title = (d.feed.get("title") if getattr(d, "feed", None) else None)
        for e in d.entries[:_RSS_ITEMS_PER_FEED]:
            eid = e.get("id") or e.get("link")
            if not eid or eid in seen:
                continue
            seen.add(eid)
            st = e.get("published_parsed") or e.get("updated_parsed")
            created_utc = calendar.timegm(st) if st else None   # UTC struct_time → epoch; NEVER time.mktime
            body = ""
            if e.get("content"):                        # entry.content is a LIST
                body = e.content[0].get("value") or ""
            if not body:
                body = e.get("summary") or ""
            tags = [t.get("term") for t in e.get("tags", []) if t.get("term")]
            items.append({
                "id": f"rss:{host}:{eid}",
                "title": e.get("title") or _synth_title(_strip_html(body)),
                "author": e.get("author"),
                "score": None,                          # RSS has no popularity signal (RSS-04 / FUSE-01)
                "num_comments": None,
                "created_utc": created_utc,             # recency RRF signal
                "url": e.get("link"),
                "text": _strip_html(body),              # plain text → BM25/dense
                "top_comments": [],
                "tags": tags,
                "extra": {"feed_title": feed_title, "feed_url": feed_url},
            })
    # REL-03 total-RSS cap: 12 feeds x 8 still stacks → freshness-sort (RSS has no
    # `score`; newest first, None last) and slice to _RSS_TOTAL_CAP so the curated
    # feeds can't flood the merged top-25 on an off-theme query (F-14). The per-query
    # BM25 REL_QUANTILE floor in rank.py remains the relevance gate (no new constant).
    items.sort(key=lambda it: (it.get("created_utc") is None, -(it.get("created_utc") or 0)))
    items = items[:_RSS_TOTAL_CAP]
    write_out("rss", vars(a), items, a.out)             # total failure → [] envelope, never fatal


async def bluesky(client, a):
    # AT Protocol public AppView searchPosts — keyless, HTTP, subagent-safe (BSKY-01).
    # ONE UNCURSORED call: &cursor= returns 403 on the AppView (atproto#2838); the larger
    # pool (D-11-05, sized in the registry thunk) is the only recall lever. sort default is
    # 'latest' per the lexicon, so 'top' MUST be explicit (engagement-weighted; relevance is
    # recovered downstream by BM25/dense + rank.py REL_QUANTILE — D-11-03: likeCount rides
    # score as a POPULARITY signal only, never a floor). lang is a single string (NOT array).
    url = ("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?sort=top&lang=en"
           f"&limit={min(a.limit, 100)}&q=" + urllib.parse.quote(a.query or ""))
    try:
        data = await _get_json(client, url)            # cached/throttled/retrying GET
    except httpx.HTTPError as e:                        # news-style fail-soft (no key to gate on)
        print(f"[bluesky] searchPosts failed ({e}) — fail-soft to []", file=sys.stderr)
        return write_out("bluesky", vars(a), [], a.out)  # [] envelope, never fatal (BSKY-03)
    items = []
    for p in data.get("posts", [])[:a.limit]:
        rec = p.get("record") or {}
        if "en" not in (rec.get("langs") or ["en"]):    # D-11-02 defensive guard (lang=en already filters)
            continue
        author = p.get("author") or {}
        handle = author.get("handle")
        uri = p.get("uri") or ""
        rkey = uri.rsplit("/", 1)[-1] if uri else ""
        body = rec.get("text") or ""
        permalink = (f"https://bsky.app/profile/{handle}/post/{rkey}"
                     if handle and rkey else None)
        items.append({
            "id": uri or p.get("cid"),
            "title": _synth_title(body),               # None if empty (D-11-04 / SC#2)
            "author": handle,
            "score": p.get("likeCount"),               # popularity RRF signal ONLY (D-11-03)
            "num_comments": p.get("replyCount"),
            "created_utc": p.get("indexedAt"),          # recency signal
            "url": permalink,
            "text": body,                              # FULL body → BM25/dense (D-11-04)
            "top_comments": [],
            "tags": rec.get("tags") or [],
            "extra": {"repostCount": p.get("repostCount"), "quoteCount": p.get("quoteCount"),
                      "bookmarkCount": p.get("bookmarkCount"), "cid": p.get("cid"),
                      "did": author.get("did"), "langs": rec.get("langs")},
        })
    write_out("bluesky", vars(a), items, a.out)


def build_parser():
    p = argparse.ArgumentParser(description="Multi-source project research (open APIs)")
    sub = p.add_subparsers(dest="cmd", required=True)
    common = dict()
    for name, fn in [("hn", hn), ("devto", devto), ("arxiv", arxiv),
                     ("stackoverflow", stackoverflow), ("github", github),
                     ("brave", brave), ("reddit", reddit), ("youtube", youtube),
                     ("news", news), ("bluesky", bluesky),
                     ("discourse", discourse),
                     ("lobsters", lobsters), ("medium", medium),
                     ("huggingface", huggingface), ("npm", npm),
                     ("openalex", openalex), ("semanticscholar", semanticscholar),
                     ("europepmc", europepmc), ("entity", entity),
                     ("ddg", ddg)]:
        sp = sub.add_parser(name)
        sp.add_argument("--limit", type=int, default=30)
        sp.add_argument("--days", type=int, default=30)
        sp.add_argument("--query", default="")
        sp.add_argument("--tag", default="")
        sp.add_argument("--category", default="")
        sp.add_argument("--comments", type=int, default=0)
        sp.add_argument("--answers", type=int, default=0)
        sp.add_argument("--out", default="")
        sp.set_defaults(func=fn)
    return p


if __name__ == "__main__":
    # Load a project/CWD .env into os.environ ONCE at startup (ROB-07 / D-22), without
    # clobbering already-exported vars (override=False). Every os.environ.get(...) source
    # read is unchanged — dotenv just pre-populates. usecwd=True = deterministic discovery
    # (the no-arg form walks the caller frame and is fragile — 05-01 finding).
    from dotenv import find_dotenv, load_dotenv
    load_dotenv(find_dotenv(usecwd=True), override=False)
    args = build_parser().parse_args()
    if not args.out:
        args.out = None

    # Async-dispatch shim (D-05, ROB-08): build_parser's set_defaults(func=fn) now points at
    # `async def source(client, a)` coroutines, so the CLI awaits the chosen source over a
    # throwaway per-invocation httpx.AsyncClient — `python3 research.py <source> --query "..."`
    # keeps working unchanged. This CLI client is plain httpx (no hishel cache — caching is a
    # research_topic.run concern); the per-host limiter is created lazily in research._get.
    async def _main():
        async with httpx.AsyncClient(headers={"User-Agent": UA}) as c:
            await args.func(c, args)
    asyncio.run(_main())
