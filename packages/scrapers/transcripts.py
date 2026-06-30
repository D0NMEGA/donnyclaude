"""YouTube caption/transcript enrichment (ENRICH-01/02): the spoken-content signal.

A clean mirror of ``dense.py``'s contract — an OPTIONAL capability with a LAZY
heavy import and a degrade-to-unchanged guarantee. ``research.youtube()`` calls
``await enrich(items)`` after the Data API v3 search builds items and BEFORE
``write_out``; the transcript is stored on ``extra.transcript`` and rank.py scores it
as a SEPARATE field, keeping ``max(score(title+desc), score(transcript))`` for BM25
(rank.py) AND the dense cosine (active on the consumer/general tiers where YouTube
fires — routing.py). The transcript is a relevance INPUT that can only RAISE an item's
score, never lower it — appending it into ``text`` instead diluted term density (BM25
length-normalization) and unfocused the embedding, DEMOTING well-described videos (the
Phase 10 regression finding: the #1 official tutorial fell out of the top-10). It is
not a new RRF list — the lift is richer per-field evidence, max-combined (10-RESEARCH
§ Pattern 2; Phase 10 fix).

Holds the HEAVY transcript stack LAZILY (``from youtube_transcript_api import
…`` lives INSIDE ``_fetch_text``) exactly as ``dense._get_model`` holds
``from model2vec import StaticModel`` — so the import-light eval runner
(``research_topic → research → transcripts``) never pulls
``youtube_transcript_api``/``requests``/``defusedxml`` into a Donny subagent's
``sys.modules`` (ENRICH-02/SC#4; the AST guard + the runtime ``sys.modules`` net
both enforce this). ``research.py`` may ``import transcripts`` at module top ONLY
because this module keeps that heavy import in-function.

Three bounds keep a hanging/slow fetch from dominating the run's wall-clock
(T-10-03, the phase's primary MEDIUM+ threat): (1) a per-call
``asyncio.wait_for(asyncio.to_thread(_fetch_text), _PER_CALL)``; (2) an outer
``asyncio.wait_for(gather, _BUDGET)``; (3) a ``requests.Session`` socket
``timeout`` shim — because a cancelled ``to_thread`` does NOT kill the OS thread
running blocking ``requests`` (Pitfall 7), the socket timeout is what actually
frees it. Plus a top-``_TOPN`` cap so only N videos are ever fetched.

Fully fail-soft: ``CouldNotRetrieveTranscript`` (the library's common base for
disabled / missing / unavailable / IP-blocked / PoToken-required / unparsable),
``requests.exceptions.RequestException``, and ``asyncio.TimeoutError`` all
degrade that item to description-only — ``enrich`` NEVER raises and the run
completes unchanged. Datacenter IPs (CI / Donny subagents) are reliably blocked, so
a high miss-rate degrading gracefully is by design (the value lands on the
operator's residential machine); no bare ``except`` anywhere (project rule).

Caching reconciliation (ENRICH-02 literally says "cached (hishel)"): ``hishel``
is an httpx-only RFC-9111 transport and ``youtube-transcript-api`` is
``requests``-based, so hishel cannot wrap it. The chosen realization is an
app-level ``video_id → {text, fetched}`` cache in ``out/yt_transcripts.sqlite``
(stdlib ``sqlite3``, gitignored like the hishel store, 30-day TTL) — it caches
the FINAL artifact we actually reuse and is byte-stable for warm CLI runs,
realizing ENRICH-02's caching intent in full (10-RESEARCH § Caching, option #1).
"""
from __future__ import annotations

import asyncio
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

# Local secret-scrub for the D-15-04 stderr summary (Pitfall 4 / D-57 / T-15-04). Kept
# self-contained (import-light: do NOT import research_topic) — a verbatim copy of its
# _SECRET_RE/_scrub (research_topic.py:281-286); the pattern already matches ``x-api-key``
# (the Supadata header) + ``bearer``/``basic``/``token``/``x-subscription-token`` so a
# credential can never reach stderr/out/. The summary itself reports only counts + typed
# failure NAMES (never values), so this is belt-and-braces.
_SECRET_RE = re.compile(
    r"(?i)(bearer|basic|token|x-api-key|x-subscription-token)\s*[:=]?\s*\S+"
)


def _scrub(s: str) -> str:
    return _SECRET_RE.sub(r"\1 [redacted]", s)

# Env-overridable knobs (defaults from 10-RESEARCH § Bounding). Phase 9 (a shared
# per-source budget primitive) is NOT YET BUILT, so Phase 10 carries its own
# self-contained bound here, structured to delegate to Phase 9's budget later.
_CACHE = Path(__file__).resolve().parent / "out" / "yt_transcripts.sqlite"  # gitignored (out/)
_TTL = int(os.environ.get("RESEARCH_YT_TRANSCRIPT_TTL", str(30 * 86400)))  # transcripts are stable
_TOPN = int(os.environ.get("RESEARCH_YT_TRANSCRIPT_TOPN", "4"))  # enrich the top-N hits only
_PER_CALL = float(os.environ.get("RESEARCH_YT_TRANSCRIPT_TIMEOUT", "8"))  # per-fetch wall-clock + socket
_BUDGET = float(os.environ.get("RESEARCH_YT_TRANSCRIPT_BUDGET", "20"))  # total wall-clock ceiling
_CAP = int(os.environ.get("RESEARCH_YT_TRANSCRIPT_CHARS", "3000"))  # appended char cap (Pitfall 4)
_ENABLED = os.environ.get("RESEARCH_YT_TRANSCRIPTS", "1") != "0"  # master enable (set 0 to disable)

# Proxy/hosted HOOK env knobs (Phase 15, D-15-01/02/03; RESEARCH § Pattern 2). These are
# DELIBERATELY NOT module-level constants: every gate below is read at CALL TIME via
# ``os.environ.get(...)`` INSIDE the functions, so monkeypatch.delenv/setenv in the Plan-01
# no-op tests take effect and the rungs are skipped/attempted per the live env. With NONE of
# these set, ONLY the local rung fires → byte-identical to Phase 10 (D-15-01). All credentials
# are read from env ONLY — never argv, never logged, never written to out/ (D-57 / T-15-04).
#   WEBSHARE_PROXY_USERNAME + WEBSHARE_PROXY_PASSWORD  → Webshare residential proxy (primary; wins
#                                                        over generic when both are set, D-15-02)
#   RESEARCH_YT_PROXY_URL                              → GenericProxyConfig escape hatch (one HTTPS URL)
#   RESEARCH_YT_HOSTED_URL + RESEARCH_YT_HOSTED_KEY    → generic hosted hook (Supadata worked example)
#   RESEARCH_YT_HOSTED_FIELD                           → hosted response field override (default "content")

# Type-name → short diagnostic for the D-15-04 stderr summary + per-item failure marker
# (RESEARCH § Code Examples: one tuple + a name lookup is the recommended taxonomy granularity).
# Plain strings — no heavy import. The named types all inherit ``CouldNotRetrieveTranscript`` so the
# fail-soft floor is guaranteed by the base; this map is for DISTINGUISHING them in diagnostics.
_REASON = {
    "IpBlocked": "datacenter IP blocked",  # ⊂ RequestBlocked — try proxy/hosted next
    "RequestBlocked": "request blocked",  # try proxy/hosted next
    "PoTokenRequired": "PoToken required",  # try proxy/hosted next (NO side-car — deferred YTX-F1)
    "TranscriptsDisabled": "captions disabled",  # no retry helps → floor
    "AgeRestricted": "age restricted",  # no retry helps → floor
}


def _fetch_text(video_id: str) -> str | None:
    """BLOCKING. The LOCAL rung — full English transcript text via the direct
    ``youtube-transcript-api`` fetch, or None on ANY retrieval/transport failure
    (fail-soft). The heavy library import is LAZY here (ENRICH-02/SC#4) so it never lands
    in the import-light runner's ``sys.modules``; a ``requests``-level timeout shim bounds
    the actual socket (Pitfall 2/7 — a cancelled ``to_thread`` does not kill this OS thread).
    Catches ONLY the specific retrieval/transport exceptions — no bare except, no
    ``except Exception``.

    This is the stable monkeypatch surface the unit tests target; :func:`_fetch_text_detail`
    drives the local rung through it (so patching ``_fetch_text`` exercises the whole ladder's
    local step), then adds the proxy/hosted rungs + the served-path/failure-name diagnostics."""
    from youtube_transcript_api import (  # LAZY (SC#4): only when the live fetch path runs
        CouldNotRetrieveTranscript,
        YouTubeTranscriptApi,
    )
    import requests

    class _TimeoutSession(requests.Session):  # bound the actual socket (Pitfall 2/7)
        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", _PER_CALL)
            return super().request(*args, **kwargs)

    try:
        ft = YouTubeTranscriptApi(http_client=_TimeoutSession()).fetch(
            video_id, languages=("en",)
        )
        return " ".join(s.text for s in ft).strip() or None
    except (CouldNotRetrieveTranscript, requests.exceptions.RequestException):
        return None  # degrade: this video keeps title+description, the run continues


def _fetch_text_detail(video_id: str) -> tuple[str | None, str | None, str | None]:
    """BLOCKING. Run the locked ``local → proxy → hosted`` ladder (D-15-01), attempting
    ONLY rungs whose env/key is set, degrading each typed failure to the next rung and
    finally to the title+description floor. Returns ``(text, served_path, failure_name)``:
      * a served transcript → ``(text, "local"|"proxy"|"hosted", None)``
      * the floor           → ``(None, None, <last typed-failure name or None>)``

    The LOCAL rung delegates to :func:`_fetch_text` (the monkeypatch surface) — so patching
    ``_fetch_text`` exercises the local step here unchanged; it raises a typed retrieval error
    (which this ladder catches) or returns None/text. The proxy/hosted rungs import the heavy
    library + proxy classes + ``requests`` LAZILY (import-light/YTX-01) so they never land in
    the eval runner's ``sys.modules``; a ``requests``-level socket-timeout shim bounds the
    actual socket on the proxy rung (Pitfall 2/7 — a cancelled ``to_thread`` does not kill this
    OS thread). Every rung's fetch is wrapped in ONE explicit typed ``except`` tuple over the
    five named exceptions + the ``CouldNotRetrieveTranscript`` base backstop + ``requests``
    transport error — NO bare except, NO ``except Exception``.

    Only paths whose env/key is set are attempted, so with NO hook env set ONLY the local rung
    fires → byte-identical to Phase 10. ``TranscriptsDisabled``/``AgeRestricted`` cannot be
    helped by a proxy/hosted retry (the uploader disabled captions / the video is age-gated),
    so on those the ladder short-circuits straight to the floor (RESEARCH § Version-Pin Verdict)."""
    from youtube_transcript_api import (  # LAZY (SC#4): only when the live fetch path runs
        AgeRestricted,
        CouldNotRetrieveTranscript,  # base backstop for any unnamed subtype
        IpBlocked,
        PoTokenRequired,
        RequestBlocked,
        TranscriptsDisabled,
        YouTubeTranscriptApi,
    )
    from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig  # LAZY
    import requests  # LAZY — socket shim + hosted call

    class _TimeoutSession(requests.Session):  # bound the actual socket (Pitfall 2/7)
        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", _PER_CALL)
            return super().request(*args, **kwargs)

    # ONE explicit typed except tuple — no bare except, no `except Exception`. The named
    # subtypes are listed for self-documentation; the base catches any unnamed subtype.
    _CAUGHT = (
        RequestBlocked,
        IpBlocked,
        PoTokenRequired,
        TranscriptsDisabled,
        AgeRestricted,
        CouldNotRetrieveTranscript,  # base — covers any unnamed retrieval failure
        requests.exceptions.RequestException,  # transport (incl. socket timeout)
    )

    failure: str | None = None

    # ── Rung a: LOCAL (always attempted — via _fetch_text, the monkeypatch surface) ───
    try:
        text = _fetch_text(video_id)
        if text:
            return (text, "local", None)
    except _CAUGHT as e:  # _fetch_text already swallows these, but a patched one may raise
        failure = type(e).__name__

    # ── Rung b: SHORT-CIRCUIT — captions disabled / age-restricted can't be helped ────
    # A proxy/hosted retry cannot recover these (the uploader disabled captions; the video
    # is age-gated), so skip the remaining rungs and degrade straight to the floor.
    if failure in ("TranscriptsDisabled", "AgeRestricted"):
        return (None, None, failure)

    # ── Rung c: PROXY (only if configured — Webshare wins over generic, D-15-02) ──────
    if os.environ.get("WEBSHARE_PROXY_USERNAME") and os.environ.get("WEBSHARE_PROXY_PASSWORD"):
        proxy_config = WebshareProxyConfig(
            proxy_username=os.environ["WEBSHARE_PROXY_USERNAME"],
            proxy_password=os.environ["WEBSHARE_PROXY_PASSWORD"],
        )  # Webshare wins
    elif os.environ.get("RESEARCH_YT_PROXY_URL"):
        url = os.environ["RESEARCH_YT_PROXY_URL"]
        proxy_config = GenericProxyConfig(http_url=url, https_url=url)
    else:
        proxy_config = None  # proxy rung not configured → skip

    if proxy_config is not None:
        try:
            ft = YouTubeTranscriptApi(
                proxy_config=proxy_config, http_client=_TimeoutSession()
            ).fetch(video_id, languages=("en",))
            text = " ".join(s.text for s in ft).strip() or None
            if text:
                return (text, "proxy", None)
        except _CAUGHT as e:
            failure = type(e).__name__

    # ── Rung d: HOSTED (only if configured — generic hook, Supadata default field-map) ─
    if os.environ.get("RESEARCH_YT_HOSTED_URL") and os.environ.get("RESEARCH_YT_HOSTED_KEY"):
        try:
            text = _fetch_hosted(video_id)
            if text:
                return (text, "hosted", None)
        except _CAUGHT as e:  # hosted transport errors degrade like any other rung
            failure = type(e).__name__

    # ── Rung e: FLOOR — every configured rung failed/empty → title+description only ───
    return (None, None, failure)


def _fetch_hosted(video_id: str) -> str | None:
    """Provider-agnostic hosted transcript hook (D-15-03), DORMANT unless configured.

    Worked example: Supadata — ``GET https://api.supadata.ai/v1/youtube/transcript``,
    header ``x-api-key``, params ``videoId`` + ``text=true`` + ``lang``, top-level
    ``"content"`` string. Point a different provider at it via
    ``RESEARCH_YT_HOSTED_URL``/``_KEY``/``_FIELD``. Returns None when unconfigured
    (zero HTTP — the env check returns BEFORE importing ``requests`` and BEFORE any
    call, so the dormant no-op makes zero ``requests.get`` calls) or on any
    non-string/empty result.

    The provider JSON is untrusted external data (V5 / T-15-05): it is parsed defensively
    (``isinstance(data, dict)`` then ``isinstance(val, str/list)`` before use, list-segment
    ``isinstance(seg, dict)``) so malformed/garbage JSON returns None rather than raising;
    transport errors / ``raise_for_status`` raise ``requests.exceptions.RequestException``,
    which :func:`_fetch_text_detail` wraps in its typed except → degrade to the floor.

    Secret hygiene (D-57): the API key is read from env ONLY (never argv/logged/written to
    ``out/``). HTTPS is the operator's responsibility — do NOT downgrade to a plaintext base
    (V6); SSRF via ``RESEARCH_YT_HOSTED_URL`` is accepted for this single-operator local tool
    (T-15-07). Live verification of the Supadata shape is the future req YTX-F1, e.g.:
        curl -H "x-api-key: $RESEARCH_YT_HOSTED_KEY" \\
          "https://api.supadata.ai/v1/youtube/transcript?videoId=VID&text=true&lang=en"
    """
    import os

    base = os.environ.get("RESEARCH_YT_HOSTED_URL")
    key = os.environ.get("RESEARCH_YT_HOSTED_KEY")
    if not base or not key:
        return None  # hosted path not configured → skip rung, zero HTTP

    import requests  # LAZY (import-light) — only reached when the hook is configured

    field = os.environ.get("RESEARCH_YT_HOSTED_FIELD", "content")
    resp = requests.get(
        base,
        params={"videoId": video_id, "text": "true", "lang": "en"},  # Supadata params
        headers={"x-api-key": key},  # Supadata auth header
        timeout=_PER_CALL,  # socket bound (Pitfall 2/7)
    )
    resp.raise_for_status()
    data = resp.json()
    val = data.get(field) if isinstance(data, dict) else None  # defensive (V5: untrusted JSON)
    if isinstance(val, str):
        return val.strip() or None
    if isinstance(val, list):  # text=false / other providers: list of {"text": ...} segments
        return " ".join(seg.get("text", "") for seg in val if isinstance(seg, dict)).strip() or None
    return None


def _fetch_errors() -> tuple[type[BaseException], ...]:
    """The retrieval/transport exception tuple ``enrich`` degrades on, imported
    LAZILY (SC#4) so the type references never land in the import-light runner's
    sys.modules. ``_fetch_text`` already swallows these, but a monkeypatched (or
    future direct) ``_fetch_text`` may RAISE them — ``enrich`` must stay fail-soft
    around the per-call fetch itself, catching ONLY this specific surface (no bare
    except, no ``except Exception``). If the library is unavailable, degrade to the
    requests/timeout surface alone (``ImportError`` → still no broad catch)."""
    surface: tuple[type[BaseException], ...] = (asyncio.TimeoutError,)
    try:
        from youtube_transcript_api import (  # LAZY (SC#4)
            AgeRestricted,
            CouldNotRetrieveTranscript,
            IpBlocked,
            PoTokenRequired,
            RequestBlocked,
            TranscriptsDisabled,
        )

        # The named subtypes all inherit CouldNotRetrieveTranscript (so the base alone already
        # covers them); listing them is belt-and-braces + self-documenting (Task 1 step 6). Still
        # an explicit tuple — no bare except, no `except Exception`.
        surface += (
            RequestBlocked,
            IpBlocked,
            PoTokenRequired,
            TranscriptsDisabled,
            AgeRestricted,
            CouldNotRetrieveTranscript,
        )
    except ImportError:
        pass
    try:
        import requests

        surface += (requests.exceptions.RequestException,)
    except ImportError:
        pass
    return surface


def _conn() -> sqlite3.Connection:
    """Open the app-level transcript cache (creating the dir + table if absent)."""
    _CACHE.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(_CACHE))
    c.execute("CREATE TABLE IF NOT EXISTS t (vid TEXT PRIMARY KEY, text TEXT, fetched REAL)")
    return c


def _cached(video_id: str) -> str | None:
    """Return the cached transcript for ``video_id`` if present and within _TTL,
    else None. PARAMETERIZED query only — ``video_id`` is the 11-char Data-API key,
    never string-built into SQL, never used as a path (T-10-06)."""
    with _conn() as c:
        row = c.execute("SELECT text, fetched FROM t WHERE vid = ?", (video_id,)).fetchone()
    if row and (time.time() - row[1]) < _TTL:
        return row[0]
    return None


def _store(video_id: str, text: str) -> None:
    """UPSERT a fetched transcript into the cache (parameterized; T-10-06)."""
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO t (vid, text, fetched) VALUES (?, ?, ?)",
            (video_id, text, time.time()),
        )


async def enrich(items: list[dict]) -> list[dict]:
    """Attach transcripts to the top-N items as a SEPARATE ``extra.transcript`` field
    (immutable rebuild), bounded and fail-soft. Returns items UNCHANGED when disabled /
    no transcript / blocked / timed out — the run never fails.

    Each enriched item is a NEW dict (project coding-style: never mutate input): the
    transcript is stored on ``extra.transcript`` (capped at ``_CAP``), NOT appended to
    ``text`` — rank.py scores it as its own field and keeps ``max(title+desc, transcript)``
    so spoken content can only RAISE an item's relevance/dense score, never lower it (the
    Phase 10 regression fix). ``extra.transcript_chars`` records the stored length and
    ``extra.transcript_source`` the serving rung (``"local"|"proxy"|"hosted"|"cache"``);
    items that fell to the floor are returned BYTE-IDENTICAL (no extra fields added — the
    no-transcript fixture path must stay unchanged). Only the first ``_TOPN`` items with an
    ``id`` are fetched; a warm ``_cached`` hit avoids the fetch AND short-circuits the whole
    ladder (one fetch per video across runs). The whole fan-out is wrapped in an outer
    ``asyncio.wait_for(_BUDGET)`` backstop. Only ``asyncio.TimeoutError`` is caught here
    (the fetch's own failures already degrade to None) — no bare except.

    D-15-04 observability rides STDERR + ``extra`` ONLY (never the digest JSON/markdown, so
    the digest artifact + the frozen-P@10 fixture path stay byte-identical): after the fan-out,
    if ANY non-cache rung was attempted (so the no-fetch fixture/benchmark path stays SILENT),
    ONE scrubbed per-run line is printed to stderr mirroring research_topic.py:358 —
    e.g. ``  transcripts: 3/4 served (1 datacenter IP blocked)``."""
    if not _ENABLED or not items:
        return items

    fetch_errors = _fetch_errors()  # lazy retrieval/transport surface (incl. TimeoutError)

    # Per-run D-15-04 diagnostics, accumulated across the fan-out. ``attempted`` counts ONLY
    # non-cache (live) rungs — a run where every top-N item is a warm cache hit (or YouTube
    # never fires, e.g. the 10-topic benchmark) leaves attempted==0 → the stderr line is
    # suppressed and the eval/fixture path stays silent + byte-identical. Kept as separate
    # typed locals (not one heterogeneous dict) so the static type-checker stays clean.
    counts: dict[str, int] = {"served": 0, "attempted": 0}
    failures: dict[str, int] = {}

    async def _one(idx_item: tuple[int, dict]) -> dict:
        i, it = idx_item
        vid = it.get("id")
        if i >= _TOPN or not vid:
            return it
        text = _cached(vid)
        source = "cache"
        if text is None:
            counts["attempted"] += 1  # a live (non-cache) rung is about to run
            failure: str | None = None
            try:
                text, served, failure = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_text_detail, vid), _PER_CALL
                )
                source = served or "local"
            except fetch_errors:
                # per-call bound (asyncio.TimeoutError) OR a retrieval/transport error
                # raised by the detail helper itself → this video stays description-only.
                # (_fetch_text_detail normally degrades to (None, None, name) without raising;
                # this outer guard keeps enrich fail-soft even if it ever raises.)
                text = None
                failure = "timeout"
            if text:
                _store(vid, text)
            else:
                # record the typed failure (or the timeout) for the per-run summary
                reason = _REASON.get(failure, failure) if failure else None
                if reason:
                    failures[reason] = failures.get(reason, 0) + 1
        if not text:
            return it  # degrade: description-only, item BYTE-IDENTICAL (no extra fields added)
        counts["served"] += 1
        clipped = text[:_CAP]  # bound the stored transcript field (Pitfall 4 / dense dilution)
        return {
            **it,
            # Store the transcript as a SEPARATE field — do NOT append it to ``text``.
            # rank.py scores it as its own field and keeps ``max(title+desc, transcript)``,
            # so spoken content can only RAISE an item's relevance/dense score, never lower
            # it. Appending the transcript into ``text`` made ``rank._doc_text`` long and
            # unfocused and DEMOTED well-described videos (BM25 length-normalization +
            # dense-embedding dilution — the Phase 10 regression finding; the #1 official
            # tutorial fell out of the top-10). ``text`` stays the clean Data-API description.
            # ``transcript_source`` (the serving rung) rides ``extra`` ONLY (D-15-04) — never
            # the digest JSON/markdown, so the artifact stays byte-identical.
            "extra": {
                **it.get("extra", {}),
                "transcript": clipped,
                "transcript_chars": len(clipped),
                "transcript_source": source,
            },
        }

    try:
        out = await asyncio.wait_for(
            asyncio.gather(*(_one((i, it)) for i, it in enumerate(items))), _BUDGET
        )
    except asyncio.TimeoutError:
        out = items  # budget blown → leave items unchanged (description-only)

    # D-15-04 per-run stderr summary — rides stderr ONLY, scrubbed, and SUPPRESSED on the
    # no-fetch path (attempted==0) so the frozen 10-topic benchmark / fixture replay stays
    # silent + byte-identical. Mirrors research_topic.py:358 (two leading spaces, file=sys.stderr).
    if counts["attempted"]:
        summary = f"  transcripts: {counts['served']}/{counts['attempted']} served"
        if failures:
            summary += " (" + ", ".join(
                f"{n} {r}" for r, n in sorted(failures.items())
            ) + ")"
        print(_scrub(summary), file=sys.stderr)

    return out
