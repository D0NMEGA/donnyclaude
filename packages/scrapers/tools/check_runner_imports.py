#!/usr/bin/env python3
"""Static guard: the eval runner imports no pytest / heavy libs (D-27/D-38).

Parses ``eval/run_eval.py`` with ``ast`` (no execution) and asserts that the
runner — which is on the metric path and must run inside Donny subagents — never
imports ``pytest`` and never pulls a heavy library (``bm25s``, ``datasketch``,
``httpx``). Keeps the verify step a single simple invocation and pins the
subagent-safe invariant so a future edit can't silently regress it.

Exit 0 with "run_eval import-light ok" when clean; SystemExit(1) otherwise.
"""
from __future__ import annotations

import ast
from pathlib import Path

RUNNER = Path(__file__).resolve().parent.parent / "eval" / "run_eval.py"
# Phase 7 (SEM-03): the dense half adds a heavy embedding stack (model2vec + its
# tokenizers/safetensors/huggingface_hub deps, plus the never-installed
# onnxruntime/torch/fastembed of the deferred [semantic] upgrade). The dense
# import lives lazily inside dense.py (mirroring eval/metrics.py's lazy
# `import rank`), so the runner must never pull any of them at module top.
# NOTE: this AST pre-filter only parses run_eval.py and CANNOT see a transitive
# leak through routing / eval.metrics / rank — eval/tests/test_dense_import_light.py
# is the runtime sys.modules net that catches that (Pitfall 3 / STATE blocker).
FORBIDDEN = {"pytest", "bm25s", "datasketch", "httpx",
             "model2vec", "tokenizers", "safetensors", "huggingface_hub",
             "onnxruntime", "torch", "fastembed",
             # Phase 10 (ENRICH-02/SC#4): the requests-based transcript stack must
             # stay lazy in transcripts.py — a top-level import in research.py would
             # land in the runner's sys.modules. (httpx is already legitimately
             # present via research.py and is NOT a transcript-net concern.)
             "youtube_transcript_api", "requests", "defusedxml",
             # Phase 13 (RSS-01): feedparser (+ its only dep sgmllib3k) must stay lazy
             # in research.rss — a top-level import in research.py would leak into the
             # runner's sys.modules. Belt-and-braces over the mandatory lazy in-fn
             # import, consistent with the youtube_transcript_api/requests precedent.
             "feedparser", "sgmllib3k"}


def imported_top_level_modules(source: str) -> set[str]:
    """Return the set of top-level module names imported by ``source``.

    Handles both ``import x.y`` (-> "x") and ``from x.y import z`` (-> "x");
    ignores relative imports (``from . import ...``), which have no top-level
    module name.
    """
    tree = ast.parse(source)
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                modules.add(node.module.split(".")[0])
    return modules


def main() -> int:
    source = RUNNER.read_text(encoding="utf-8")
    modules = imported_top_level_modules(source)
    leaked = sorted(modules & FORBIDDEN)
    if leaked:
        raise SystemExit(
            f"run_eval.py imports forbidden module(s): {', '.join(leaked)} "
            f"(D-27/D-38: the metric path must stay pytest/heavy-lib free)"
        )
    print("run_eval import-light ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
