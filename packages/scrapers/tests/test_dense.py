"""RED unit tests for dense.py (created GREEN in Plan 02).

Contract (07-RESEARCH § Code Examples → dense.py):
  dense_scores(query, docs) -> list[float] | None
    * [] for empty docs
    * one cosine float per doc, same order as docs
    * cosine is the L2-normalized dot product (model normalizes by default),
      so identical query==doc ≈ 1.0 and a paraphrase scores HIGHER than an
      unrelated string (vocabulary-gap bridging — SEM-02)
    * deterministic: two calls give byte-identical floats (static model2vec)
    * degrade-to-None ONLY on (ImportError, OSError) — NEVER a bare except
"""
from __future__ import annotations

import inspect

import pytest

import dense  # RED until Plan 07-02 creates dense.py (ModuleNotFoundError on collection)


def test_dense_empty_docs_returns_empty():
    # An empty doc list is a cheap, model-free path: [] regardless of the model.
    assert dense.dense_scores("q", []) == []


@pytest.mark.eval
def test_dense_load_offline_shape():  # selector: load_offline
    # With the vendored model present, dense_scores returns one cosine per doc in
    # [-1, 1]. The vendored weights land in Plan 03, so SKIP (don't fail) while the
    # model is absent — this row goes GREEN at the Plan 04/05 vendored-model gate.
    scores = dense.dense_scores("gruyere", ["gruyere melts", "key lime pie"])
    if scores is None:
        pytest.skip("vendored model absent (Plan 03 Task 1) — degrade-to-None")
    assert isinstance(scores, list)
    assert len(scores) == 2
    assert all(isinstance(s, float) for s in scores)
    assert all(-1.0001 <= s <= 1.0001 for s in scores)


@pytest.mark.eval
def test_dense_paraphrase_outscores_unrelated():  # selector: rank_op / normalize
    # SEM-02 vocabulary-gap bridging: a paraphrase of the query must score a HIGHER
    # cosine than an unrelated string. Skip if the vendored model is absent.
    query = "gruyere melts well"
    docs = ["best cheese for grilled cheese", "longest range electric vehicle"]
    scores = dense.dense_scores(query, docs)
    if scores is None:
        pytest.skip("vendored model absent (Plan 03 Task 1) — degrade-to-None")
    assert scores[0] > scores[1], (
        "paraphrase 'best cheese for grilled cheese' must out-cosine the unrelated "
        "'longest range electric vehicle' (SEM-02 vocabulary-gap rescue)"
    )


@pytest.mark.eval
def test_dense_determinism():  # selector: determinism
    # Static model2vec is deterministic by construction: two calls → identical floats.
    docs = ["gruyere melts well", "best cheese for grilled cheese"]
    first = dense.dense_scores("gruyere", docs)
    if first is None:
        pytest.skip("vendored model absent (Plan 03 Task 1) — degrade-to-None")
    second = dense.dense_scores("gruyere", docs)
    assert first == second, "static model2vec cosine must be byte-identical across calls"


def test_dense_degrade_to_none_is_typed():  # selector: degrade
    # Structurally pin the no-bare-except rule (project CLAUDE.md): the degrade path
    # catches (ImportError, OSError) ONLY — never a bare `except:`. RED until dense.py
    # exists, then GREEN. Reading the source keeps this offline + model-independent.
    src = inspect.getsource(dense.dense_scores)
    assert "except (ImportError, OSError)" in src, (
        "dense_scores must degrade to None on (ImportError, OSError) only"
    )
    assert "except:" not in src, "no bare `except:` allowed (project CLAUDE.md)"
