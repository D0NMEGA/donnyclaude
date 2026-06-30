"""Failing TDD scaffold (RED) for the Phase-4 query classifier + source router.

``routing.py`` does not exist yet — it is built by Plan 02 (Wave 1). The
top-level ``import routing`` below therefore raises ``ModuleNotFoundError``,
which is the intended RED signal for every test in this file. These tests
encode the SRC-05/06/07 observables (classifier accuracy, the always-on safety
net, tier-gating) and route/classify determinism as executable assertions so
Plan 02 implements against a fixed contract instead of exploring.

The single most important pin is ``test_classify_headline_is_consumer_not_dev``
— the #1 trap (Pitfall 1 / D-34 / D-38): the classifier MUST tokenize with
``salient_tokens(..., keep_stopwords=True)`` or the consumer-intent words
("best"/"free") are stripped as stopwords and the headline misroutes.

Contract under test (created by Plan 02 — ``routing.py``, stdlib-only)::

    ALWAYS_ON: frozenset[str]                 # == frozenset({"brave","reddit","hackernews"})
    SOURCE_TIERS: dict[str, frozenset[str]]   # the D-41 table, 12 entries
    def classify(topic: str) -> set[str]      # multi-label; {general} fallback
    def route(topic: str) -> list[str]        # sorted(ALWAYS_ON ∪ tier-eligible)
"""
import pathlib

import pytest
import yaml

import routing
from query_norm import salient_tokens

# Build the parametrize list straight from the committed benchmark so the
# classifier-accuracy test stays in lockstep with eval/topics.yaml (D-37/D-52):
# the labeled ``tier`` is the classifier ground truth.
_TOPICS = yaml.safe_load(
    (
        pathlib.Path(__file__).resolve().parent.parent / "eval" / "topics.yaml"
    ).read_text()
)["topics"]


# ── SRC-05: the classifier (the headline trap first) ─────────────────────────


def test_classify_headline_is_consumer_not_dev():
    # keep_stopwords=True must preserve "best"/"free"; "macos" must NOT trip dev (D-34)
    assert routing.classify("best free macOS malware scanner antivirus 2026") == {"consumer"}


@pytest.mark.parametrize("topic", _TOPICS, ids=[t["id"] for t in _TOPICS])
def test_classify_accuracy_over_10_labels(topic):
    # Multi-label: the labeled tier must be AMONG the returned set (D-33/D-52).
    assert topic["tier"] in routing.classify(topic["query"])


def test_keep_stopwords_consumer_words_survive():
    # A query that is ONLY consumer-filler still classifies consumer — proof the
    # classifier did NOT take the default stopword-stripping path (Pitfall 1).
    assert "consumer" in routing.classify("best cheap budget review vs comparison")


# ── SRC-06: ALWAYS_ON is a subset of every route (the safety net) ────────────


@pytest.mark.parametrize(
    "q",
    [t["query"] for t in _TOPICS]
    + ["rust async runtime tokio", "asdfqwer zxcv qwerty"],
)
def test_always_on_subset_of_every_route(q):
    # SRC-06 / D-36: brave+reddit+hackernews fire for every topic — including a
    # pure-dev query and a nonsense/misroute topic.
    assert routing.ALWAYS_ON <= set(routing.route(q))


# ── SRC-07: tier-gating ──────────────────────────────────────────────────────


def test_tier_gating_off_for_consumer_topic():
    # SRC-07 / D-45: dev/ML-only sources are ABSENT from a consumer route.
    fired = set(routing.route("best budget air purifier 2026 HEPA"))
    assert fired & {"npm", "huggingface", "arxiv", "openalex", "semanticscholar"} == set()


def test_youtube_gated_to_consumer_general_news_retired():
    # SRC-03 (D-23): youtube fires on a consumer topic, absent on a pure-dev topic.
    # REL-01 (Phase 19): `news` is RETIRED from the always-on route — absent everywhere.
    consumer_fired = set(routing.route("best budget air purifier 2026 HEPA"))
    assert "youtube" in consumer_fired
    assert "news" not in consumer_fired
    dev_fired = set(routing.route("rust async runtime tokio"))
    assert dev_fired & {"youtube", "news"} == set()


def test_dev_sources_fire_on_dev_topic():
    # SRC-07 positive case: github/stackoverflow present on a dev topic.
    fired = set(routing.route("rust async runtime tokio"))
    assert {"github", "stackoverflow"} <= fired


# ── purity / determinism (Phase-1 D-10/D-12) ─────────────────────────────────


def test_route_and_classify_deterministic():
    q = "model context protocol mcp"
    assert routing.classify(q) == routing.classify(q)
    assert routing.route(q) == routing.route(q)


# ── the registry is complete + ALWAYS_ON membership pinned (D-42/D-36) ───────


def test_source_tiers_registry_complete():
    assert set(routing.SOURCE_TIERS) == {
        "brave", "reddit", "hackernews", "github", "stackoverflow", "arxiv",
        "openalex", "semanticscholar", "huggingface", "npm", "youtube",
        "bluesky", "discourse", "rss", "europepmc", "entity",
        "ddg"}    # Phase 18: +europepmc/entity/ddg; Phase 19 (REL-01): -news → 17 names
    assert routing.ALWAYS_ON == frozenset({"brave", "reddit", "hackernews"})


# ─────────────────────────────────────────────────────────────────────────────
# Phase 17 — Query Understanding (QU-01, QU-05). RED until Plan 17-01 Task 3.
#
# These pin the _SCIENTIFIC academic-routing hook and the resolve_route override
# layer. They do NOT modify the existing tests above. The frozen-10
# non-regression guard proves _SCIENTIFIC is additive and disjoint from the 10
# frozen topics' vocab (no academic misroute on a non-academic topic) — the
# Pitfall-1 false-positive trap (17-RESEARCH §4).
# ─────────────────────────────────────────────────────────────────────────────


# ── QU-01: scientific/biomedical -> academic tier ────────────────────────────


def test_classify_biomedical_is_academic():
    # The dogfood biomedical query must route academic so arxiv/openalex/s2 fire
    # (today it has no scientific lexicon -> routes general/consumer -> F-01/F-18).
    assert "academic" in routing.classify(
        "low-intensity focused ultrasound glymphatic clearance"
    )
    assert "academic" in routing.classify(
        "transcranial focused ultrasound neuromodulation"
    )


def test_frozen_topics_classify_unchanged():
    # Every frozen-10 topic keeps its labeled tier among classify()'s output —
    # _SCIENTIFIC must not steal a label from any of the 10.
    for topic in _TOPICS:
        assert topic["tier"] in routing.classify(topic["query"])


def test_scientific_false_positive_guard():
    # Two non-academic frozen topics must NOT gain "academic" from _SCIENTIFIC
    # (the false-positive trap that would regress the frozen 1.0000 gate).
    assert "academic" not in routing.classify("best free macos malware scanner")
    assert "academic" not in routing.classify("mechanical keyboard switches comparison")


# ── QU-05: resolve_route() override layer (--all > --sources > --tier > classify)


def test_resolve_route_default_equals_route():
    # No overrides -> today's behaviour, byte-for-byte route().
    q = "low-intensity focused ultrasound glymphatic clearance"
    assert routing.resolve_route(q) == routing.route(q)


def test_resolve_route_all_returns_every_source():
    # --all -> sorted(SOURCE_TIERS ∪ ALWAYS_ON) == the sorted registry names.
    expected = sorted(set(routing.SOURCE_TIERS) | routing.ALWAYS_ON)
    assert routing.resolve_route("x", all_sources=True) == expected
    assert len(expected) == 17            # Phase 18 +europepmc/entity/ddg; Phase 19 (REL-01) -news → 17


def test_resolve_route_tier_fires_academic_sources():
    # --tier academic -> ALWAYS_ON ∪ academic-eligible (a tier hint, keeps the net).
    fired = set(routing.resolve_route("x", tier=["academic"]))
    assert {"arxiv", "openalex", "semanticscholar"} <= fired
    assert routing.ALWAYS_ON <= fired


def test_resolve_route_sources_honored_verbatim():
    # --sources is a deliberate override -> honored verbatim, NO ALWAYS_ON force-add.
    assert routing.resolve_route("x", sources=["github", "npm"]) == ["github", "npm"]


def test_resolve_route_validates_unknown_source():
    import pytest as _pytest

    with _pytest.raises(ValueError):
        routing.resolve_route("x", sources=["bogus"])


def test_resolve_route_validates_unknown_tier():
    import pytest as _pytest

    with _pytest.raises(ValueError):
        routing.resolve_route("x", tier=["bogus"])


def test_resolve_route_precedence_all_wins():
    # --all > --sources > --tier: with all three set, --all wins (the full 15).
    expected = sorted(set(routing.SOURCE_TIERS) | routing.ALWAYS_ON)
    assert (
        routing.resolve_route(
            "x", all_sources=True, sources=["github"], tier=["dev"]
        )
        == expected
    )


def test_routable_sources_tracks_registry():
    # The validation set == the canonical research_topic.SOURCES registry (so a
    # newly-added source can't silently fail --sources validation).
    import research_topic

    assert set(routing._ROUTABLE_SOURCES) == set(research_topic.SOURCES)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 19 — Sub-intent ideation gate (REL-04). RED until Plan 19-02.
#
# F-15: npm + huggingface fired on the MoltGrid ideation query "purely by
# dev-tier membership." A high-precision `_IDEATION` lexicon (mirroring the
# `_SCIENTIFIC` discipline) suppresses the build/package registries npm+HF when
# an ideation/market query hits — `news` is already retired (19-01), so the
# suppress set is just {npm, huggingface}. These tests pin: the MoltGrid
# suppression, that every frozen-10 topic's vocab is disjoint from `_IDEATION`
# (route stays byte-identical for the 10 → no frozen re-freeze), and that an
# explicit `--sources` override bypasses the gate (override > sub-intent).
# ─────────────────────────────────────────────────────────────────────────────

# VERBATIM from eval/topics_realworld.yaml id `longnl-moltgrid` (do NOT fabricate
# — this pins the exact query 19-03 re-tiers/re-freezes). Trips the gate via the
# salient tokens {ideas, startup, pivot, defensible, moat}.
_MOLTGRID = (
    "AI-agent startup ideas MoltGrid could pivot to that have a high success "
    "rate and a defensible MOAT"
)


def test_ideation_query_suppresses_npm_and_hf():
    # REL-04: an ideation/market query drops npm + huggingface from the fired set,
    # but the ALWAYS_ON safety net (brave/reddit/hackernews) is NEVER suppressed.
    fired = set(routing.route(_MOLTGRID))
    assert "npm" not in fired
    assert "huggingface" not in fired
    assert routing.ALWAYS_ON <= fired


@pytest.mark.parametrize("topic", _TOPICS, ids=[t["id"] for t in _TOPICS])
def test_ideation_lexicon_disjoint_from_frozen(topic):
    # No frozen-10 topic's vocab trips the gate → route() is byte-identical for
    # all 10 (npm/HF still fire when tier-eligible). This is the false-positive
    # guard that keeps the frozen 1.0000 gate intact (REL-04 needs no re-freeze).
    toks = set(salient_tokens(topic["query"], keep_stopwords=True))
    assert routing._IDEATION.isdisjoint(toks)


def test_ideation_gate_bypassed_by_explicit_sources_override():
    # override > sub-intent gate: an explicit `--sources npm` still fires npm even
    # on an ideation query (resolve_route's --sources branch returns before route()).
    assert routing.resolve_route(_MOLTGRID, sources=["npm"]) == ["npm"]
