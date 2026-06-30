"""Shared fixtures/helpers for the Phase-4 source tests (offline, no network).

Two helpers the no-key/envelope-shape tests in ``test_sources_phase4.py`` reuse:

* ``ENVELOPE_KEYS`` — the full uniform item key set every source emits via
  ``research.write_out`` (D-58). The four new sources (brave/reddit/youtube/news)
  produce exactly these 11 keys.
* ``clear_keys`` — a monkeypatch fixture that removes every Phase-4 source key
  from the environment so the source functions take the no-key ``[]`` path with
  zero network (D-56 / threat T-04-02). Auto-reverted by monkeypatch teardown.
* ``read_envelope`` — read a ``write_out`` envelope JSON back from disk (tests
  write to ``tmp_path`` then read it back).
"""
import json
import pathlib

import pytest

# The full uniform envelope item key set (research.py write_out shape, D-58).
ENVELOPE_KEYS = {"id", "title", "author", "score", "num_comments", "created_utc",
                 "url", "text", "top_comments", "tags", "extra"}


@pytest.fixture
def clear_keys(monkeypatch):
    """Remove every Phase-4 source key so source fns take the no-key path (D-56)."""
    for var in ("BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY", "REDDIT_CLIENT_ID",
                "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT", "YOUTUBE_API_KEY", "YT_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def read_envelope(path):
    """Read a write_out envelope JSON back from disk."""
    return json.loads(pathlib.Path(path).read_text())
