"""Stdlib-only single source of truth for query routing (D-40).

Imported by ``research_topic.run()`` AND the import-light eval runner
(``eval/run_eval.py``) — therefore it imports ONLY ``query_norm`` (itself
stdlib). NEVER import numpy / rank / httpx / bm25s / datasketch here
(D-38/D-40): the eval runner's docstring forbids heavy imports so it stays
subagent-safe, and ``routing.py`` is on that import path.

This module holds three things and does ZERO I/O:

* ``ALWAYS_ON`` — the ``{brave, reddit, hackernews}`` safety net that fires for
  every topic regardless of the classifier (SRC-06 / D-36).
* ``SOURCE_TIERS`` — the D-41 routing table mapping each of the 12 registered
  sources to the tiers it is eligible for.
* ``classify(topic) -> set[str]`` — the deterministic, case-insensitive,
  multi-label tier classifier (SRC-05 / D-32/D-33/D-34/D-35/D-38). Tokenizes
  with ``salient_tokens(topic, keep_stopwords=True)`` — the ONLY correct call
  (the default path strips ``best/free/vs/...``, the exact consumer-intent
  words, and silently misroutes every consumer query to ``{general}``).
* ``route(topic) -> list[str]`` — the per-run firing set ``ALWAYS_ON`` ∪
  tier-eligible sources (SRC-07 / D-42), sorted for deterministic output.

Pure functions over token sets: no URL, no host, no network — SSRF is
structurally impossible here (mitigated at the source-fn layer in Plan 03).
"""
import re

from query_norm import salient_tokens

# --- Source registry & always-on safety net (D-36 / D-41) -------------------

ALWAYS_ON: frozenset[str] = frozenset({"brave", "reddit", "hackernews"})  # SRC-06 safety net (D-36)

SOURCE_TIERS: dict[str, frozenset[str]] = {            # D-41 routing table — the 17-name registry (Phase 18 +europepmc/entity/ddg; Phase 19 -news)
    "brave":           frozenset({"dev", "academic", "consumer", "general"}),
    "reddit":          frozenset({"dev", "academic", "consumer", "general"}),
    "hackernews":      frozenset({"dev", "academic", "consumer", "general"}),
    "github":          frozenset({"dev", "academic"}),
    "stackoverflow":   frozenset({"dev", "academic"}),
    "arxiv":           frozenset({"academic"}),
    "openalex":        frozenset({"academic"}),
    "semanticscholar": frozenset({"academic"}),
    "europepmc":       frozenset({"academic"}),            # SRC-08 (Phase 18): keyless biomedical literature
    "entity":          frozenset({"general", "consumer", "dev", "academic"}),  # SRC-10 (Phase 18): person/org entity resolution — tier-broad (mirror ddg); the detect_entity_query conditional-fire thunk is the real gate, so entity must be eligible on general-tier person/org queries (e.g. amadio) too
    "ddg":             frozenset({"general", "consumer", "dev", "academic"}),  # SRC-09 (Phase 18): keyless web fallback — mirror brave's web tiers; the no-key-Brave gate bounds actual firing

    "huggingface":     frozenset({"dev"}),
    "npm":             frozenset({"dev"}),
    "youtube":         frozenset({"consumer", "general"}),
    # `news` (GDELT) RETIRED from the always-on route (Phase 19, REL-01): 4/4 dogfood
    # 429s + 13–15s latency (F-05); Brave covers web/news. Kept as a dormant CLI
    # subcommand in research.build_parser() only — not routed, not in SOURCES.
    "bluesky":         frozenset({"dev"}),                 # D-11-01 dev-tier-only (Phase 11)
    "discourse":       frozenset({"dev"}),                 # D-12-03 escape valve realized: re-tiered {dev,academic}→{dev} (academic per-source 0/3 < 0.80)
    "rss":             frozenset({"dev"}),                 # D-13-03 escape valve fired: rss per-source 0.207<0.80 (FAIL) but macro-avg P@10 held 1.0000 → re-tiered {dev,academic}→{dev} (re-tier not drop; mirrors D-12-03 discourse)
}
# OQ#1 ratified: follow D-41 narrowing; verify at the live gate (Plan 05) that
# consumer recall does not suffer — if it does, restore github/SO to cross-tier ONLY.

# --- Tier lexicons (D-34) ----------------------------------------------------
# Any-hit multi-label rule (OQ#3): a tier fires if the topic's token set
# intersects that tier's lexicon — no weights needed to pass the 10 labels.

_YEAR = re.compile(r"^(19|20)\d{2}$")

_DEV: frozenset[str] = frozenset({
    "api", "cli", "sdk", "library", "framework", "package", "python", "rust",
    "go", "golang", "async", "code", "compiler", "runtime", "server", "kubernetes",
    "docker", "tokio", "npm", "react", "agent", "agents", "mcp",
})
# NOTE (D-34, Pitfall 1 / Anti-pattern): `macos`, `windows`, `linux` are
# deliberately ABSENT from _DEV — a bare platform noun must NOT trip dev or the
# malware query re-pollutes with npm/HF/arXiv. `agent`/`agents` ARE in _DEV (the
# llm-agents topic is labeled dev); `mcp` is in _DEV so the mcp topic lands dev.

_ACADEMIC: frozenset[str] = frozenset({
    "algorithm", "retrieval", "paper", "theorem", "benchmark", "embedding",
    "fusion", "reciprocal", "model", "dataset", "neural", "transformer",
    "rrf", "bm25", "protocol",
})

_CONSUMER: frozenset[str] = frozenset({
    "best", "cheap", "budget", "review", "reviews", "vs", "versus",
    "comparison", "compare", "buy", "top", "price", "antivirus", "malware",
    "scanner", "keyboard", "switches", "switch", "purifier", "hepa",
    "sourdough", "bread", "baking", "vehicle", "ev", "battery", "range",
})

# Consumer-ish lifestyle / general-interest tokens. When any of these hit, the
# topic is both consumer AND general (D-33/D-35): sourdough/EV are labeled
# `general`, and youtube/news fire on consumer OR general identically per
# SOURCE_TIERS, so adding both costs nothing while satisfying the subset rule.
_GENERAL: frozenset[str] = frozenset({
    "sourdough", "bread", "baking", "vehicle", "ev", "range", "battery",
    "charging", "kwh", "tesla",
})

# --- Scientific/biomedical lexicon (QU-01, Phase 17) -------------------------
# A compact curated set covering the dogfood failure vocabulary (LIFU/glymphatic
# clearance, transcranial focused-ultrasound neuromodulation) + close neighbours,
# so a scientific/biomedical query routes `academic` and arxiv/openalex/s2 fire
# (today classify() has no scientific lexicon -> general/consumer -> F-01/F-18).
#
# THE FALSE-POSITIVE TRAP (17-RESEARCH §4 / routing.py Pitfall-1): this set MUST
# stay disjoint from every frozen-10 topic's vocab — a bare common/platform noun
# would re-route a non-academic frozen topic to academic and break the 1.0000
# gate. So: NO common nouns (`model`/`protocol`/`benchmark` already live in
# _ACADEMIC and are kept there — _SCIENTIFIC is additive and disjoint), only
# high-precision scientific terms. No morphological-suffix regex is used: the
# lexicon alone covers the dogfood queries and the frozen-10 non-regression +
# biomedical pins both pass with it (the conservative, low-false-positive lever).
_SCIENTIFIC: frozenset[str] = frozenset({
    "glymphatic", "ultrasound", "neuromodulation", "cerebrospinal",
    "transcranial", "neurosurgery", "neurosurgeon", "biomarker", "clinical",
    "vivo", "vitro", "cortical", "synaptic", "proteomic", "genomic",
    "microbiome", "cohort", "pathophysiology", "neuroscience", "neurotech",
    "preclinical", "cranial", "sonication",
})

# --- Sub-intent ideation gate (REL-04, Phase 19) -----------------------------
# High-precision ideation/market lexicon. When ANY of these tokens hit, the
# build/package registries npm + huggingface are pure noise (F-15: they fired on
# the MoltGrid ideation query by dev-tier membership). MUST stay disjoint from
# every frozen-10 topic's vocab — PROVEN by live salient_tokens tokenization
# (19-RESEARCH §4): zero frozen hit, so route() is byte-identical for the 10 and
# REL-04 needs no frozen re-freeze. NO bare common nouns
# ("project"/"build"/"tool"/"company"/"business") — those collide with dev/general
# topics and would suppress npm/HF on a legitimate software query, breaking the
# 1.0000 gate (the _SCIENTIFIC Pitfall-1 discipline). NOTE: salient_tokens splits
# on hyphens, so the multi-word entries (go-to-market/market-map) never match a
# token — they are documentation of intent, harmless (cannot false-positive); the
# single-word terms are what actually fire the gate.
_IDEATION: frozenset[str] = frozenset({
    "ideas", "idea", "startup", "startups", "pivot", "brainstorm",
    "monetize", "monetization", "moat", "defensible", "defensibility",
    "go-to-market", "gtm", "market-map", "niche", "opportunity", "opportunities",
    "saas", "venture", "founder", "founders",
})
_IDEATION_SUPPRESS: frozenset[str] = frozenset({"npm", "huggingface"})  # build/package registries pollute ideation queries (`news` already retired in 19-01)


def classify(topic: str) -> set[str]:
    """Deterministic multi-label tier classifier (SRC-05).

    MUST tokenize with ``keep_stopwords=True`` (D-38) or the consumer-intent
    words (best/free/vs/...) are stripped and every consumer query misroutes to
    ``{general}`` (Pitfall 1).

    :param topic: raw topic / query string.
    :returns: the set of tiers the topic belongs to; ``{"general"}`` when no
        lexicon fires (the no-signal fallback, D-35).
    """
    toks = set(salient_tokens(topic, keep_stopwords=True))   # D-38 — keep_stopwords=True is MANDATORY
    tiers: set[str] = set()
    if toks & _DEV:
        tiers.add("dev")
    if toks & _ACADEMIC:
        tiers.add("academic")
    if toks & _SCIENTIFIC:                # QU-01: scientific/biomedical -> academic
        tiers.add("academic")
    if (toks & _CONSUMER) or any(_YEAR.match(t) for t in toks):
        tiers.add("consumer")
    if toks & _GENERAL:
        tiers |= {"consumer", "general"}
    return tiers or {"general"}        # D-35 fallback


def route(topic: str) -> list[str]:
    """Derived per-run firing set: ``ALWAYS_ON`` ∪ tier-eligible sources (D-42).

    :param topic: raw topic / query string.
    :returns: the sorted list of source names that should fire for this topic —
        always a superset of ``ALWAYS_ON`` (SRC-06).
    """
    active = classify(topic)
    fired = set(ALWAYS_ON)
    for name, tiers in SOURCE_TIERS.items():
        if tiers & active:
            fired.add(name)
    # REL-04 sub-intent gate: an ideation/market query drops the build/package
    # registries (npm/HF) — pure noise for "give me startup ideas / market map".
    # ALWAYS_ON is never in the suppress set, so the safety net is preserved.
    if set(salient_tokens(topic, keep_stopwords=True)) & _IDEATION:
        fired -= _IDEATION_SUPPRESS
    return sorted(fired)


# --- Override layer above the frozen route()/classify() (QU-05, Phase 17) ----

# The 15-name validation set for --sources, built from the frozen registry with
# NO import of research_topic (that would create a cycle and risk a heavy pull).
# SOURCE_TIERS already holds all 12 tier-routed names and ALWAYS_ON the 3 net
# names — together the full 15 of research_topic.SOURCES (pinned by a test).
_ROUTABLE_SOURCES: frozenset[str] = frozenset(SOURCE_TIERS) | ALWAYS_ON

# The 4 valid --tier values (a tier not in this set is an input error, T-17-03).
_VALID_TIERS: frozenset[str] = frozenset({"dev", "academic", "consumer", "general"})


def resolve_route(
    topic: str,
    *,
    tier: list[str] | None = None,
    sources: list[str] | None = None,
    all_sources: bool = False,
) -> list[str]:
    """Override-aware router above the frozen ``route()``/``classify()`` (QU-05).

    Precedence (RESEARCH §7): ``--all`` > ``--sources`` > ``--tier`` > classifier.
    ``route()``/``classify()``/``SOURCE_TIERS`` are NEVER mutated — this is a thin
    layer the CLI threads through so the eval's frozen path stays byte-identical.

    * ``all_sources`` -> sorted(all 15 routable sources).
    * ``sources``     -> the explicit list honored VERBATIM (a deliberate override;
      ALWAYS_ON is NOT force-added). Every name is validated against
      ``_ROUTABLE_SOURCES`` — an unknown name raises ``ValueError``.
    * ``tier``        -> ``ALWAYS_ON`` ∪ tier-eligible sources (a tier hint, so the
      safety net is kept). Every value is validated against ``_VALID_TIERS`` —
      an unknown tier raises ``ValueError``.
    * else            -> ``route(topic)`` (today's behaviour, unchanged).

    Pure token/set logic — the validated values select from a fixed frozenset and
    are NEVER concatenated into a URL/path/shell command, so SSRF/injection is
    structurally impossible (T-17-03). No I/O.

    :param topic: raw topic / query string (used only on the default path).
    :param tier: optional list of tier names to force (repeatable ``--tier``).
    :param sources: optional explicit source list (``--sources a,b,c``).
    :param all_sources: when True, fire every routable source (``--all``).
    :returns: the sorted list of source names to fire.
    :raises ValueError: on an unknown source name or tier value.
    """
    if all_sources:
        return sorted(_ROUTABLE_SOURCES)
    if sources:
        unknown = [s for s in sources if s not in _ROUTABLE_SOURCES]
        if unknown:
            raise ValueError(
                f"unknown source(s): {sorted(unknown)}; "
                f"valid: {sorted(_ROUTABLE_SOURCES)}"
            )
        return sorted(set(sources))
    if tier:
        unknown_tiers = [t for t in tier if t not in _VALID_TIERS]
        if unknown_tiers:
            raise ValueError(
                f"unknown tier(s): {sorted(unknown_tiers)}; "
                f"valid: {sorted(_VALID_TIERS)}"
            )
        wanted = set(tier)
        fired = set(ALWAYS_ON)
        for name, tiers in SOURCE_TIERS.items():
            if tiers & wanted:
                fired.add(name)
        return sorted(fired)
    return route(topic)
