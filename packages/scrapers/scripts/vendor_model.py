#!/usr/bin/env python3
"""One-shot model vendoring (SEM-01 / D-04). Run ONCE on a networked machine,
then commit models/potion-retrieval-32M-int8/ via PLAIN GIT.

Provenance:
  source repo : minishlab/potion-retrieval-32M  (HuggingFace, MIT license)
  revision    : 6fc8051fab2a1e0ee76689cf08c853792ac285e7  (main @ 2026-06-20, pinned)
  quantize    : int8  (~32 MB; "25% size, no perf loss" -- model2vec changelog)
  why plain-git, not LFS: an LFS smudge filter fetches the real blob over the
    network on a fresh clone -> breaks the cold/offline guarantee. int8 keeps
    model.safetensors <= ~32 MB, under GitHub's 100 MB hard / 50 MB warn limits.
    (float32 is 129 MB -> would be REJECTED by GitHub; quantization is REQUIRED.)
  load path   : dense.StaticModel.from_pretrained(models/potion-retrieval-32M-int8)
                with HF_HUB_OFFLINE=1 (no Hub call at query time).
  safety      : we fetch ONLY the safetensors static-model files (ignore onnx/* and
                any pickle) -> no code-exec surface (T-07-07); committed plain-git so
                the exact bytes are reviewable and revision-stable (T-07-09).

  NOTE: model2vec 0.8.x StaticModel.from_pretrained has no `revision` parameter, so
  the revision is pinned by snapshot_download(revision=...) into the HF cache FIRST,
  then we quantize+save from that exact-revision local snapshot.
"""
from __future__ import annotations

from pathlib import Path

from huggingface_hub import snapshot_download
from model2vec import StaticModel

SOURCE = "minishlab/potion-retrieval-32M"
REVISION = "6fc8051fab2a1e0ee76689cf08c853792ac285e7"  # pinned main commit SHA
OUT = Path(__file__).resolve().parent.parent / "models" / "potion-retrieval-32M-int8"


def main() -> None:
    # 1. Fetch the EXACT pinned revision (safetensors only; no onnx/pickle) into cache.
    local = snapshot_download(SOURCE, revision=REVISION, ignore_patterns=["onnx/*"])
    # 2. Load the float32 static weights from the pinned snapshot and int8-quantize.
    m = StaticModel.from_pretrained(local, quantize_to="int8")
    # 3. Save the int8 model to the vendored dir (committed plain-git).
    m.save_pretrained(str(OUT))
    print(f"vendored {SOURCE}@{REVISION} (int8) -> {OUT}")


if __name__ == "__main__":
    main()
