#!/usr/bin/env python3
# cco-tool-version: 1
# RED-before-GREEN pytest suite for cco-dream-log (AUTO-02, the /dream kept/discarded log writer).
# Proves the load-bearing log facts BEFORE the implementation is trusted:
#   - row SHAPE: one .jsonl line per call json-parses to EXACTLY {ts,iter,summary,before,after,
#     decision,why}; decision in {keep,discard}.
#   - .md table: a header row written ONCE (first write only); one data row per call; no header dup.
#   - append-not-overwrite: two calls leave TWO data rows in BOTH files; the first row is preserved.
#   - metadata-only (D-07/D-11): build_row emits ONLY the seven fields; an oversize/payload summary is
#     TRUNCATED to the cap and no other key is written.
#   - fail-safe (T-08-05): an unwritable log dir / bad path -> warn to stderr, exit 0, write nothing
#     (a log failure must NEVER crash the loop).
# The script under test has no `.py` extension, so it is loaded via SourceFileLoader (the cco-ledger
# pytest pattern this repo uses).
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

LOG_PATH = Path(__file__).with_name("cco-dream-log")

EXPECTED_KEYS = {"ts", "iter", "summary", "before", "after", "decision", "why"}


def _load_log() -> ModuleType:
    loader = importlib.machinery.SourceFileLoader("cco_dream_log", str(LOG_PATH))
    spec = importlib.util.spec_from_loader("cco_dream_log", loader)
    assert spec is not None, f"cannot load {LOG_PATH}"
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def lg() -> ModuleType:
    return _load_log()


def _run_cli(args: list[str]):
    """Drive the real CLI (the runner invokes it directly per iteration)."""
    return subprocess.run(
        [sys.executable, str(LOG_PATH), *args],
        capture_output=True,
        text=True,
    )


def _invoke(log_base: Path, **kw):
    """Append one row via the CLI with sensible defaults; override per test."""
    args = [
        "--log", str(log_base),
        "--iter", str(kw.get("iter", 1)),
        "--summary", kw.get("summary", "tweaked the thing"),
        "--before", str(kw.get("before", "10")),
        "--after", str(kw.get("after", "12")),
        "--decision", kw.get("decision", "keep"),
        "--why", kw.get("why", "improved and green"),
    ]
    return _run_cli(args)


# --------------------------------------------------------------------------------------------------
# Behavior 1: the jsonl row shape (EXACTLY the seven metadata keys)
# --------------------------------------------------------------------------------------------------
def test_1_jsonl_row_shape(lg, tmp_path):
    base = tmp_path / "dreamlog"
    proc = _invoke(base, decision="keep")
    assert proc.returncode == 0, proc.stderr
    lines = (tmp_path / "dreamlog.jsonl").read_text().splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert set(row.keys()) == EXPECTED_KEYS, f"unexpected keys: {set(row.keys())}"
    assert row["decision"] in {"keep", "discard"}
    assert row["iter"] == 1


# --------------------------------------------------------------------------------------------------
# Behavior 2: the .md table — header ONCE, one data row per call, no header dup
# --------------------------------------------------------------------------------------------------
def test_2_md_header_written_once(lg, tmp_path):
    base = tmp_path / "dreamlog"
    _invoke(base, iter=1)
    _invoke(base, iter=2)
    md = (tmp_path / "dreamlog.md").read_text()
    # The markdown header (a "| iter |" pipe row) must appear exactly once.
    header_lines = [ln for ln in md.splitlines() if ln.strip().startswith("|") and "iter" in ln]
    assert len(header_lines) == 1, f"header should appear once, found {len(header_lines)}"
    # Two data rows present (each carries a decision token).
    data_lines = [ln for ln in md.splitlines() if ln.strip().startswith("|") and ("keep" in ln or "discard" in ln)]
    assert len(data_lines) == 2


# --------------------------------------------------------------------------------------------------
# Behavior 3: append-not-overwrite — two calls -> TWO rows in both files; first row preserved
# --------------------------------------------------------------------------------------------------
def test_3_append_not_overwrite(lg, tmp_path):
    base = tmp_path / "dreamlog"
    _invoke(base, iter=1, summary="first attempt", decision="keep")
    _invoke(base, iter=2, summary="second attempt", decision="discard")
    jl = (tmp_path / "dreamlog.jsonl").read_text().splitlines()
    assert len(jl) == 2
    first, second = json.loads(jl[0]), json.loads(jl[1])
    assert first["iter"] == 1 and first["decision"] == "keep"
    assert second["iter"] == 2 and second["decision"] == "discard"
    assert first["summary"] == "first attempt"  # the writer NEVER truncated/rewrote the prior row


# --------------------------------------------------------------------------------------------------
# Behavior 4: metadata-only / no payload — only the 7 fields; oversize summary truncated
# --------------------------------------------------------------------------------------------------
def test_4_metadata_only_and_truncation(lg, tmp_path):
    # build_row is the pure gate: given a payload-looking, oversize summary it returns ONLY the seven
    # keys and truncates summary/why to the cap.
    big = "X" * 5000  # a "payload" — file-dump-sized
    row = lg.build_row(iter=3, summary=big, before="1", after="2", decision="discard", why="Y" * 5000)
    assert set(row.keys()) == EXPECTED_KEYS
    assert len(row["summary"]) <= 200
    assert len(row["why"]) <= 200
    # No payload key can be smuggled in — build_row takes a fixed signature, not **kwargs.
    # (Asserting the key set above is the guarantee.)


def test_4b_cli_drops_unknown_via_fixed_flags(lg, tmp_path):
    """The CLI only accepts the declared flags; the written row carries no extra key even if a long
    summary is passed (the no-payload contract, end-to-end)."""
    base = tmp_path / "dreamlog"
    proc = _invoke(base, summary="Z" * 1000)
    assert proc.returncode == 0
    row = json.loads((tmp_path / "dreamlog.jsonl").read_text().splitlines()[0])
    assert set(row.keys()) == EXPECTED_KEYS
    assert len(row["summary"]) <= 200


# --------------------------------------------------------------------------------------------------
# Behavior 5: fail-safe — unwritable path -> warn to stderr, exit 0, write nothing
# --------------------------------------------------------------------------------------------------
def test_5_fail_safe_unwritable(lg, tmp_path):
    # Point --log at a path whose PARENT is a file (so makedirs/open must fail). The CLI must NOT
    # crash: warn to stderr, exit 0, write nothing.
    blocker = tmp_path / "iam_a_file"
    blocker.write_text("not a directory")
    bad_base = blocker / "subdir" / "dreamlog"  # parent 'iam_a_file' is a file, not a dir
    proc = _invoke(bad_base)
    assert proc.returncode == 0, "a log failure must NEVER crash the loop (exit 0)"
    assert proc.stderr.strip() != "", "fail-safe should warn to stderr"
    # Nothing got written under the impossible path.
    assert not (blocker / "subdir").exists()


# --------------------------------------------------------------------------------------------------
# Pure-function spot checks (imported directly; signatures must stay stable)
# --------------------------------------------------------------------------------------------------
def test_build_row_fields_and_types(lg):
    row = lg.build_row(iter=2, summary="s", before="0.5", after="0.4", decision="keep", why="w")
    assert set(row.keys()) == EXPECTED_KEYS
    assert row["iter"] == 2
    assert row["decision"] == "keep"
    assert isinstance(row["ts"], str) and row["ts"]  # an ISO timestamp string
    assert isinstance(row["before"], str) and isinstance(row["after"], str)


def test_build_row_dash_for_unset(lg):
    """before/after may be a literal dash when unset (e.g. the first iteration has no 'before')."""
    row = lg.build_row(iter=1, summary="s", before="-", after="7", decision="keep", why="baseline")
    assert row["before"] == "-"
    assert row["after"] == "7"


def test_md_header_and_row_pure(lg):
    header = lg.md_header()
    assert header.strip().startswith("|") and "iter" in header
    row = lg.build_row(iter=1, summary="has | a pipe", before="1", after="2", decision="discard", why="why | here")
    line = lg.md_row(row)
    assert line.strip().startswith("|")
    # The content survives the row.
    assert "has " in line and "a pipe" in line
    # A pipe inside a field MUST be escaped (\\|) so it cannot break the table columns.
    assert "\\|" in line, "a literal pipe in a field must be escaped"
    # The row's UNESCAPED pipes are exactly the column delimiters — same as ONE header line (the
    # header string carries two lines: the column row + the separator row, so compare to its first).
    header_first_line = header.splitlines()[0]
    unescaped = line.replace("\\|", "")  # drop escaped field-pipes, leaving only column delimiters
    assert unescaped.count("|") == header_first_line.count("|"), "field pipes must be escaped (no extra columns)"
