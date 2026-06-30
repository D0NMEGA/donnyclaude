"""Opt-in cross-encoder rerank (RERANK-01): the precision layer over the fused head.

Mirrors dense.py / transcripts.py — the HEAVY fastembed/onnxruntime import is held LAZILY
inside ``_get_encoder`` so the import-light eval runner (D-27/D-38 / SC#3) never pulls it
into a subagent's sys.modules. Default OFF (D-04): a network-less / no-[semantic]-extra run
simply runs WITHOUT rerank (graceful, like a missing key — D-07), so this is NOT vendored.

Rerank is a final REORDER of the already-fused head (rank.py rank_items), never a score-mix
into RRF — the v1.0 non-comparable-score disease stays cured (Pitfall 3: the scores are raw
MS-MARCO logits ~-11..+7, used ONLY to argsort).
"""
from __future__ import annotations

import os

_ENCODER = None  # cache the encoder OBJECT (load once per process), NOT the import
MODEL = os.environ.get("RESEARCH_RERANK_MODEL", "Xenova/ms-marco-MiniLM-L-6-v2")  # Discretion default
# D-06: cap <= 50. Env-overridable but CLAMPED so a stray env can never exceed the SC#1 bound.
TOP_N = min(int(os.environ.get("RESEARCH_RERANK_TOP_N", "50")), 50)


def enabled() -> bool:
    """D-04: opt-in, default OFF. CLI --rerank sets RESEARCH_RERANK=1 in main() (explicit wins)."""
    return os.environ.get("RESEARCH_RERANK", "0") == "1"


def _get_encoder():
    """Lazily construct + cache the cross-encoder (the heavy import lives HERE — D-08/SC#3)."""
    global _ENCODER
    if _ENCODER is None:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")   # offline after first fetch (mirror dense.py:63)
        from fastembed.rerank.cross_encoder import TextCrossEncoder  # LAZY — only when rerank runs

        _ENCODER = TextCrossEncoder(MODEL, threads=1)  # threads=1 → reproducible (Gate 3)
    return _ENCODER


def rerank_scores(query: str, docs: list[str]) -> list[float] | None:
    """Per-doc cross-encoder logits (index-aligned with ``docs``), or None to degrade to
    passthrough. Catches the FULL fastembed failure surface (Pitfall 1): ImportError (lib
    absent), ValueError (model absent + offline), OSError (unreadable cache), httpx.HTTPError
    (cold network fetch fails). NO bare except / no ``except Exception`` (project rule)."""
    if not docs:
        return []
    try:
        import httpx  # core dep — for the network-fetch-failure branch of the catch

        enc = _get_encoder()
        return list(enc.rerank(query, docs))   # generator → list[float] (VERIFIED)
    except (ImportError, ValueError, OSError, httpx.HTTPError):
        return None
