"""TDD RED pins for the Phase-17 stdlib query-understanding core (QU-02/03/04).

These pin the contract for three new pure helpers added to ``query_norm.py`` in
Plan 17-01 Task 2 (GREEN):

    keyphrases(text, *, max_terms=6) -> list[str]   # QU-02 (highest leverage)
    expand_acronyms(text) -> str                     # QU-03
    detect_scope(text) -> str | None                 # QU-04

The top-level import below raises ``ImportError`` until Task 2 implements the
helpers — that is the intended RED signal for every test here. Assertions use the
EXACT dogfood query strings from ``eval/topics_realworld.yaml`` so the unit pins
sample the same failure modes the realworld benchmark measures (no aliasing — a
single combined test would blur the modes; 17-RESEARCH §"Validation Architecture").

All three helpers stay stdlib-only (``re``) and import-light (D-37/D-38): the
routing/query-shaping path is imported by the subagent-safe eval runner, so a new
top-level dependency would break ``tools/check_runner_imports.py``.
"""
import pytest

from query_norm import detect_scope, expand_acronyms, keyphrases

# Verbatim dogfood strings (the failure modes Phase 17 lifts). Kept as module
# constants so the idempotence pin re-feeds the SAME long query.
_LONG_MOLTGRID = (
    "AI-agent startup ideas MoltGrid could pivot to that have a high success "
    "rate and a defensible MOAT"
)
_BIOMED = "low-intensity focused ultrasound glymphatic clearance"
_REACH = "Ways to make paper 1 in REACH box folder better"


# ── QU-02: keyphrases() — drop entity/filler noise to <=6 salient terms ──────


def test_keyphrases_caps_at_max_terms():
    # The 18-word NL query must collapse to <= 6 salient terms so keyword APIs
    # (github/HN/SO/npm) stop returning [] (F-12, the highest-leverage fix).
    out = keyphrases(_LONG_MOLTGRID)
    assert isinstance(out, list)
    assert len(out) <= 6


def test_keyphrases_drops_proper_noun_noise():
    # "MoltGrid" is a rare proper noun that matches nothing in code/Q&A APIs;
    # it must fall outside the kept salient budget (casefolded -> "moltgrid").
    out = keyphrases(_LONG_MOLTGRID)
    assert "moltgrid" not in out


def test_keyphrases_drops_filler_adjectives():
    # Filler the shared STOPWORDS set misses but that dilutes a query.
    out = keyphrases(_LONG_MOLTGRID)
    for filler in ("high", "success", "rate", "defensible"):
        assert filler not in out


def test_keyphrases_keeps_a_salient_term():
    # At least one genuine salient term must survive the trim.
    out = keyphrases(_LONG_MOLTGRID)
    assert set(out) & {"startup", "agent", "pivot", "moat"}


def test_keyphrases_empty_and_all_stopword_return_empty():
    # Empty / all-stopword input -> [] (never raises) — the same guard
    # salient_tokens provides for downstream query builders.
    assert keyphrases("") == []
    assert keyphrases("the a of to") == []


def test_keyphrases_is_idempotent_on_its_own_output():
    # Re-feeding its own output yields a subset (no double-trim drift).
    first = keyphrases(_LONG_MOLTGRID)
    second = keyphrases(" ".join(first))
    assert set(second) <= set(first)


# ── QU-03: expand_acronyms() — augment, don't replace ────────────────────────


def test_expand_acronyms_lifu_adds_spelled_out_form():
    # LIFU -> the spelled-out form is appended AND the rest of the query survives
    # (augment, not replace — F-07: the strongest BM25 hit matched the long form).
    out = expand_acronyms("LIFU for glymphatic clearance").casefold()
    assert "low-intensity focused ultrasound" in out
    assert "glymphatic" in out


def test_expand_acronyms_is_case_insensitive():
    # Lowercase acronym expands too (whole-token casefold match).
    assert "low-intensity focused ultrasound" in expand_acronyms("lifu").casefold()


def test_expand_acronyms_leaves_non_acronyms_unchanged():
    # A non-acronym word is returned unchanged (no spurious expansion).
    assert expand_acronyms("ultrasound") == "ultrasound"


def test_expand_acronyms_whole_token_only():
    # "LIFUX" must NOT match the "lifu" key (whole-token match only).
    assert "low-intensity focused ultrasound" not in expand_acronyms("LIFUX").casefold()


# ── QU-04: detect_scope() — document-task intent vs in-scope research query ───


def test_detect_scope_reach_is_document_task():
    # "make ... better" improve-signal + "paper"/"folder" artifact -> document_task.
    assert detect_scope(_REACH) == "document_task"


def test_detect_scope_research_query_is_none():
    # A real research query (no artifact/possessive) is in-scope -> None.
    assert detect_scope(_BIOMED) is None


def test_detect_scope_possessive_artifact_improve():
    # possessive ("my") + artifact ("manuscript") + improve-verb ("improve").
    assert (
        detect_scope("improve my manuscript before journal submission")
        == "document_task"
    )


# ── QU-04 (17-02): scope surfaced additively in the digest (banner) ──────────


def test_digest_scope_banner_present_when_document_task():
    # The additive scope banner is rendered when a document-task scope is passed,
    # WITHOUT removing the ranked block (ROB-08). digest() pulls the heavy stack,
    # so import it lazily inside the test (keeps the module import-light at collect).
    import research_topic

    md = research_topic.digest(_REACH, {}, scope="document_task")
    assert "improve a private document" in md, "the out-of-scope banner must appear"
    assert "ranked results" in md, "the ranked block must still be present (additive)"


def test_digest_legacy_two_arg_call_unchanged():
    # The legacy 2-arg digest(topic, collected) call still returns a string with the
    # ranked block and NO scope banner (scope defaults to None — byte-stable contract).
    import research_topic

    md = research_topic.digest("rust async runtime", {})
    assert isinstance(md, str)
    assert "ranked results" in md
    assert "improve a private document" not in md, "no banner when scope is None"


# ── QU-05 (17-02): route_override threads through run_with_status/_run_async ──
#
# Drive run_with_status() over an offline httpx.MockTransport so every FIRED source
# completes (via the non-fatal breaker) and lands a key in `collected` — the observable
# proving resolve_route's output reached the fan-out. The frozen run()/route()/classify()
# are untouched (route_override is keyword-only with a default).


def _empty_origin_client():
    import httpx

    import research as R

    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={}))
    return httpx.AsyncClient(transport=transport, headers={"User-Agent": R.UA})


def test_route_override_all_sources_fires_all_fifteen(monkeypatch):
    import research_topic
    import routing

    monkeypatch.setattr(research_topic, "_make_client", _empty_origin_client)
    monkeypatch.setattr(research_topic, "_make_rss_client", _empty_origin_client)
    _slug, collected, _status = research_topic.run_with_status(
        "rust async runtime", 3, route_override={"all_sources": True})
    assert set(collected) == set(research_topic.SOURCES), "--all must fire every registered source"
    assert set(collected) == set(routing.resolve_route("rust async runtime", all_sources=True))


def test_route_override_sources_honored_verbatim(monkeypatch):
    import research_topic

    monkeypatch.setattr(research_topic, "_make_client", _empty_origin_client)
    monkeypatch.setattr(research_topic, "_make_rss_client", _empty_origin_client)
    _slug, collected, _status = research_topic.run_with_status(
        "rust async runtime", 3, route_override={"sources": ["github"]})
    # Honored VERBATIM — ALWAYS_ON (brave/reddit/hackernews) is NOT force-added.
    assert set(collected) == {"github"}, "--sources must be honored verbatim (no ALWAYS_ON force-add)"


def test_route_override_tier_keeps_always_on(monkeypatch):
    import research_topic
    from routing import ALWAYS_ON

    monkeypatch.setattr(research_topic, "_make_client", _empty_origin_client)
    monkeypatch.setattr(research_topic, "_make_rss_client", _empty_origin_client)
    _slug, collected, _status = research_topic.run_with_status(
        "rust async runtime", 3, route_override={"tier": ["academic"]})
    fired = set(collected)
    assert {"arxiv", "openalex", "semanticscholar"} <= fired, "--tier academic fires the scholarly set"
    assert ALWAYS_ON <= fired, "--tier keeps the ALWAYS_ON safety net"


def test_route_override_bad_source_name_raises():
    # resolve_route validates against the registry; a bad name raises ValueError,
    # which main() converts to a non-zero sys.exit (fail-fast, T-17-03).
    import research_topic

    with pytest.raises(ValueError):
        research_topic.run_with_status(
            "rust async runtime", 3, route_override={"sources": ["not_a_real_source"]})


# ── QU-04 (17-03): the intent-literal-reach companion observable ─────────────
#
# The QU-04 win for the out-of-scope "improve my document" query is "detected +
# fewer literal-keyword negatives" — proven by a standalone unit test, NOT a new
# scored field in run_eval.py (measure-first discipline; 17-RESEARCH §6). Two pins:
#   (a) detect_scope flags the REACH query as a document_task (the detection half);
#   (b) the negative-term hit count in rank.rank_items(...)[:10] over the recorded
#       intent-literal-reach fixtures does not INCREASE vs the Phase-16 RED ceiling.


def test_reach_scope_detected():
    # QU-04 detection half: the literal "make ... better" + "paper"/"folder"
    # artifact phrasing is an out-of-scope document task, not a research query.
    from query_norm import detect_scope

    assert detect_scope(_REACH) == "document_task"


# The intent-literal-reach RED ceiling — the number of items in the ranked top-10
# that carry >=1 negative term (an absolute disqualifier in eval/judge.py), counted
# over the CURRENT (Phase-16 RED) fixtures at eval/fixtures_realworld/intent-literal-
# reach/ BEFORE the Plan-17 live re-record. Phase 17 must NOT increase this garbage
# (ideally QU-04 drops it). DERIVATION (offline, this tree, 2026-06-25): loaded the
# 8 recorded envelopes, ran rank.rank_items(query, collected)[:10], and counted top-10
# items whose casefolded title+text+url+tags haystack contains any topics_realworld.yaml
# `negative` term -> 6 of 10 (3 S-box/avalanche/black-box adversarial-ML papers from
# semanticscholar + 3 wikiHow paper-box/pocket-folder how-tos + the IKEA organizers
# page). Re-checked against the RE-RECORDED fixtures in Task 3 (must stay <= 6).
REACH_NEGATIVE_RED = 6

# The four realworld topic ids (their recorded fixtures live under the realworld
# track dir, NOT the frozen eval/fixtures/). The reach pin reads only its own dir.
_REALWORLD_FIXTURES_DIR = "eval/fixtures_realworld"


def _negative_hits(topic_id: str) -> int:
    """Count how many of a realworld topic's recorded ranked top-10 carry a negative term.

    Mirrors the eval runner's ranking path EXACTLY: build ``collected`` from each
    source's recorded envelope ``items`` (eval/run_eval.py ``_gather_fixture``), then
    ``rank.rank_items(query, collected)[:10]`` (the same call ``eval/metrics.merge_collected``
    makes for a truthy query). A "negative hit" uses ``eval/judge.normalize`` semantics —
    a casefolded ``title + text + url + tags`` haystack, substring match — because a
    negative term is an absolute disqualifier there. Reads the RECORDED realworld track
    (``eval/fixtures_realworld/<id>/``), never the frozen ``eval/fixtures/``.
    """
    import glob
    import json
    import os

    import yaml

    import rank
    from eval.judge import normalize

    spec = yaml.safe_load(open("eval/topics_realworld.yaml"))
    topic = next(t for t in spec["topics"] if t["id"] == topic_id)
    query = topic["query"]
    negatives = [n.casefold() for n in (topic["relevance"].get("negative") or [])]

    collected: dict[str, list[dict]] = {}
    for path in sorted(glob.glob(f"{_REALWORLD_FIXTURES_DIR}/{topic_id}/*.json")):
        source = os.path.basename(path)[:-5]
        with open(path) as fh:
            envelope = json.load(fh)
        collected[source] = (envelope or {}).get("items", []) if envelope else []

    ranked = rank.rank_items(query, collected)[:10]
    return sum(
        1 for item in ranked if any(term in normalize(item) for term in negatives)
    )


def test_reach_negatives_not_increased():
    # QU-04 companion observable (17-03-02): the literal-keyword garbage in the
    # intent-literal-reach top-10 must not GROW vs the Phase-16 RED ceiling. Run now
    # against the existing fixtures (count == the ceiling) and RE-RUN in Task 3 against
    # the re-recorded fixtures (must stay <=). gold:[] for this topic, so P@10 ~ 0 is
    # acceptable — QU-04 is proven HERE (detected + negatives bounded), not by a P@10 lift.
    hits = _negative_hits("intent-literal-reach")
    assert hits <= REACH_NEGATIVE_RED, (
        f"intent-literal-reach negative-term hits in top-10 rose to {hits} "
        f"(RED ceiling {REACH_NEGATIVE_RED}) — Phase 17 must not increase literal-keyword garbage"
    )


# ── QU-02 (17-02-01): keyphrase shaping reaches ONLY the keyword sources ──────
#
# The no-double-normalize structural pin: drive run_with_status() with every
# `research.<source>` monkeypatched to a stub that RECORDS the query it received,
# then assert the six keyword sources saw the SHAPED kq while the web sources +
# the academic self-normalizers saw the FULL topic (double-normalizing the
# self-normalizers would starve their fielded builders — research_topic.py:320).

# The six keyword sources get kq = " ".join(keyphrases(expand_acronyms(topic))).
_KEYWORD_SOURCES = {"hackernews", "github", "stackoverflow", "npm", "bluesky", "discourse"}
# These keep the FULL topic: web/free-text (brave/reddit/youtube/rss) + the
# academic self-normalizers (arxiv/openalex/semanticscholar) + huggingface.
# (`news` retired from the always-on route in Phase 19 / REL-01.)
_FULLTOPIC_SOURCES = {
    "brave", "reddit", "youtube", "rss",
    "arxiv", "openalex", "semanticscholar", "huggingface",
}


def test_no_double_normalize_shaping_reach(monkeypatch):
    # Map research_topic's registry name -> the research.py function attribute it calls.
    import research as R
    import research_topic
    from query_norm import expand_acronyms, keyphrases

    name_to_attr = {
        "brave": "brave", "reddit": "reddit", "hackernews": "hn", "github": "github",
        "arxiv": "arxiv", "openalex": "openalex", "semanticscholar": "semanticscholar",
        "huggingface": "huggingface", "npm": "npm", "stackoverflow": "stackoverflow",
        "youtube": "youtube", "bluesky": "bluesky",   # REL-01: `news` retired from the route
        "discourse": "discourse", "rss": "rss",
    }
    seen: dict[str, str] = {}

    def _make_stub(source_name: str):
        async def _stub(client, a):
            # Record the query each source received, then write an empty envelope via the
            # patched R.write_out (the in-memory collector _run_async installs) — no network.
            seen[source_name] = a.query
            R.write_out(source_name, a.query, [])
        return _stub

    for name, attr in name_to_attr.items():
        monkeypatch.setattr(R, attr, _make_stub(name))

    # --all fires every registered source so we observe what query each one got.
    research_topic.run_with_status(_REACH, 3, route_override={"all_sources": True})

    kq = " ".join(keyphrases(expand_acronyms(_REACH))) or _REACH
    assert kq != _REACH, "the REACH query must SHAPE to a different kq for this pin to bite"

    for source in _KEYWORD_SOURCES:
        assert source in seen, f"{source} should have fired under --all"
        # github appends ' stars:>50' AFTER shaping; the rest pass kq verbatim. Either way
        # the keyword source received the SHAPED keyphrases, NOT the full natural-language topic.
        assert seen[source].startswith(kq), (
            f"{source} should receive the SHAPED kq {kq!r}, got {seen[source]!r}"
        )
        assert _REACH not in seen[source], (
            f"{source} must NOT receive the full topic (double-normalize guard), got {seen[source]!r}"
        )

    for source in _FULLTOPIC_SOURCES:
        assert source in seen, f"{source} should have fired under --all"
        assert seen[source] == _REACH, (
            f"{source} (web/self-normalizer) must receive the FULL topic, got {seen[source]!r}"
        )


# ── SRC-10 (18-02): detect_entity_query() precision table ─────────────────────
#
# query_norm.detect_entity_query(text) -> bool flags a person/organization query
# (F-19/F-22) so the conditional `entity` source fires ONLY for a person/org query.
# It is import-light (re ONLY) — imported lazily inside these tests so the rest of
# this module stays collectable while detect_entity_query is RED (Task 1 → Task 2).
#
# HIGH-PRECISION (mirrors the routing._SCIENTIFIC false-positive discipline): a
# misfire that routes a normal academic/dev query to entity-mode must NOT displace
# good results on the frozen gate, so EVERY frozen-10 topic + the dev/consumer
# realworld queries are asserted FALSE (the false-positive guard). All are
# `-k entity_detect`-selectable.

# The 10 frozen queries are read from eval/topics.yaml (NOT hand-copied) so the
# negative table can never silently drift from the gate the entity source must not
# touch (mirrors test_frozen_topics_classify_unchanged's read-don't-copy discipline).
def _frozen_queries() -> list[str]:
    import yaml

    spec = yaml.safe_load(open("eval/topics.yaml"))
    return [t["query"] for t in spec["topics"]]


# The dev/consumer realworld queries that MUST be False (they are topics, not a
# person/org): the long MoltGrid NL query and the biomedical glymphatic query.
_ENTITY_NEGATIVE_REALWORLD = [_LONG_MOLTGRID, _BIOMED, _REACH]

# Person/org queries that MUST be True (the entity-resolution targets).
_ENTITY_POSITIVES = [
    "Jordan Amadio Institute of Neuro Innovation UT Austin",
    "Dr. Jane Smith neurosurgeon",
    "Stanford University neuroscience lab",
    "Institute of Neuro Innovation",
]


@pytest.mark.parametrize("query", _ENTITY_POSITIVES)
def test_entity_detect_positive(query):
    # A person/org query is detected (an org/person cue, or >=2 mixed-case proper
    # nouns dominating). detect_entity_query is the gate the `entity` source fires on.
    from query_norm import detect_entity_query

    assert detect_entity_query(query), f"{query!r} should be detected as a person/org query"


@pytest.mark.parametrize("query", _frozen_queries())
def test_entity_detect_negative_frozen(query):
    # THE FALSE-POSITIVE GUARD: every frozen-10 topic is a NON-entity query, so the
    # entity source self-limits off the frozen gate (-> 0 hits -> byte-unchanged 1.0000).
    from query_norm import detect_entity_query

    assert not detect_entity_query(query), (
        f"frozen-10 query {query!r} must NOT be detected as a person/org query "
        "(a false positive would route an academic/dev query to entity-mode)"
    )


@pytest.mark.parametrize("query", _ENTITY_NEGATIVE_REALWORLD)
def test_entity_detect_negative_realworld(query):
    # The dev/consumer realworld queries are topics, not people/orgs -> False.
    from query_norm import detect_entity_query

    assert not detect_entity_query(query), (
        f"realworld query {query!r} is a topic, not a person/org — must be False"
    )
