"""Shared query-normalization helper (D-37) — stdlib-only, import-light.

The single DRY normalizer consumed by the arXiv (ENDP-02, Plan 04) and Semantic
Scholar (ENDP-06, Plan 05) source fixes, so each does NOT re-derive stopword logic.

It lowercases the topic, splits on non-alphanumeric runs, drops a static English
stopword set, and returns the remaining salient tokens in first-seen order
(de-duplicated). Empty / whitespace / all-stopword input returns ``[]`` — the guard
those sources rely on before building a query.

  * Semantic Scholar (D-33): trim a long query to salient terms so it stops
    returning 0 (long-query stopword dilution).
  * arXiv (D-29): extract the salient tokens that become the
    ``(ti:<tok> OR abs:<tok>) AND ...`` field-prefixed query.

This is NOT the Phase-4 query classifier — tokenization only, no routing, no
tiering. ``re`` is the ONLY import (no third-party, no yaml/httpx) so it stays
subagent-safe / import-light (D-37/D-38) — importable inside Donny subagents and the
eval runner's metric path.

Phase 17 (Query Understanding) adds three more pure, stdlib-only helpers on the
SAME import-light path (no new import — ``re`` only — D-37/D-38, T-17-01 bounded
regex):

  * ``keyphrases(text)`` (QU-02, highest leverage) — trims a long natural-language
    query to the few salient terms keyword APIs (github/HN/SO/npm) can actually
    match, dropping proper-noun/entity noise and an EXTENDED keyphrase-only filler
    set ``_KEYPHRASE_NOISE``. That noise set is **more aggressive than the shared
    ``STOPWORDS``** (which other callers reuse for routing/source-query building):
    it is applied ONLY inside ``keyphrases`` so it never widens what ``classify``
    or the academic source builders treat as filler.
  * ``expand_acronyms(text)`` (QU-03) — augments (does NOT replace) the query with
    spelled-out forms of curated acronyms so both forms stay searchable.
  * ``detect_scope(text)`` (QU-04) — flags an "improve my artifact" document-task
    query (the scraper does web retrieval, not private-document critique).

Usage::

    from query_norm import salient_tokens, STOPWORDS
    salient_tokens("best free macOS malware scanner")  # -> ["macos", "malware", "scanner"]
    keyphrases("AI-agent startup ideas MoltGrid could pivot to ...")  # noise dropped, <=6 terms
    expand_acronyms("LIFU for glymphatic clearance")  # -> "... low-intensity focused ultrasound"
    detect_scope("improve my manuscript")  # -> "document_task"
"""
import re

# Collapse any run of non-alphanumeric characters into a single split point. Fixed
# character-class substitution (linear, no catastrophic backtracking) over a bounded
# topic string — the same vetted pattern as eval/judge.py:23 (threat T-02-01).
_NON_ALNUM = re.compile(r"[^a-z0-9]+")

# A small, static English stopword set: articles, prepositions, conjunctions,
# pronouns, auxiliaries/copulas, plus search-query filler ("best", "free", "vs",
# "using", "how", "guide", "comparison", "top", "review", ...) that dilute a topic
# without carrying meaning. All lowercase. Hand-written and stdlib-only on purpose —
# pulling in nltk/sklearn would break subagent-safety (D-37). Notably this set does
# NOT contain content nouns like "agent"/"agents" — only genuine filler is removed.
STOPWORDS: frozenset[str] = frozenset(
    {
        # articles / determiners
        "a", "an", "the", "this", "that", "these", "those", "some", "any",
        "each", "every", "all", "both", "no",
        # conjunctions
        "and", "or", "but", "nor", "so", "yet", "if", "then", "than", "as",
        "because",
        # prepositions
        "of", "in", "on", "at", "to", "for", "with", "without", "by", "from",
        "into", "onto", "over", "under", "about", "between", "through",
        "during", "before", "after", "above", "below", "up", "down", "out",
        "off", "via",
        # pronouns
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
        "them", "my", "your", "his", "its", "our", "their", "what", "which",
        "who", "whom", "whose",
        # auxiliaries / copulas / common verbs
        "is", "are", "was", "were", "be", "been", "being", "am", "do", "does",
        "did", "have", "has", "had", "can", "could", "should", "would", "will",
        "shall", "may", "might", "must",
        # wh-words / adverbs of manner often used in queries
        "how", "when", "where", "why", "not",
        # search-query filler (the terms that dilute a topic)
        "best", "free", "top", "vs", "versus", "using", "use", "guide",
        "tutorial", "comparison", "compare", "review", "reviews", "good",
        "great", "new", "latest", "cheap", "easy", "simple", "way", "ways",
        "list", "introduction", "intro", "overview", "tips",
    }
)


def salient_tokens(text: str, *, keep_stopwords: bool = False) -> list[str]:
    """Lowercase, split on non-alphanumeric runs, drop STOPWORDS, return tokens.

    Tokens are returned in first-seen order and de-duplicated (the first occurrence
    of each distinct token is kept). With ``keep_stopwords=True`` the stopword filter
    is bypassed (tokenize + dedup only).

    Empty, whitespace-only, or all-stopword input returns ``[]`` — never raises. This
    is the guard arXiv (D-29) / Semantic Scholar (D-33) rely on before constructing a
    query from the result.

    :param text: raw topic / query string.
    :param keep_stopwords: if True, do not drop STOPWORDS (tokenize-only).
    :returns: salient lowercase tokens, de-duplicated, in first-seen order.
    """
    lowered = text.casefold()
    # Replace every non-alphanumeric run with a space, then split → drop empties.
    raw_tokens = _NON_ALNUM.sub(" ", lowered).split()

    seen: set[str] = set()
    tokens: list[str] = []
    for token in raw_tokens:
        if not keep_stopwords and token in STOPWORDS:
            continue
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


# --- Phase 17 (QU-02) keyphrase extraction -----------------------------------

# Keyphrase-ONLY filler: query noise the shared STOPWORDS deliberately omits
# (STOPWORDS is reused by classify()/the source query builders, so widening it
# would change routing). These collapse keyword APIs without carrying topic
# meaning — dropped only inside keyphrases(). All lowercase.
_KEYPHRASE_NOISE: frozenset[str] = frozenset(
    {
        "high", "huge", "special", "success", "rate", "defensible", "good",
        "big", "new", "best", "top", "idea", "ideas", "thing", "things",
        "stuff", "could", "would", "via", "etc",
    }
)

# A token mixed/Title-cased in the ORIGINAL query (and NOT all-caps) is almost
# always a proper noun / product name (MoltGrid, REACH-the-box) that matches
# nothing in code/Q&A APIs — bounded char-class checks (T-17-01, linear).
# NB: the proper-noun scan splits the RAW (non-casefolded) query, so it needs a
# CASE-PRESERVING separator — `_NON_ALNUM` is lowercase-only (`[^a-z0-9]+`) and
# would treat every uppercase letter as a delimiter (mangling "MoltGrid").
_NON_ALNUM_CI = re.compile(r"[^A-Za-z0-9]+")
_HAS_UPPER = re.compile(r"[A-Z]")
_HAS_LOWER = re.compile(r"[a-z]")


def keyphrases(text: str, *, max_terms: int = 6) -> list[str]:
    """Trim a query to its <= ``max_terms`` salient terms (QU-02, RESEARCH §3-A).

    A search query is the inverse of a document: the job is to DROP the
    noise/entity tokens that match nothing in code/Q&A APIs and keep the 2-4
    salient terms, so the long natural-language query stops over-constraining
    keyword sources (github/HN/SO/npm) into returning ``[]`` (F-12).

    Pipeline (pure ``re``/stdlib, deterministic):

    1. ``salient_tokens(text)`` — stopwords dropped, first-seen dedup.
    2. drop single-character and pure-numeric tokens.
    3. drop the extended ``_KEYPHRASE_NOISE`` filler.
    4. drop mixed/Title-cased proper-noun tokens (e.g. "MoltGrid"); all-caps
       tokens are kept (a meaningful acronym like "MOAT"/"AI" is signal).
    5. rank survivors by descending length (a cheap salience proxy), STABLE on
       ties (first-seen order preserved), and return the first ``max_terms``.

    Empty / all-noise input returns ``[]`` (never raises). Idempotent: feeding
    its own output back yields a subset (no double-trim drift).

    :param text: raw topic / query string.
    :param max_terms: cap on returned terms (keyword APIs choke on long queries).
    :returns: salient lowercase terms, de-duplicated, ranked, capped.
    """
    # Map each casefolded token to whether it looks like a proper noun in the
    # ORIGINAL text (mixed-case, not all-caps). First occurrence wins.
    proper: set[str] = set()
    for raw in _NON_ALNUM_CI.sub(" ", text).split():
        low = raw.casefold()
        if low in proper:
            continue
        if _HAS_UPPER.search(raw) and _HAS_LOWER.search(raw):
            proper.add(low)

    kept: list[str] = []
    for tok in salient_tokens(text):
        if len(tok) < 2 or tok.isdigit():
            continue
        if tok in _KEYPHRASE_NOISE:
            continue
        if tok in proper:
            continue
        kept.append(tok)

    # Stable rank by descending length (Python's sort is stable -> ties keep
    # first-seen order), then cap. enumerate index breaks length ties to the
    # earliest token deterministically.
    ranked = sorted(enumerate(kept), key=lambda iv: (-len(iv[1]), iv[0]))
    return [tok for _, tok in ranked[:max_terms]]


# --- Phase 17 (QU-03) acronym expansion --------------------------------------

# Curated acronym -> spelled-out form map (lowercase keys), weighted toward the
# biomedical/scientific vocabulary the dogfood broke on (the dev acronyms
# already route correctly). Static + offline + deterministic — a query-time
# Wikidata/UMLS/AB3P lookup is disqualified (network + non-determinism). Augment,
# don't replace (F-07: the strongest BM25 hit matched the spelled-out form).
_EXPANSIONS: dict[str, str] = {
    "lifu": "low-intensity focused ultrasound",
    "tfus": "transcranial focused ultrasound",
    "csf": "cerebrospinal fluid",
    "mri": "magnetic resonance imaging",
    "fmri": "functional magnetic resonance imaging",
    "eeg": "electroencephalography",
    "bci": "brain computer interface",
    "llm": "large language model",
    "rag": "retrieval augmented generation",
    "mcp": "model context protocol",
    "rrf": "reciprocal rank fusion",
    "bm25": "best matching 25",
}


def expand_acronyms(text: str) -> str:
    """Augment ``text`` with spelled-out forms of curated acronyms (QU-03).

    Whole-token, case-insensitive match against ``_EXPANSIONS``: for each token
    whose casefolded form (stripped of surrounding non-alphanumerics) is a known
    acronym, the spelled-out phrase is APPENDED to the end of the string so BOTH
    the acronym and the long form stay searchable (RESEARCH §5 "augment, don't
    replace"). "LIFUX" must NOT match "lifu" (whole-token only). No expansion ->
    the original text is returned unchanged.

    Bounded ``re`` only (the vetted ``_NON_ALNUM`` split — linear, T-17-01).

    :param text: raw topic / query string.
    :returns: ``text`` with any matched expansions appended (first-seen order),
        or ``text`` unchanged when nothing matched.
    """
    additions: list[str] = []
    seen: set[str] = set()
    for raw in text.split():
        key = _NON_ALNUM.sub("", raw.casefold())
        if key and key in _EXPANSIONS and key not in seen:
            seen.add(key)
            additions.append(_EXPANSIONS[key])
    if not additions:
        return text
    return text + " " + " ".join(additions)


# --- Phase 17 (QU-04) document-task scope detection --------------------------

_POSSESSIVE: frozenset[str] = frozenset({"my", "our"})
_IMPROVE: frozenset[str] = frozenset(
    {
        "improve", "better", "fix", "revise", "edit", "strengthen", "polish",
        "rewrite", "refine",
    }
)
_ARTIFACT: frozenset[str] = frozenset(
    {
        "paper", "manuscript", "draft", "config", "codebase", "essay",
        "thesis", "resume", "document", "folder",
    }
)


def detect_scope(text: str) -> str | None:
    """Flag an "improve my artifact" document-task query (QU-04, RESEARCH §6).

    The scraper does web retrieval, not private-document critique — a query like
    "improve my manuscript" or "make paper 1 ... better" should be flagged so the
    driving agent (not the scraper) handles the artifact. Heuristic over the
    tokens (kept stopwords so "my"/"better" survive): return ``"document_task"``
    when an ARTIFACT noun is present AND there is either a possessive ("my"/"our")
    OR an improvement signal (an ``_IMPROVE`` verb, or the "make ... better"
    bigram). Artifact-mandatory two-of-three; else ``None``.

    Pure set-membership over tokens (no regex matching) — structurally ReDoS-free
    (T-17-01).

    :param text: raw topic / query string.
    :returns: ``"document_task"`` for a document-improvement query, else ``None``.
    """
    toks = set(salient_tokens(text, keep_stopwords=True))
    if not (toks & _ARTIFACT):
        return None
    has_possessive = bool(toks & _POSSESSIVE)
    has_improve = bool(toks & _IMPROVE) or ("make" in toks and "better" in toks)
    if has_possessive or has_improve:
        return "document_task"
    return None


# --- Phase 18 (SRC-10) person/organization entity-query detection ------------

# Person/title cues — a query carrying one of these is asking about a person.
_PERSON_CUE: frozenset[str] = frozenset({"dr", "prof", "professor"})
# Organization cues — a query carrying one of these is asking about an org/institution.
_ORG_CUE: frozenset[str] = frozenset(
    {
        "institute", "university", "lab", "laboratory", "foundation",
        "college", "department", "school", "center", "centre", "institution",
    }
)


def detect_entity_query(text: str) -> bool:
    """Flag a person/organization query (SRC-10, F-19/F-22). Import-light (``re`` only).

    A person/org query (``"Jordan Amadio Institute of Neuro Innovation UT Austin"``)
    should fire the structured-identity ``entity`` source (OpenAlex-author/ORCID/ROR)
    instead of contact-scraper directory spam. This is the gate the conditional
    ``entity`` thunk fires on — and the source ALSO self-limits, so this detector can
    stay HIGH-PRECISION (the same false-positive discipline as ``routing._SCIENTIFIC``:
    a misfire that routes a normal academic/dev query to entity-mode must NOT displace
    good results on the frozen gate).

    Returns ``True`` when:

    * an organization cue (``institute``/``university``/``lab``/``foundation``/…) is
      present, OR
    * a person/title cue (``dr``/``prof``/``professor``) is present, OR
    * two or more distinct mixed-case (not all-caps) proper-noun tokens dominate the
      query — a name like "Jordan Amadio" (reuses the ``keyphrases`` proper-noun
      signal; the linear ``_NON_ALNUM_CI`` split is ReDoS-free, T-17-01).

    Every frozen-10 topic is lowercase or carries only all-caps acronyms
    (``RRF``/``macOS``/``HEPA``/``EV``) → ``proper < 2`` and no cue → ``False`` (the
    false-positive guard the precision table pins).

    :param text: raw topic / query string.
    :returns: ``True`` for a person/organization query, else ``False``.
    """
    toks = set(salient_tokens(text, keep_stopwords=True))
    if toks & _ORG_CUE or toks & _PERSON_CUE:
        return True
    # Count distinct mixed-case proper-noun tokens (all-caps acronyms are NOT proper
    # nouns — they carry topic signal like keyphrases() treats them).
    proper = 0
    seen: set[str] = set()
    for raw in _NON_ALNUM_CI.sub(" ", text).split():
        low = raw.casefold()
        if low in seen:
            continue
        seen.add(low)
        if _HAS_UPPER.search(raw) and _HAS_LOWER.search(raw):
            proper += 1
    return proper >= 2
