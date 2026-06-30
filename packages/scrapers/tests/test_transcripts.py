"""RED unit spec for transcripts.enrich (created GREEN in Plan 10-02).

These tests are RED *now*: the ``transcripts`` module does not exist yet
(``import transcripts`` -> ModuleNotFoundError at collection). Plan 10-02 creates
``transcripts.py`` (mirroring dense.py: optional capability, lazy heavy import,
degrade-to-unchanged contract) and turns every test here GREEN — the selectors
and assertions do not move across the wave boundary, only the red->green state.

Contract pinned (10-RESEARCH § Code Examples -> transcripts.py; § Validation
Architecture -> the 5 unit dimensions):
  async def enrich(items: list[dict]) -> list[dict]
    * doc_text  — stores the transcript on the SEPARATE ``extra.transcript`` field
      (NOT appended into ``text``); rank.py scores it as its own field and keeps
      ``max(title+desc, transcript)`` so spoken content can only RAISE a score, never
      demote a well-described video (Phase 10 regression fix); records
      ``extra.transcript_chars``; ``text`` stays the clean description
    * fail_soft — ANY retrieval/transport failure (TranscriptsDisabled / IpBlocked /
      requests.Timeout / ...) degrades that item to description-only; ``enrich`` never
      raises and the run completes
    * budget    — a hanging fetch cannot exceed the wall-clock budget; on a blown
      budget the items come back unchanged (asyncio.TimeoutError swallowed)
    * cache     — a second ``enrich`` for the same video_id hits the sqlite cache
      (``_fetch_text`` is called once, not twice)
    * immutable — ``enrich`` returns NEW dicts and never mutates the input items
      (project coding-style: never mutate)

OFFLINE + byte-deterministic: every test monkeypatches ``transcripts._fetch_text``
so there is NO live network and NO ``youtube_transcript_api`` import at test time
(the library import stays lazy inside the production ``_fetch_text``; SC#4). No bare
``except:`` anywhere (project CLAUDE.md / cross-session do-not-repeat).
"""
from __future__ import annotations

import copy
import time

import pytest

import transcripts  # RED until Plan 10-02 creates transcripts.py (ModuleNotFoundError on collection)


def _items(text: str = "thin desc", vid: str = "vid1") -> list[dict]:
    """One YouTube-shaped item (the write_out envelope shape research.youtube() builds)."""
    return [{"id": vid, "title": "thin title", "text": text, "url": "https://y/v", "extra": {}}]


# ── doc_text (10-02-01) ───────────────────────────────────────────────────────
async def test_enrich_doc_text_stores_transcript_field(monkeypatch):
    """Transcript text is stored on the SEPARATE ``extra.transcript`` field (rank.py
    scores it as its own field and keeps max(title+desc, transcript), so the spoken
    content can only RAISE a score, never demote a well-described video — the Phase 10
    regression fix). ``text`` stays the clean description; the char count is recorded."""
    transcript = "spoken keyword content"
    monkeypatch.setattr(transcripts, "_fetch_text", lambda _vid: transcript)
    # Defeat the cache so _fetch_text is what supplies the text (not a warm row).
    monkeypatch.setattr(transcripts, "_cached", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_store", lambda _vid, _txt: None)

    out = await transcripts.enrich(_items("thin desc"))

    assert out[0]["extra"]["transcript"] == transcript, "transcript stored on its own field"
    assert out[0]["text"] == "thin desc", "text stays the clean description (NOT appended)"
    assert out[0]["extra"]["transcript_chars"] == len(transcript)


# ── fail_soft (10-02-03) ──────────────────────────────────────────────────────
def _build_error(exc_cls):
    """Construct a youtube_transcript_api exception defensively.

    Some take a ``video_id`` (and more) constructor arg; if the signature is awkward
    we fall back to a no-arg construction. Either way the load-bearing assertion is
    the run-completes-unchanged guarantee, not the exact ctor shape.
    """
    try:
        return exc_cls("vid1")
    except TypeError:
        return exc_cls()


@pytest.mark.parametrize(
    "exc_name",
    [
        "TranscriptsDisabled",
        "IpBlocked",
        "requests_timeout",
        "RequestBlocked",
        "PoTokenRequired",
        "AgeRestricted",
    ],
)
async def test_enrich_fail_soft_each_error(monkeypatch, exc_name):
    """A blocked/disabled/timed-out fetch degrades to description-only; enrich never raises.

    ``_fetch_text`` is patched to RAISE (bypassing its own try/except) so we exercise
    enrich's outer fail-soft guarantee directly. The exception classes are imported in
    THIS test module (fine — only the PRODUCTION module must keep them lazy)."""
    if exc_name == "requests_timeout":
        import requests
        err = requests.exceptions.Timeout("simulated socket timeout")
    else:
        import youtube_transcript_api as yta
        err = _build_error(getattr(yta, exc_name))

    def _raise(_vid):
        raise err

    monkeypatch.setattr(transcripts, "_fetch_text", _raise)
    monkeypatch.setattr(transcripts, "_cached", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_store", lambda _vid, _txt: None)

    items = _items("thin desc")
    out = await transcripts.enrich(items)  # must NOT raise

    assert out[0]["text"] == "thin desc", "degrade: failed fetch leaves description unchanged"


async def test_enrich_fail_soft_none_completes_unchanged(monkeypatch):
    """The load-bearing fail-soft contract independent of any exception ctor shape:
    when ``_fetch_text`` returns None (no transcript / swallowed failure) the run
    completes and the item keeps title+description only."""
    monkeypatch.setattr(transcripts, "_fetch_text", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_cached", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_store", lambda _vid, _txt: None)

    items = _items("thin desc")
    out = await transcripts.enrich(items)

    assert out[0]["text"] == "thin desc"
    assert "transcript_chars" not in out[0].get("extra", {})


# ── proxy / hosted hooks: provable no-op when unconfigured (YTX-03, Phase 15) ──
# Both hooks ship DORMANT — the load-bearing "no paid key required to pass" guarantee.
# When their env vars are unset the proxy rung must be a byte-identical no-op (the local
# path runs unchanged) and the hosted rung must return None with ZERO HTTP calls.
async def test_proxy_hook_noop_when_unconfigured(monkeypatch):
    """Proxy hook is a provable no-op when its env vars are unset: the LOCAL path runs
    unchanged (env unset → the proxy rung is skipped, byte-identical to the Phase-10
    local-only path). Deterministic + offline: monkeypatch ``_fetch_text`` to a sentinel
    and assert ``enrich`` surfaces it on ``extra.transcript`` exactly as before.

    The stronger "builds no ``proxy_config``" assertion is covered by Plan 02 keeping the
    import-light nets + the byte-identical fixture gate green; this test pins the OBSERVABLE
    no-op (proxy env unset → local result unchanged)."""
    # Clear every proxy env var so no proxy path can be configured (D-15-02 knobs).
    for k in ("WEBSHARE_PROXY_USERNAME", "WEBSHARE_PROXY_PASSWORD", "RESEARCH_YT_PROXY_URL"):
        monkeypatch.delenv(k, raising=False)

    sentinel = "spoken keyword content"
    monkeypatch.setattr(transcripts, "_fetch_text", lambda _vid: sentinel)
    monkeypatch.setattr(transcripts, "_cached", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_store", lambda _vid, _txt: None)

    out = await transcripts.enrich(_items("thin desc"))

    assert out[0]["extra"]["transcript"] == sentinel, (
        "proxy env unset → the local fetch path runs unchanged (no proxy rung)"
    )
    assert out[0]["text"] == "thin desc", "text stays the clean description (local path)"


async def test_hosted_hook_noop_when_unconfigured(monkeypatch):
    """Hosted hook is a provable no-op when unconfigured: with ``RESEARCH_YT_HOSTED_*``
    unset, ``_fetch_hosted`` returns None and makes ZERO ``requests.get`` calls (the rung
    is skipped — no paid key required to pass). A ``requests.get`` tripwire fails the test
    if the hook ever touches the network when dormant.

    RED until Plan 02: ``transcripts._fetch_hosted`` does not exist yet, so this raises
    ``AttributeError`` — that RED is the intended signal, NOT a failure."""
    # Clear the hosted env vars (D-15-03 knobs) so the hook has no base URL / key.
    for k in ("RESEARCH_YT_HOSTED_URL", "RESEARCH_YT_HOSTED_KEY", "RESEARCH_YT_HOSTED_FIELD"):
        monkeypatch.delenv(k, raising=False)

    import requests

    def _boom(*_a, **_k):
        raise AssertionError("hosted hook made an HTTP call when unconfigured")

    monkeypatch.setattr(requests, "get", _boom)

    # _fetch_hosted is created in Plan 02 → AttributeError here (RED by design).
    assert transcripts._fetch_hosted("vid1") is None, (
        "hosted env unset → hook returns None and makes no HTTP call"
    )


# ── budget (10-02-02) ─────────────────────────────────────────────────────────
async def test_enrich_budget_bound(monkeypatch):
    """A hanging fetch cannot blow the wall-clock budget. With a tiny _BUDGET, a
    5s-sleeping fetch must be abandoned (asyncio.TimeoutError swallowed) and the
    items returned unchanged well under the sleep duration."""
    monkeypatch.setattr(transcripts, "_PER_CALL", 0.2, raising=False)
    monkeypatch.setattr(transcripts, "_BUDGET", 0.2, raising=False)
    monkeypatch.setattr(transcripts, "_cached", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_store", lambda _vid, _txt: None)

    def _slow(_vid):
        time.sleep(5)  # offloaded via to_thread in the real enrich; the bound is enforced above it
        return "late transcript that must never land"

    monkeypatch.setattr(transcripts, "_fetch_text", _slow)

    items = _items("thin desc")
    t0 = time.monotonic()
    out = await transcripts.enrich(items)
    elapsed = time.monotonic() - t0

    assert elapsed < 2.0, f"budget not enforced: enrich took {elapsed:.2f}s"
    assert out == items, "budget blown -> items returned unchanged (description-only)"


# ── cache (10-02-04) ──────────────────────────────────────────────────────────
async def test_enrich_cache_single_fetch(monkeypatch, tmp_path):
    """The second enrich for the same video_id hits the sqlite cache: _fetch_text is
    invoked exactly once across two runs (the warm run reads _cached, no re-fetch)."""
    monkeypatch.setattr(transcripts, "_CACHE", tmp_path / "yt.sqlite", raising=False)

    calls = {"n": 0}

    def _counting(_vid):
        calls["n"] += 1
        return "spoken keyword content"

    monkeypatch.setattr(transcripts, "_fetch_text", _counting)

    items = _items("thin desc", vid="same-vid")
    await transcripts.enrich(items)
    await transcripts.enrich(_items("thin desc", vid="same-vid"))

    assert calls["n"] == 1, f"expected a single fetch (cache hit on run 2), got {calls['n']}"


# ── immutable (10-02-05) ──────────────────────────────────────────────────────
async def test_enrich_immutable_input(monkeypatch):
    """enrich returns NEW dicts and never mutates the input list/items
    (project coding-style: never mutate existing objects)."""
    monkeypatch.setattr(transcripts, "_fetch_text", lambda _vid: "spoken keyword content")
    monkeypatch.setattr(transcripts, "_cached", lambda _vid: None)
    monkeypatch.setattr(transcripts, "_store", lambda _vid, _txt: None)

    items = _items("thin desc")
    before = copy.deepcopy(items)

    await transcripts.enrich(items)

    assert items == before, "enrich must not mutate the input items (immutable rebuild)"


# ── hosted hook field-map: extracts content when configured (YTX-03, Phase 15) ─
async def test_hosted_hook_extracts_content(monkeypatch):
    """When the hosted hook is configured, its DEFAULT Supadata field-map extracts the
    transcript text from the top-level ``content`` field of the JSON response (offline,
    mocked ``requests.get``). Proves the generic hook's worked-example field-map.

    RED until Plan 02 creates ``transcripts._fetch_hosted`` → ``AttributeError`` (the
    intended signal, NOT a failure)."""
    monkeypatch.setenv("RESEARCH_YT_HOSTED_URL", "https://api.supadata.ai/v1/youtube/transcript")
    monkeypatch.setenv("RESEARCH_YT_HOSTED_KEY", "test-key-xyz")

    import requests

    class _Resp:
        def json(self):
            return {"content": "spoken text", "lang": "en"}

        def raise_for_status(self):
            return None

    monkeypatch.setattr(requests, "get", lambda *_a, **_k: _Resp())

    # _fetch_hosted is created in Plan 02 → AttributeError here (RED by design).
    assert transcripts._fetch_hosted("vid1") == "spoken text", (
        "hosted hook extracts the Supadata default ``content`` field (offline)"
    )


# ── no bare/broad except: standing AST static guard (YTX-02, Phase 15) ─────────
def test_transcripts_module_has_no_bare_except():
    """Static guard: ``transcripts.py`` contains no bare ``except:`` and no
    ``except Exception`` (the two project-prohibited forms — CLAUDE.md). GREEN against the
    Plan-10 module today; the standing guard that Plan 02's wider
    ``except (RequestBlocked, IpBlocked, ...)`` tuple does NOT regress into a broad catch."""
    import ast
    from pathlib import Path

    src = Path(transcripts.__file__).read_text()
    tree = ast.parse(src)
    bad = [
        h
        for h in ast.walk(tree)
        if isinstance(h, ast.ExceptHandler)
        and (h.type is None or (isinstance(h.type, ast.Name) and h.type.id == "Exception"))
    ]
    assert not bad, f"bare/broad except found in transcripts.py at lines {[h.lineno for h in bad]}"
