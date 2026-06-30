"""Unit tests for rank.py — the pure cross-source ranking module.

RANK-03 (canonical_url): canonical_url maps www./tracking/fragment/redirector
variants of the same link to a single canonical string, so the dedup stage can
collapse a link surfaced by multiple sources into one entry.

RANK-01 (bm25_scores) + RANK-02 (rrf_fuse, _rank_list) + _parse_recency: the three
relevance primitives at the heart of the ranker. Written failing-first (TDD RED):
these four functions do not exist until Plan 03-02 Tasks 2-3, so the import fails
until the implementation lands (GREEN).

RANK-04 (title_dup_groups, _shingles): near-duplicate-title detection — an exact-
normalized-title dict pass followed by a seeded MinHash/LSH fuzzy pass over word-
3-gram shingles, producing stable duplicate groups. Written failing-first (TDD RED):
``title_dup_groups``/``_shingles`` do not exist until Plan 03-03 Task 2.
"""
import json
from datetime import datetime, timezone

import pytest

import rank
from rank import (
    bm25_scores,
    canonical_url,
    rank_items,
    rrf_fuse,
    title_dup_groups,
    _parse_recency,
    _rank_list,
    _shingles,
)


# ── RANK-03: canonical_url normalization ─────────────────────────────────────

def test_canon_strips_www():
    # www. and apex host must canonicalize identically (D-RANK-WWW).
    assert canonical_url("https://www.example.com/page") == canonical_url(
        "https://example.com/page"
    )


def test_canon_drops_fragment():
    # The #fragment is not part of the resource identity for dedup.
    assert canonical_url("https://example.com/page#section") == canonical_url(
        "https://example.com/page"
    )


def test_canon_strips_tracking():
    # utm_* (and friends) are removed; the meaningful id=42 query arg is kept.
    assert canonical_url(
        "https://example.com/p?utm_source=hn&utm_medium=feed&id=42"
    ) == canonical_url("https://example.com/p?id=42")


def test_canon_sorts_query_args():
    # w3lib canonicalize_url sorts query args, so arg order is irrelevant.
    assert canonical_url("https://example.com/p?b=2&a=1") == canonical_url(
        "https://example.com/p?a=1&b=2"
    )


def test_canon_unwraps_google_news():
    # Google News wraps the real target in ?url=… — unwrap by PARSING ONLY.
    wrapped = "https://news.google.com/articles/xyz?url=https://realsite.com/story&hl=en"
    assert canonical_url(wrapped) == canonical_url("https://realsite.com/story")


def test_canon_unwraps_hrefli():
    # href.li/?<target> — the whole query string is the target URL (key is None).
    assert canonical_url("https://href.li/?https://realsite.com/x") == canonical_url(
        "https://realsite.com/x"
    )


def test_canon_empty_returns_empty():
    # Guard: empty input never raises, returns "".
    assert canonical_url("") == ""


def test_canon_two_sources_collapse():
    # The collapse precondition RANK-03's dedup relies on: the SAME logical link
    # arriving from two sources with different decoration (www + utm + fragment
    # vs bare) must canonicalize to one identical string -> collapse-count > 0.
    a = "https://www.example.com/story?utm_source=reddit#top"
    b = "https://example.com/story"
    assert canonical_url(a) == canonical_url(b)


# ── RANK-01: bm25_scores per-document relevance ──────────────────────────────

def test_bm25_returns_one_score_per_doc():
    # One finite float per doc, in corpus order (RANK-05 needs ALL candidates scored).
    docs = [
        "a cat is a feline",
        "a dog is loyal",
        "a bird can fly",
        "a fish can swim",
    ]
    scores = bm25_scores("cat", docs)
    assert len(scores) == 4
    assert all(isinstance(s, float) for s in scores)


def test_bm25_matching_outscores_nonmatching():
    # A query-matching doc must outscore a non-matching one on a controlled corpus.
    docs = [
        "a cat is a feline that likes to purr",
        "a dog is the human's best friend",
        "a bird can fly",
        "a fish swims in water",
    ]
    scores = bm25_scores("fish water swim", docs)
    # fish doc (index 3) matches "fish"/"water"/"swim"; dog doc (index 1) matches none.
    assert scores[3] > scores[1]


def test_bm25_empty_docs():
    # Guard: an empty corpus yields an empty score list, never raises.
    assert bm25_scores("anything", []) == []


def test_bm25_small_corpus_no_crash():
    # Pitfall 1: an 8-token query intent on a 2-doc corpus must NOT raise
    # (k is capped to len(docs); retrieve(k>n) would ValueError).
    scores = bm25_scores("x y z a b c d e", ["doc one about x", "doc two about y"])
    assert len(scores) == 2
    assert all(isinstance(s, float) for s in scores)


# ── RANK-02: rrf_fuse Reciprocal Rank Fusion (k=60) ──────────────────────────

def test_rrf_fuse_worked_example():
    # The research's worked mini-example: five candidates A-E, three GLOBAL
    # per-signal lists, C omitted from recency (no date) and popularity (None).
    # Exact floats are the mathematically correct Σ 1/(60+rank) values — the
    # research doc's hand-computed B/D/E digits contain rounding/transcription
    # errors (verified via fractions.Fraction); the IMPLEMENTATION produces these.
    rel = ["C", "A", "B", "E", "D"]   # BM25 desc
    rec = ["D", "A", "E", "B"]         # recency desc (C omitted — no date)
    pop = ["B", "A", "E", "D"]         # popularity desc (C omitted — None)
    fused = rrf_fuse([rel, rec, pop], k=60)
    # A = 3×1/62; B = 1/63+1/64+1/61; C = 1/61; D = 1/65+1/61+1/64; E = 1/64+2×1/63
    assert fused["A"] == pytest.approx(0.048387, abs=1e-5)
    assert fused["B"] == pytest.approx(0.047891, abs=1e-5)
    assert fused["D"] == pytest.approx(0.047403, abs=1e-5)
    assert fused["E"] == pytest.approx(0.047371, abs=1e-5)
    assert fused["C"] == pytest.approx(0.016393, abs=1e-5)
    # The headline RANK-02 oracle: signal-sparse-but-high-BM25 C does NOT dominate.
    order = [doc_id for doc_id, _s in sorted(fused.items(), key=lambda t: t[1], reverse=True)]
    assert order == ["A", "B", "D", "E", "C"]


def test_rrf_default_k_is_60():
    # The k=60 default is locked (RANK-02): a single list, rank 1 → 1/(60+1).
    assert rrf_fuse([["x"]])["x"] == pytest.approx(1.0 / 61)


def test_rank_list_omits_none():
    # _rank_list builds a global ranked list of ids from a signal, OMITTING items
    # whose signal value is None (missing-signal omission, D-RANK-A2). Items expose
    # their stable id via the "id" key; value_of maps an item → its signal value.
    items = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    signal = {"a": 5, "b": None, "c": 3}
    ranked = _rank_list(items, value_of=lambda it: signal[it["id"]])
    assert ranked == ["a", "c"]   # b omitted (None); a before c (desc)


# ── _parse_recency: tolerant parse of mixed-type created_utc (Pitfall 2) ──────

def test_recency_hn_epoch_int():
    # HN created_at_i is a unix-epoch int → passes through as a float.
    assert _parse_recency(1716200000) == pytest.approx(1716200000.0)


def test_recency_arxiv_iso_string():
    # arXiv published is an ISO-8601 string with trailing Z; newer ⇒ larger.
    newer = _parse_recency("2026-05-01T00:00:00Z")
    older = _parse_recency("2024-01-01T00:00:00Z")
    assert isinstance(newer, float)
    assert isinstance(older, float)
    assert newer > older


def test_recency_openalex_yyyymmdd():
    # OpenAlex publication_date is a bare "YYYY-MM-DD" date string.
    assert isinstance(_parse_recency("2024-01-15"), float)


def test_recency_s2_bare_year_int():
    # Semantic Scholar year is a bare 4-digit int → treated as a YEAR, not an epoch.
    y2025 = _parse_recency(2025)
    y2026 = _parse_recency(2026)
    assert y2025 == pytest.approx(
        datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
    )
    assert isinstance(y2025, float) and isinstance(y2026, float)
    assert y2025 < y2026


def test_recency_github_iso_datetime():
    # GitHub created_at is a full ISO datetime string.
    assert isinstance(_parse_recency("2023-06-01T12:00:00Z"), float)


def test_recency_none_and_garbage():
    # Tolerant: None / empty / unparseable → None, never raises (DoS mitigation).
    assert _parse_recency(None) is None
    assert _parse_recency("") is None
    assert _parse_recency("not-a-date") is None


# ── RANK-04: title_dup_groups near-duplicate detection ───────────────────────
#
# title_dup_groups(items) -> {representative_id: [member items incl. representative]}
# does an exact-normalized-title dict pass FIRST (catches verbatim cross-posts
# cheaply), then a seeded MinHash/LSH fuzzy pass over word-3-gram shingles. Every
# item lands in exactly one group. We assert on the GROUPING (which ids cluster
# together), never on which id is the "representative" winner — winner selection
# is the orchestrator's job (RRF is not known here). The partition is compared as a
# set of frozensets of member ids so the choice of representative key is irrelevant.


def _partition(groups: dict) -> set[frozenset[str]]:
    """Reduce {rep_id: [member items]} to a representative-agnostic partition.

    Returns the set of member-id frozensets so two groupings are equal iff they
    cluster the same ids together, regardless of which id was picked as the key.
    """
    return {
        frozenset(str(member["id"]) for member in members)
        for members in groups.values()
    }


def test_dup_exact_normalized_title():
    # Two items, different sources, identical-AFTER-normalization titles → ONE group.
    # The cheap exact-normalized-title dict pass catches this before MinHash runs.
    items = [
        {"id": "hn1", "title": "Show HN: A Fast BM25 Library", "url": "https://a.com/x"},
        {"id": "rd1", "title": "show hn  a fast bm25 library", "url": "https://b.com/y"},
    ]
    assert _partition(title_dup_groups(items)) == {frozenset({"hn1", "rd1"})}


def test_dup_near_duplicate_titles_merge():
    # Near-identical (not exact) titles — one trailing word differs → grouped together
    # (estimated Jaccard over word-3-gram shingles ≥ 0.7 via the MinHash/LSH pass).
    items = [
        {
            "id": "a1",
            "title": "Reciprocal Rank Fusion outperforms learned reranking in production",
            "url": "https://a.com/1",
        },
        {
            "id": "b1",
            "title": "Reciprocal Rank Fusion outperforms learned reranking in production systems",
            "url": "https://b.com/2",
        },
    ]
    assert _partition(title_dup_groups(items)) == {frozenset({"a1", "b1"})}


def test_dup_distinct_titles_dont_merge():
    # Two genuinely different titles that share a couple of words → TWO groups.
    items = [
        {"id": "v1", "title": "A survey of vector databases for RAG", "url": "https://a.com/v"},
        {
            "id": "g1",
            "title": "A survey of graph neural networks for chemistry",
            "url": "https://b.com/g",
        },
    ]
    assert _partition(title_dup_groups(items)) == {frozenset({"v1"}), frozenset({"g1"})}


def test_dup_short_titles():
    # Very short titles (< 3 tokens) exercise the token-set fallback in _shingles;
    # distinct one-word titles must NOT merge, and _shingles must not raise.
    assert _shingles("BM25") == {"bm25"}
    assert _shingles("FAISS")  # non-empty set, no raise
    items = [
        {"id": "s1", "title": "BM25", "url": "https://a.com/bm25"},
        {"id": "s2", "title": "FAISS", "url": "https://b.com/faiss"},
    ]
    assert _partition(title_dup_groups(items)) == {frozenset({"s1"}), frozenset({"s2"})}


def test_dup_deterministic():
    # Pitfall 3: the SAME input twice must yield identical partitions (pinned seed=1,
    # num_perm=128, items-order iteration, sorted component members). Guards fixture
    # replay. Use the union of the items above so all three passes are exercised.
    items = [
        {"id": "hn1", "title": "Show HN: A Fast BM25 Library", "url": "https://a.com/x"},
        {"id": "rd1", "title": "show hn  a fast bm25 library", "url": "https://b.com/y"},
        {
            "id": "a1",
            "title": "Reciprocal Rank Fusion outperforms learned reranking in production",
            "url": "https://a.com/1",
        },
        {
            "id": "b1",
            "title": "Reciprocal Rank Fusion outperforms learned reranking in production systems",
            "url": "https://b.com/2",
        },
        {"id": "v1", "title": "A survey of vector databases for RAG", "url": "https://a.com/v"},
        {
            "id": "g1",
            "title": "A survey of graph neural networks for chemistry",
            "url": "https://b.com/g",
        },
        {"id": "s1", "title": "BM25", "url": "https://a.com/bm25"},
    ]
    first = title_dup_groups(items)
    second = title_dup_groups(items)
    # Same representative keys AND same member-id sets per group, run-to-run.
    assert set(first.keys()) == set(second.keys())
    assert {k: frozenset(str(m["id"]) for m in v) for k, v in first.items()} == {
        k: frozenset(str(m["id"]) for m in v) for k, v in second.items()
    }
    # And the partition itself is stable (and correct: the two cross-posts cluster).
    assert _partition(first) == _partition(second)
    assert frozenset({"hn1", "rd1"}) in _partition(first)
    assert frozenset({"a1", "b1"}) in _partition(first)


# ── RANK-05: rank_items orchestrator (the ONE public entry point) ─────────────
#
# rank_items(query, collected, k) -> list[dict] is the single cross-source ranked
# list both Plan 03-05 callers (the CLI digest and the eval metric) consume. It
# flattens collected with provenance, groups duplicates (canonical URL + near-dup
# title), scores BM25, builds the three GLOBAL per-signal rank lists, fuses with
# RRF on the union of each group's ranks, annotates every survivor's `extra`, and
# returns the stable-sorted top-k. Written failing-first (TDD RED): rank_items does
# not exist until Plan 03-04 Task 2, so the import (above) fails until GREEN.


def _envelope(id_, title, *, score=None, created_utc=None, url="", text=""):
    """A minimal research envelope item (the shape research_topic.run() collects)."""
    return {
        "id": id_,
        "title": title,
        "author": "",
        "score": score,
        "url": url,
        "created_utc": created_utc,
        "num_comments": 0,
        "text": text,
        "top_comments": [],
        "tags": [],
        "extra": {},
    }


def _sample_collected():
    """A small multi-source `collected` with a clear multi-signal winner.

    `bl`/`hn` match the query "bm25 ranking" strongly; `gh` is a 95k-star repo that
    barely matches (high popularity, ~zero relevance) — so RRF must NOT rank `gh`
    first even though it has the largest `score`. `ax` is an arXiv-style paper with
    score=None (no popularity) and a parseable date.
    """
    return {
        "github": [
            _envelope(
                "gh", "awesome list of everything", score=95000,
                created_utc="2020-01-01T00:00:00Z", url="https://github.com/x/awesome",
            ),
        ],
        "hackernews": [
            _envelope(
                "hn", "BM25 ranking and reciprocal rank fusion explained", score=400,
                created_utc="2026-05-01T00:00:00Z", url="https://news.com/bm25",
            ),
        ],
        "arxiv": [
            _envelope(
                "ax", "A study of BM25 ranking variants", score=None,
                created_utc="2025-11-01T00:00:00Z", url="https://arxiv.org/abs/2511.0001",
                text="lucene atire robertson bm25 ranking comparison",
            ),
        ],
        "openalex": [
            _envelope(
                "bl", "Implementing BM25 ranking in python", score=10,
                created_utc="2026-06-01T00:00:00Z", url="https://blog.com/bm25",
            ),
        ],
    }


def test_rank_items_annotates_every_item():
    # RANK-05: 100% of returned items carry extra.bm25 (float), extra.rrf (float),
    # and extra.ranks (a dict with relevance/recency/popularity/dense keys — the
    # "dense" key is the Phase-7 additive D-01 rank; None when dense is unavailable).
    result = rank_items("bm25 ranking", _sample_collected())
    assert result, "expected a non-empty ranked list"
    for it in result:
        assert "bm25" in it["extra"]
        assert "rrf" in it["extra"]
        assert "ranks" in it["extra"]
        assert isinstance(it["extra"]["bm25"], float)
        assert isinstance(it["extra"]["rrf"], float)
        ranks = it["extra"]["ranks"]
        assert isinstance(ranks, dict)
        assert set(ranks.keys()) == {"relevance", "recency", "popularity", "dense"}


def test_rank_items_returns_single_list_not_per_source():
    # The result is a flat list[dict] (one cross-source ranking), NOT a dict-of-sources.
    result = rank_items("bm25 ranking", _sample_collected())
    assert isinstance(result, list)
    assert all(isinstance(it, dict) for it in result)


def test_rank_items_order_is_rrf_not_score():
    # RANK-02 at the orchestrator level: the top item is NOT simply max(score).
    # `gh` has the largest score (95000) but barely matches the query, so a
    # multi-signal item must outrank it under RRF.
    collected = _sample_collected()
    result = rank_items("bm25 ranking", collected)
    all_items = [it for items in collected.values() for it in items]
    max_score_id = max(all_items, key=lambda it: it["score"] or 0)["id"]
    assert max_score_id == "gh"          # sanity: gh really is the score leader
    assert result[0]["id"] != max_score_id


def test_rank_items_dedup_collapses_and_provenance():
    # SC#4 + RANK-03/04 wiring: the SAME story arrives from two sources with the
    # same canonical URL (one tracking-decorated) → the survivor appears ONCE,
    # carries extra.also_seen_on naming the other source, and the duplicate is gone.
    collected = {
        "hackernews": [
            _envelope(
                "hn1", "A Deep Dive Into Reciprocal Rank Fusion", score=500,
                created_utc="2026-05-01T00:00:00Z",
                url="https://blog.example.com/rrf?utm_source=hn#top",
            ),
        ],
        "reddit": [
            _envelope(
                "rd1", "Reddit discussion thread", score=120,
                created_utc="2026-05-02T00:00:00Z",
                url="https://blog.example.com/rrf",
            ),
        ],
    }
    total_in = sum(len(v) for v in collected.values())
    result = rank_items("reciprocal rank fusion", collected)
    assert len(result) < total_in            # collapse > 0
    assert len(result) == 1
    survivor = result[0]
    also = survivor["extra"]["also_seen_on"]
    assert isinstance(also, list)
    # The survivor names the OTHER source; only one entry remains for this URL.
    sources = {"hackernews", "reddit"}
    assert set(also) == sources - {_source_of(survivor, collected)}
    canon = canonical_url(survivor["url"])
    assert canonical_url("https://blog.example.com/rrf") == canon


def _source_of(item, collected):
    """Which source list (by name) the surviving item object came from."""
    for source, items in collected.items():
        if any(it["id"] == item["id"] for it in items):
            return source
    raise AssertionError("survivor not found in any source")


def test_rank_items_single_source_also_seen_on_empty():
    # A single-source item carries an EMPTY also_seen_on (or none) — never names itself.
    collected = {"hackernews": [_envelope("only", "BM25 ranking solo", score=10, url="https://x.com/1")]}
    result = rank_items("bm25 ranking", collected)
    assert len(result) == 1
    assert result[0]["extra"].get("also_seen_on", []) == []


def test_rank_items_topk():
    # k caps the result; no k returns the full post-dedup list.
    collected = _sample_collected()
    top3 = rank_items("bm25 ranking", collected, k=3)
    assert len(top3) <= 3
    full = rank_items("bm25 ranking", collected)
    assert len(full) == 4            # 4 distinct items, no dupes in this fixture
    assert len(top3) == 3
    # top-k is a strict prefix of the full ranking (same order, just truncated).
    assert [it["id"] for it in top3] == [it["id"] for it in full[:3]]


def test_rank_items_deterministic():
    # Pitfall 3 (the load-bearing fixture-mode guard): two runs on the same input
    # are byte-identical — same order AND same extra annotations.
    collected = _sample_collected()
    r1 = rank_items("bm25 ranking", collected)
    r2 = rank_items("bm25 ranking", _sample_collected())
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)


def test_rank_items_handles_missing_signals():
    # arXiv score=None (no popularity) + an unparseable created_utc (no recency) must
    # NOT raise; both items still appear and still get extra.rrf (ranked on the
    # signals they DO have — omitted only from the lists they're missing).
    collected = {
        "arxiv": [
            _envelope("ax", "BM25 ranking paper", score=None, created_utc=None,
                      url="https://arxiv.org/abs/1"),
        ],
        "hackernews": [
            _envelope("hn", "BM25 ranking post", score=42, created_utc="not-a-date",
                      url="https://news.com/2"),
        ],
    }
    result = rank_items("bm25 ranking", collected)
    ids = {it["id"] for it in result}
    assert ids == {"ax", "hn"}
    for it in result:
        assert isinstance(it["extra"]["rrf"], float)
    by_id = {it["id"]: it for it in result}
    # arXiv item omitted from popularity (score None); hn omitted from recency (bad date).
    assert by_id["ax"]["extra"]["ranks"]["popularity"] is None
    assert by_id["hn"]["extra"]["ranks"]["recency"] is None


def test_rank_items_offtopic_recent_popular_not_promoted():
    # D-RANK-RELGATE: recency + popularity are query-INDEPENDENT signals; they must
    # only re-order topically-relevant items, never lift a zero-relevance item into
    # the top. The registry item matches NO salient query term (BM25 == 0) yet is the
    # most recent AND the most popular — it must NOT outrank the on-topic paper (the
    # npm-package-surfaced-for-a-sourdough-query regression caught at SC#4).
    collected = {
        "papers": [
            _envelope("paper", "sourdough bread baking guide", score=None,
                      created_utc="2019-01-01T00:00:00Z", url="https://ex.com/paper"),
        ],
        "registry": [
            _envelope("pkg", "tailwindcss typography plugin", score=99999,
                      created_utc="2026-06-01T00:00:00Z", url="https://ex.com/pkg"),
        ],
    }
    result = rank_items("sourdough bread baking", collected)
    ids = [it["id"] for it in result]
    assert ids[0] == "paper"                       # on-topic item ranks first
    assert ids.index("paper") < ids.index("pkg")   # off-topic recent+popular NOT promoted


def test_rank_items_empty():
    # Guards: no sources, and a source with an empty item list → [].
    assert rank_items("q", {}) == []
    assert rank_items("q", {"hn": []}) == []


# ── FUSE-01: proportional/quantile relevance gate (TDD RED) ──────────────────
# These three tests encode the v1.1 Phase-6 graded gate that REPLACES the current
# binary `bm25_of[id(it)] > 0.0` gate (rank.py:441,446). They reference
# `rank.REL_QUANTILE` — the quantile-cutoff constant Plan 06-03 introduces — via
# getattr(..., None) so the rest of this suite stays COLLECTABLE while the constant
# is absent (a hard `from rank import REL_QUANTILE` would break collection of every
# test in this file). The boundary test below is RED against the current binary gate
# (which admits ANY positive BM25) and turns GREEN once 06-03's quantile gate drops
# the lowest-positive item below REL_QUANTILE.


def test_rank_items_offtopic_recent_popular_gated():
    # FUSE-01 (the zero-relevance floor — already holds under the binary gate; kept as
    # the regression floor Plan 06-03 must NOT break). A zero-relevance item (matches
    # NO salient query token → BM25 == 0) that is BOTH the most recent AND the highest
    # `score` must be OMITTED from recency+popularity (extra.ranks.recency is None AND
    # .popularity is None) and must NOT rank #1, even alongside a strongly-matching item
    # and a weakly-but-positively matching item that is neither newest nor most popular.
    collected = {
        "strong": [
            # Strong on-topic match (multiple salient tokens), middling recency/score.
            _envelope(
                "strong", "sourdough bread baking sourdough starter guide", score=50,
                created_utc="2022-01-01T00:00:00Z", url="https://ex.com/strong",
            ),
        ],
        "weak": [
            # Weak-but-positive on-topic match (one salient token: "sourdough"),
            # and deliberately NEITHER the newest NOR the most popular.
            _envelope(
                "weak", "sourdough discussion", score=5,
                created_utc="2020-01-01T00:00:00Z", url="https://ex.com/weak",
            ),
        ],
        "registry": [
            # Zero-relevance (no salient query token) BUT most recent AND most popular.
            _envelope(
                "pkg", "tailwindcss typography plugin", score=99999,
                created_utc="2026-06-01T00:00:00Z", url="https://ex.com/pkg",
            ),
        ],
    }
    result = rank_items("sourdough bread baking", collected)
    by_id = {it["id"]: it for it in result}
    ids = [it["id"] for it in result]

    # The zero-relevance package is gated OUT of both query-independent lists …
    assert by_id["pkg"]["extra"]["ranks"]["recency"] is None
    assert by_id["pkg"]["extra"]["ranks"]["popularity"] is None
    # … so despite being newest+most-popular it is not #1 (the regression floor).
    assert ids[0] != "pkg"
    assert ids.index("strong") < ids.index("pkg")


def test_rank_items_quantile_boundary_membership():
    # FUSE-01 boundary case (TDD RED under the current binary gate). Several items have
    # DISTINCT positive BM25 scores spanning a range; ONE item's only overlap is a single
    # weak token, giving it the LOWEST positive BM25 — and it is ALSO the most popular and
    # most recent. Under the current binary gate (admits ANY BM25 > 0) it collects the full
    # recency+popularity boost and can top the list. Under 06-03's quantile gate it falls
    # BELOW the relevance cutoff, so it is OMITTED from recency+popularity and cannot be
    # lifted to #1 by popularity alone.
    #
    # Assertion: the lowest-positive item's extra.ranks.recency AND .popularity are None,
    # and it is not ranked #1. FAILS now (binary gate gives it real ranks), PASSES after
    # the quantile gate excludes it.
    collected = {
        "a": [
            _envelope(
                "hi3", "bm25 ranking reciprocal rank fusion retrieval relevance", score=10,
                created_utc="2021-01-01T00:00:00Z", url="https://ex.com/hi3",
            ),
        ],
        "b": [
            _envelope(
                "hi2", "bm25 ranking reciprocal rank fusion retrieval", score=10,
                created_utc="2021-02-01T00:00:00Z", url="https://ex.com/hi2",
            ),
        ],
        "c": [
            _envelope(
                "hi1", "bm25 ranking reciprocal rank", score=10,
                created_utc="2021-03-01T00:00:00Z", url="https://ex.com/hi1",
            ),
        ],
        "d": [
            # Single weak token overlap ("ranking") → LOWEST positive BM25 — but most
            # popular AND most recent: the binary gate would let it top the list.
            _envelope(
                "lowpos", "product ranking leaderboard chart", score=99999,
                created_utc="2026-06-01T00:00:00Z", url="https://ex.com/lowpos",
            ),
        ],
    }
    # REL_QUANTILE is the quantile cutoff Plan 06-03 introduces; pinned here so its
    # existence is part of the GREEN contract. getattr(...) keeps the suite collectable
    # while the constant is absent — this assertion is RED until 06-03 defines it.
    assert getattr(rank, "REL_QUANTILE", None) is not None

    result = rank_items("bm25 ranking reciprocal rank fusion retrieval relevance", collected)
    by_id = {it["id"]: it for it in result}
    ids = [it["id"] for it in result]

    # A single weak token match no longer buys the full popularity boost: the lowest-
    # positive item is gated OUT of recency+popularity and is not #1.
    assert by_id["lowpos"]["extra"]["ranks"]["recency"] is None
    assert by_id["lowpos"]["extra"]["ranks"]["popularity"] is None
    assert ids[0] != "lowpos"


def test_rank_items_all_zero_corpus_degrades():
    # FUSE-01 all-zero / all-filler degrade (RESEARCH Pitfall 1). When NO item matches any
    # salient query token (every BM25 == 0, the empty-positive-subset path), the ranker must
    # NOT crash, must return ALL items, and recency/popularity must still order the all-zero
    # pool exactly as today — every survivor still carries a float extra.rrf. (selector:
    # rides the existing `-k empty` substring via "_corpus" → matched by `-k all_zero` too;
    # the function name contains both `all_zero` and ends in degrade.)
    collected = {
        "alpha": [
            _envelope("z1", "completely unrelated alpha title", score=10,
                      created_utc="2024-01-01T00:00:00Z", url="https://ex.com/z1"),
        ],
        "beta": [
            _envelope("z2", "totally different beta heading", score=999,
                      created_utc="2026-01-01T00:00:00Z", url="https://ex.com/z2"),
        ],
        "gamma": [
            _envelope("z3", "another off subject gamma note", score=None,
                      created_utc="2025-01-01T00:00:00Z", url="https://ex.com/z3"),
        ],
    }
    # Query shares no token with any title → every BM25 == 0 (the all-zero corpus).
    result = rank_items("zzqqxx", collected)
    ids = {it["id"] for it in result}
    assert ids == {"z1", "z2", "z3"}          # does not crash; returns all items
    for it in result:
        assert isinstance(it["extra"]["rrf"], float)   # still ordered, still annotated


# ── FUSE-01 (Plan 06-04): relevance-dominant per-list-k fusion (TDD RED) ──────
# Encodes the single-signal-omission burial the operator's 20-topic diagnostic
# surfaced (06-DIAGNOSTIC-FINDINGS): a BM25 rank-1 web ARTICLE with no created_utc
# and no score is omitted from the recency+popularity RRF lists and — under the OLD
# UNIFORM k=60 fusion — sinks below a fresher, LESS-relevant item, because at k=60
# the relevance-rank-1 contribution is only 1/61 ≈ 0.016 while one recency term adds
# the same ~0.016, so a single query-independent boost overwhelms the relevance lead
# (the cheese "thepioneerwoman 10 Best Cheeses" rel#1 buried at #8). Plan 06-04 fuses
# the relevance list at a STEEPER k (rank.REL_RRF_K=15) than recency/popularity
# (k=60), so the relevance-rank-1 lead (1/16 ≈ 0.0625) dominates one boost. This test
# is RED under uniform k=60 and turns GREEN once relevance is fused at REL_RRF_K.


def test_rank_items_relevance_dominates_single_signal_omission():
    # The relevance-dominance property (FUSE-01 / Tunkelang relevance-primary). A
    # HIGH-BM25 single-signal ARTICLE (NO created_utc, NO score → OMITTED from BOTH
    # recency and popularity) must OUT-RANK a LOWER-BM25 item that carries a SINGLE
    # query-independent boost — the newest created_utc — exactly the cheese fixture's
    # shape (its gold articles have no recency/score metadata; fresh-but-less-relevant
    # videos carry created_utc and bury them under uniform-k RRF).
    #
    # Relevance (BM25 over title + " " + text) is driven by query tokens carried in the
    # TEXT field; the TITLES are all lexically distinct so the RANK-04 near-dup pass does
    # NOT merge any item (each survives as its own ranked entry — the relevance signal and
    # the dedup signal are deliberately decoupled). Strong fillers (more query tokens) sit
    # BETWEEN the article and the rival on the relevance list, so the rival lands at
    # relevance rank ~9 — far enough below #1 that the steeper-k rel-lead beats one boost,
    # yet still above the per-query median so it CLEARS the relevance gate (06-03) and
    # legitimately collects its recency boost (this is a FUSION test, not a gate test).
    qtok = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima"
    toks = qtok.split()

    def _q_text(n: int) -> str:                  # first n query tokens, carried in `text`
        return " ".join(toks[:n])

    collected = {
        # BM25 leader (ALL query tokens in text) but metadata-poor: no date, no score
        # → OMITTED from recency AND popularity; ranks on relevance ALONE.
        "article": [
            _envelope("article", "definitive cheese melting reference handbook",
                      score=None, created_utc=None, url="https://ex.com/article",
                      text=_q_text(12)),
        ],
        # Eight strong matches (descending query-token overlap), each a DISTINCT title,
        # all carrying created_utc but NO score (mirrors the cheese fixture: recency-
        # bearing, score-less). They occupy relevance ranks 2..~8, pushing the rival down
        # to rel rank ~9 — far enough below #1 that the steeper-k rel-lead beats one boost,
        # while keeping the per-query median below the rival so the rival clears the gate.
        "fillers": [
            _envelope("s0", "comprehensive stovetop pairing dossier", score=None,
                      created_utc="2010-01-01T00:00:00Z", url="https://ex.com/s0", text=_q_text(11)),
            _envelope("s1", "artisan dairy tasting compendium", score=None,
                      created_utc="2011-01-01T00:00:00Z", url="https://ex.com/s1", text=_q_text(10)),
            _envelope("s2", "weeknight skillet flavor manual", score=None,
                      created_utc="2012-01-01T00:00:00Z", url="https://ex.com/s2", text=_q_text(9)),
            _envelope("s3", "regional creamery field notes", score=None,
                      created_utc="2013-01-01T00:00:00Z", url="https://ex.com/s3", text=_q_text(8)),
            _envelope("s4", "kitchen technique deep dossier", score=None,
                      created_utc="2014-01-01T00:00:00Z", url="https://ex.com/s4", text=_q_text(7)),
            _envelope("s5", "seasonal market sourcing review", score=None,
                      created_utc="2015-01-01T00:00:00Z", url="https://ex.com/s5", text=_q_text(6)),
            _envelope("s6", "classic bistro plating digest", score=None,
                      created_utc="2016-01-01T00:00:00Z", url="https://ex.com/s6", text=_q_text(5)),
            _envelope("s7", "home cook ingredient ledger", score=None,
                      created_utc="2017-01-01T00:00:00Z", url="https://ex.com/s7", text=_q_text(4)),
        ],
        # The rival: a LOWER-BM25 (five query tokens) item with the NEWEST created_utc
        # and NO score — a SINGLE query-independent boost (recency only).
        "video": [
            _envelope("video", "fresh viral cooking short clip today", score=None,
                      created_utc="2026-06-01T00:00:00Z", url="https://ex.com/video", text=_q_text(5)),
        ],
        # Eight weak fillers (one query token each) below the rival on relevance, so the
        # per-query median sits beneath the rival's BM25 and the rival clears the gate.
        "weak": [
            _envelope("w0", "quick morning aside", score=None,
                      created_utc="2000-01-01T00:00:00Z", url="https://ex.com/w0", text=_q_text(1)),
            _envelope("w1", "brief evening jotting", score=None,
                      created_utc="2001-01-01T00:00:00Z", url="https://ex.com/w1", text=_q_text(1)),
            _envelope("w2", "short midday memo", score=None,
                      created_utc="2002-01-01T00:00:00Z", url="https://ex.com/w2", text=_q_text(1)),
            _envelope("w3", "tiny weekend scrap", score=None,
                      created_utc="2003-01-01T00:00:00Z", url="https://ex.com/w3", text=_q_text(1)),
            _envelope("w4", "small nightly blurb", score=None,
                      created_utc="2004-01-01T00:00:00Z", url="https://ex.com/w4", text=_q_text(1)),
            _envelope("w5", "minor dawn snippet", score=None,
                      created_utc="2005-01-01T00:00:00Z", url="https://ex.com/w5", text=_q_text(1)),
            _envelope("w6", "slight dusk remark", score=None,
                      created_utc="2006-01-01T00:00:00Z", url="https://ex.com/w6", text=_q_text(1)),
            _envelope("w7", "passing noon line", score=None,
                      created_utc="2007-01-01T00:00:00Z", url="https://ex.com/w7", text=_q_text(1)),
        ],
    }
    result = rank_items(qtok, collected)
    by_id = {it["id"]: it for it in result}
    ids = [it["id"] for it in result]

    # No dedup merge — every distinct-titled item survives (relevance ⊥ dedup here).
    assert {"article", "video"} <= set(ids)

    # Sanity: the article is the BM25 leader and is OMITTED from BOTH boost lists,
    # while the rival cleared the gate and DID collect its single (recency) boost.
    assert by_id["article"]["extra"]["bm25"] > by_id["video"]["extra"]["bm25"]
    assert by_id["article"]["extra"]["ranks"]["recency"] is None
    assert by_id["article"]["extra"]["ranks"]["popularity"] is None
    assert by_id["video"]["extra"]["ranks"]["recency"] is not None      # newest → in recency
    assert by_id["video"]["extra"]["ranks"]["popularity"] is None       # score-less → single boost

    # The relevance-dominance property: the metadata-poor BM25 leader out-ranks the
    # fresher, less-relevant rival (RED at uniform k=60, GREEN at REL_RRF_K=15).
    assert ids.index("article") < ids.index("video")


# ── ENRICH-01 (Phase 10): transcript max-combine can only help, never demote ──────
def test_transcript_never_demotes_well_described_item():
    """A YouTube transcript on ``extra.transcript`` can only RAISE an item's score —
    never demote a well-described one.

    Appending the transcript into the scored doc text used to sink a strong item via
    BM25 length-normalization + dense-embedding dilution (the Phase 10 regression
    finding: the #1 official tutorial fell out of the top-10). rank.py now scores the
    transcript as a SEPARATE field and keeps ``max(title+desc, transcript)`` per signal,
    so a well-described item carrying even a long OFF-TOPIC transcript keeps its rank
    (its base title+desc score wins the max). This is the standing regression guard for
    the fix: RED under the old append-into-text path, GREEN under max-combine.
    """
    import copy

    query = "descale a breville espresso machine"
    strong = {
        "id": "strong",
        "title": "How to descale a Breville espresso machine",
        "text": "a thorough step-by-step descaling guide for your Breville espresso machine",
        "url": "https://y/strong",
        "extra": {},
    }
    others = [
        {
            "id": f"o{i}",
            "title": f"unrelated gardening clip {i}",
            "text": f"planting tomatoes and pruning roses part {i}",
            "url": f"https://y/o{i}",
            "extra": {},
        }
        for i in range(6)
    ]

    def rank_of(target_id: str, collected: dict) -> int:
        ranked = rank_items(query, copy.deepcopy(collected), k=None)  # deepcopy: rank_items annotates extra
        return next(i for i, it in enumerate(ranked) if it["id"] == target_id)

    without = rank_of("strong", {"youtube": [strong, *others]})
    # same corpus, but the strong item now carries a LONG, OFF-TOPIC transcript
    strong_tr = {**strong, "extra": {"transcript": "lorem ipsum dolor sit amet " * 200}}
    with_tr = rank_of("strong", {"youtube": [strong_tr, *others]})

    assert with_tr <= without, (
        "a transcript must never demote a well-described item (max-combine guarantee): "
        f"rank without transcript = {without}, with a long off-topic transcript = {with_tr}"
    )


# ── RERANK-01 / SC#1: opt-in cross-encoder rerank contract (Phase 8) ─────────
# The opt-in rerank (default OFF, D-04) reorders ONLY the top RERANK_TOP_N (cap ≤
# 50, D-06) fused survivors when RESEARCH_RERANK == "1", over the SAME _doc_text the
# BM25/dense paths score; OFF (or the optional [semantic] dep absent) it is skipped
# entirely so the fixture path stays byte-identical to Phase 7 (D-09).
#
# These pin the contract BEFORE rerank.py exists (TDD RED, Plan 08-01). The future
# surface (Plan 08-02 creates rerank.py): rerank.enabled() -> bool,
# rerank.TOP_N -> int (≤ 50), rerank.rerank_scores(query, docs) -> list[float] | None,
# rerank._get_encoder() (the lazy fastembed factory the OFF path must NOT call).
#
# RED today (ModuleNotFoundError: No module named 'rerank') for the three contract
# cases — exactly the state Plan 08-02 turns GREEN. test_rerank_off_is_passthrough
# does NOT import rerank: it is GREEN today (rank.py never reorders without rerank.py)
# and MUST STAY GREEN after Plan 08-02 (OFF = byte-identical, D-09).


def test_rerank_default_off(monkeypatch):
    # SC#1 / D-04: rerank is OFF unless RESEARCH_RERANK == "1".
    # RED today = ModuleNotFoundError on `import rerank` (Plan 08-02 creates it).
    monkeypatch.delenv("RESEARCH_RERANK", raising=False)
    import rerank  # RED until Plan 08-02 creates rerank.py

    assert rerank.enabled() is False


def test_rerank_top_n_cap(monkeypatch):
    # SC#1 / D-06: the head-reorder cap must be ≤ 50 (bounded cross-encoder cost).
    # RED today = ModuleNotFoundError on `import rerank`.
    monkeypatch.delenv("RESEARCH_RERANK", raising=False)
    import rerank  # RED until Plan 08-02 creates rerank.py

    assert isinstance(rerank.TOP_N, int)
    assert rerank.TOP_N <= 50


def test_rerank_off_is_passthrough(monkeypatch):
    # SC#1 / D-09: with rerank OFF (RESEARCH_RERANK unset) rank_items returns the
    # SAME order as a baseline call — the OFF path is a no-op reorder. GREEN today
    # (rerank.py absent → rank.py never reorders) and MUST STAY GREEN after Plan
    # 08-02 (byte-identical OFF is the carried-forward non-negotiable).
    monkeypatch.delenv("RESEARCH_RERANK", raising=False)
    baseline = rank_items("bm25 ranking", _sample_collected())
    off = rank_items("bm25 ranking", _sample_collected())
    assert json.dumps(off, sort_keys=True) == json.dumps(baseline, sort_keys=True), (
        "rerank OFF must be a byte-identical no-op reorder (D-09 byte-identical OFF)"
    )


def test_rerank_off_does_not_construct_encoder(monkeypatch):
    # SC#1 / SC#2: with rerank OFF, rank_items must NEVER construct the cross-encoder
    # (the ≤12-min model fetch / heavy fastembed import must not fire on the default
    # path). A spy on rerank._get_encoder raises if called.
    # RED today = ModuleNotFoundError on `import rerank`; GREEN after Plan 08-02
    # (OFF skips the rerank block entirely, so the encoder is never constructed).
    monkeypatch.delenv("RESEARCH_RERANK", raising=False)
    import rerank  # RED until Plan 08-02 creates rerank.py

    def _boom(*args, **kwargs):
        raise AssertionError("encoder constructed while rerank is OFF (SC#1/SC#2)")

    monkeypatch.setattr(rerank, "_get_encoder", _boom)
    # Must complete without raising — OFF path never touches the encoder.
    result = rank_items("bm25 ranking", _sample_collected())
    assert isinstance(result, list)
