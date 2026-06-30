"""Pure cross-source ranking module (RANK-01..05).

This module turns the per-source result envelopes (already fetched upstream) into
one unified, deterministic, de-duplicated ranking. It performs **zero network
I/O** — every operation is in-memory over data the caller already has — so it is
safe to import and run inside Donny/HTTP subagents (HTTP-only-core) and replays
byte-identically in fixture-mode eval.

Design invariants:
- **Additive-only (ROB-08):** ranking signals ride inside each item's existing
  ``extra`` dict; no envelope key is renamed or removed and no existing source
  function signature changes.
- **Deterministic:** the BM25 path is pinned to the ``bm25s`` numpy backend, the
  near-duplicate path uses ``MinHash(seed=1)``, and every sort is total-ordered
  with a stable tie-break, so ``eval --mode fixture`` reproduces exactly.
- **Pure / parse-only:** redirector unwrapping reads the target out of the query
  string and never fetches it (SSRF-safe by construction); malformed upstream
  input degrades to a tolerant empty/None rather than crashing the run.

Public surface (built up across Phase-3 plans):
- ``canonical_url(url)`` — RANK-03 URL-hygiene primitive (Plan 03-01).
- ``bm25_scores(query, docs)`` — RANK-01 per-document BM25 relevance (Plan 03-02).
- ``rrf_fuse(ranked_lists, k)`` — RANK-02 Reciprocal Rank Fusion at k=60 (Plan 03-02).
- ``_rank_list(items, value_of)`` — global per-signal ranked list, missing-signal
  omission (Plan 03-02).
- ``_parse_recency(v)`` — tolerant parse of the mixed-type ``created_utc`` field
  (Plan 03-02).
- ``title_dup_groups(items)`` — RANK-04 near-duplicate-title grouping: exact-
  normalized-title dict pass then a seeded MinHash/LSH fuzzy pass (Plan 03-03).
- ``_shingles(title)`` / ``_minhash(title)`` — word-3-gram shingles + the seeded
  MinHash signature backing ``title_dup_groups`` (Plan 03-03).
- ``rank_items(query, collected, k)`` — RANK-05 orchestrator: the ONE public entry
  point both Plan 03-05 callers (the CLI digest and the eval metric) consume. Wires
  every primitive into a single deterministic, de-duplicated, annotated ranked list
  (Plan 03-04). ``_flatten_with_provenance`` is its private helper.
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qs

import bm25s
import numpy as np
from datasketch import MinHash, MinHashLSH
from w3lib.url import canonicalize_url, url_query_cleaner

from query_norm import salient_tokens

# Near-duplicate-title detection (RANK-04) tuning — pinned for fixture determinism.
# 128 permutations is the datasketch default accuracy/cost tradeoff; 0.7 Jaccard over
# word-3-gram shingles is the research's starting recommendation; seed=1 (the
# datasketch default, made explicit) makes MinHash reproducible run-to-run.
NUM_PERM = 128
THRESHOLD = 0.7
SEED = 1

# Proportional-relevance gate cutoff (FUSE-01 / D-01, tuned by D-02). The recency &
# popularity RRF lists are gated on a per-query BM25 relevance QUANTILE rather than the
# old binary ``BM25 > 0`` — so a barely-relevant-but-popular item can no longer be lifted
# into the top (the "Key Lime Pie" cheese #1). The quantile is taken over POSITIVE BM25
# scores ONLY (RESEARCH A1): a quantile over ALL scores collapses to 0.0 whenever most
# candidates score 0.0 (niche/consumer queries), and ``>= 0.0`` would re-admit everything,
# silently re-creating the binary leak. ``REL_QUANTILE = 0.0`` over the positive subset
# reproduces the exact old binary behavior (the loosest sweep endpoint = known-good v1.0);
# Task 2's D-02 sweep raises it to the loosest value that closes the leak while holding the
# fixture floor (06-FLOOR.md) and dev/academic P@10 = 1.0.
#
# D-02 sweep result (see 06-03-SUMMARY): 0.5 = the median — the loosest principled value
# in the stable [0.1, 0.6] plateau that maximizes the regression trio (8/9 rows: cheese +
# claude + moltgrid D-03a, claude + moltgrid D-03b, all determinism) while RAISING the
# fixture floor 0.9500 -> 0.9900 and holding dev P@10 = 1.0 / academic = 0.900->1.000.
# No single cutoff passes all 9 rows (Pitfall 3, no feasible point — FLAGGED in the SUMMARY):
# cheese D-03b needs q>=0.8 (its gold ARTICLES lack recency/score metadata and lose RRF to
# fresh YouTube videos — a metadata quirk, not a relevance defect), while claude D-03b needs
# q<=0.6 (its gold is a relevance-#14 npm package propped up by recency/popularity — the very
# weak-but-boosted item FUSE-01 exists to demote; the npm/short-name pollution residual
# STATE.md flags for Phase 7). The windows are disjoint; 0.5 is the principled median fallback.
REL_QUANTILE = 0.5

# Relevance-fusion steepness (FUSE-01 / Plan 06-04). The relevance RRF list is fused at a
# STEEPER ``k`` (smaller k ⇒ bigger gaps between adjacent ranks) than the query-independent
# recency/popularity lists (which stay at the locked RRF k=60). Rationale: under a uniform
# k=60, the relevance-rank-1 contribution is only ``1/61 ≈ 0.016`` while ONE recency or
# popularity term adds the same ~0.016 — so a single query-independent boost out-votes the
# relevance lead and a high-relevance, metadata-poor item (a BM25 rank-1 web ARTICLE with no
# ``created_utc``/``score``, omitted from BOTH boost lists) sinks below a fresher but LESS-
# relevant item (the cheese "10 Best Cheeses" rel#1 buried at #8 — 06-DIAGNOSTIC-FINDINGS).
# Fusing relevance at ``REL_RRF_K`` makes the relevance-rank-1 contribution ``1/16 ≈ 0.0625``,
# so the relevance lead dominates one boost while recency/popularity remain BOUNDED tie-/near-
# tie breakers applied AFTER relevance (Tunkelang "relevance is the most significant bit";
# Typesense filter-then-boost). This is the project's stated fusion intent that uniform-k RRF
# violated. Empirically validated (in-process sweep on the recorded fixtures, see
# 06-DIAGNOSTIC-FINDINGS + the operator session): the fixture floor is INSENSITIVE to
# REL_RRF_K (0.9900 across k≈3..60) and dev/academic hold P@10=1.0; REL_RRF_K in [13,16]
# turns the cheese regression best-in-top-3 row GREEN while KEEPING claude GREEN and reduces
# the 20-topic #1-leaks 2→1. 15 is the center of that passing window (~±1 margin). Only the
# FUSION k changes here; the REL_QUANTILE gate (06-03) is unchanged.
REL_RRF_K = 15

# Dense paraphrase-rescue floor (SEM-02 / D-02), the BASE used when a query's tier has no
# per-tier override (``dense._TIER_COS_FLOOR``, D-03). A candidate whose cosine vs the query
# clears the (per-tier) floor is admitted to the ``cleared`` set even when its BM25 ≈ 0 —
# true vocabulary-gap bridging ("gruyère melts well" ↔ "best cheese for grilled cheese").
# Bounded by the floor so an off-topic item cannot leak back in.
#
# Plan-04 sweep result (gentlest value that holds the floor + dev/academic P@10 = 1.0):
# the TUNING surface is ``dense._TIER_COS_FLOOR`` (dev/academic = 2.0 DISABLED, which also
# suppresses the D-01 dense LIST for those tiers — see dense.dense_list_active; consumer/
# general = 0.30 ACTIVE). This base 0.30 only applies to a query that classifies into NO
# tier present in the override table; it matches the active-rescue tiers so an unclassified
# query still gets bounded paraphrase rescue rather than the disabled 2.0. The 10-topic
# fixture aggregate is insensitive to the consumer/general floor across 0.05–0.50 (stays
# 1.0000, dev/academic = 1.0), so 0.30 is a principled center, not a knife-edge. NB: a
# global COS_FLOOR alone is NOT enough — the dev-tier protection lives in the per-tier
# override + the dense-list gating (Pitfall 5); see dense.py for the full sweep rationale.
COS_FLOOR = 0.30

# Hosts that wrap a real target URL in a query param — unwrap by PARSING ONLY
# (never fetch; SSRF-safe). Value is the query-param name holding the target, or
# None when the whole query string *is* the target (e.g. href.li/?<target>).
_REDIRECTORS: dict[str, str | None] = {
    "news.google.com": "url",
    "www.google.com":  "url",
    "l.facebook.com":  "u",
    "lm.facebook.com": "u",
    "out.reddit.com":  "url",
    "href.li":         None,   # href.li/?<target> — the whole query string is the URL (no key)
}

# Tracking / analytics query params stripped before canonicalization so the same
# link decorated differently by two sources collapses to one canonical string.
_TRACKING: list[str] = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_reader", "fbclid", "gclid", "gbraid", "wbraid", "msclkid",
    "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "ref_url", "source", "spm", "cmpid",
]


def canonical_url(url: str) -> str:
    """Canonical form of a URL for cross-source dedup. Pure, parse-only (no network).

    Collapses ``www.``/tracking-param/fragment/redirector-wrapper variants of the
    same logical link to one identical string so a link surfaced by multiple
    sources becomes a single dedup entry (RANK-03). Redirector unwrapping reads
    the target out of the query string only — it never fetches it (SSRF-safe).
    Malformed input degrades to ``""`` rather than crashing the run.
    """
    if not url:
        return ""
    try:
        parts = urlsplit(url)
        host = parts.netloc.lower().removeprefix("www.")
        if host in _REDIRECTORS:                       # unwrap ONE hop, parse-only (no fetch)
            key = _REDIRECTORS[host]
            if key is None:
                target = parts.query                   # href.li style: whole query is the URL
            else:
                target = (parse_qs(parts.query).get(key) or [""])[0]
            if target.startswith("http"):
                url = target
        cleaned = url_query_cleaner(url, _TRACKING, remove=True)   # strip tracking params
        canon = canonicalize_url(cleaned)              # sort args, drop fragment, normalize %-encoding
        # w3lib lowercases the host but does NOT strip a leading www. — strip it
        # on the final host too (D-RANK-WWW: favor dedup recall) so www.example.com
        # and example.com collapse. Parse-only re-assembly; typed-exception guarded.
        cparts = urlsplit(canon)
        if cparts.netloc.startswith("www."):
            canon = urlunsplit(cparts._replace(netloc=cparts.netloc[len("www."):]))
        return canon
    except (ValueError, TypeError):
        return ""                                      # malformed input → empty (tolerant; never crash the run)


def bm25_scores(query: str, docs: list[str]) -> list[float]:
    """Per-document BM25 relevance of every ``doc`` against ``query`` (RANK-01).

    Returns one finite float per doc, in the SAME order as ``docs`` (RANK-05 needs
    every candidate scored, not just a top-k). The BM25 index is built per-call over
    the per-query corpus (~80-200 docs — cheap); no module-level cache (no global
    mutable state). Pinned to the ``bm25s`` numpy backend (no numba JIT) so the score
    is deterministic and the module stays subagent-safe / fixture-replayable.

    The QUERY is tokenized with ``query_norm.salient_tokens`` (drops search filler
    like "best"/"free"/"vs") so BM25 scores on the same salient terms arXiv/S2 already
    fetched for (Pitfall 4); the CORPUS uses ``bm25s``'s own ``stopwords="en"``
    tokenizer. An empty / all-filler query falls back to the raw query string; if that
    still yields an empty vocab the pre-filled ``0.0`` scores are returned (RRF then
    orders those items by recency/popularity only — correct degradation).
    """
    if not docs:
        return []
    corpus_tokens = bm25s.tokenize(docs, stopwords="en", show_progress=False)
    retriever = bm25s.BM25(method="lucene", backend="numpy")   # PIN numpy (no numba/JIT — deterministic, subagent-safe)
    retriever.index(corpus_tokens, show_progress=False)
    q = " ".join(salient_tokens(query)) or query               # salient query terms (Pitfall 4); fall back to raw if all-filler
    q_tokens = bm25s.tokenize(q, stopwords="en", show_progress=False)
    n = len(docs)
    doc_ids, scores = retriever.retrieve(q_tokens, k=n)         # k == n: score EVERY doc (Pitfall 1 — never k>n)
    out = [0.0] * n
    for j in range(doc_ids.shape[1]):
        out[int(doc_ids[0, j])] = float(scores[0, j])          # map ranked positions back to corpus order
    return out


def _parse_recency(v) -> float | None:
    """Tolerant parse of the mixed-type ``created_utc`` field → epoch float or None.

    The envelope's recency field is heterogeneous across sources (Pitfall 2): HN
    emits a unix-epoch int, arXiv/GitHub an ISO-8601 string, OpenAlex a bare
    ``YYYY-MM-DD`` date string, Semantic Scholar a bare 4-digit year int. A 4-digit
    integer is interpreted as a YEAR (not a tiny epoch); any other int/float is an
    epoch; strings are parsed as ISO (tolerating a trailing ``Z``).

    Returns ``None`` on any failure (None / empty / unparseable) — the item is then
    OMITTED from the recency ranked list (D-RANK-A2), never sunk to a sentinel rank
    and never crashing the run (DoS mitigation T-03-04). Only typed exceptions are
    caught; there is no bare ``except``.
    """
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            iv = int(v)
            if 1000 <= iv <= 9999:                              # a 4-digit value is a YEAR (S2), not an epoch
                return datetime(iv, 1, 1, tzinfo=timezone.utc).timestamp()
            return float(v)                                     # otherwise an epoch int/float (HN)
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            if len(s) == 16 and s.endswith("Z") and s[8:9] == "T" and s[:8].isdigit():
                # GDELT seendate compact ISO (YYYYMMDDTHHMMSSZ) — no separators, so
                # fromisoformat rejects it; parse explicitly. (kept stdlib-only — no
                # new import; the broader except below still backstops a bad value.)
                return datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp()
            s = s.replace("Z", "+00:00")                        # tolerate a trailing Z (arXiv/GitHub)
            return datetime.fromisoformat(s).timestamp()        # ISO date or datetime (arXiv/OpenAlex/GitHub)
    except (ValueError, TypeError, OverflowError):
        return None
    return None


def rrf_fuse(ranked_lists: list[list[str]], k: int = 60) -> dict[str, float]:
    """Reciprocal Rank Fusion over per-signal ranked lists (RANK-02).

    Fuses N global per-signal ranked lists on the universal currency of *rank*:
    ``score(d) = Σ 1/(k + rank_i(d))`` with 1-based rank, summed over every list ``d``
    appears in (Cormack/Clarke/Büttcher SIGIR'09). ``k`` controls steepness: a smaller k
    widens the gap between adjacent ranks (rank-1 is worth more), a larger k flattens it.
    The ``k=60`` default is the locked recency/popularity steepness (RANK-02). An item
    absent from a list simply earns no contribution from it (missing-signal omission,
    D-RANK-A2) — it is never assigned a sentinel worst-rank. Scores are NOT normalized and
    lists are NOT weighted (the unweighted rank-fusion is the whole point — it replaces the
    non-comparable raw-score sort).

    The orchestrator (:func:`rank_items`) calls this TWICE — relevance at the steeper
    ``REL_RRF_K`` and recency+popularity at ``k=60`` — and SUMS the two dicts, so the
    relevance lead dominates any single query-independent boost (FUSE-01 / Plan 06-04, the
    relevance-dominant fusion). This function itself is signal- and k-agnostic.
    """
    scores: dict[str, float] = {}
    for lst in ranked_lists:                              # each lst = [doc_id ordered best→worst]
        for rank, doc_id in enumerate(lst, start=1):      # rank is 1-based
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return scores


def _rank_list(items, value_of, reverse: bool = True) -> list[str]:
    """Build one global ranked list of doc ids from a single signal.

    ``value_of(item)`` extracts that item's signal value (BM25 score, parsed recency,
    or popularity ``score``); items whose value is ``None`` are OMITTED (missing-signal
    omission, D-RANK-A2 — arXiv ``score=None`` ⇒ absent from popularity, an unparseable
    date ⇒ absent from recency). The remaining ids are returned ordered by value
    (descending by default). Ties are resolved by Python's stable sort (insertion =
    ``items`` order), giving per-signal determinism; the FINAL total tie-break across
    equal RRF scores is the orchestrator's job (Plan 03-04: canonical-URL → id).
    """
    scored = [(value_of(it), it["id"]) for it in items if value_of(it) is not None]  # OMIT missing signal
    scored.sort(key=lambda t: t[0], reverse=reverse)
    return [doc_id for _v, doc_id in scored]


def _shingles(title: str, n: int = 3) -> set[str]:
    """Word n-gram shingles over the normalized title (default trigrams; RANK-04).

    Tokenizes via ``query_norm.salient_tokens(..., keep_stopwords=True)`` — order is
    preserved (the n-grams carry the word order), stopwords are KEPT (titles are short;
    dropping "in"/"for" would over-merge), and the vetted linear ``[^a-z0-9]+`` splitter
    is reused so a crafted title cannot trigger catastrophic backtracking (ReDoS
    mitigation T-03-08). Titles shorter than ``n`` tokens fall back to the bare token
    set so very short titles still produce a usable (non-empty for non-empty input)
    shingle set instead of an empty one.
    """
    toks = salient_tokens(title or "", keep_stopwords=True)   # tokenize-only; keep word order for n-grams (ReDoS-safe)
    if len(toks) < n:
        return set(toks)                                      # short titles: fall back to the token set
    return {" ".join(toks[i:i + n]) for i in range(len(toks) - n + 1)}


def _minhash(title: str) -> MinHash:
    """Seeded MinHash signature of a title's shingle set (RANK-04).

    ``MinHash(num_perm=NUM_PERM, seed=SEED)`` is pinned so the signature — and hence
    every downstream LSH grouping — is deterministic run-to-run (Pitfall 3, T-03-09).
    The sha1 default hash is used for *similarity* hashing, not security (T-03-10).
    """
    m = MinHash(num_perm=NUM_PERM, seed=SEED)                 # seed pinned → deterministic (Pitfall 3)
    for sh in _shingles(title):
        m.update(sh.encode("utf8"))
    return m


def title_dup_groups(items: list[dict]) -> dict[str, list[dict]]:
    """Group near-duplicate-title items so each story/paper appears once (RANK-04).

    Two-pass grouper (the research's "exact dict pass first, then MinHash"):

    1. **Stable per-item key** — ``canonical_url(url) or str(id)``. LSH requires
       *unique* keys, so the list index is suffixed (``{base}#{idx}``) to keep keys
       unique even when two items' URLs canonicalize equal (that URL-collision is a
       real duplicate and is unioned anyway via the shared ``base``); this also means
       ``lsh.insert`` never raises on a duplicate key (T-03-11).
    2. **Exact-normalized-title pass** — bucket items by their normalized title
       string (``" ".join(salient_tokens(title, keep_stopwords=True))``) and union
       items sharing a non-empty bucket. This catches verbatim cross-posts cheaply,
       before any MinHash work. The empty-title bucket is skipped so title-less items
       do NOT all merge together.
    3. **MinHash/LSH fuzzy pass** — insert each item's ``_minhash`` under its unique
       key (in ``items`` order → deterministic insertion) and union each item with
       every LSH neighbor (estimated Jaccard ≥ ``THRESHOLD``).

    The exact-title and LSH relations are merged into connected components via a
    union-find keyed by list index; iteration is in ``items`` order and component
    members are sorted by their stable key, so the output is fully deterministic
    (fixture-replayable). Returns ``{representative_id: [member items]}`` with every
    item in exactly one group (singletons form their own one-member group). The
    representative is a DETERMINISTIC PLACEHOLDER — the member with the smallest
    stable key — because RRF is not known here; the orchestrator (Plan 03-04)
    overrides the representative by max-RRF and attaches ``extra.also_seen_on``.

    Pure: no network, no clock, no RNG (seed pinned); no bare ``except``.
    """
    n = len(items)
    if n == 0:
        return {}

    # 1. Stable per-item key (base) + unique LSH key (base#idx so insert never collides).
    base_keys: list[str] = []
    for it in items:
        base = canonical_url(it.get("url") or "") or str(it.get("id") or "")
        base_keys.append(base)
    lsh_keys = [f"{base_keys[i]}#{i}" for i in range(n)]
    key_to_idx = {lsh_keys[i]: i for i in range(n)}

    # Union-find over item indices (path-compressed; union toward the smaller root for
    # a deterministic, stable representative root).
    parent = list(range(n))

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:        # path compression
            parent[x], x = root, parent[x]
        return root

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        lo, hi = (ra, rb) if ra < rb else (rb, ra)
        parent[hi] = lo                 # attach larger-index root under smaller (deterministic)

    # 2. Exact-normalized-title pass (cheap; runs before MinHash). Skip empty titles.
    by_norm_title: dict[str, list[int]] = {}
    for i, it in enumerate(items):
        norm = " ".join(salient_tokens(it.get("title") or "", keep_stopwords=True))
        if not norm:
            continue                    # title-less items must NOT all merge together
        by_norm_title.setdefault(norm, []).append(i)
    for idxs in by_norm_title.values():
        first = idxs[0]
        for j in idxs[1:]:
            union(first, j)

    # 3. MinHash/LSH fuzzy pass. Insert in items order (deterministic), then union each
    #    item with every neighbor LSH reports (estimated Jaccard >= THRESHOLD).
    lsh = MinHashLSH(threshold=THRESHOLD, num_perm=NUM_PERM)   # num_perm MUST match _minhash
    minhashes = [_minhash(it.get("title") or "") for it in items]
    for i in range(n):
        lsh.insert(lsh_keys[i], minhashes[i])                  # unique key → never raises (T-03-11)
    for i in range(n):
        for neighbor_key in lsh.query(minhashes[i]):           # includes self
            union(i, key_to_idx[str(neighbor_key)])            # keys we inserted are str (narrow for ty)

    # Collapse to connected components, deterministically.
    components: dict[int, list[int]] = {}
    for i in range(n):
        components.setdefault(find(i), []).append(i)

    groups: dict[str, list[dict]] = {}
    for member_idxs in components.values():
        members_in_order = sorted(member_idxs)                 # items-order members for the value list
        rep_idx = min(member_idxs, key=lambda idx: base_keys[idx])   # deterministic placeholder representative
        rep_id = str(items[rep_idx].get("id") or "")
        groups[rep_id] = [items[idx] for idx in members_in_order]
    return groups


def _flatten_with_provenance(collected: dict[str, list[dict]]) -> list[dict]:
    """Flatten ``{source: [items]}`` into one list, stamping each item's source.

    Sources are iterated in ``sorted(collected)`` order (deterministic and
    dependency-free — no reliance on ``research_topic.SOURCES``) so the flat order,
    and therefore every downstream stable sort and MinHash insertion order, is
    reproducible run-to-run (Pitfall 3 / T-03-13). Each item gets its origin source
    recorded on ``extra["_source"]`` (a temporary working field used to compute
    ``also_seen_on`` and stripped before ``rank_items`` returns). Empty source lists
    contribute nothing. The items are mutated in place (the additive ROB-08 contract:
    only ``extra`` is touched).
    """
    items: list[dict] = []
    for source in sorted(collected):
        for it in collected[source]:
            it.setdefault("extra", {})
            it["extra"]["_source"] = source
            items.append(it)
    return items


def rank_items(
    query: str, collected: dict[str, list[dict]], k: int | None = None
) -> list[dict]:
    """Single cross-source ranked list — the ONE public entry point (RANK-05).

    Pure, deterministic, additive. Wires every Phase-3 primitive into the unified
    ranking both Plan 03-05 callers (the CLI digest and the eval metric) consume:

    1. **Flatten with provenance** (:func:`_flatten_with_provenance`) — one list,
       each item stamped with its source; sources iterated in sorted order.
    2. **BM25** (:func:`bm25_scores`) over ``title + " " + text`` of the FLAT list,
       index-aligned (every candidate scored — RANK-01/RANK-05).
    3. **Three GLOBAL per-signal rank lists** (:func:`_rank_list`) keyed by a stable
       per-item id (``canonical_url`` or ``id`` or positional fallback): relevance
       (BM25), recency (:func:`_parse_recency`), popularity (``score``). Missing
       signals are OMITTED, never sentinel-ranked (D-RANK-A2). Recency & popularity
       are query-INDEPENDENT, so they are GATED on a per-query BM25 relevance QUANTILE
       (``REL_QUANTILE`` over POSITIVE scores; FUSE-01 / D-01/D-02 — the graded successor
       to the binary ``BM25 > 0`` D-RANK-RELGATE gate): an item below the quantile (barely-
       or non-matching) is omitted from BOTH lists and can never be promoted into the top
       by recency+popularity alone, while a genuinely-relevant item keeps its boosts. The
       gate is a pure membership test (``id(it) in cleared``) feeding OMISSION — no score
       is mixed; an all-zero corpus degrades to the prior behavior (RESEARCH Pitfall 1).
       Phase-7 (D-02) WIDENS only how ``cleared`` is built: an item also clears via cosine
       (``cosine >= COS_FLOOR``, per-tier), so a true paraphrase (BM25≈0, high cosine) earns
       its boosts too — the rec/pop lambdas are unchanged (SEM-02 / bounded rescue).
    4. **Relevance-dominant RRF** (:func:`rrf_fuse`, FUSE-01 / Plan 06-04) → a per-item
       score: the relevance group (BM25 relevance + the Phase-7 dense/cosine list as a
       co-equal peer — D-01/SEM-02, ``rrf_fuse([rel, dense], k=REL_RRF_K)``) is fused at a
       STEEPER ``k`` (``REL_RRF_K``) than the query-independent recency/popularity lists
       (locked ``k=60``), and the two are SUMMED. The steeper relevance k makes the
       relevance-rank lead exceed a single recency/popularity boost, so a high-relevance
       metadata-poor item (omitted from both boost lists) is no longer out-voted by a
       fresher, less-relevant multi-signal item (single-signal-omission burial). A pure
       rank op — dense joins as an integer-rank list, never score-mixed (Pitfall 4); recency
       +popularity stay bounded AFTER-relevance tie-/near-tie breakers (Tunkelang
       relevance-primary; Typesense filter-then-boost). Dense degrades to absent (the
       Phase-6 ``rrf_fuse([rel], …)``) when no model/cosine is available.
    5. **Group duplicates** (D-RANK-DEDUP) — union of near-duplicate-TITLE clusters
       (:func:`title_dup_groups`, RANK-04) AND same-canonical-URL clusters
       (:func:`canonical_url`, RANK-03), so a story cross-posted under a reworded
       title *or* a tracking-decorated URL collapses to one entry.
    6. **Survivor + annotation** — within each group keep the MAX-RRF member; write
       ``extra.bm25`` (4dp), ``extra.rrf`` (6dp), ``extra.ranks`` (1-based ranks or
       None per signal), and ``extra.also_seen_on`` (the OTHER groups' sources, ``[]``
       when single-source). The interpretation of "RRF on the union of the group's
       ranks" (D-RANK-DEDUP) is realized as max-RRF-survivor: the surviving member is
       already the group's strongest multi-signal representative, so consensus rides
       in its score; this satisfies the SC#4 collapse + ordering contract.
       When the OPT-IN rerank is enabled (RERANK-01 / D-05, step 8 below), reordered
       head items also gain ``extra.rerank`` (the raw cross-encoder logit, 6dp) and
       ``extra.ranks.rerank`` (1-based rerank position); BOTH are ABSENT when rerank is
       OFF (the default), so the OFF path stays byte-identical to Phase 7 (D-09).
    7. **Stable total-order sort** (D-RANK-TIEBREAK) — ``(-rrf, canonical_url, id)`` so
       equal-RRF items never reorder; return the top-``k`` (all if ``k`` is None).

    :param query: the search topic (tokenized with ``salient_tokens`` inside BM25).
    :param collected: ``{source_name: [envelope items]}`` — the
        ``research_topic.run()`` / eval-merge shape.
    :param k: optional cap on the returned list length.
    :returns: the de-duplicated, RRF-ranked items with ``extra`` enriched.
    """
    if not collected:
        return []
    items = _flatten_with_provenance(collected)
    if not items:
        return []

    # Stable per-item id for the ranked lists / RRF keys (canonical URL → id → index).
    sids: list[str] = []
    for idx, it in enumerate(items):
        sid = canonical_url(it.get("url") or "") or str(it.get("id") or "") or f"_idx{idx}"
        sids.append(sid)
    sid_of = {id(it): sids[i] for i, it in enumerate(items)}

    # BM25 over the flat list, index-aligned with `items` (every candidate scored).
    def _doc_text(it: dict) -> str:
        return ((it.get("title") or "") + " " + (it.get("text") or "")).strip()

    # ENRICH-01 (Phase 10): a YouTube transcript rides on ``extra.transcript`` as a
    # SEPARATE field (transcripts.enrich), NOT appended into ``text``. It is scored as its
    # own field and MAX-combined into BM25 + dense below, so spoken content can only RAISE
    # an item's score, never lower it. Appending it into ``_doc_text`` instead made the doc
    # long and unfocused — BM25 length-normalization + dense-embedding dilution — and
    # DEMOTED well-described videos (the #1 official tutorial fell out of the top-10: the
    # Phase 10 regression finding). Empty string for items with no transcript.
    def _transcript_doc(it: dict) -> str:
        tr = (it.get("extra") or {}).get("transcript")
        return ((it.get("title") or "") + " " + tr).strip() if tr else ""

    base_docs = [_doc_text(it) for it in items]
    scores = bm25_scores(query, base_docs)              # PURE base corpus — identical to the pre-enrichment path
    bm25_of = {id(it): scores[i] for i, it in enumerate(items)}

    # Transcript max-combine (BM25). Score the transcript docs ALONGSIDE the base corpus
    # (shared IDF/avgdl — not an inflated transcript-only corpus), then keep max(base,
    # transcript) per transcript-bearing item. The PURE base scores above are left
    # untouched, so every item's relevance is >= its title+desc score (the transcript can
    # only help — never demote). With NO transcripts present (every 10-topic benchmark
    # query — YouTube does not fire / is not enriched there) this block is skipped and the
    # scores are BYTE-IDENTICAL to the pre-enrichment path ⇒ SC#3 non-regression is automatic.
    _tr_docs = [_transcript_doc(it) for it in items]
    _tr_idx = [i for i, d in enumerate(_tr_docs) if d]
    if _tr_idx:
        _combo = bm25_scores(query, base_docs + [_tr_docs[i] for i in _tr_idx])
        for j, i in enumerate(_tr_idx):
            bm25_of[id(items[i])] = max(scores[i], _combo[len(items) + j])

    # Dense cosine over the SAME _doc_text the BM25 path uses (SEM-02 / D-01). Lazy import
    # keeps the eval runner import-light (D-27/D-38 — mirrors merge_collected's lazy
    # `import rank`); dense_scores returns None ⇒ degrade to BM25-only (the Phase-6 path,
    # byte-identical). cos_of is empty {} when dense is unavailable, so every dense-aware
    # branch below collapses to its Phase-6 form. The dense floor is per-tier (D-03/SEM-04).
    import dense  # LAZY here, NOT at module top of rank.py (import-light preserved)
    _cos = dense.dense_scores(query, base_docs)
    cos_of = {id(it): _cos[i] for i, it in enumerate(items)} if _cos else {}
    # Transcript max-combine (dense). Cosine is per-doc (not corpus-relative), so the
    # transcript-bearing items' transcript docs are embedded separately and we keep
    # max(cos(title+desc), cos(transcript)) — no other item is touched. Degrades to the base
    # cosine when dense is unavailable or no transcripts are present (byte-identical path).
    if _cos and _tr_idx:
        _tr_cos = dense.dense_scores(query, [_tr_docs[i] for i in _tr_idx])
        if _tr_cos:
            for j, i in enumerate(_tr_idx):
                cos_of[id(items[i])] = max(cos_of[id(items[i])], _tr_cos[j])
    _cos_floor = dense.cos_floor_for(query, COS_FLOOR) if _cos else COS_FLOOR
    # Per-tier dense-LIST gating (D-03/SEM-04 / Pitfall 5): the dev/academic tier disables
    # the dense fusion list (its floor is the 2.0 sentinel) so dense can NEVER demote an
    # exact lexical winner (the claude-code-artifacts regression); consumer/general keeps it
    # ON as a fused relevance peer (paraphrase rescue). One tuning surface — the same per-tier
    # floor drives both the D-02 rescue gate above AND whether the D-01 list participates below.
    _dense_active = bool(_cos) and dense.dense_list_active(query, COS_FLOOR)

    # Proportional-relevance gate set (FUSE-01 / D-01, widened by D-02) — computed ONCE here
    # (mirrors the compute-once bm25_of/sid_of pattern). ``cleared`` is the set of item-ids
    # admitted to contribute to the recency & popularity lists below: an item clears either by
    # BM25 (clears the per-query relevance quantile) OR by cosine (>= the per-tier _cos_floor —
    # D-02 paraphrase rescue, SEM-02). The quantile is taken over POSITIVE scores ONLY (RESEARCH
    # A1) — a quantile over ALL scores is 0.0 whenever most candidates score 0.0, and ``>= 0.0``
    # admits everything, silently re-creating the old binary leak; ``_cut is None`` (no positive
    # score) disables the BM25 branch. The all-zero / all-filler corpus WITH dense unavailable
    # (cos_of empty ⇒ cos_of.get → -1.0 < _cos_floor) clears nobody → the empty ``cleared`` set
    # reproduces Phase-6 behavior byte-for-byte (recency/popularity then order the all-zero pool
    # exactly as before). For a dev/academic query the per-tier floor is the 2.0 sentinel, so no
    # cosine reaches it and the rescue is OFF (Phase-6-identical gate) — dense rescue fires only
    # for consumer/general (floor 0.30). Inclusive ``>=`` on the RAW float (not the 4dp-rounded
    # extra.bm25) keeps the decision deterministic (Pitfall 2).
    _pos = [v for v in bm25_of.values() if v > 0.0]
    _cut = float(np.quantile(_pos, REL_QUANTILE, method="linear")) if _pos else None
    cleared = {
        oid for oid in bm25_of
        if (_cut is not None and bm25_of[oid] >= _cut)
        or (cos_of.get(oid, -1.0) >= _cos_floor)   # D-02: paraphrase rescue, per-tier-bounded
    }

    # Three GLOBAL per-signal ranked lists keyed by the canonical-URL-aware stable id
    # (so the RRF lists agree with the dedup identity). Missing signals are omitted.
    rel = _rank_over_sid(items, sid_of, lambda it: bm25_of[id(it)])
    # Recency and popularity are query-INDEPENDENT signals: as global rank lists they
    # favor whatever is newest / most-downloaded regardless of topic (a freshly
    # published, heavily-downloaded npm package surfaced for a "sourdough bread" query
    # would rank #1 on both). Established IR practice treats relevance as the "most
    # significant bit" and applies query-independent signals only AFTER it (Tunkelang,
    # "Ranking vs. Relevance"; Typesense filter-then-boost). So GATE recency/popularity
    # on the relevance quantile: an item below the per-query BM25 quantile (a barely- or
    # non-matching item) is omitted from BOTH lists and can surface only via the relevance
    # list (where it ranks low), never be lifted into the top by recency+popularity alone
    # (FUSE-01 / D-01/D-02 — the graded successor to the binary D-RANK-RELGATE BM25>0 gate;
    # closes the off-topic-#1 leak while a genuinely-relevant item keeps its boosts).
    # The gate is a PURE membership test feeding OMISSION (``id(it) in cleared`` → value vs
    # None): extra.bm25/extra.rrf formulas are unchanged and no score is ever multiplied or
    # added (FUSE-01 / SC#3 — no score-mixing). Phase-7 forward-compat (CONFIRMED, not built
    # here): these lambdas already test ``id(it) in cleared``, so the dense path changes ONLY
    # how ``cleared`` is built (add ``OR cosine >= COS_FLOOR``) — zero lambda change (D-01).
    rec = _rank_over_sid(
        items,
        sid_of,
        lambda it: _parse_recency(it.get("created_utc")) if id(it) in cleared else None,
    )
    pop = _rank_over_sid(
        items,
        sid_of,
        lambda it: it.get("score") if id(it) in cleared else None,
    )

    # Relevance-dominant per-list-k fusion (FUSE-01 / Plan 06-04). Fuse the relevance list
    # at a STEEPER k (REL_RRF_K) than the query-independent recency/popularity lists (locked
    # k=60), then SUM the two dicts. A pure rank op — rrf_fuse is unchanged and called twice;
    # no score is normalized, weighted, or mixed (extra.bm25/extra.rrf formulas untouched).
    # The steeper relevance k makes the relevance-rank lead exceed a single recency/popularity
    # boost, so a high-relevance metadata-poor item (omitted from both boost lists) is no
    # longer out-voted by a fresher, less-relevant multi-signal item (single-signal-omission
    # burial — 06-DIAGNOSTIC-FINDINGS); recency+popularity remain bounded AFTER-relevance
    # tie-/near-tie breakers. An id absent from a list earns no contribution from it (missing-
    # signal omission preserved). ``extra.rrf`` below reflects this summed fused value.
    # D-01: dense joins the RELEVANCE group as a 4th integer-rank list at the steep REL_RRF_K
    # (semantic IS relevance — a peer of BM25, never a query-independent boost; NO score-mixing,
    # SEM-02). Built with the SAME _rank_over_sid machinery (cosine value → rank, None omits) so
    # it composes with rrf_fuse verbatim. Gated by ``_dense_active`` (D-03/SEM-04): the dev/
    # academic tier suppresses the list so dense cannot demote an exact lexical winner (Pitfall 5
    # — the claude-code-artifacts regression), while consumer/general keeps it ON for paraphrase
    # rescue. When dense is unavailable OR suppressed for the tier this is exactly the Phase-6
    # ``rrf_fuse([rel], k=REL_RRF_K)`` — byte-identical.
    dense_list = (
        _rank_over_sid(items, sid_of, lambda it: cos_of.get(id(it)))
        if _dense_active else []
    )
    fused_rel = rrf_fuse([rel, dense_list], k=REL_RRF_K) if _dense_active else rrf_fuse([rel], k=REL_RRF_K)
    fused_boost = rrf_fuse([rec, pop], k=60)
    fused = {
        sid: fused_rel.get(sid, 0.0) + fused_boost.get(sid, 0.0)
        for sid in (fused_rel.keys() | fused_boost.keys())
    }

    # Per-signal 1-based rank lookup (or None when the item was omitted from a list).
    rel_pos = {sid: i for i, sid in enumerate(rel, start=1)}
    rec_pos = {sid: i for i, sid in enumerate(rec, start=1)}
    pop_pos = {sid: i for i, sid in enumerate(pop, start=1)}
    dense_pos = {sid: i for i, sid in enumerate(dense_list, start=1)}   # D-01: dense rank (empty when unavailable OR per-tier-suppressed)

    # Group duplicates: union of near-dup-TITLE clusters (RANK-04) and same-canonical-
    # URL clusters (RANK-03) into connected components over flat-list indices.
    components = _dup_components(items, sids)

    survivors: list[dict] = []
    for member_idxs in components:
        members = [items[i] for i in member_idxs]
        # Keep the MAX-RRF survivor (D-RANK-DEDUP). Resolve RRF ties deterministically
        # toward the smallest (canonical_url, id) so the survivor never depends on
        # iteration order (D-RANK-TIEBREAK / fixture replay).
        best_rrf = max(fused.get(sid_of[id(m)], 0.0) for m in members)
        tied = [m for m in members if fused.get(sid_of[id(m)], 0.0) == best_rrf]
        survivor = min(
            tied,
            key=lambda it: (
                canonical_url(it.get("url") or ""),
                str(it.get("id") or ""),
            ),
        )

        ssid = sid_of[id(survivor)]
        also = sorted(
            {m["extra"].get("_source", "") for m in members}
            - {survivor["extra"].get("_source", "")}
        )
        survivor["extra"]["bm25"] = round(bm25_of[id(survivor)], 4)
        survivor["extra"]["rrf"] = round(best_rrf, 6)
        survivor["extra"]["ranks"] = {
            "relevance": rel_pos.get(ssid),
            "recency": rec_pos.get(ssid),
            "popularity": pop_pos.get(ssid),
            "dense": dense_pos.get(ssid),   # None when dense unavailable/omitted (additive, ROB-08)
        }
        survivor["extra"]["also_seen_on"] = also
        survivors.append(survivor)

    # Strip the temporary provenance working field from ALL items (survivors and the
    # collapsed duplicates) so `extra` carries only the public annotation keys.
    for it in items:
        it["extra"].pop("_source", None)

    survivors.sort(
        key=lambda it: (
            -it["extra"]["rrf"],
            canonical_url(it.get("url") or ""),
            str(it.get("id") or ""),
        )
    )

    # RERANK-01 (Phase 8, D-05): OPT-IN cross-encoder reorder of the fused HEAD only. Default
    # OFF (rerank.enabled() False) ⇒ this block is skipped entirely and the encoder is never
    # constructed ⇒ byte-identical to Phase 7 (D-09/SC#2 — the whole 10-topic fixture path is
    # OFF). Lazy `import rerank` mirrors the lazy `import dense` above (rank.py:541) — keeps the
    # eval runner import-light (SC#3). Reorders ONLY survivors[:rerank.TOP_N] (cap <= 50, D-06)
    # by cross-encoder logit over the SAME _doc_text base BM25/dense score; the tail + the [:k]
    # slice are untouched. NOT a score-mix into RRF (Pitfall 3) — extra.rrf stays the fused
    # value; rerank writes only the additive extra.rerank + extra.ranks.rerank (ROB-08).
    import rerank  # LAZY here (mirrors `import dense` at line 541) — keeps rank.py import-light-friendly
    if rerank.enabled():
        head = survivors[: rerank.TOP_N]
        rr = rerank.rerank_scores(query, [_doc_text(it) for it in head])
        if rr is not None:   # None ⇒ degrade-to-passthrough (dep/model absent — Pitfall 6)
            order = sorted(
                range(len(head)),
                key=lambda i: (
                    -rr[i],
                    canonical_url(head[i].get("url") or ""),
                    str(head[i].get("id") or ""),
                ),
            )
            for new_pos, old_i in enumerate(order, start=1):
                head[old_i]["extra"]["rerank"] = round(rr[old_i], 6)   # additive (ROB-08)
                head[old_i]["extra"].setdefault("ranks", {})["rerank"] = new_pos
            survivors[: rerank.TOP_N] = [head[i] for i in order]
    return survivors[:k] if k else survivors


def _rank_over_sid(items: list[dict], sid_of: dict[int, str], value_of) -> list[str]:
    """Global per-signal ranked list keyed by the stable id (missing-signal omission).

    Same contract as :func:`_rank_list` but keyed by the canonical-URL-aware stable id
    (``sid_of``) rather than the raw ``it["id"]`` — so the RRF lists agree with the
    canonical-URL identity used for dedup. Items whose ``value_of`` is ``None`` are
    omitted (D-RANK-A2); ties resolve by Python's stable sort (``items`` order).
    """
    scored = [
        (value_of(it), sid_of[id(it)]) for it in items if value_of(it) is not None
    ]
    scored.sort(key=lambda t: t[0], reverse=True)
    return [sid for _v, sid in scored]


def _dup_components(items: list[dict], sids: list[str]) -> list[list[int]]:
    """Connected components of duplicate items over the flat list (RANK-03 + RANK-04).

    Unions two relations into one partition via union-find over flat-list indices:

    * **near-duplicate TITLE** — every cluster :func:`title_dup_groups` reports
      (exact-normalized-title pass + seeded MinHash/LSH), mapped back to indices by id;
    * **same canonical URL** — items whose ``sids`` entry is an identical non-empty
      canonical URL (RANK-03 collapse, which title grouping alone misses when two
      sources reword the title of the same link).

    Returns a list of index-lists, each list sorted ascending and the components
    themselves ordered by their smallest index, so the partition is deterministic
    (fixture-replayable). No bare ``except``; pure.
    """
    n = len(items)
    parent = list(range(n))

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        lo, hi = (ra, rb) if ra < rb else (rb, ra)
        parent[hi] = lo

    # Relation 1: near-duplicate titles (reuse the RANK-04 primitive).
    idx_by_id: dict[str, list[int]] = {}
    for i, it in enumerate(items):
        idx_by_id.setdefault(str(it.get("id") or ""), []).append(i)
    for members in title_dup_groups(items).values():
        member_idxs: list[int] = []
        for m in members:
            member_idxs.extend(idx_by_id.get(str(m.get("id") or ""), []))
        for j in member_idxs[1:]:
            union(member_idxs[0], j)

    # Relation 2: identical non-empty canonical URL (RANK-03).
    by_canon: dict[str, list[int]] = {}
    for i, sid in enumerate(sids):
        if sid.startswith("http"):                 # only real canonical URLs collapse
            by_canon.setdefault(sid, []).append(i)
    for idxs in by_canon.values():
        for j in idxs[1:]:
            union(idxs[0], j)

    components: dict[int, list[int]] = {}
    for i in range(n):
        components.setdefault(find(i), []).append(i)
    return [sorted(v) for _root, v in sorted(components.items())]
