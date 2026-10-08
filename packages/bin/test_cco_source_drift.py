#!/usr/bin/env python3
# cco-tool-version: 1
# RED-before-GREEN pytest suite for cco-source-drift (DETECT-02, the read-only git
# source-drift detector — a structural sibling of cco-vault-audit). Pins the FOUR
# DETECT-02 success criteria, each independently selectable via `-k`:
#   - signal   (criterion 1): a deterministic git drift signal — commits_since the note's
#               updated: + source mtime vs updated: — NOT embeddings/LLM (static-purity check).
#   - json     (criterion 2): the machine-readable worklist envelope (sibling of
#               cco-vault-audit --json): {vault, generated_at, total_mapped, total_drifted,
#               drifted[], unresolved_sources[], suppressed[]}; total_drifted == len(drifted).
#   - readonly (criterion 3): ZERO writes — a before/after vault content-hash + `rev-parse HEAD`
#               equality (NOT "trust the read"); a `drift_ignore: true` note is suppressed.
#   - unmapped (criterion 4): a note with no source: is absent from ALL output; a non-git
#               source: lands only in unresolved_sources (never drifted); age alone never flags.
# The script under test has NO `.py` extension → loaded via SourceFileLoader (the
# test_cco_dream_log.py / cco-ledger pattern this repo uses), and the CLI is driven via
# subprocess.run([sys.executable, PATH, ...]). Deterministic: commit dates are pinned with
# GIT_COMMITTER_DATE/GIT_AUTHOR_DATE so the signal never depends on wall-clock time.
# Run with `~/.local/bin/pytest` (default `python3 -m pytest` is ABSENT and silently runs
# nothing). The PostToolUse `ty` lint-loop emits a FALSE `unresolved-import: pytest` on this
# file — pytest lives at `~/.local/bin/pytest`, not the default python path — IGNORE it.
from __future__ import annotations

import hashlib
import importlib.machinery
import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType

import pytest

DRIFT_PATH = Path(__file__).with_name("cco-source-drift")

# The exact top-level JSON envelope this detector must emit (sibling of cco-vault-audit --json).
ENVELOPE_KEYS = {
    "vault",
    "generated_at",
    "total_mapped",
    "total_drifted",
    "drifted",
    "unresolved_sources",
    "suppressed",
}
# Per-drifted-entry evidence keys (one entry per drifted note).
DRIFT_ENTRY_KEYS = {
    "note",
    "source",
    "repo",
    "subpath",
    "commits_since",
    "src_commit_iso",
    "src_mtime",
    "note_updated",
}

# A commit date strictly AFTER any seeded note's `updated:` (so commits_since lights up).
LATER_DATE = "2026-06-10T12:00:00"
# A commit date BEFORE the bumped `updated:` used in the not-drifted half of the signal test.
EARLY_DATE = "2026-04-01T12:00:00"


# --------------------------------------------------------------------------------------------------
# Module load + CLI driver (the script has no .py extension).
# --------------------------------------------------------------------------------------------------
def _load() -> ModuleType:
    loader = importlib.machinery.SourceFileLoader("cco_source_drift", str(DRIFT_PATH))
    spec = importlib.util.spec_from_loader("cco_source_drift", loader)
    assert spec is not None, f"cannot load {DRIFT_PATH}"
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def mod() -> ModuleType:
    return _load()


def _cli(vault: Path, *args: str) -> subprocess.CompletedProcess:
    """Drive the real CLI exactly as Phase 16 / an operator will (argv, not shell)."""
    return subprocess.run(
        [sys.executable, str(DRIFT_PATH), str(vault), *args],
        capture_output=True,
        text=True,
    )


# --------------------------------------------------------------------------------------------------
# Throwaway-git + temp-vault fixtures (mirrors test_cco_dream_harden.py L154-169).
# --------------------------------------------------------------------------------------------------
def _git(repo: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, env=env
    )


def _dated_env(iso: str) -> dict:
    """A commit-date-pinned env so the git signal is reproducible (no wall-clock dependence)."""
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
    """A throwaway git source repo with one early-dated seed commit on the mapped subpath."""
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
    """A temp vault that is ITSELF a git repo (so the HEAD-unchanged assertion is meaningful)."""
    v = tmp_path / "vault"
    _init_repo(v)
    return v


def _commit_vault(vault: Path) -> None:
    _git(vault, "add", "-A")
    _git(vault, "commit", "-qm", "notes", env=_dated_env(LATER_DATE))


# --------------------------------------------------------------------------------------------------
# Read-only proof: a recursive content hash over every file in the vault (skipping .git).
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


# ==================================================================================================
# CRITERION 1 — deterministic git drift signal (`-k signal`).
# ==================================================================================================
def test_signal_commits_since_deterministic(vault: Path, source_repo: Path) -> None:
    """Seed updated:2026-05-01 mapped to a repo with 3 commits dated AFTER it → drifted with
    commits_since == 3. Then bump updated: past HEAD's committer date → ABSENT from drifted."""
    write_note(vault, "Projects/Tracked.md", source=str(source_repo), updated="2026-05-01")
    _commit_vault(vault)

    # 3 commits dated AFTER 2026-05-01 touching the mapped subpath (the repo root here).
    for i in range(3):
        (source_repo / "f.txt").write_text(f"change {i}\n")
        _commit(source_repo, LATER_DATE, f"later {i}")

    r = _cli(vault, "--json")
    assert r.returncode == 1, f"drift present ⇒ exit 1; got {r.returncode}: {r.stderr}"
    data = json.loads(r.stdout)
    drifted = {e["note"]: e for e in data["drifted"]}
    assert "Projects/Tracked.md" in drifted, f"tracked note must be drifted: {data}"
    assert drifted["Projects/Tracked.md"]["commits_since"] == 3, (
        f"3 commits after updated: ⇒ commits_since==3; got {drifted['Projects/Tracked.md']}"
    )

    # Bump updated: PAST HEAD's committer date → no commits_since, no mtime drift → absent.
    future = "2027-01-01T00:00:00+00:00"
    write_note(vault, "Projects/Tracked.md", source=str(source_repo), updated=future)
    # Make the note file's mtime old so the secondary mtime signal does not re-flag it.
    old = 1735689600  # 2025-01-01
    os.utime(source_repo / "f.txt", (old, old))
    r2 = _cli(vault, "--json")
    data2 = json.loads(r2.stdout)
    drifted2 = {e["note"] for e in data2["drifted"]}
    assert "Projects/Tracked.md" not in drifted2, (
        f"updated: past HEAD ⇒ not drifted; got {data2['drifted']}"
    )


def test_static_purity_stdlib_only_no_embeddings() -> None:
    """Static-purity (criterion 1 corollary): cco-source-drift imports ONLY stdlib — no
    yaml/embeddings/LLM client. Named OUTSIDE the `-k signal` selector so each of the four
    criterion selectors resolves to exactly one test."""
    src = DRIFT_PATH.read_text(encoding="utf-8")
    assert re.search(r"\bimport\s+yaml\b", src) is None, "must not import yaml (stdlib-only)"
    for banned in ("sentence_transformers", "openai", "anthropic", "numpy", "dateutil"):
        assert re.search(rf"\b{banned}\b", src) is None, f"must not depend on {banned}"


# ==================================================================================================
# CRITERION 2 — machine-readable JSON worklist shape (`-k json`).
# ==================================================================================================
def test_json_worklist_shape(vault: Path, source_repo: Path) -> None:
    """`--json` emits the documented sibling envelope; each drifted[] entry carries full
    evidence; total_drifted == len(drifted)."""
    write_note(vault, "Projects/Tracked.md", source=str(source_repo), updated="2026-05-01")
    write_note(vault, "Notes/Plain.md", updated="2026-05-01")  # unmapped → must be absent
    _commit_vault(vault)
    (source_repo / "f.txt").write_text("drifted\n")
    _commit(source_repo, LATER_DATE, "drift")

    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    assert set(data.keys()) >= ENVELOPE_KEYS, f"missing envelope keys: {ENVELOPE_KEYS - set(data)}"
    assert isinstance(data["drifted"], list) and isinstance(data["unresolved_sources"], list)
    assert isinstance(data["suppressed"], list)
    assert data["total_drifted"] == len(data["drifted"]), "total_drifted must == len(drifted)"
    assert data["total_drifted"] >= 1, f"the tracked note should drift: {data}"
    for entry in data["drifted"]:
        assert set(entry.keys()) >= DRIFT_ENTRY_KEYS, (
            f"drift entry missing evidence keys: {DRIFT_ENTRY_KEYS - set(entry)}"
        )
        assert entry["note"].endswith(".md") and "/" in entry["note"], "note is vault-relative"
        assert entry["subpath"], "subpath present (\".\" for repo root)"
    notes = {e["note"] for e in data["drifted"]}
    assert "Notes/Plain.md" not in notes, "an unmapped note must never appear in drifted"


# ==================================================================================================
# CRITERION 3 — read-only (zero writes) + drift_ignore suppression (`-k readonly`).
# ==================================================================================================
def test_readonly_zero_writes_before_after_hash(vault: Path, source_repo: Path) -> None:
    """Before/after vault content-hash + `rev-parse HEAD` MUST be byte-identical across a run
    (the read-only proof — NOT 'trust the read')."""
    write_note(vault, "Projects/Tracked.md", source=str(source_repo), updated="2026-05-01")
    _commit_vault(vault)
    (source_repo / "f.txt").write_text("drifted\n")
    _commit(source_repo, LATER_DATE, "drift")

    head_before = _head(vault)
    hash_before = vault_hash(vault)
    r = _cli(vault, "--json")
    assert r.returncode in (0, 1), f"unexpected exit {r.returncode}: {r.stderr}"
    head_after = _head(vault)
    hash_after = vault_hash(vault)

    assert head_before == head_after, "the detector must not move the vault git HEAD"
    assert hash_before == hash_after, "the detector must not write a single vault byte"


def test_suppression_drift_ignore_excluded(vault: Path, source_repo: Path) -> None:
    """Criterion 3 (suppression half): a note that WOULD drift but carries `drift_ignore: true`
    is ABSENT from drifted and counted under `suppressed`. Named OUTSIDE the `-k readonly`
    selector so `-k readonly` resolves to exactly the zero-writes hash test."""
    write_note(
        vault,
        "Projects/Ignored.md",
        source=str(source_repo),
        updated="2026-05-01",
        drift_ignore="true",
    )
    _commit_vault(vault)
    (source_repo / "f.txt").write_text("drifted\n")
    _commit(source_repo, LATER_DATE, "drift")

    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    drifted = {e["note"] for e in data["drifted"]}
    suppressed = {e["note"] if isinstance(e, dict) else e for e in data["suppressed"]}
    assert "Projects/Ignored.md" not in drifted, "drift_ignore: true must suppress from drifted"
    assert "Projects/Ignored.md" in suppressed, (
        f"a suppressed note must be counted under suppressed: {data['suppressed']}"
    )


# ==================================================================================================
# CRITERION 4 — no source ⇒ absent; non-git source ⇒ unresolved only; age never flags (`-k unmapped`).
# ==================================================================================================
def test_unmapped_and_unresolved_absent_from_drift(vault: Path, source_repo: Path) -> None:
    """A note with NO source: is absent from ALL output. A note whose source: is a non-git path
    (or a citation string) appears ONLY in unresolved_sources (with a reason), never drifted."""
    # No source: at all (and a very old updated:) → must be absent from drifted AND unresolved.
    write_note(vault, "Notes/NoSource.md", updated="2000-01-01")
    # A non-git absolute path (the stale-Windows-path exemplar) → unresolved only.
    write_note(vault, "Projects/Stale.md", source=r"C:\Users\Donme\nope", updated="2026-05-01")
    # A citation string that does not resolve to a git work tree → unresolved (or ignored),
    # NEVER drifted.
    write_note(vault, "Reference/Book.md", source='"Banister, Atomic Habits"', updated="2026-05-01")
    _commit_vault(vault)

    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    drifted = {e["note"] for e in data["drifted"]}
    unresolved = {e["note"] for e in data["unresolved_sources"]}

    assert "Notes/NoSource.md" not in drifted, "unmapped note must never be drifted (age never flags)"
    assert "Notes/NoSource.md" not in unresolved, "unmapped note must not be in unresolved_sources"

    assert "Projects/Stale.md" not in drifted, "a non-git source: must never be drifted"
    assert "Projects/Stale.md" in unresolved, "a non-git source: must land in unresolved_sources"
    for entry in data["unresolved_sources"]:
        assert entry.get("reason"), f"each unresolved entry needs a reason: {entry}"

    # The citation string must never be drifted (it may be ignored OR unresolved, never drifted).
    assert "Reference/Book.md" not in drifted, "a citation string must never be drifted"


def test_age_alone_never_flags(vault: Path, source_repo: Path) -> None:
    """Criterion 4 (defense-in-depth): even an ancient note with no source is absent — age is
    NEVER the signal. Named OUTSIDE the `-k unmapped` selector so `-k unmapped` resolves to
    exactly the no-source/unresolved test."""
    write_note(vault, "Notes/Ancient.md", updated="1990-01-01")
    _commit_vault(vault)
    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    assert data["total_drifted"] == 0, f"no mapped source ⇒ zero drift regardless of age: {data}"
    assert r.returncode == 0, "no drift ⇒ exit 0"


# ==================================================================================================
# Exit-code contract (0 no-drift / 2 no-vault) — cross-cuts; selected by none of the 4 -k names.
# ==================================================================================================
def test_exit_code_no_vault() -> None:
    """Pointing at a missing dir → exit 2 (mirrors cco-vault-audit)."""
    r = subprocess.run(
        [sys.executable, str(DRIFT_PATH), "/no/such/vault/here", "--json"],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 2, f"missing vault ⇒ exit 2; got {r.returncode}"


# ==================================================================================================
# DETECT-02 regression hardening (mutation-audit gap closers). Each test PASSES against the current
# code and would FAIL if the specific behavior it pins were reverted — never a vacuous returncode==0.
# ==================================================================================================
def test_source_escaping_repo_is_unresolved_not_drift(vault: Path, source_repo: Path) -> None:
    """The `..` path-escape guard in resolve_source (`if rel.startswith(".."): return None`, T-15-01)
    — currently UNTESTED. A `source:` whose enclosing repo is a VALID git work tree but whose mapped
    target ESCAPES that toplevel must NOT be followed: the note lands in `unresolved_sources` and is
    NEVER in `drifted[]`.

    Built with an inline `{repo: <valid repo>, path: ../escape}` mapping so `git rev-parse
    --show-toplevel` SUCCEEDS on the repo (the only way to reach the guard — a non-git base would bail
    earlier as 'not a git work tree'), while `os.path.relpath(target, toplevel)` starts with `..`. The
    repo genuinely drifts (a commit after the note's `updated:`), so absent the guard the note WOULD
    be drifted — reverting `if rel.startswith(".."): return None` makes this fail."""
    # The escape target must exist (resolve_source checks os.path.exists(target) before rev-parse).
    escape_dir = source_repo.parent / "escape"
    escape_dir.mkdir()
    (escape_dir / "e.txt").write_text("outside\n")
    # The repo genuinely moves so it WOULD drift were the target not escaping.
    (source_repo / "f.txt").write_text("moved\n")
    _commit(source_repo, LATER_DATE, "drift")

    mapping_val = "{repo: " + str(source_repo) + ", path: ../escape}"
    write_note(vault, "Projects/Escape.md", source=mapping_val, updated="2026-05-01")
    _commit_vault(vault)

    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    drifted = {e["note"] for e in data["drifted"]}
    unresolved = {e["note"] for e in data["unresolved_sources"]}

    assert "Projects/Escape.md" not in drifted, (
        "a target that escapes the repo toplevel via `..` must NEVER be drifted (T-15-01 guard)"
    )
    assert "Projects/Escape.md" in unresolved, (
        f"an escaping `source:` must land in unresolved_sources, not be silently followed: {data}"
    )


def test_drift_threshold_exactly_one_commit(vault: Path, source_repo: Path) -> None:
    """The drift threshold is `commits_since >= 1`: a mapped note whose source has EXACTLY ONE commit
    after the note's `updated:` IS drifted, with `commits_since == 1`. Pins the boundary against a
    `>=1`→`>=2` off-by-one.

    The secondary mtime signal is NEUTRALIZED (the source file's mtime is set BEFORE the note's
    `updated:`) so drift depends SOLELY on the commit count — otherwise the fresh mtime from staging
    the commit would mask the off-by-one and the test would pass even under `>=2`."""
    write_note(vault, "Projects/One.md", source=str(source_repo), updated="2026-05-01")
    _commit_vault(vault)

    # Exactly ONE commit dated AFTER the note's updated:.
    (source_repo / "f.txt").write_text("change-1\n")
    _commit(source_repo, LATER_DATE, "later-1")
    # Neutralize the mtime secondary signal so ONLY commits_since can flag this note.
    old = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
    os.utime(source_repo / "f.txt", (old, old))

    r = _cli(vault, "--json")
    assert r.returncode == 1, f"one-commit drift ⇒ exit 1; got {r.returncode}: {r.stderr}"
    data = json.loads(r.stdout)
    drifted = {e["note"]: e for e in data["drifted"]}
    assert "Projects/One.md" in drifted, f"exactly one commit after updated: must drift: {data}"
    assert drifted["Projects/One.md"]["commits_since"] == 1, (
        f"the threshold is commits_since >= 1; got {drifted['Projects/One.md']}"
    )


def test_mtime_only_drift_when_zero_commits(vault: Path, source_repo: Path) -> None:
    """The secondary mtime signal: a mapped note with ZERO commits-since (no commit after its
    `updated:`) but a source working-tree file whose mtime is NEWER than `updated:` IS still drifted
    (`drifted = ... or (src_mtime > note_epoch)`). Pins it against a mutation that drops the mtime
    branch.

    The source's only commit is the early seed (BEFORE `updated:`), so `commits_since == 0`; the file
    mtime is bumped past `updated:` via os.utime WITHOUT any new commit. The note must be drifted with
    `commits_since == 0` — proving it drifted on the mtime branch alone (removing that branch leaves
    drifted=False and the note absent)."""
    write_note(vault, "Projects/Mtime.md", source=str(source_repo), updated="2026-05-01")
    _commit_vault(vault)

    # No new commit (only the EARLY_DATE seed exists → commits_since == 0). Bump file mtime past updated:.
    newer = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp()
    os.utime(source_repo / "f.txt", (newer, newer))

    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    drifted = {e["note"]: e for e in data["drifted"]}
    assert "Projects/Mtime.md" in drifted, (
        f"an uncommitted working-tree edit (mtime > updated:) must drift via the mtime signal: {data}"
    )
    assert drifted["Projects/Mtime.md"]["commits_since"] == 0, (
        "this note must drift on the mtime branch ALONE (commits_since == 0); got "
        f"{drifted['Projects/Mtime.md']}"
    )


def test_symlinked_note_skipped(vault: Path, source_repo: Path, tmp_path: Path) -> None:
    """The symlink-skip in load_map (`if os.path.islink(fp): continue`) — never read a note through a
    symlink that could point OUTSIDE the vault. A symlinked *.md inside the vault that targets a real
    note (with a valid, drifting `source:`) must be SKIPPED entirely: absent from BOTH `drifted` and
    `unresolved_sources` (it is never read, so its `source:` is never even parsed).

    The real target lives outside the vault and its `source:` maps to a genuinely-drifting repo, so
    were the symlink followed it WOULD drift — reverting `if os.path.islink(fp): continue` makes this
    fail (the symlinked note would then be processed)."""
    # The repo genuinely drifts (a commit after the would-be note's updated:).
    (source_repo / "f.txt").write_text("moved\n")
    _commit(source_repo, LATER_DATE, "drift")

    # A real note OUTSIDE the vault with a valid, drifting source mapping.
    outside = tmp_path / "outside_note.md"
    outside.write_text(
        _fm_block({"source": str(source_repo), "updated": "2026-05-01"}) + "body\n",
        encoding="utf-8",
    )
    # A symlink INSIDE the vault pointing at it.
    link_dir = vault / "Projects"
    link_dir.mkdir(parents=True, exist_ok=True)
    os.symlink(str(outside), str(link_dir / "link.md"))
    _commit_vault(vault)

    r = _cli(vault, "--json")
    data = json.loads(r.stdout)
    drifted = {e["note"] for e in data["drifted"]}
    unresolved = {e["note"] for e in data["unresolved_sources"]}

    assert "Projects/link.md" not in drifted, (
        "a symlinked note must be skipped by the walker (never followed out of the vault), so it "
        "can never appear in drifted"
    )
    assert "Projects/link.md" not in unresolved, (
        f"a skipped symlinked note is never read, so its source: is never parsed: {data}"
    )
