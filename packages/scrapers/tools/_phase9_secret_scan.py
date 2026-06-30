#!/usr/bin/env python3
"""Throwaway Phase-9 belt-and-braces secret-at-rest scanner (D-9-07 / the 05-05 gate).

A BYTE-EXACT scan over every file under ``out/.httpcache/`` — NOT ``grep -rI``, which
SKIPS the binary sqlite db (the exact 05-05 lesson: keyword grep misses the credential
bytes packed into the Entry blob). Reports any credential-SHAPED value bytes left in the
on-disk cache by a prior live run.

This is the secondary, opportunistic gate. The BINDING offline proof that PERF-02 does
not regress secret-at-rest is ``tests/test_robustness.py::test_cache_store_redacts_auth_material``
(its 5-secret byte-scan over a pytest ``tmp_path`` store). This scanner just confirms no
secret bytes survive in any cache the operator's prior live runs left behind.

Run under uv (never bare python):  ``uv run python tools/_phase9_secret_scan.py``
Exit 0 = clean (empty hit list); exit 1 = a credential-shaped byte sequence was found.
"""
from __future__ import annotations

import os
import re
import sys

_CACHE_DIR = os.path.join(os.path.expanduser("~/.claude/scrapers/out"), ".httpcache")

# Credential-SHAPED byte patterns (value bytes, not header NAMES). The redaction at
# _RedactingSqliteStorage.create_entry strips auth headers + masks ?key= values BEFORE
# persistence, so none of these should appear in the stored Entry blobs.
#
# A real credential VALUE is a single CONTIGUOUS no-whitespace token (base64 / JWT / hex
# shape), >=16 chars and not a natural-language word — that length+contiguity bound is what
# separates a true ``Authorization: Bearer <token>`` from cached article prose like
# "basic settings"/"basic sourdough" (the 05-05 lesson: a loose ``basic\s+\w+`` matches
# English text, so it must require a credential-shaped token, not just any following word).
#   - ``Bearer <tok>`` / ``Basic <b64>``       : an Authorization header value that survived
#   - ``?key=<v>`` / ``&api_key=<v>`` / ...     : a youtube/google ?key= URL secret that survived
#     (the post-redaction ``REDACTED`` placeholder is EXPECTED → excluded via negative lookahead)
#   - x-subscription-token / x-api-key VALUES   : a credential-shaped token after the header name
_TOKEN = rb"[A-Za-z0-9+/_\-]{16,}={0,2}"     # contiguous base64/JWT/hex run, >=16 chars
_BOUND = rb"(?![A-Za-z0-9+/_\-=])"           # value must END here (not mid-word)
# A real credential VALUE is base64/JWT/hex-shaped — it carries >=1 digit or base64-special
# (+ / =). This is exactly the "credential-shaped token, not just any following word" the
# module docstring requires: a pure-alpha run like "misunderstanding" (16 letters) is English
# prose, NOT a token. Applied ONLY to the bearer|basic pattern — the one that can match a bare
# dictionary word after "basic "/"bearer " in cached article text (the 17-03 / 05-05 lesson).
# The key=/api_key/x-api-key/x-subscription-token patterns stay unconstrained: they are anchored
# by an explicit secret-context prefix that never appears in prose, so they still flag an
# all-alpha provider key verbatim.
_SHAPED = rb"(?=[A-Za-z0-9+/_\-]*[0-9+/=])"  # the >=16-char run must contain a digit or +/=
_SECRET_BYTE_PATTERNS = [
    rb"(?i)(?:bearer|basic)\s+" + _SHAPED + _TOKEN + _BOUND,
    rb"(?i)[?&]key=(?!REDACTED)" + _TOKEN + _BOUND,
    rb"(?i)[?&](?:api_key|apikey|access_token|token)=(?!REDACTED)" + _TOKEN + _BOUND,
    rb"(?i)x-subscription-token[\"'\s:=]+" + _TOKEN + _BOUND,
    rb"(?i)x-api-key[\"'\s:=]+" + _TOKEN + _BOUND,
]
_COMPILED = [re.compile(p) for p in _SECRET_BYTE_PATTERNS]


def scan() -> int:
    if not os.path.isdir(_CACHE_DIR):
        print(f"[phase9-secret-scan] no cache dir at {_CACHE_DIR} — "
              "the offline test_cache_store_redacts_auth_material is the authoritative gate.")
        return 0
    hits: list[str] = []
    scanned = 0
    for root, _dirs, files in os.walk(_CACHE_DIR):
        for fname in files:
            path = os.path.join(root, fname)
            try:
                with open(path, "rb") as fh:
                    blob = fh.read()
            except OSError as e:
                print(f"[phase9-secret-scan] could not read {path}: {e}", file=sys.stderr)
                continue
            scanned += 1
            for rx in _COMPILED:
                for m in rx.finditer(blob):
                    # Report the pattern + a short, length-capped, non-leaking context marker.
                    snippet = m.group(0)[:48]
                    hits.append(f"{path}: matched {rx.pattern!r} -> {snippet!r}")
    print(f"[phase9-secret-scan] byte-scanned {scanned} file(s) under {_CACHE_DIR}")
    if hits:
        print(f"[phase9-secret-scan] FOUND {len(hits)} credential-shaped hit(s):")
        for h in hits:
            print(f"  ! {h}")
        return 1
    print("[phase9-secret-scan] CLEAN — no credential-shaped value bytes found (empty hit list).")
    return 0


if __name__ == "__main__":
    sys.exit(scan())
