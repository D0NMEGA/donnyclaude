"""Local offline dense retrieval (SEM-01/02/04): the dense half of the hybrid ranker.

Holds the HEAVY embedding import LAZILY (inside ``_get_model``) so the import-light
eval runner (D-27/D-38) never pulls model2vec/tokenizers/safetensors into a
subagent — exactly mirroring ``eval/metrics.merge_collected``'s lazy ``import rank``.
The model is the VENDORED int8 ``potion-retrieval-32M`` static model under ``models/``
(D-04): a pure local-file load, no HuggingFace Hub call (``HF_HUB_OFFLINE=1`` makes a
stray call fail loud). Static model2vec is deterministic by construction (numpy
lookup + mean-pool, ``normalize=True``, no ONNX threads, no RNG) — byte-replay safe.

Dense joins the fusion as a RANK LIST (never a raw score — Pitfall 4 / no
score-mixing); this module only produces per-doc cosine. ``rank.py`` turns the cosine
order into a rank list and fuses it into the relevance group (D-01).
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np  # already top-level via bm25s; dense.py is not the runner path

import routing  # stdlib-only; per-tier weighting keys off classify() (D-03/SEM-04)

_MODEL = None  # cache the model OBJECT (loaded once per process), NOT the import
_VENDORED = Path(__file__).resolve().parent / "models" / "potion-retrieval-32M-int8"

# Per-tier dense COS_FLOOR overrides (D-03/SEM-04), tuned by the Plan-04 eval sweep.
# The floor does double duty: (1) it is the D-02 ``cleared`` rescue threshold (a BM25≈0
# item whose cosine clears it earns its recency/popularity boost), AND (2) it gates the
# D-01 dense RRF LIST itself via ``dense_list_active`` — a floor > 1.0 (no cosine in
# [-1, 1] can ever reach it) is the DISABLE sentinel that suppresses dense in fusion for
# that tier entirely.
#
# Sweep result (Plan 04, against the frozen fixtures + the regression set):
#   * dev / academic → 2.0 (DISABLED). Empirically the 5 dev/academic benchmark topics
#     are P@10 = 1.0 WITHOUT any dense contribution (BM25 already nails the exact lexical
#     winners), and an ACTIVE dense list only DEMOTES them — it pushes a prose article
#     ("Claude Code now supports artifacts") above the exact-match package
#     (@anthropic-ai/claude-code) whose terse description embeds weakly (Pitfall 5,
#     the claude-code-artifacts regression). A floor of 2.0 suppresses the dense list for
#     these tiers so dense can NEVER demote an exact lexical winner — the hard SEM-04
#     guarantee (test_per_tier_gate). Mixed-tier queries (e.g. mcp → {academic, dev})
#     take the STRICTEST tier floor via ``cos_floor_for``'s ``max(...)`` ⇒ 2.0 ⇒ off.
#   * consumer / general → 0.30 (ACTIVE). The gentlest floor that keeps dense ON for the
#     consumer/general tier (where paraphrase rescue belongs — SEM-02) while staying a
#     real bound: representative paraphrase-gold cosines (cheese 0.36–0.46, webassembly
#     0.52–0.66) clear 0.30, while clearly off-topic items do not. The 10-topic fixture
#     aggregate is INSENSITIVE to this value (1.0000 across 0.05–0.50) and dev/academic
#     hold 1.0, so 0.30 is the principled center, not a knife-edge.
# A tier absent here falls back to the base ``rank.COS_FLOOR`` (also 0.30 — active rescue).
_TIER_COS_FLOOR: dict[str, float] = {
    "dev": 2.0,        # DISABLED: protect exact lexical winners (SEM-04 / Pitfall 5)
    "academic": 2.0,   # DISABLED: same — BM25 already P@10=1.0, dense only demotes
    "consumer": 0.30,  # ACTIVE: paraphrase rescue floor (SEM-02), bounded
    "general": 0.30,   # ACTIVE: paraphrase rescue floor (SEM-02), bounded
}


def _get_model():
    """Load the vendored static model from the committed local dir (no Hub call)."""
    global _MODEL
    if _MODEL is None:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")  # stray Hub call fails loud
        from model2vec import StaticModel  # LAZY: only when the dense path runs
        _MODEL = StaticModel.from_pretrained(str(_VENDORED))  # local files only
    return _MODEL


def dense_scores(query: str, docs: list[str]) -> list[float] | None:
    """Cosine of each doc vs the query via the local static model (SEM-01/02).

    Returns ``[]`` for empty docs; one cosine float per doc (same order as docs);
    ``None`` when model2vec OR the vendored dir is absent (caller degrades to
    BM25-only — the Phase-6 path, byte-identical). Deterministic: static model
    + numpy + L2-normalize. Only ``(ImportError, OSError)`` are caught (no bare except).
    """
    if not docs:
        return []
    if not _VENDORED.is_dir():
        # Vendored weights absent (Plan 07-03 commits them) → degrade to BM25-only
        # WITHOUT touching the Hub: from_pretrained would treat the absolute path as
        # a malformed repo id and raise HFValidationError(ValueError), not OSError.
        # The explicit dir check keeps the offline/cold-subagent contract deterministic.
        return None
    try:
        model = _get_model()
    except (ImportError, OSError):  # no model2vec OR an unreadable vendored dir → degrade
        return None
    q = np.asarray(model.encode([query]))[0]   # model normalizes by default
    D = np.asarray(model.encode(docs))
    qn = q / (np.linalg.norm(q) + 1e-9)
    Dn = D / (np.linalg.norm(D, axis=1, keepdims=True) + 1e-9)
    return (Dn @ qn).tolist()


# A per-tier floor at/above this value is the DISABLE sentinel: no cosine in [-1, 1]
# can clear it, so it both (a) admits nobody via the D-02 rescue gate and (b) signals
# ``dense_list_active`` to suppress the D-01 dense RRF list for that tier. 1.0 is the
# exact upper bound of cosine, so ``floor > 1.0`` ⇔ "dense off for this tier".
_DENSE_LIST_DISABLE_FLOOR = 1.0


def cos_floor_for(query: str, base: float) -> float:
    """Per-tier COS_FLOOR for this query (D-03/SEM-04): the strictest override
    across the query's classified tiers, else the base floor. Keyed off the
    stdlib router so ``routing.py`` stays numpy/rank-free. The dev/academic tier
    takes the stricter (higher) floor to protect its P@10=1.0 (Pitfall 5)."""
    tiers = routing.classify(query)
    floors = [_TIER_COS_FLOOR[t] for t in tiers if t in _TIER_COS_FLOOR]
    return max(floors) if floors else base


def dense_list_active(query: str, base: float) -> bool:
    """Whether the D-01 dense RRF list should participate in fusion for this query.

    SEM-04 / Pitfall 5: the per-tier floor gates not only the D-02 rescue (which
    items clear into the recency/popularity ``cleared`` set) but the dense LIST
    itself. For the dev/academic tier the floor is the DISABLE sentinel (2.0) — the
    benchmark's 5 dev/academic topics are already P@10 = 1.0 on BM25 alone and an
    active dense list only DEMOTES their exact lexical winners (the
    claude-code-artifacts regression), so dense is suppressed there. For
    consumer/general the floor is a real, clearable value (0.30) so dense IS a
    fused relevance peer (SEM-02 paraphrase rescue). Computed off the SAME
    ``cos_floor_for`` value — one tuning surface, no second knob.

    Returns ``True`` iff the query's effective floor is clearable (≤ 1.0)."""
    return cos_floor_for(query, base) <= _DENSE_LIST_DISABLE_FLOOR
