#!/usr/bin/env python3
# cco-tool-version: 1
# RED-before-GREEN pytest suite for cco-vault-dream (Phase 16: DREAM-02 / DETECT-01 / DETECT-03).
# cco-vault-dream is the THIRD sibling of cco-vault-audit / cco-source-drift: a stdlib-only
# orchestrator that COMPOSES the byte-unchanged cco-dream loop (--surface ~/vault) and MERGES the
# two detector streams (cco-vault-audit --json + cco-source-drift --json) into ONE deterministically
# ranked worklist, honoring per-folder TTL/threshold + a `pinned` escape hatch, behind a
# `--detect-only` ZERO-WRITE checkpoint (the proven-safe stopping point before Phase 17's write loop).
#
# This file is the RED half of the TDD cycle: it is authored BEFORE ~/.claude/bin/cco-vault-dream
# exists. Every test that exercises the orchestrator must currently FAIL or ERROR (there is no
# cco-vault-dream yet) — that is the proof the suite tests real behavior, not a tautology. The single
# exception is test_siblings_byte_unchanged, which PASSES immediately (the three siblings already
# match their md5 of record) and stands as a regression guard Plan 02 must keep green.
#
# The 12 tests (each independently selectable via `-k`, names verbatim from 16-VALIDATION.md):
#   DREAM-02 / SC1 (composition, not a fork):
#     - test_composition_not_fork        : orchestrator subprocesses cco-dream; loop body NOT copied.
#     - test_siblings_byte_unchanged     : all three sibling md5s of record unchanged (GREEN now).
#     - test_dry_run_no_claude_p         : --dry-run delegates to cco-dream --dry-run (NO claude -p).
#   DETECT-01 / SC2 (merge the two streams):
#     - test_merge_union_by_path         : a multi-stream note = ONE worklist entry (classes union).
#     - test_passthrough_not_ranked      : unresolved_sources/suppressed never become candidates.
#   DETECT-03 / SC3 (deterministic rank + thresholds + pinned + stdlib):
#     - test_rank_class_severity_primary : drift > broken/orphaned > aged; stable across runs.
#     - test_ttl_per_folder_and_evergreen: budgeted folder flags past-TTL; evergreen never age-flags.
#     - test_pinned_excludes_all_classes : pinned: true note absent across ALL classes.
#     - test_no_pyyaml_import            : orchestrator does NOT import yaml (D-07 stdlib-only).
#   DETECT-03 / SC4 (the zero-write checkpoint) + sibling parity:
#     - test_detect_only_zero_writes_fixture : content-hash + rev-parse HEAD identical (fixture repo).
#     - test_detect_only_zero_writes_live    : the same proof against the REAL ~/vault.
#     - test_exit_codes_and_json_shape       : exit 0/1/2; --json D-14 keys present; render() non-crash.
#
# The script under test has NO `.py` extension → loaded via SourceFileLoader (the
# test_cco_source_drift.py / test_cco_dream_log.py pattern this repo uses), and the CLI is driven via
# subprocess.run([sys.executable, PATH, ...]). Commit dates are pinned with GIT_COMMITTER_DATE/
# GIT_AUTHOR_DATE so any git-derived signal never depends on wall-clock time.
#
# Run with `~/.local/bin/pytest` (default `python3 -m pytest` is ABSENT and silently runs nothing):
#   ~/.local/bin/pytest ~/.claude/bin/test_cco_vault_dream.py -x
# The PostToolUse `ty` lint-loop emits a FALSE `unresolved-import: pytest` on this file — pytest lives
# at `~/.local/bin/pytest`, not the default python path — IGNORE it. Never verify this file's contents
# with plain BSD `grep` (non-ASCII → "binary", silent empty output): use `grep -a` / Python / pytest.
from __future__ import annotations

import hashlib
import importlib.machinery
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

import pytest

# The orchestrator under test (does NOT exist yet — Plan 02 creates it).
VAULT_DREAM_PATH = Path(__file__).with_name("cco-vault-dream")
# The directory holding all four cco-* siblings (for the md5-of-record assertions).
BIN = Path(__file__).parent

# --------------------------------------------------------------------------------------------------
# Sibling md5s OF RECORD. cco-vault-dream COMPOSES (does not fork) cco-dream, and the orchestrator
# edits NEITHER cco-dream NOR cco-vault-audit — those two MUST stay byte-unchanged (D-03/D-13a).
# cco-source-drift's md5 was rebaselined in the Phase-16 post-audit hardening pass (added git-call
# timeouts + a symlink-skip + a dead-var cleanup — a Phase-15 sibling hardening, NOT a cco-vault-dream
# edit); the constant below is its post-hardening md5. test_siblings_byte_unchanged asserts these exactly.
# --------------------------------------------------------------------------------------------------
CCO_DREAM_MD5 = "d8055242bffbee5cb3ea557340c6a444"
CCO_VAULT_AUDIT_MD5 = "3eef360b9fd7607d463a0c2d90ed6331"
CCO_SOURCE_DRIFT_MD5 = "c6a53eb2553f3982dfe44627cb6b179d"
SIBLING_MD5S = {
    "cco-dream": CCO_DREAM_MD5,
    "cco-vault-audit": CCO_VAULT_AUDIT_MD5,
    "cco-source-drift": CCO_SOURCE_DRIFT_MD5,
}

# Forbidden-token list for test_composition_not_fork (DREAM-02 / T-16-FORK). These tokens are
# UNIQUE to cco-dream's ~1,400-line runner loop and are ABSENT from a thin merge+rank orchestrator
# AND from the two stdlib detectors (verified live: cco-dream contains reconcile_orphans×7,
# caffeinate×19, MAX_ITERS×9, ITER_TIMEOUT×13; both detectors contain 0 of each). If a copied loop
# body slips into cco-vault-dream, one of these will appear and the test fails loud. (We deliberately
# do NOT forbid the bare string "cco-dream" — the orchestrator MUST reference it to compose it.)
#
# PHASE-17 RE-SCOPE (17-02): "claude -p" was REMOVED from this tuple. Phase 17 legitimately COMPOSES a
# WRITING `claude -p` per-note refresh through the cco-dream `--attempt-cmd` seam (the runner still owns
# the loop body); the LLM edit is built INTO the per-note attempt command cco-dream runs, so the literal
# string "claude -p" is no longer a fork signal. The genuine no-fork signal is the RUNNER-ONLY loop-body
# tokens below (the ~1,300-line caffeinated iteration machinery) staying ABSENT, plus the siblings being
# byte-unchanged (test_siblings_byte_unchanged / test_composition_unforked) — those are the companion
# no-edit proofs. (Before this re-scope a wave-3 gated `claude -p` under --apply would have FALSELY
# tripped this token; narrowing the tuple keeps the suite GREEN across the whole phase.)
FORKED_LOOP_TOKENS = (
    "reconcile_orphans",  # cco-dream's orphan-worktree sweep — a runner-only concern
    "caffeinate",         # cco-dream wraps the loop in caffeinate; an orchestrator never does
    "MAX_ITERS",          # the iteration ceiling — a loop-body variable
    "ITER_TIMEOUT",       # the per-iteration timeout — a loop-body variable
)

# A commit date strictly AFTER the seeded notes' `updated:` ages (so any git signal lights up) and
# the temp-vault commit date.
LATER_DATE = "2026-06-10T12:00:00"
# A commit date BEFORE the seeded note ages (the source's initial seed commit).
EARLY_DATE = "2026-04-01T12:00:00"


# --------------------------------------------------------------------------------------------------
# Module load + CLI driver (the script has no .py extension).
# --------------------------------------------------------------------------------------------------
def _load() -> ModuleType:
    """Import cco-vault-dream as a module via SourceFileLoader (it has no .py extension).

    NOT wrapped in try/except: until Plan 02 creates the file this raises FileNotFoundError, and the
    tests that request the `mod` fixture ERROR — which is the correct RED state (do not swallow it)."""
    loader = importlib.machinery.SourceFileLoader("cco_vault_dream", str(VAULT_DREAM_PATH))
    spec = importlib.util.spec_from_loader("cco_vault_dream", loader)
    assert spec is not None, f"cannot load {VAULT_DREAM_PATH}"
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def mod() -> ModuleType:
    """The imported orchestrator module. ERRORs (RED) until Plan 02 creates cco-vault-dream."""
    return _load()


def _cli(vault: Path, *args: str) -> subprocess.CompletedProcess:
    """Drive the real CLI exactly as an operator / Phase 17 will (argv list, never a shell string)."""
    return subprocess.run(
        [sys.executable, str(VAULT_DREAM_PATH), str(vault), *args],
        capture_output=True,
        text=True,
    )


# --------------------------------------------------------------------------------------------------
# Throwaway-git + temp-vault fixtures (copied from test_cco_source_drift.py — same hermetic pattern).
# --------------------------------------------------------------------------------------------------
def _git(repo: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, env=env
    )


def _dated_env(iso: str) -> dict:
    """A commit-date-pinned env so any git signal is reproducible (no wall-clock dependence)."""
    return {**os.environ, "GIT_COMMITTER_DATE": iso, "GIT_AUTHOR_DATE": iso}


def _init_repo(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")


def _commit(repo: Path, iso: str, msg: str = "later") -> None:
    """Stage everything and commit with a PINNED committer/author date."""
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", msg, env=_dated_env(iso))


@pytest.fixture()
def source_repo(tmp_path: Path) -> Path:
    """A throwaway git source repo with one early-dated seed commit (the drift `source:` target)."""
    repo = tmp_path / "source"
    _init_repo(repo)
    (repo / "f.txt").write_text("seed\n")
    _commit(repo, EARLY_DATE, "seed")
    return repo


def _fm_block(fm: dict[str, str]) -> str:
    lines = "\n".join(f"{k}: {v}" for k, v in fm.items())
    return f"---\n{lines}\n---\n"


def write_note(vault: Path, relpath: str, body: str = "note body\n", **fm: str) -> Path:
    """Write `relpath` under the temp vault with a `---\\n<k: v>\\n---\\n` frontmatter block."""
    p = vault / relpath
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_fm_block(fm) + body, encoding="utf-8")
    return p


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    """A temp vault that is ITSELF a git repo (so the HEAD-unchanged zero-write assertion is real)."""
    v = tmp_path / "vault"
    _init_repo(v)
    return v


def _commit_vault(vault: Path) -> None:
    _git(vault, "add", "-A")
    _git(vault, "commit", "-qm", "notes", env=_dated_env(LATER_DATE))


def write_vault_dream_yaml(vault: Path, body: str) -> Path:
    """Seed `<vault>/.cco/vault-dream.yaml` (the per-folder threshold/TTL/pinned config, D-07)."""
    cfg = vault / ".cco" / "vault-dream.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(body, encoding="utf-8")
    return cfg


# --------------------------------------------------------------------------------------------------
# FIXTURE detector-JSON payloads (hand-authored dicts shaped EXACTLY like the live detectors' --json,
# so the merge/rank logic is unit-tested deterministically — NOT against the near-empty live vault).
# --------------------------------------------------------------------------------------------------
def audit_payload(
    stale: list[str] | None = None,
    orphans: list[str] | None = None,
    broken: dict[str, list[str]] | None = None,
) -> dict:
    """A dict shaped like `cco-vault-audit --json` (verified live keys + TYPES).

    CRITICAL (live-fact correction): `broken_links` is a DICT {note_relpath: [broken_targets]}, NOT a
    list. The merge must consume its .keys() (note relpaths) / .items() (to keep target evidence). A
    `curated_orphans + broken_links` concatenation (CONTEXT D-04 sketch) is a list+dict TypeError."""
    return {
        "vault": "/fixture/vault",
        "total": 0,
        "by_folder": {},
        "n_curated": 0,
        "n_journal": 0,
        "machine_notes": [],
        "missing_frontmatter": [],
        "curated_missing": {},
        "journal_missing_count": 0,
        "curated_field_gaps": {},
        "curated_orphans": sorted(orphans or []),
        "journal_leaf_orphans": 0,
        "no_inbound_total": 0,
        "broken_links": dict(broken or {}),  # DICT, keyed by note relpath
        "stale_curated": sorted(stale or []),
    }


def drift_payload(
    drifted: list[dict] | None = None,
    unresolved: list[dict] | None = None,
    suppressed: list[str] | None = None,
) -> dict:
    """A dict shaped like `cco-source-drift --json` (verified live keys)."""
    drifted = drifted or []
    return {
        "vault": "/fixture/vault",
        "generated_at": "2026-06-20T00:00:00Z",
        "total_mapped": len(drifted),
        "total_drifted": len(drifted),
        "drifted": drifted,
        "unresolved_sources": unresolved or [],
        "suppressed": suppressed or [],
    }


def drift_entry(note: str, commits_since: int = 1, source: str = "/some/repo") -> dict:
    """One `cco-source-drift --json` drifted[] entry with the verified evidence keys."""
    return {
        "note": note,
        "source": source,
        "repo": source,
        "subpath": ".",
        "commits_since": commits_since,
        "src_commit_iso": "2026-06-10T12:00:00+00:00",
        "src_mtime": 1_749_556_800.0,
        "note_updated": "2026-05-01",
    }


# --------------------------------------------------------------------------------------------------
# Read-only proof helpers: a recursive content hash over every file in the vault (skipping .git) +
# the git HEAD (the Phase-15 zero-write pattern, reused verbatim for D-12).
# --------------------------------------------------------------------------------------------------
def vault_hash(vault: Path) -> str:
    h = hashlib.sha256()
    files: list[str] = []
    for root, dirs, names in os.walk(vault):
        dirs[:] = [d for d in dirs if d != ".git"]
        for n in names:
            files.append(os.path.relpath(os.path.join(root, n), vault))
    for rel in sorted(files):
        with open(vault / rel, "rb") as fh:
            data = fh.read()
        h.update(rel.encode())
        h.update(b"\0")
        h.update(data)
    return h.hexdigest()


def _head(vault: Path) -> str:
    return _git(vault, "rev-parse", "HEAD").stdout.strip()


def _worklist_notes(data: dict) -> list[str]:
    """The ordered note paths in a --json worklist (D-14 shape: worklist[] of {note, ...})."""
    return [entry["note"] for entry in data["worklist"]]


def _entry_for(data: dict, note: str) -> dict:
    for entry in data["worklist"]:
        if entry["note"] == note:
            return entry
    raise AssertionError(f"{note} not in worklist: {_worklist_notes(data)}")


# ==================================================================================================
# PHASE-17 (Plan 17-02) — shared apply-loop fixtures + the deterministic --attempt-cmd stub.
#
# These fixtures + the stub power the PROPOSE-01..04 + composition_unforked tests at the bottom of the
# file. They are EXPECTED-RED until wave 3 (the `--apply` flag does not exist yet) — building them here
# does NOT make those tests pass; it only puts the seam the tests inject in place.
#
# THE LOCKED --apply CLI CONTRACT (wave 3 / Plan 17-03 implements it; these tests ASSERT it):
#   cco-vault-dream --apply --branch <name> [--max-notes N (default 5)] [--diff-cap N (default 40)]
#   - --apply REQUIRES --branch <name> (exit NON-ZERO otherwise; mirrors cco-dream's --keep-branch guard).
#   - bare cco-vault-dream + --detect-only STAY the zero-write default; --apply is an explicit opt-in
#     branch BEFORE the default path.
#   - --apply rides `cco-dream --surface <vault> --branch <name> --keep-branch` WITHOUT --dry-run;
#     proposals land on the named review branch; the default branch is untouched + never auto-merged.
#   - one commit per refreshed note on the review branch (D-03).
#   - a source-LESS note is emitted to a flag-only list in the machine JSON and NEVER sent to claude -p.
#   - emits a machine-readable JSON record of kept/rejected/flag_only facts on stdout (Phase 18 formats it).
#
# THE LOCKED STUB SEAM (the injection knob the wave-3 apply path MUST honor — pinned by 17-03 must_haves,
# NOT discovered from a SUMMARY):
#   * The wave-3 apply path builds, per worklist note, a per-note ATTEMPT COMMAND (resolve source → build
#     the diff-proposing prompt → invoke `claude -p` → pipe its edit JSON to apply_note.py) and hands it
#     to `cco-dream --attempt-cmd '<cmd>'` (the Phase-14 seam: run with cwd=<wt>, env DREAM_ITER/DREAM_WT/
#     DREAM_FEEDFORWARD; stdout passed through as the classifiable result — confirmed live cco-dream L713-726).
#   * For a TEST stub, the apply path reads the env var **CCO_VAULT_DREAM_ATTEMPT_CMD**: when set, that
#     string is used as the per-note attempt command verbatim INSTEAD of building the real claude -p one
#     (a deterministic fake edit; NO live LLM). The apply path exports the per-note context the stub needs
#     as **CCO_VAULT_DREAM_NOTE** (the note's vault-relative path) and **CCO_VAULT_DREAM_MARKER_DIR** (a
#     dir the stub drops a per-note marker into) before invoking that note's attempt — so a test can prove
#     "was claude -p asked to edit THIS note?" positively (its marker is present) or its CONVERSE for a
#     source-LESS note (its marker is ABSENT — the PROPOSE-03 no-invocation proof). A source-less note is
#     short-circuited to the flag-only list and its attempt command is NEVER run, so its marker never drops.
#   These two env vars + the --attempt-cmd passthrough ARE the seam 17-03 implements.
#
# THE APPLY HELPER (Plan 01, LOCKED contract): /Users/d0nmega/Developer/cco-vault-dream-apply/.venv/bin/
# python apply_note.py --note <p> --edit - --diff-cap <int> [--out <p>] [--check]; stdout JSON
# {accepted,reason,changed_lines,protected_dropped,byte_identical}; exit 0/3/2. The byte-stability proof
# (test_propose02_byte_stable) runs THROUGH this helper via the wave-3 apply path.
# ==================================================================================================

# The injection-knob env-var names — the LOCKED stub seam the wave-3 --apply path reads (17-03 honors).
ATTEMPT_CMD_ENV = "CCO_VAULT_DREAM_ATTEMPT_CMD"   # set => use this attempt command verbatim (test stub)
NOTE_ENV = "CCO_VAULT_DREAM_NOTE"                 # per-note: the note's vault-relative path
MARKER_DIR_ENV = "CCO_VAULT_DREAM_MARKER_DIR"     # per-note: a dir the stub drops its marker into
# Phase 18 (REVIEW-01, Plan 03): the ledger + digest LOG-BASE injection seam. When set, the --apply
# path writes the cco-dream-log ledger (<base>.md/.jsonl) + the morning-review digest (<base>.digest.md)
# under this base VERBATIM (else the default ~/.claude/cco-memory/dream/run-<UTC-ts>). Tests set it to
# tmp_path/"run" so the ledger/digest land in a tmp dir they read back deterministically.
LOG_BASE_ENV = "CCO_VAULT_DREAM_LOG_BASE"

# The Plan-01 byte-stable apply-helper (the wave-3 path invokes it argv-only as a subprocess).
APPLY_PROJECT = Path("/Users/d0nmega/Developer/cco-vault-dream-apply")
APPLY_VENV_PY = APPLY_PROJECT / ".venv" / "bin" / "python"
APPLY_NOTE_PY = APPLY_PROJECT / "apply_note.py"


def _marker_name(note_relpath: str) -> str:
    """A filesystem-safe per-note marker filename (so a test can decide 'was the stub run for it?')."""
    return note_relpath.replace("/", "__") + ".marker"


def write_stub(tmp_path: Path, marker_dir: Path, edit_json: str) -> str:
    """Write a deterministic --attempt-cmd stub script and return the SHELL COMMAND that runs it.

    The returned command is what a test passes as CCO_VAULT_DREAM_ATTEMPT_CMD (the seam the wave-3 apply
    path runs verbatim via `cco-dream --attempt-cmd`, cwd=<wt>). The stub, per the LOCKED seam, does two
    things using the per-note env the apply path exports (NOTE_ENV + MARKER_DIR_ENV):

      (a) DROPS a per-note MARKER file (proof-of-invocation: present iff claude -p was asked to edit this
          note — the positive PROPOSE-03 no-invocation proof when a source-less note's marker is ABSENT), and
      (b) EMITS the apply_note.py edit serialization on stdout (the LOCKED {frontmatter, body_replacements}
          JSON the apply path pipes to apply_note.py --edit -). `edit_json` is that serialization — a
          benign surgical edit, an OVER-cap edit, or a new-broken-link edit (see the make_*_edit builders).

    No live LLM, no claude -p — a pure deterministic stand-in. The stub is argv-driven Python (written into
    tmp_path) and reads ONLY the documented env knob, so it works regardless of cwd."""
    stub = tmp_path / "attempt_stub.py"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import os, sys, pathlib\n"
        f"note = os.environ.get({NOTE_ENV!r}, '')\n"
        f"mdir = os.environ.get({MARKER_DIR_ENV!r}, '')\n"
        "if mdir and note:\n"
        "    d = pathlib.Path(mdir); d.mkdir(parents=True, exist_ok=True)\n"
        "    (d / (note.replace('/', '__') + '.marker')).write_text(note, encoding='utf-8')\n"
        # stdout = the apply_note.py edit serialization (the apply path pipes this to apply_note.py).
        f"sys.stdout.write({edit_json!r})\n",
        encoding="utf-8",
    )
    # Run it with the SAME interpreter the suite uses (stdlib-only; apply_note's ruamel is NOT needed here).
    return f"{shlex.quote(sys.executable)} {shlex.quote(str(stub))}"


def make_noop_edit() -> str:
    """The benign NO-OP edit serialization — apply_note.py re-emits the note byte-identical (PROPOSE-02)."""
    return json.dumps({})


def make_surgical_edit(old: str, new: str) -> str:
    """A benign MINIMAL surgical body edit (one anchored old→new replace-block); diff well under the cap."""
    return json.dumps({"body_replacements": [{"old": old, "new": new}]})


def make_over_cap_edit(old: str, line_count: int = 80) -> str:
    """An OVER-diff-cap edit: replace `old` with `line_count` new lines (> the default 40-line cap) so the
    apply_note.py harness-computed diff exceeds --diff-cap and the proposal is REJECTED (PROPOSE-04 cap)."""
    big = "\n".join(f"injected over-cap line {i}" for i in range(line_count))
    return json.dumps({"body_replacements": [{"old": old, "new": big}]})


def make_broken_link_edit(old: str) -> str:
    """An edit that INTRODUCES a new broken `[[wikilink]]` into the body, so the post-proposal
    cco-vault-audit broken-link count rises above baseline and the regression gate REJECTS (PROPOSE-04)."""
    return json.dumps(
        {"body_replacements": [{"old": old, "new": old + "\n\nSee [[A Note That Does Not Exist]] for more."}]}
    )


@pytest.fixture()
def apply_vault(vault: Path, source_repo: Path) -> Path:
    """A fixture vault git repo seeded with the FOUR notes the PROPOSE proofs need (D-09 source model):

      (a) Projects/Drift.md  — a DRIFT note whose `source:` resolves to the throwaway source_repo (a real
          readable git path) AND which genuinely drifts (the source is moved below) ⇒ a refresh candidate.
      (b) Reference/NoSource.md — a SOURCE-LESS note (NO `source:` field, not referenced in any drift
          evidence) ⇒ flag-only, must NEVER be sent to claude -p (PROPOSE-03).
      (c) Reference/Grade.md  — an A-grade note (`confidence: A` + a `Source:` citation line) for the
          byte-stability / protected-line proof (PROPOSE-02). Also given a resolvable source so it is a
          legitimate refresh target the stub can no-op / surgically edit.
      (d) Projects/Linked.md  — a `related:` / `[[backlink]]`-bearing note (protected-line coverage).

    Built via tmp_path + git init (never the live ~/vault default branch). The source is MOVED after the
    seed commit so the mapped notes genuinely drift. Returns the vault path; commits are dated for repro."""
    # (a) drift note — resolvable source: + will drift once the source moves.
    write_note(vault, "Projects/Drift.md", source=str(source_repo), updated="2026-05-01",
               body="This note tracks the source repo.\nOld fact: the seed value is 'seed'.\n")
    # (b) source-LESS note — no source:, never in drift evidence ⇒ flag-only (PROPOSE-03).
    write_note(vault, "Reference/NoSource.md", updated="2026-05-01",
               body="A purely internal note with no external source of truth.\n")
    # (c) A-grade / sourced note — protected lines (confidence: A, Source:) must survive any edit.
    write_note(vault, "Reference/Grade.md", source=str(source_repo), confidence="A", updated="2026-05-01",
               body="Source: https://example.com/spec\nThis claim is A-grade and sourced.\n")
    # (d) related:/backlink note — more protected-line coverage.
    write_note(vault, "Projects/Linked.md", source=str(source_repo), related="[[Projects/Drift]]",
               updated="2026-05-01",
               body="Body referencing [[Projects/Drift]] as a backlink.\n")
    _commit_vault(vault)
    # Move the source so the mapped notes genuinely drift (a real refresh candidate for the apply loop).
    (source_repo / "f.txt").write_text("moved value\n")
    _commit(source_repo, LATER_DATE, "drift")
    return vault


def run_apply(vault: Path, branch: str, attempt_cmd: str | None, marker_dir: Path,
              *extra: str, timeout: float = 120.0) -> subprocess.CompletedProcess:
    """Invoke `cco-vault-dream --apply --branch <branch> [extra...]` with the deterministic stub injected
    via the LOCKED seam env (ATTEMPT_CMD_ENV + MARKER_DIR_ENV). Tasks 3..4 reuse this single helper.

    `attempt_cmd` is the stub command (from write_stub); when None the apply path would build the real
    claude -p attempt (NOT used by the deterministic suite — always pass a stub). The env knob is the
    contract the wave-3 --apply path reads; until wave 3 exists the CLI exits non-zero on the unknown
    `--apply` flag (the EXPECTED-RED signal these proofs gate on). argv-only; timeout-bounded."""
    env = dict(os.environ)
    env[MARKER_DIR_ENV] = str(marker_dir)
    if attempt_cmd is not None:
        env[ATTEMPT_CMD_ENV] = attempt_cmd
    return subprocess.run(
        [sys.executable, str(VAULT_DREAM_PATH), str(vault), "--apply", "--branch", branch, *extra],
        capture_output=True, text=True, env=env, timeout=timeout,
    )


def _branch_exists(vault: Path, branch: str) -> bool:
    """True iff `branch` is a real local ref in the vault repo (review-branch persistence check)."""
    r = _git(vault, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}")
    return r.returncode == 0


def _commits_on(vault: Path, branch: str, base: str) -> list[str]:
    """The commit subjects on `branch` that are NOT on `base` (the per-note refresh commits, D-03)."""
    r = _git(vault, "log", "--format=%s", f"{base}..{branch}")
    return [ln for ln in r.stdout.splitlines() if ln.strip()]


def _note_sha(vault: Path, relpath: str) -> str:
    """sha256 of a single note's bytes on the working tree (byte-stability proof, PROPOSE-02)."""
    return hashlib.sha256((vault / relpath).read_bytes()).hexdigest()


def _marker_present(marker_dir: Path, note_relpath: str) -> bool:
    """True iff the stub dropped its per-note marker — i.e. claude -p WAS asked to edit this note."""
    return (marker_dir / _marker_name(note_relpath)).exists()


# ==================================================================================================
# DETECT-01 / SC2 — merge the two detector streams into ONE ranked worklist (`-k merge_union`).
# ==================================================================================================
def test_merge_union_by_path(mod: ModuleType) -> None:
    """A note appearing in BOTH `stale_curated` (aged) AND `drifted[]` (drift) merges into ONE
    worklist entry whose `classes` ⊇ {aged, drift} — never two rows (D-04 union-by-path). A
    broken-class note sourced from the `broken_links` DICT keys pins the dict-not-list handling.

    Drives the importable merge function the orchestrator exposes. Plan 02: implement
    `merge(audit_json: dict, drift_json: dict) -> dict[str, set[str]]` mapping note path → class set
    (aged ← stale_curated; orphaned/broken ← curated_orphans + broken_links.keys(); drift ←
    drifted[].note). If the public name differs, adjust here — but the union-by-path contract holds."""
    audit = audit_payload(
        stale=["Projects/Both.md", "Reference/AgedOnly.md"],
        orphans=["Notes/Orphan.md"],
        broken={"Notes/Broken.md": ["[[Missing Target]]", "[[Also Gone]]"]},
    )
    drift = drift_payload(drifted=[drift_entry("Projects/Both.md", commits_since=4)])

    merged = mod.merge(audit, drift)  # path -> set(classes)

    assert set(merged["Projects/Both.md"]) >= {"aged", "drift"}, (
        f"a note in two streams must carry BOTH classes in ONE entry; got {merged.get('Projects/Both.md')}"
    )
    # Exactly one record per note path (union, never duplicated).
    assert list(merged.keys()).count("Projects/Both.md") == 1
    assert "aged" in merged["Reference/AgedOnly.md"]
    assert "orphaned" in merged["Notes/Orphan.md"]
    # The broken_links DICT key became a candidate (dict consumed by .keys(), no list+dict TypeError).
    assert "Notes/Broken.md" in merged, "broken_links is a DICT keyed by note relpath — consume .keys()"
    assert merged["Notes/Broken.md"] & {"broken", "orphaned"}, (
        f"a broken_links entry must carry the broken/orphaned class; got {merged['Notes/Broken.md']}"
    )


def test_passthrough_not_ranked(mod: ModuleType) -> None:
    """`unresolved_sources` + `suppressed` from the drift payload are passed through to the
    orchestrator output (informational) and NEVER become worklist candidates (D-05)."""
    drift = drift_payload(
        drifted=[drift_entry("Projects/Real.md")],
        unresolved=[{"note": "Projects/Stale.md", "source": r"C:\nope", "reason": "not a git work tree"}],
        suppressed=["Projects/Ignored.md"],
    )
    audit = audit_payload()

    result = mod.build_worklist(audit, drift, vault="/fixture/vault")  # full D-14 dict
    notes = {e["note"] for e in result["worklist"]}

    assert "Projects/Stale.md" not in notes, "an unresolved_sources note must never be a candidate (D-05)"
    assert "Projects/Ignored.md" not in notes, "a suppressed note must never be a candidate (D-05)"
    # …but they survive as informational pass-through lists.
    upass = {e["note"] if isinstance(e, dict) else e for e in result["unresolved_sources"]}
    spass = {e["note"] if isinstance(e, dict) else e for e in result["suppressed"]}
    assert "Projects/Stale.md" in upass, "unresolved_sources must pass through to the output"
    assert "Projects/Ignored.md" in spass, "suppressed must pass through to the output"


# ==================================================================================================
# DETECT-03 / SC3 — deterministic ranking + per-folder TTL + pinned escape hatch (`-k …`).
# ==================================================================================================
def test_rank_class_severity_primary(mod: ModuleType) -> None:
    """Class severity is the PRIMARY sort key: drift > broken/orphaned > aged; ties broken by drift
    magnitude (commits_since), then staleness age (oldest updated: first), then note path. The order
    is STABLE across two identical runs (deterministic — that IS the zero-write contract, D-06)."""
    audit = audit_payload(
        stale=["Reference/Aged.md"],
        broken={"Notes/Broken.md": ["[[Gone]]"]},
    )
    drift = drift_payload(drifted=[drift_entry("Projects/Drift.md", commits_since=2)])

    r1 = mod.build_worklist(audit, drift, vault="/fixture/vault")
    r2 = mod.build_worklist(audit, drift, vault="/fixture/vault")
    order1 = _worklist_notes(r1)
    order2 = _worklist_notes(r2)

    assert order1 == order2, f"ranking MUST be deterministic across runs; {order1} != {order2}"
    di = order1.index("Projects/Drift.md")
    bi = order1.index("Notes/Broken.md")
    ai = order1.index("Reference/Aged.md")
    assert di < bi < ai, (
        f"class severity drift>broken/orphaned>aged must dominate the order; got {order1}"
    )
    # Each entry carries an ascending integer rank consistent with its position (D-14).
    ranks = [e["rank"] for e in r1["worklist"]]
    assert ranks == sorted(ranks), f"rank field must ascend with worklist order; got {ranks}"


def test_ttl_per_folder_and_evergreen(vault: Path, source_repo: Path) -> None:
    """With a fixture `.cco/vault-dream.yaml` declaring a budgeted folder (Projects: 90 days) and an
    evergreen folder (Sessions: null), a past-TTL `Projects/` note is aged-eligible while a far-older
    `Sessions/` note NEVER age-flags (D-09: a folder with no TTL never flags on age alone).

    Driven via the CLI (`--detect-only --json`) against a fixture vault so the full config→TTL→age
    pipeline is exercised end to end. Aged detection here is the orchestrator's own per-folder TTL
    gate over note `updated:` ages (NOT cco-vault-audit's global stale window)."""
    write_vault_dream_yaml(
        vault,
        "thresholds:\n"
        "  Projects: 90\n"
        "  Sessions: null\n",
    )
    # A Projects/ note far past a 90-day budget (ancient updated:) → aged-eligible.
    write_note(vault, "Projects/Old.md", updated="2000-01-01")
    # A Sessions/ note even older, but evergreen (null TTL) → must NEVER age-flag.
    write_note(vault, "Sessions/Ancient.md", updated="1990-01-01")
    _commit_vault(vault)

    r = _cli(vault, "--detect-only", "--json")
    assert r.returncode in (0, 1), f"detect-only ⇒ exit 0/1; got {r.returncode}: {r.stderr}"
    data = json.loads(r.stdout)
    aged_notes = {e["note"] for e in data["worklist"] if "aged" in e["classes"]}

    assert "Projects/Old.md" in aged_notes, (
        f"a Projects/ note past its 90-day TTL must be aged-eligible; got {data['worklist']}"
    )
    assert "Sessions/Ancient.md" not in aged_notes, (
        "an evergreen (null-TTL) folder must NEVER age-flag, regardless of age (D-09)"
    )


def test_pinned_excludes_all_classes(vault: Path, source_repo: Path) -> None:
    """A note carrying frontmatter `pinned: true` (and a note named in the yaml `pinned:` list) is
    ABSENT from the worklist across ALL classes — even if it ALSO drifts — and appears in
    `pinned_excluded[]` (D-08, success criterion 3). This is STRICTER than `drift_ignore`: a
    `drift_ignore` note may still appear via a non-drift class, but a `pinned` note cannot appear at
    all. Driven via the CLI against a fixture vault where the pinned note is also genuinely drifted."""
    write_vault_dream_yaml(
        vault,
        "pinned:\n"
        "  - Reference/PinnedByYaml.md\n",
    )
    # Pinned via frontmatter AND genuinely drifted (mapped to a moved source) — must STILL be excluded.
    write_note(
        vault,
        "Projects/PinnedFM.md",
        source=str(source_repo),
        updated="2026-05-01",
        pinned="true",
    )
    # Pinned via the yaml list (no frontmatter pinned key) — also excluded across classes.
    write_note(vault, "Reference/PinnedByYaml.md", source=str(source_repo), updated="2026-05-01")
    _commit_vault(vault)
    # Move the source so both notes WOULD drift were they not pinned.
    (source_repo / "f.txt").write_text("moved\n")
    _commit(source_repo, LATER_DATE, "drift")

    r = _cli(vault, "--detect-only", "--json")
    data = json.loads(r.stdout)
    notes = {e["note"] for e in data["worklist"]}
    excluded = {e["note"] if isinstance(e, dict) else e for e in data["pinned_excluded"]}

    assert "Projects/PinnedFM.md" not in notes, "a `pinned: true` note must be absent from ALL classes"
    assert "Reference/PinnedByYaml.md" not in notes, "a yaml-pinned note must be absent from ALL classes"
    assert "Projects/PinnedFM.md" in excluded, "an excluded note must be surfaced in pinned_excluded[]"
    assert "Reference/PinnedByYaml.md" in excluded, "a yaml-pinned note must be surfaced in pinned_excluded[]"


def test_no_pyyaml_import() -> None:
    """D-07 stdlib-only invariant (static): the orchestrator parses `.cco/vault-dream.yaml` with a
    stdlib mini-parser, NOT PyYAML (which is incidentally importable on this python3 but LOCKED out
    for sibling-consistency/portability). Also assert no embedding/LLM client leaks into the
    deterministic detect core. Read the source with Python (never BSD grep on this non-ASCII file)."""
    src = VAULT_DREAM_PATH.read_text(encoding="utf-8")
    assert re.search(r"\bimport\s+yaml\b", src) is None, "must not import yaml (D-07 stdlib-only)"
    assert re.search(r"\bfrom\s+yaml\b", src) is None, "must not import from yaml (D-07 stdlib-only)"
    for banned in ("sentence_transformers", "openai", "anthropic", "numpy", "dateutil"):
        assert re.search(rf"\b{banned}\b", src) is None, f"detect core must not depend on {banned}"


# ==================================================================================================
# DREAM-02 / SC1 — composition (NOT a fork) + sibling byte-stability + the dry-run smoke.
# ==================================================================================================
def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def test_composition_not_fork() -> None:
    """DREAM-02 / T-16-FORK (static/structural): cco-vault-dream COMPOSES cco-dream — its source
    references `cco-dream` AND uses `subprocess` to invoke it — and does NOT contain cco-dream's
    runner-loop body. The forbidden tokens (FORKED_LOOP_TOKENS) are UNIQUE to the ~1,400-line runner
    loop and absent from both stdlib detectors (verified live), so a copied loop body makes this fail
    loud. Read the source with Python (never BSD grep on this non-ASCII file).

    PHASE-17 RE-SCOPE (17-02): FORKED_LOOP_TOKENS was NARROWED to the four genuine runner-only loop-body
    tokens (reconcile_orphans / caffeinate / MAX_ITERS / ITER_TIMEOUT); the literal "claude -p" was
    dropped because Phase 17 legitimately composes a WRITING `claude -p` per-note refresh through the
    cco-dream `--attempt-cmd` seam (so a gated `claude -p` under --apply is no longer a fork signal —
    it would otherwise FALSELY trip this test and break the suite mid-phase). The no-edit-of-siblings
    companion proof is test_siblings_byte_unchanged / test_composition_unforked (md5 of record)."""
    src = VAULT_DREAM_PATH.read_text(encoding="utf-8")

    # (a) It composes cco-dream as a subprocess.
    assert "cco-dream" in src, "the orchestrator must reference cco-dream (composition, D-02)"
    assert "subprocess" in src, "the orchestrator must shell out (argv subprocess) to compose cco-dream"

    # (b) It does NOT inline cco-dream's loop body — a forked loop trips one of these tokens.
    for token in FORKED_LOOP_TOKENS:
        assert token not in src, (
            f"forbidden runner-loop token {token!r} found in cco-vault-dream — that is a FORK, not "
            f"composition (DREAM-02 success criterion 1). Shell out to cco-dream instead."
        )


def test_siblings_byte_unchanged() -> None:
    """DREAM-02 / SC1: all three composed/subprocessed siblings are byte-unchanged at test time
    (md5 of record). PASSES immediately (the siblings already match) — a standing regression guard
    proving Plan 02 edited NO sibling (composition, not a fork). If Plan 02 touches a sibling, the
    md5 changes and this goes red."""
    for name, expected in SIBLING_MD5S.items():
        path = BIN / name
        assert path.exists(), f"sibling {name} missing from {BIN}"
        assert _md5(path) == expected, (
            f"{name} md5 changed (got {_md5(path)}, expected {expected}) — a sibling was edited; "
            f"this phase is composition-only and must leave all three byte-unchanged"
        )


def test_dry_run_no_claude_p(vault: Path) -> None:
    """DREAM-02 / T-16-WRITE: `--dry-run` delegates to `cco-dream --dry-run` (worktree create/teardown
    + green check, NO writing edit, no commit). The run exits cleanly without writing the vault even
    when no real `claude` edit could happen — that IS the point of the write-free composition smoke
    (D-13b). Paired with a before/after vault content-hash so a stray write is caught.

    PHASE-17 RE-SCOPE (17-02): the bare `"claude -p" not in orchestrator_src` ban was REMOVED. A
    writing `claude -p` becomes legitimate in Phase 17 — but ONLY under the explicit `--apply --branch`
    opt-in (Plan 17-03), never on the DRY-RUN / --detect-only / DEFAULT paths. This test pins exactly
    that boundary for the dry-run path: it stays GREEN by proving the dry-run path is provably
    WRITE-FREE (delegates to `cco-dream --dry-run`; HEAD + content-hash unchanged before/after; the
    safe-path banner present) — i.e. a writing edit is NOT reachable here, regardless of whether the
    literal string appears for the gated apply path elsewhere in the file. A bare string ban would
    have FALSELY gone red the moment wave 3 added the gated apply `claude -p` — so it is dropped while
    every write-free property below is kept unchanged-in-spirit."""
    write_note(vault, "Projects/Seed.md", updated="2026-05-01")
    _commit_vault(vault)

    head_before = _head(vault)
    hash_before = vault_hash(vault)
    r = _cli(vault, "--dry-run")
    head_after = _head(vault)
    hash_after = vault_hash(vault)

    combined = (r.stdout or "") + (r.stderr or "")
    # POSITIVE evidence the dry-run actually ran the composition smoke (so the test is genuinely RED
    # while cco-vault-dream is absent — an absent orchestrator exits 2 with no such marker, never a
    # vacuous pass). The orchestrator's --dry-run delegates to `cco-dream --dry-run`, which prints a
    # "NO claude -p" / "dry-run" marker; the run must succeed (exit 0).
    assert r.returncode == 0, f"--dry-run composition smoke must succeed (exit 0); got {r.returncode}: {combined}"
    assert re.search(r"dry[\s-]?run", combined, re.IGNORECASE), (
        f"--dry-run must show it delegated to cco-dream's dry-run path; output:\n{combined}"
    )
    # PHASE-17 RE-SCOPE (17-02): the true T-16-WRITE property for the DRY-RUN path is that it is
    # provably WRITE-FREE — it delegates to `cco-dream --dry-run` (worktree create/teardown + green
    # check, NO commit) and changes not a vault byte. We pin that DIRECTLY (the safe-path banner + the
    # HEAD/content-hash equality below) rather than via a bare `"claude -p" not in orchestrator_src`
    # ban. That ban was self-contradictory even in Phase 16 (cco-dream's OWN --dry-run banner prints
    # the reassurance substring "NO claude -p"/"WOULD then loop … (each: claude -p …)" describing the
    # loop it is NOT running), and it becomes FALSE the moment Plan 17-03 adds the gated apply
    # `claude -p` under `--apply --branch`. The writing edit is reachable ONLY under that explicit
    # opt-in (Plan 17-03), NEVER on this dry-run path — which is exactly what the write-free proof
    # below demonstrates: a run that writes zero bytes invoked no writing edit, whatever strings the
    # apply path elsewhere contains.
    assert "NO commit" in combined or re.search(r"no\s+commit", combined, re.IGNORECASE), (
        f"--dry-run must surface cco-dream's write-free safe-path banner; output:\n{combined}"
    )
    # Zero vault writes during the dry-run (HEAD unmoved, not a byte changed) — the load-bearing
    # write-free proof: the dry-run path provably invoked no writing edit (it changed nothing).
    assert head_before == head_after, "--dry-run must not move the vault git HEAD"
    assert hash_before == hash_after, "--dry-run must not write a single vault byte"


# ==================================================================================================
# DETECT-03 / SC4 — the --detect-only ZERO-WRITE checkpoint (fixture + live) (`-k …zero_writes…`).
# ==================================================================================================
def test_detect_only_zero_writes_fixture(vault: Path, source_repo: Path) -> None:
    """DETECT-03 / SC4 / T-16-WRITE: a full `--detect-only --json` run on a throwaway git `vault`
    (seeded with drift/aged/pinned notes) writes ZERO bytes and leaves git HEAD unmoved — the
    Phase-15 read-only proof (NOT 'trust the read'), pinned by a before/after content-hash +
    `rev-parse HEAD`."""
    write_vault_dream_yaml(vault, "thresholds:\n  Projects: 90\n  Sessions: null\n")
    write_note(vault, "Projects/Drift.md", source=str(source_repo), updated="2026-05-01")
    write_note(vault, "Projects/Aged.md", updated="2000-01-01")
    write_note(vault, "Reference/Pinned.md", source=str(source_repo), updated="2026-05-01", pinned="true")
    _commit_vault(vault)
    (source_repo / "f.txt").write_text("moved\n")
    _commit(source_repo, LATER_DATE, "drift")

    head_before = _head(vault)
    hash_before = vault_hash(vault)
    r = _cli(vault, "--detect-only", "--json")
    assert r.returncode in (0, 1), f"detect-only ⇒ exit 0/1; got {r.returncode}: {r.stderr}"
    head_after = _head(vault)
    hash_after = vault_hash(vault)

    assert head_before == head_after, "--detect-only must not move the vault git HEAD"
    assert hash_before == hash_after, "--detect-only must not write a single vault byte"


def test_detect_only_zero_writes_live() -> None:
    """DETECT-03 / SC4 / T-16-WRITE (LIVE): the SAME zero-write proof against the operator's REAL
    `~/vault`. Captures (git rev-parse HEAD, sha256 over all *.md bytes) before/after a
    `--detect-only --json` run and asserts equality — a fixture-only proof can miss a real-vault
    write path (D-13 pitfall). Skip ONLY if `~/vault` is absent / not a git repo; otherwise it MUST
    run. This test performs NO writes itself (read-only git porcelain + file reads)."""
    live = Path.home() / "vault"
    if not live.is_dir():
        pytest.skip("~/vault is not a directory")
    inside = _git(live, "rev-parse", "--is-inside-work-tree")
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        pytest.skip("~/vault is not a git work tree")

    def live_fingerprint() -> tuple[str, str]:
        head = _git(live, "rev-parse", "HEAD").stdout.strip()
        h = hashlib.sha256()
        for md in sorted(live.rglob("*.md")):
            try:
                h.update(md.read_bytes())
            except OSError:
                continue  # a file vanishing mid-scan is not a write by us
        return head, h.hexdigest()

    head_before, hash_before = live_fingerprint()
    r = _cli(live, "--detect-only", "--json")
    assert r.returncode in (0, 1), f"detect-only on ~/vault ⇒ exit 0/1; got {r.returncode}: {r.stderr}"
    head_after, hash_after = live_fingerprint()

    assert head_before == head_after, "--detect-only must NOT move the live ~/vault git HEAD"
    assert hash_before == hash_after, "--detect-only must NOT write a single byte of the live ~/vault"


# ==================================================================================================
# Sibling parity — exit codes + the D-14 --json worklist shape + a non-crashing render().
# ==================================================================================================
def test_exit_codes_and_json_shape(vault: Path, source_repo: Path) -> None:
    """DETECT-03 / SC2-4 / T-16-JSON: exit 2 for a non-existent vault; exit 0 when the worklist is
    empty and 1 when candidates exist; `--detect-only --json` stdout parses as JSON whose top-level
    keys ⊇ the D-14 shape and whose `by_class` ⊇ {aged,orphaned,broken,drift}; the human `render()`
    (no --json) does not crash."""
    # exit 2 — no vault.
    missing = subprocess.run(
        [sys.executable, str(VAULT_DREAM_PATH), "/no/such/vault/here", "--detect-only", "--json"],
        capture_output=True,
        text=True,
    )
    assert missing.returncode == 2, f"missing vault ⇒ exit 2; got {missing.returncode}"

    # exit 0 — an empty vault (no candidates).
    empty = _cli(vault, "--detect-only", "--json")
    assert empty.returncode == 0, f"no candidates ⇒ exit 0; got {empty.returncode}: {empty.stderr}"
    edata = json.loads(empty.stdout)
    top_keys = {
        "vault",
        "generated_at",
        "total_candidates",
        "by_class",
        "worklist",
        "pinned_excluded",
        "suppressed",
        "unresolved_sources",
    }
    assert set(edata.keys()) >= top_keys, f"missing D-14 top-level keys: {top_keys - set(edata)}"
    assert set(edata["by_class"].keys()) >= {"aged", "orphaned", "broken", "drift"}, (
        f"by_class must cover all four classes; got {edata['by_class']}"
    )
    assert edata["total_candidates"] == 0 and edata["worklist"] == [], "empty vault ⇒ empty worklist"

    # exit 1 — a genuinely drifted note ⇒ candidates found.
    write_note(vault, "Projects/Drift.md", source=str(source_repo), updated="2026-05-01")
    _commit_vault(vault)
    (source_repo / "f.txt").write_text("moved\n")
    _commit(source_repo, LATER_DATE, "drift")
    found = _cli(vault, "--detect-only", "--json")
    assert found.returncode == 1, f"candidates present ⇒ exit 1; got {found.returncode}: {found.stderr}"
    fdata = json.loads(found.stdout)
    assert fdata["total_candidates"] >= 1, f"the drifted note must be a candidate: {fdata}"

    # render() (human output, no --json) does not crash.
    human = _cli(vault, "--detect-only")
    assert human.returncode in (0, 1), f"render() path must not crash; got {human.returncode}: {human.stderr}"
    assert human.stdout.strip(), "render() must emit human-readable output"


# ==================================================================================================
# Phase-16 regression hardening (mutation-audit gap closers). Each test PASSES against the current
# code and would FAIL if the specific behavior it pins were reverted — never a vacuous returncode==0.
# ==================================================================================================
def test_rank_tiebreak_by_commits_within_tier(mod: ModuleType) -> None:
    """Within the SAME class tier, `commits_since` is the secondary sort key (higher ranks first) —
    the `-_commits_since(...)` term in build_worklist's sort key. Pins it against a mutation that
    DROPS or INVERTS that term.

    Two drift-tier notes with DELIBERATELY OPPOSING name/commits order make the key load-bearing:
    `Projects/Zzz.md` has MORE commits (10) but sorts LAST by path; `Projects/Aaa.md` has FEWER (1)
    but sorts FIRST by path, and both share the SAME `note_updated` (so the staleness tie-break is a
    no-op). Current code (commits desc) ⇒ Zzz before Aaa. If `-_commits_since` were dropped, the tie
    falls through to the note path ⇒ Aaa before Zzz (the order FLIPS) and this fails. (The task's
    HighDrift/LowDrift naming would be vacuous here: 'High' < 'Low' alphabetically AGREES with the
    commits order, so a dropped key would not change it.) Also asserts byte-identical order across two
    calls (deterministic — the zero-write ranking contract)."""
    audit = audit_payload()
    drift = drift_payload(
        drifted=[
            drift_entry("Projects/Zzz.md", commits_since=10),  # MORE commits, sorts LAST by path
            drift_entry("Projects/Aaa.md", commits_since=1),   # FEWER commits, sorts FIRST by path
        ]
    )

    r1 = mod.build_worklist(audit, drift, vault="/fixture/vault")
    r2 = mod.build_worklist(audit, drift, vault="/fixture/vault")
    order1 = _worklist_notes(r1)
    order2 = _worklist_notes(r2)

    assert order1 == order2, f"ranking MUST be deterministic across runs; {order1} != {order2}"
    assert order1.index("Projects/Zzz.md") < order1.index("Projects/Aaa.md"), (
        f"within the drift tier, higher commits_since must rank first (the -commits_since "
        f"secondary key); got {order1}"
    )


def test_config_thresholds_override_and_preserve_defaults(vault: Path, source_repo: Path) -> None:
    """THE just-fixed merge-not-replace bug. A PARTIAL `thresholds:` block naming ONLY `Projects`
    (differing from the built-in default of 90) must (a) take effect AND (b) leave every UNNAMED
    folder's built-in default intact — i.e. `cfg["thresholds"].update(file_thresholds)`, never a full
    replace.

    `Projects/Recent.md` is dated ~30 days ago: under the file's `Projects: 5` it IS past budget
    (aged); under the built-in default of 90 it would NOT be (proving the override took effect).
    `Sessions/Ancient.md` (updated 1990) must NOT age: Sessions is evergreen (null) by default and is
    NOT named in the file — so the merge must preserve it. The OLD full-replace code would drop
    Sessions from the table, fall it back to defaults.ttl_days (180, a BUDGET), and age-flag a 1990
    note. This single test pins both override-takes-effect and defaults-preserved."""
    write_vault_dream_yaml(
        vault,
        "thresholds:\n"
        "  Projects: 5\n",
    )
    recent = (date.today() - timedelta(days=30)).isoformat()
    write_note(vault, "Projects/Recent.md", updated=recent)
    write_note(vault, "Sessions/Ancient.md", updated="1990-01-01")
    _commit_vault(vault)

    r = _cli(vault, "--detect-only", "--json")
    assert r.returncode in (0, 1), f"detect-only ⇒ exit 0/1; got {r.returncode}: {r.stderr}"
    data = json.loads(r.stdout)
    aged_notes = {e["note"] for e in data["worklist"] if "aged" in e["classes"]}

    assert "Projects/Recent.md" in aged_notes, (
        "a ~30-day Projects/ note must age under the file's `Projects: 5` override (it would NOT "
        f"age under the built-in default of 90 days); got {data['worklist']}"
    )
    assert "Sessions/Ancient.md" not in aged_notes, (
        "the partial thresholds block must NOT wipe Sessions' evergreen (null) default — a 1990 "
        "Sessions note must never age (the merge-not-replace fix; old full-replace would age it)"
    )


def test_ttl_boundary_strict_greater_than(mod: ModuleType, vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The TTL gate is a STRICT `age > ttl * 86400`, so a note whose age is EXACTLY the budget is
    FRESH (not aged); one second more is aged. Pins the off-by-one against a `>`→`>=` mutation.

    The exact boundary `age == ttl * 86400` is unreachable through the subprocess CLI (the tool reads
    its OWN wall-clock `now`, a moving target across the process boundary — and a date-only `updated:`
    always carries an intraday fraction that pushes 'exactly N days ago' just past N*86400 under BOTH
    `>` and `>=`, so a CLI-driven date-only test cannot distinguish them — verified this session). The
    faithful pin freezes `now` (monkeypatching the module's `datetime.now`) and drives the importable
    `build_worklist(..., notes=...)` directly so age lands EXACTLY on the budget: under the current `>`
    the at-budget note is fresh; a `>=` mutation flips it to aged and this fails. `notes=` overrides
    the on-disk walk; `vault` points at a real dir solely so `load_config` reads the `Projects: 30`
    yaml. This matches the real current behavior (strict `>`) while distinguishing `>`↔`>=`."""
    write_vault_dream_yaml(vault, "thresholds:\n  Projects: 30\n")

    fixed_now = datetime(2026, 6, 20, 12, 0, 0, tzinfo=timezone.utc)

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return fixed_now if tz is None else fixed_now.astimezone(tz)

    monkeypatch.setattr(mod, "datetime", _FixedDateTime)

    ttl_days = 30
    at_edge = (fixed_now - timedelta(days=ttl_days)).isoformat()       # age EXACTLY 30 days
    past_edge = (fixed_now - timedelta(days=ttl_days + 1)).isoformat()  # age 31 days (past)
    notes = {
        "Projects/AtEdge.md": {"updated": at_edge},
        "Projects/PastEdge.md": {"updated": past_edge},
    }

    r = mod.build_worklist(audit_payload(), drift_payload(), vault=str(vault), notes=notes)
    aged_notes = {e["note"] for e in r["worklist"] if "aged" in e["classes"]}

    assert "Projects/AtEdge.md" not in aged_notes, (
        "a note whose age is EXACTLY the TTL budget must be FRESH under the strict `>` gate (a "
        "`>=` mutation would age it)"
    )
    assert "Projects/PastEdge.md" in aged_notes, (
        "a note one day PAST the TTL budget must be aged (proves the gate fires at all, not a "
        "vacuous both-fresh result)"
    )


def test_metric_cmd_is_shlex_quoted(mod: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    """dry_run() builds the `--metric` command STRING that cco-dream later runs through `bash -c`, so
    the interpolated vault path MUST be shlex-quoted — else a path with spaces word-splits (breaking
    the metric) and a path with shell metacharacters injects (T-16-EoP). Pins the `shlex.quote(vault)`
    fix against the old unquoted `f"... -- {vault}"`.

    Monkeypatches `mod.subprocess.run` to CAPTURE the argv (without running cco-dream) and return a
    fake CompletedProcess. After dry_run() on a space-containing path, the `--metric` value is
    `shlex.split()`-parsed and its LAST token must equal the full path as ONE intact token. Under the
    old unquoted code that last token would be the trailing word ('spaces'), so this fails on
    reversion."""
    space_vault = "/tmp/vault with spaces"
    captured: dict[str, list[str]] = {}

    def _fake_run(args, *a, **kw):  # noqa: ANN001, ANN002, ANN003 — signature mirrors subprocess.run
        captured["argv"] = list(args)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(mod.subprocess, "run", _fake_run)

    rc = mod.dry_run(space_vault)
    assert rc == 0, f"the faked cco-dream run should return 0; got {rc}"

    argv = captured["argv"]
    assert "--metric" in argv, f"dry_run must pass a --metric command to cco-dream; got {argv}"
    metric_value = argv[argv.index("--metric") + 1]
    tokens = shlex.split(metric_value)
    assert tokens[-1] == space_vault, (
        "the vault path must survive as ONE intact shlex token (proves shlex.quote(vault), not the "
        f"old word-splitting `-- {{vault}}`); shlex.split({metric_value!r}) gave {tokens}"
    )


# ==================================================================================================
# PHASE-17 (Plan 17-02) — the PROPOSE-01..04 + composition_unforked Nyquist proof contract.
#
# >>> EXPECTED-RED WINDOW (the TDD gate — READ THIS BEFORE "fixing" a red here) <<<
# These six tests bind to the LOCKED `--apply` CLI contract, which does NOT exist until wave 3 (Plan
# 17-03). They are EXPECTED-RED at the end of plan 17-02 — each fails because `cco-vault-dream --apply …`
# exits non-zero (unknown flag / no apply path). This RED IS the Nyquist TDD gate. The wave-3 executor
# MUST turn them GREEN by IMPLEMENTING `--apply` against this contract (the LOCKED --apply CLI + the
# apply_note.py JSON contract + the CCO_VAULT_DREAM_ATTEMPT_CMD/NOTE/MARKER_DIR stub seam documented in
# the fixtures above) — NOT by deleting, skipping, xfail-ing, or weakening any assertion. Gutting a test
# to make red go away is a TDD violation and a verification fraud (threat T-17-14). They are deliberately
# NOT decorated xfail/skip: a clear RED with a not-yet-implemented signal is the desired wave-2 end state.
#
# Each test is wired to the REAL (absent) flag and asserts a POSITIVE guardrail proof (a sha256 identity,
# a per-note no-invocation MARKER, an audit-count comparison, the default-branch tip unchanged) — never
# mere absence — so it is genuinely RED now (the apply path does not run) and genuinely GREEN only once
# wave 3 satisfies the invariant. `_require_apply_ran()` makes the not-yet-implemented RED explicit and
# guarantees no test can vacuously pass while `--apply` is unimplemented (threat T-17-13).
# ==================================================================================================
def _require_apply_ran(r: subprocess.CompletedProcess) -> dict:
    """Assert the `--apply` run actually executed the apply path and return its machine JSON record.

    Until wave 3 lands `--apply`, the CLI exits NON-ZERO on the unknown flag (argparse error / no apply
    path) and emits no JSON record — so this assertion FAILS with a clear not-yet-implemented signal (the
    EXPECTED-RED state). Once wave 3 implements `--apply`, the run exits 0/1 and prints a machine-readable
    JSON record of kept/rejected/flag_only facts; this returns it for the positive proofs. This is the
    single chokepoint that makes every PROPOSE test RED-until-implemented and never vacuously green."""
    combined = (r.stdout or "") + (r.stderr or "")
    assert r.returncode in (0, 1), (
        "cco-vault-dream --apply must run the apply path and exit 0/1 (NOT-YET-IMPLEMENTED until wave 3: "
        f"the --apply flag does not exist, so the CLI exits {r.returncode} on the unknown flag). "
        f"This RED is the Nyquist TDD gate — wave 3 implements --apply to satisfy it.\noutput:\n{combined}"
    )
    try:
        record = json.loads(r.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            "cco-vault-dream --apply must emit a machine-readable JSON record on stdout (kept/rejected/"
            f"flag_only facts) — NOT-YET-IMPLEMENTED until wave 3. stdout was:\n{r.stdout!r}"
        ) from exc
    return record


def test_propose01_branch_only(apply_vault: Path, tmp_path: Path) -> None:
    """PROPOSE-01 (T-17-01): proposals land ONLY on the named review branch; the default branch tip is
    UNCHANGED; per-note refresh commits exist on the branch (D-03); NO merge commit on the default branch;
    the live working-tree default branch is never edited in place. Driven by the benign surgical stub via
    cco-dream --attempt-cmd on a fixture vault + fixture branch — NEVER ~/vault, NEVER a live LLM.

    EXPECTED-RED until wave 3 (--apply absent ⇒ _require_apply_ran fails with the not-yet-implemented signal)."""
    marker_dir = tmp_path / "markers"
    branch = "vault-refresh/test"
    # The default branch + its tip BEFORE the run (must be byte-identical after).
    default_branch = _git(apply_vault, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    tip_before = _head(apply_vault)
    stub = write_stub(
        tmp_path, marker_dir,
        make_surgical_edit("Old fact: the seed value is 'seed'.", "Updated fact: the value is 'moved value'."),
    )

    r = run_apply(apply_vault, branch, stub, marker_dir, "--max-notes", "5")
    _require_apply_ran(r)

    # The default branch tip is UNCHANGED — proposals never touched it (the load-bearing PROPOSE-01 proof).
    assert _head(apply_vault) == tip_before, "the default-branch tip must be UNCHANGED after --apply"
    # The review branch EXISTS and holds at least one per-note refresh commit (D-03).
    assert _branch_exists(apply_vault, branch), f"the review branch {branch!r} must exist after --apply"
    branch_commits = _commits_on(apply_vault, branch, default_branch)
    assert branch_commits, f"the review branch must hold per-note refresh commit(s); got {branch_commits}"
    # NO merge commit on the default branch (never auto-merged): the default branch log is unchanged.
    default_after = _git(apply_vault, "log", "--format=%H", default_branch).stdout.split()
    assert default_after[0] == tip_before, "the default branch must have NO new (merge) commit (D-02 no auto-merge)"


def test_propose01_branch_survives(apply_vault: Path, tmp_path: Path) -> None:
    """PROPOSE-01 (T-17-01): the review branch ref still EXISTS after the run exits (`--keep-branch`
    persists it; the cco-dream worktree is torn down; reconcile_orphans spares the non-`dream/run-*`
    name — the Phase-14 reasoning). A second --apply run's startup reconcile must not reap it either.

    EXPECTED-RED until wave 3 (--apply absent)."""
    marker_dir = tmp_path / "markers"
    branch = "vault-refresh/survives"
    stub = write_stub(tmp_path, marker_dir, make_noop_edit())

    r = run_apply(apply_vault, branch, stub, marker_dir)
    _require_apply_ran(r)

    assert _branch_exists(apply_vault, branch), (
        "the named review branch must SURVIVE the run (--keep-branch persists it past the worktree "
        "teardown; reconcile_orphans spares a non-dream/run-* name — Phase-14 durability)"
    )
    # The ephemeral cco-dream worktree must NOT linger (only the named branch persists).
    wl = _git(apply_vault, "worktree", "list", "--porcelain").stdout
    assert "dream/run-" not in wl, "the ephemeral dream/run-* worktree must be torn down (only the branch persists)"


def test_propose02_byte_stable(apply_vault: Path, tmp_path: Path) -> None:
    """PROPOSE-02 (T-17-05) end-to-end via the apply path / apply_note.py: a NO-OP proposal for the
    A-grade/sourced note leaves its bytes IDENTICAL; a SURGICAL proposal yields a minimal diff (<= cap)
    that drops NO protected line (confidence: A, the Source: line, related:, [[backlink]]).

    EXPECTED-RED until wave 3 (--apply absent)."""
    marker_dir = tmp_path / "markers"
    # (i) NO-OP on the A-grade note ⇒ byte-identical round-trip through apply_note.py.
    grade_before = _note_sha(apply_vault, "Reference/Grade.md")
    stub_noop = write_stub(tmp_path, marker_dir, make_noop_edit())
    r1 = run_apply(apply_vault, "vault-refresh/noop", stub_noop, marker_dir)
    _require_apply_ran(r1)
    assert _note_sha(apply_vault, "Reference/Grade.md") == grade_before, (
        "a NO-OP proposal must leave the A-grade note BYTE-IDENTICAL (the load-bearing PROPOSE-02 "
        "round-trip through apply_note.py)"
    )

    # (ii) A SURGICAL edit on the drift note ⇒ minimal diff, every protected line still present on the branch.
    marker_dir2 = tmp_path / "markers2"
    branch = "vault-refresh/surgical"
    stub_edit = write_stub(
        tmp_path, marker_dir2,
        make_surgical_edit("Old fact: the seed value is 'seed'.", "Updated fact: the value is 'moved value'."),
    )
    r2 = run_apply(apply_vault, branch, stub_edit, marker_dir2, "--diff-cap", "40")
    record = _require_apply_ran(r2)
    # The refreshed note's content ON THE BRANCH keeps every protected line (read it from the branch).
    grade_on_branch = _git(apply_vault, "show", f"{branch}:Reference/Grade.md").stdout
    assert "confidence: A" in grade_on_branch, "the A-grade frontmatter line must survive the refresh"
    assert "Source: https://example.com/spec" in grade_on_branch, "the Source: citation line must survive"
    linked_on_branch = _git(apply_vault, "show", f"{branch}:Projects/Linked.md").stdout
    assert "[[Projects/Drift]]" in linked_on_branch, "the related:/[[backlink]] line must survive the refresh"
    # The machine record reports the surgical refresh as kept with a bounded changed-line count (<= cap).
    assert isinstance(record, dict), "the apply record must be a JSON object"


def test_propose03_source_anchor(apply_vault: Path, tmp_path: Path) -> None:
    """PROPOSE-03 (T-17-02/03) — THE load-bearing anti-model-collapse proof: the SOURCE-LESS note is
    flagged + its bytes are UNCHANGED, and the stub was NEVER invoked for it (its per-note MARKER is
    ABSENT — a POSITIVE no-invocation proof, not mere absence of change). The resolvable drift note IS
    sent (its marker present) so the test proves the gate discriminates, not that nothing ran.

    EXPECTED-RED until wave 3 (--apply absent)."""
    marker_dir = tmp_path / "markers"
    branch = "vault-refresh/anchor"
    nosrc_before = _note_sha(apply_vault, "Reference/NoSource.md")
    stub = write_stub(
        tmp_path, marker_dir,
        make_surgical_edit("Old fact: the seed value is 'seed'.", "Updated fact: the value is 'moved value'."),
    )

    r = run_apply(apply_vault, branch, stub, marker_dir, "--max-notes", "5")
    record = _require_apply_ran(r)

    # The source-less note is byte-UNCHANGED (its prose was never paraphrased).
    assert _note_sha(apply_vault, "Reference/NoSource.md") == nosrc_before, (
        "a source-LESS note must be byte-UNCHANGED (never rewritten — the anti-model-collapse anchor)"
    )
    # POSITIVE no-invocation proof: the stub was NEVER asked to edit the source-less note (marker ABSENT).
    assert not _marker_present(marker_dir, "Reference/NoSource.md"), (
        "the source-LESS note must NEVER be sent to claude -p — its per-note invocation MARKER must be "
        "ABSENT (the POSITIVE PROPOSE-03 no-invocation proof, not mere absence of change)"
    )
    # It appears in the flag-only list of the machine record.
    flag_only = record.get("flag_only", record.get("source_less", []))
    flagged = {e["note"] if isinstance(e, dict) else e for e in flag_only}
    assert "Reference/NoSource.md" in flagged, (
        f"the source-less note must appear in the flag-only record; got {flag_only}"
    )
    # Discrimination proof: a note WITH a resolvable source WAS sent (its marker present) — so the gate
    # discriminates by source resolution, it does not simply skip everything.
    assert _marker_present(marker_dir, "Projects/Drift.md"), (
        "a note WITH a resolvable source must BE sent to claude -p (its marker present) — proving the "
        "source-anchor gate discriminates, not that the loop ran nothing"
    )


def test_propose04_caps_gate(apply_vault: Path, tmp_path: Path) -> None:
    """PROPOSE-04 (T-17-06/09) — three guardrails: (a) an OVER-cap proposal is REJECTED (no commit for
    that note; note unchanged on the branch); (b) a worklist with MORE than --max-notes candidates
    processes only N; (c) a new-broken-link proposal drives the post-proposal cco-vault-audit broken
    count above baseline and the gate reverts/rejects (run marked rejected / offending commit absent).

    EXPECTED-RED until wave 3 (--apply absent)."""
    # (a) OVER-cap edit ⇒ rejected, the drift note is NOT refreshed on the branch.
    marker_a = tmp_path / "m_a"
    branch_a = "vault-refresh/overcap"
    stub_over = write_stub(tmp_path, marker_a, make_over_cap_edit("Old fact: the seed value is 'seed'.", 80))
    r_a = run_apply(apply_vault, branch_a, stub_over, marker_a, "--diff-cap", "40")
    rec_a = _require_apply_ran(r_a)
    if _branch_exists(apply_vault, branch_a):
        drift_on_branch = _git(apply_vault, "show", f"{branch_a}:Projects/Drift.md")
        if drift_on_branch.returncode == 0:
            assert "injected over-cap line" not in drift_on_branch.stdout, (
                "an OVER-cap proposal must be REJECTED — the over-cap body must NOT land on the branch"
            )
    rejected_a = {e["note"] if isinstance(e, dict) else e for e in rec_a.get("rejected", [])}
    assert "Projects/Drift.md" in rejected_a, "the over-cap note must be recorded as rejected (diff-cap)"

    # (b) --max-notes caps the processed count. Seed MANY drift candidates, cap at 2, assert only 2 kept.
    marker_b = tmp_path / "m_b"
    branch_b = "vault-refresh/cap2"
    for i in range(5):
        write_note(apply_vault, f"Projects/Multi{i}.md", source=str(apply_vault.parent / "source"),
                   updated="2026-05-01", body=f"multi note {i} tracking the source\n")
    _commit_vault(apply_vault)
    stub_b = write_stub(tmp_path, marker_b, make_noop_edit())
    r_b = run_apply(apply_vault, branch_b, stub_b, marker_b, "--max-notes", "2")
    rec_b = _require_apply_ran(r_b)
    processed = rec_b.get("kept", []) + rec_b.get("rejected", [])
    assert len(processed) <= 2, (
        f"--max-notes 2 must process at most 2 notes; the machine record shows {len(processed)}"
    )

    # (c) new-broken-link edit ⇒ post-proposal cco-vault-audit broken count > baseline ⇒ gate rejects/reverts.
    marker_c = tmp_path / "m_c"
    branch_c = "vault-refresh/auditgate"
    stub_broken = write_stub(tmp_path, marker_c, make_broken_link_edit("This note tracks the source repo."))
    r_c = run_apply(apply_vault, branch_c, stub_broken, marker_c, "--max-notes", "1")
    rec_c = _require_apply_ran(r_c)
    # Either the run is marked rejected for the audit regression, OR the offending commit was reverted
    # (the new broken link is NOT present on the branch tip). Both satisfy "don't make it worse".
    audit_rejected = bool(rec_c.get("rejected")) or rec_c.get("audit_regression") is True
    not_on_branch = True
    if _branch_exists(apply_vault, branch_c):
        drift_show = _git(apply_vault, "show", f"{branch_c}:Projects/Drift.md")
        if drift_show.returncode == 0:
            not_on_branch = "A Note That Does Not Exist" not in drift_show.stdout
    assert audit_rejected or not_on_branch, (
        "a proposal that introduces a new broken link must be rejected/reverted by the post-proposal "
        "audit-regression gate (recorded rejected OR the offending edit absent from the branch tip)"
    )


def test_composition_unforked() -> None:
    """Composition (D-15): all three composed/subprocessed siblings are byte-unchanged at test time
    (md5 of record — cco-dream d8055242…, cco-vault-audit 3eef360b…, cco-source-drift c6a53eb2…) AND the
    narrowed runner-only forked-loop tokens (reconcile_orphans / caffeinate / MAX_ITERS / ITER_TIMEOUT)
    are ABSENT from cco-vault-dream. This owns the md5-of-record + the claude-p-now-ALLOWED posture
    (Phase 17 composes a writing claude -p via --attempt-cmd, so the literal string is no longer banned);
    test_composition_not_fork (re-scoped in Task 1) owns the structural no-fork token check.

    NOTE: this test does NOT depend on the --apply flag and would pass on the CURRENT file. It is grouped
    here as the composition member of the 17-VALIDATION proof set; once wave 3 lands --apply it remains the
    standing regression guard that the apply loop rode cco-dream via --attempt-cmd and forked NOTHING.
    (Per 17-VALIDATION it is authored W2 / green-by W3 alongside the PROPOSE rows; it is GREEN from W2.)"""
    # (a) All three siblings byte-unchanged (md5 of record) — the apply loop edits NO sibling.
    for name, expected in SIBLING_MD5S.items():
        path = BIN / name
        assert path.exists(), f"sibling {name} missing from {BIN}"
        assert _md5(path) == expected, (
            f"{name} md5 changed (got {_md5(path)}, expected {expected}) — a sibling was edited; "
            f"this phase is composition-only and must leave all three byte-unchanged"
        )
    # (b) The narrowed runner-only loop-body tokens are ABSENT from cco-vault-dream (no forked loop).
    src = VAULT_DREAM_PATH.read_text(encoding="utf-8")
    for token in FORKED_LOOP_TOKENS:
        assert token not in src, (
            f"forbidden runner-loop token {token!r} found in cco-vault-dream — that is a FORK, not "
            f"composition; the apply loop must ride cco-dream via --attempt-cmd, not inline its loop body"
        )


# --------------------------------------------------------------------------------------------------
# Phase 18 (DREAM-03 / SC1): the /dream-vault operator command file. A faithful mirror of dream.md,
# retargeted to wrap the gated `cco-vault-dream --apply --branch` edit loop. This test pins the command
# file's existence + `command: true` frontmatter + that it references the gated --apply --branch wrap +
# documents the zero-write --detect-only preview, AND that the LIVE --apply guard exits 2 without
# --branch (so the documented contract is proven against the byte-unchanged runner, not just claimed).
# --------------------------------------------------------------------------------------------------
DREAM_VAULT_CMD = Path("~/.claude/commands/dream-vault.md").expanduser()


def test_dream_vault_command_exists_and_wraps_apply(vault: Path) -> None:
    """DREAM-03/SC1: the command file exists, declares command:true, references the gated
    cco-vault-dream --apply --branch, documents --detect-only, and the live --apply guard exits
    2 without --branch (the documented contract actually holds)."""
    assert DREAM_VAULT_CMD.is_file(), f"{DREAM_VAULT_CMD} must exist (the /dream-vault entry point)"
    text = DREAM_VAULT_CMD.read_text(encoding="utf-8")
    assert "command: true" in text, "must declare command: true frontmatter (mirror dream.md)"
    assert "name: dream-vault" in text
    assert "cco-vault-dream --apply --branch" in text, "must document the gated --apply --branch wrap"
    assert "--detect-only" in text, "must document the zero-write --detect-only preview"
    r = subprocess.run(
        [sys.executable, str(VAULT_DREAM_PATH), str(vault), "--apply"],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 2, f"--apply without --branch must exit 2; got {r.returncode}: {r.stderr}"


# --------------------------------------------------------------------------------------------------
# Phase 18 (DREAM-03 / SC1, Plan 02): the `--folders <a,b,…>` allowlist filter. An ADDITIVE post-rank
# filter (D-05) that restricts an --apply run's worklist to notes whose folder (the existing folder()
# first-path-segment key) is in the allowlist — applied BEFORE the --max-notes slice. Empty/absent =
# all folders (no regression); an unknown folder = 0 processed, exit 0; a `scope:`/`folders:` yaml
# block is the persistent default the CLI flag overrides (D-03). These tests are RED-by-design until
# Plan 02 Task 2 lands the flag (argparse rejects the unknown --folders / _require_apply_ran fails the
# not-yet-implemented signal); they go GREEN by implementation, never by weakening the assertion.
#
# They REUSE the existing apply-loop fixtures + the deterministic stub seam (NO live LLM) — the four
# seeded notes (Projects/Drift.md, Reference/NoSource.md, Reference/Grade.md, Projects/Linked.md) span
# both Projects/ and Reference/ folders, so a folder allowlist genuinely partitions the worklist.
# --------------------------------------------------------------------------------------------------
def _processed_notes(rec: dict) -> set[str]:
    """The set of note relpaths the apply run actually processed (kept ∪ rejected), handling the
    dict-or-str entry shape (the Phase-17 record carries {"note": …} dicts; Phase-18 enrichment keeps
    that key — `e["note"] if isinstance(e, dict) else e` per test_propose03/04)."""
    entries = rec.get("kept", []) + rec.get("rejected", [])
    return {e["note"] if isinstance(e, dict) else e for e in entries}


def test_folders_filter_restricts_to_allowlist(
    apply_vault: Path, source_repo: Path, mod: ModuleType, tmp_path: Path
) -> None:
    """`--folders Projects` processes ONLY worklist notes whose folder() is `Projects`; a resolvable
    drift note OUTSIDE Projects/ (Reference/DriftRef.md) is EXCLUDED. The load-bearing scope proof.

    RED until Plan 02 Task 2 (`--folders` does not exist ⇒ _require_apply_ran fails not-yet-implemented)."""
    # Seed an extra RESOLVABLE drift note outside Projects/ so the allowlist has something to exclude.
    write_note(apply_vault, "Reference/DriftRef.md", source=str(source_repo), updated="2026-05-01",
               body="ref note tracking the source\n")
    _commit_vault(apply_vault)

    marker_dir = tmp_path / "m"
    stub = write_stub(tmp_path, marker_dir, make_noop_edit())
    r = run_apply(apply_vault, "vault-review/folders", stub, marker_dir, "--folders", "Projects", "--max-notes", "5")
    rec = _require_apply_ran(r)

    processed = _processed_notes(rec)
    assert processed, "the Projects-scoped run must process at least one Projects/* note (Projects/Drift.md)"
    for note in processed:
        assert mod.folder(note) == "Projects", (
            f"--folders Projects must restrict the worklist to Projects/* notes; processed {note} "
            f"(folder {mod.folder(note)!r}). Full processed set: {sorted(processed)}"
        )
    assert "Reference/DriftRef.md" not in processed, (
        "a resolvable drift note OUTSIDE the allowlisted folder must be EXCLUDED by --folders Projects"
    )


def test_folders_filter_empty_is_no_regression(apply_vault: Path, tmp_path: Path) -> None:
    """An empty / absent `--folders` processes the SAME (non-empty) note set as today — no regression
    (Pitfall 5). Runs twice on distinct branches + marker dirs: no flag vs `--folders ""`.

    RED until Plan 02 Task 2 (`--folders` absent)."""
    stub_a = write_stub(tmp_path, tmp_path / "m_a", make_noop_edit())
    r_a = run_apply(apply_vault, "vault-review/nofolders", stub_a, tmp_path / "m_a", "--max-notes", "5")
    rec_a = _require_apply_ran(r_a)

    stub_b = write_stub(tmp_path, tmp_path / "m_b", make_noop_edit())
    r_b = run_apply(apply_vault, "vault-review/emptyfolders", stub_b, tmp_path / "m_b", "--folders", "", "--max-notes", "5")
    rec_b = _require_apply_ran(r_b)

    processed_a = _processed_notes(rec_a)
    processed_b = _processed_notes(rec_b)
    assert processed_a, "the no-folders run must process a non-empty set (Projects/Drift.md is a candidate)"
    assert processed_a == processed_b, (
        f"an empty `--folders` must be identical to no `--folders` (all folders) — no regression; "
        f"no-flag processed {sorted(processed_a)} but --folders '' processed {sorted(processed_b)}"
    )


def test_folders_filter_unknown_folder_exit_zero(apply_vault: Path, tmp_path: Path) -> None:
    """`--folders NoSuchFolder` processes ZERO notes and exits 0 — no candidates is NOT a failure
    (Pitfall 5 / T-18-06). The record's kept/rejected/flag_only are all empty.

    RED until Plan 02 Task 2 (`--folders` absent)."""
    marker_dir = tmp_path / "m"
    stub = write_stub(tmp_path, marker_dir, make_noop_edit())
    r = run_apply(apply_vault, "vault-review/none", stub, marker_dir, "--folders", "NoSuchFolder")
    assert r.returncode == 0, (
        f"--folders NoSuchFolder (empty result) must exit 0 — no candidates is not a failure; "
        f"got {r.returncode}: {r.stderr}"
    )
    rec = _require_apply_ran(r)
    assert rec.get("kept", []) == [], f"unknown folder ⇒ no kept notes; got {rec.get('kept')}"
    assert rec.get("rejected", []) == [], f"unknown folder ⇒ no rejected notes; got {rec.get('rejected')}"
    assert rec.get("flag_only", []) == [], f"unknown folder ⇒ no flag_only notes; got {rec.get('flag_only')}"


def test_folders_filter_applies_before_max_notes(
    apply_vault: Path, source_repo: Path, mod: ModuleType, tmp_path: Path
) -> None:
    """The `--folders` filter is applied BEFORE the `--max-notes` slice: `--folders Projects
    --max-notes 2` = the top-2 IN-SCOPE (Projects) notes, never top-2-overall-then-filtered (which
    could surface a Reference note or fewer than 2 Projects notes). Seeds 5 extra Projects/* drift
    notes + a Reference/* drift note so the overall top-2 would otherwise include Reference.

    RED until Plan 02 Task 2 (`--folders` absent)."""
    for i in range(5):
        write_note(apply_vault, f"Projects/Multi{i}.md", source=str(source_repo), updated="2026-05-01",
                   body=f"multi note {i} tracking the source\n")
    write_note(apply_vault, "Reference/AlsoDrift.md", source=str(source_repo), updated="2026-05-01",
               body="another reference drift note\n")
    _commit_vault(apply_vault)

    marker_dir = tmp_path / "m"
    stub = write_stub(tmp_path, marker_dir, make_noop_edit())
    r = run_apply(apply_vault, "vault-review/cap", stub, marker_dir, "--folders", "Projects", "--max-notes", "2")
    rec = _require_apply_ran(r)

    processed = _processed_notes(rec)
    assert len(processed) <= 2, (
        f"--max-notes 2 must process at most 2 notes; the record shows {len(processed)}: {sorted(processed)}"
    )
    for note in processed:
        assert mod.folder(note) == "Projects", (
            f"the filter must PRECEDE the slice — every processed note must be in Projects (the in-scope "
            f"top-2), never a Reference note that ranked high overall; processed {note}"
        )


def test_folders_filter_config_default_and_cli_override(
    apply_vault: Path, mod: ModuleType, tmp_path: Path
) -> None:
    """A `scope:`/`folders:` block in `.cco/vault-dream.yaml` is the persistent default; the
    `--folders` CLI flag OVERRIDES it (D-03). With the yaml naming Reference and NO flag, only
    Reference/* is processed; with `--folders Projects`, the CLI wins and only Projects/* is processed.

    RED until Plan 02 Task 2 (the scope: config block + --folders flag do not exist)."""
    write_vault_dream_yaml(apply_vault, "scope:\n  folders:\n    - Reference\n")

    # (i) yaml default applied (no CLI flag) ⇒ only Reference/* notes processed.
    stub_a = write_stub(tmp_path, tmp_path / "m_a", make_noop_edit())
    r_a = run_apply(apply_vault, "vault-review/cfgdefault", stub_a, tmp_path / "m_a", "--max-notes", "5")
    rec_a = _require_apply_ran(r_a)
    processed_a = _processed_notes(rec_a)
    assert processed_a, "the yaml scope default (Reference) must still yield Reference/* candidates"
    for note in processed_a:
        assert mod.folder(note) == "Reference", (
            f"the yaml `scope: folders: [Reference]` default must restrict the run to Reference/*; "
            f"processed {note} (folder {mod.folder(note)!r})"
        )

    # (ii) CLI --folders Projects OVERRIDES the yaml default ⇒ only Projects/* notes processed (D-03).
    stub_b = write_stub(tmp_path, tmp_path / "m_b", make_noop_edit())
    r_b = run_apply(apply_vault, "vault-review/cfgoverride", stub_b, tmp_path / "m_b", "--folders", "Projects", "--max-notes", "5")
    rec_b = _require_apply_ran(r_b)
    processed_b = _processed_notes(rec_b)
    assert processed_b, "the CLI override (Projects) must yield Projects/* candidates"
    for note in processed_b:
        assert mod.folder(note) == "Projects", (
            f"the --folders CLI flag must OVERRIDE the yaml scope default (D-03); processed {note} "
            f"(folder {mod.folder(note)!r}) — expected Projects only"
        )


# --------------------------------------------------------------------------------------------------
# Phase 18 (REVIEW-01, Plan 03): the run-summary LEDGER + morning-review DIGEST + the additive
# apply_run record enrichment (source / changed_lines / flag-reason). RED-by-design until Plan 03
# Task 2 lands the enrichment + cco-dream-log ledger emission + render_digest/write_reports + the
# CCO_VAULT_DREAM_LOG_BASE seam (the record carries only {"note": …} today / no ledger / no digest /
# no LOG_BASE_ENV honored, so each assertion FAILS the not-yet-implemented signal). They go GREEN by
# implementation, never by weakening the assertion.
#
# They REUSE the existing apply-loop fixtures + the deterministic stub seam (NO live LLM): the surgical
# stub on Projects/Drift.md's anchor line ("Old fact: the seed value is 'seed'.") yields a real >0
# changed-line refresh (a `keep`), while Reference/NoSource.md is the source-less flag-only note
# (a `discard`). The log base is injected via CCO_VAULT_DREAM_LOG_BASE → tmp_path/"run" so the tests
# read back run.jsonl / run.md / run.digest.md deterministically.
#
# The cco-dream-log ledger schema (REUSED writer; D-06): the .jsonl carries EXACTLY these 7 fields.
LEDGER_ROW_FIELDS = {"ts", "iter", "summary", "before", "after", "decision", "why"}
# A note BODY sentence that must NEVER appear in the metadata-only digest (T-18-LOG proof): the seeded
# Reference/NoSource.md body line. Its presence in the digest would mean note CONTENTS leaked.
NOSOURCE_BODY_SENTENCE = "A purely internal note with no external source of truth."


def run_apply_with_log(
    vault: Path, branch: str, attempt_cmd: str | None, marker_dir: Path, log_base: Path,
    *extra: str, timeout: float = 120.0,
) -> subprocess.CompletedProcess:
    """Like run_apply, but ALSO injects the Phase-18 ledger/digest LOG-BASE seam
    (CCO_VAULT_DREAM_LOG_BASE) so the ledger + digest land at <log_base>.{md,jsonl,digest.md} in a tmp
    dir the test reads back. Same LOCKED --attempt-cmd stub seam (NO live LLM); argv-only; timeout-bounded."""
    env = dict(os.environ)
    env[MARKER_DIR_ENV] = str(marker_dir)
    env[LOG_BASE_ENV] = str(log_base)
    if attempt_cmd is not None:
        env[ATTEMPT_CMD_ENV] = attempt_cmd
    return subprocess.run(
        [sys.executable, str(VAULT_DREAM_PATH), str(vault), "--apply", "--branch", branch, *extra],
        capture_output=True, text=True, env=env, timeout=timeout,
    )


def test_record_enriched_carries_source_and_changed_lines(
    apply_vault: Path, source_repo: Path, tmp_path: Path
) -> None:
    """REVIEW-01 / D-07: the apply_run record's kept[] entry for a surgically-refreshed note carries a
    non-empty `source` (the resolved external-source PATH) AND a `changed_lines` int >= 1 (the Pitfall-1
    round-trip from the per-note attempt verdict). Each flag_only entry carries a `reason`.

    RED until Plan 03 Task 2 (kept[] carries only {"note": …}; changed_lines never recovered; flag_only
    is bare strings) — `record["kept"]`'s Drift entry has no `source`/`changed_lines` and the flag_only
    entry is a string, so the assertions fail with the not-yet-implemented signal."""
    marker_dir = tmp_path / "markers"
    branch = "vault-review/enrich"
    stub = write_stub(
        tmp_path, marker_dir,
        make_surgical_edit("Old fact: the seed value is 'seed'.", "Updated fact: the value is 'moved value'."),
    )
    r = run_apply_with_log(apply_vault, branch, stub, marker_dir, tmp_path / "run", "--max-notes", "5")
    rec = _require_apply_ran(r)

    assert rec.get("kept"), f"the surgical refresh must produce a kept note; record={rec}"
    drift = next((k for k in rec["kept"] if (k.get("note") if isinstance(k, dict) else k) == "Projects/Drift.md"), None)
    assert drift is not None, f"Projects/Drift.md must be kept; kept={rec['kept']}"
    assert isinstance(drift, dict), "a kept entry must be a dict (so it can carry source/changed_lines)"
    assert isinstance(drift.get("source"), str) and drift["source"], (
        f"the kept entry must carry a non-empty `source` PATH (the resolved external source); got {drift!r}"
    )
    assert str(source_repo) in drift["source"], (
        f"the kept `source` must be the resolved source_repo path; got {drift.get('source')!r}"
    )
    assert "changed_lines" in drift, f"the kept entry must carry `changed_lines`; got {drift!r}"
    assert isinstance(drift["changed_lines"], int) and drift["changed_lines"] >= 1, (
        f"a surgical refresh must record changed_lines >= 1 (the Pitfall-1 attempt-verdict round-trip; "
        f"0/absent means changed_lines was never recovered); got {drift.get('changed_lines')!r}"
    )
    # Each flag_only entry is a dict carrying a reason (Reference/NoSource.md → "no resolvable source").
    flag_only = rec.get("flag_only", [])
    assert flag_only, "Reference/NoSource.md (source-less) must be flagged"
    for f in flag_only:
        assert isinstance(f, dict) and isinstance(f.get("reason"), str) and f["reason"], (
            f"each flag_only entry must be a dict carrying a `reason`; got {f!r}"
        )
        assert "note" in f, f"a flag_only entry must keep its `note` key (additive enrichment); got {f!r}"
    flagged_notes = {f["note"] for f in flag_only}
    assert "Reference/NoSource.md" in flagged_notes, f"the source-less note must be flagged; got {flag_only}"


def test_ledger_matches_dream_log(apply_vault: Path, source_repo: Path, tmp_path: Path) -> None:
    """REVIEW-01 / SC2 (D-06): each run emits a cco-dream-log ledger — one row per PROCESSED note
    (kept + rejected + flag_only); the .jsonl carries EXACTLY the 7 ROW_FIELDS; every decision is in
    {keep,discard}; the Drift refresh row is `keep`; the source-less NoSource row is `discard`. Asserts
    the LEDGER FILE CONTENTS (Pitfall 4 — cco-dream-log is fail-safe, so a dropped row is silent; the
    run exit code alone proves nothing).

    RED until Plan 03 Task 2 (no ledger is written; <run>.jsonl does not exist)."""
    marker_dir = tmp_path / "markers"
    branch = "vault-review/ledger"
    log_base = tmp_path / "run"
    stub = write_stub(
        tmp_path, marker_dir,
        make_surgical_edit("Old fact: the seed value is 'seed'.", "Updated fact: the value is 'moved value'."),
    )
    r = run_apply_with_log(apply_vault, branch, stub, marker_dir, log_base, "--max-notes", "5")
    rec = _require_apply_ran(r)

    jsonl = tmp_path / "run.jsonl"
    md = tmp_path / "run.md"
    assert jsonl.is_file(), f"the run must emit a cco-dream-log ledger at {jsonl} (REVIEW-01/SC2)"
    assert md.is_file(), f"the ledger .md table must also exist at {md}"

    rows = [json.loads(ln) for ln in jsonl.read_text(encoding="utf-8").splitlines() if ln.strip()]
    processed = _processed_notes(rec)
    flag_notes = {f["note"] if isinstance(f, dict) else f for f in rec.get("flag_only", [])}
    n_expected = len(processed) + len(flag_notes)
    assert n_expected >= 2, f"the fixture must process the Drift keep + the NoSource flag-only; got {n_expected}"
    assert len(rows) == n_expected, (
        f"the ledger must have one row per PROCESSED note (kept+rejected+flag_only={n_expected}); got {len(rows)}"
    )
    for row in rows:
        assert set(row.keys()) == LEDGER_ROW_FIELDS, f"each ledger row must carry exactly the 7 fields; got {set(row)}"
        assert row["decision"] in {"keep", "discard"}, f"decision must be keep|discard; got {row['decision']!r}"

    by_note = {row["summary"]: row for row in rows}
    assert by_note.get("Projects/Drift.md", {}).get("decision") == "keep", (
        f"the surgically-refreshed Drift note must be logged decision=keep; rows={rows}"
    )
    assert by_note.get("Reference/NoSource.md", {}).get("decision") == "discard", (
        f"the source-less NoSource note must be logged decision=discard (D-06); rows={rows}"
    )
    # The .md table has exactly one header row (cco-dream-log writes it once).
    header_lines = [ln for ln in md.read_text(encoding="utf-8").splitlines() if ln.strip().startswith("|") and "iter" in ln]
    assert len(header_lines) == 1, f"the ledger .md must have exactly one header row; found {len(header_lines)}"


def test_digest_names_source(apply_vault: Path, source_repo: Path, tmp_path: Path) -> None:
    """REVIEW-01 / SC3: the morning-review digest, per kept note, names the note path + the resolved
    external SOURCE path (the F4 thesis line) + a non-zero changed-line indication; lists the flag-only
    note under a manual-attention section; states an audit verdict. It is METADATA-ONLY — a note BODY
    sentence must be ABSENT (T-18-LOG). And the stdout stays PURE record JSON (the DONE pointer → stderr).

    RED until Plan 03 Task 2 (no <run>.digest.md is written; DONE not on stderr; stdout already JSON)."""
    marker_dir = tmp_path / "markers"
    branch = "vault-review/digest"
    log_base = tmp_path / "run"
    stub = write_stub(
        tmp_path, marker_dir,
        make_surgical_edit("Old fact: the seed value is 'seed'.", "Updated fact: the value is 'moved value'."),
    )
    r = run_apply_with_log(apply_vault, branch, stub, marker_dir, log_base, "--max-notes", "5")
    _require_apply_ran(r)

    digest_path = tmp_path / "run.digest.md"
    assert digest_path.is_file(), f"the run must emit a morning-review digest at {digest_path} (REVIEW-01/SC3)"
    digest = digest_path.read_text(encoding="utf-8")

    assert "Projects/Drift.md" in digest, "the digest must name the kept note path"
    assert str(source_repo) in digest, (
        "the digest must name the resolved external SOURCE path per kept note (the F4 thesis — the "
        "anti-model-collapse anchor made auditable at merge time)"
    )
    assert ("line(s) changed" in digest) or re.search(r"\b[1-9]\d*\b", digest), (
        "the digest must show a non-zero changed-line indication for the surgical refresh"
    )
    assert "Reference/NoSource.md" in digest, (
        "the digest must list the source-less flag-only note under a manual-attention/flagged section"
    )
    assert any(v in digest for v in ("clean", "REVERTED", "REJECTED")), (
        "the digest must state an audit-regression verdict (clean / REVERTED / REJECTED)"
    )
    # METADATA-ONLY: a note BODY sentence must NOT appear in the digest (no contents/diffs leaked).
    assert NOSOURCE_BODY_SENTENCE not in digest, (
        "the digest must be METADATA-ONLY — note BODY text must be ABSENT (paths/counts/reasons/source "
        f"PATH only); found the body sentence {NOSOURCE_BODY_SENTENCE!r} in the digest"
    )
    # STDOUT PURITY (Phase-17 contract): stdout is EXACTLY the record JSON; the DONE pointer is on stderr.
    assert r.stdout.strip().startswith("{"), f"stdout must be the pure record JSON; got: {r.stdout[:120]!r}"
    json.loads(r.stdout)  # parses cleanly = no DONE/log line polluted stdout
    assert "DONE" in r.stderr, "the human DONE pointer must go to STDERR (stdout stays pure record JSON)"
    assert "DONE" not in r.stdout, "the DONE pointer must NOT pollute stdout (Phase-17 _require_apply_ran)"
