#!/usr/bin/env python3
"""discovery.py - AHOL variant-differentiation measurement gate.

Replaces the cache-token-ratio gate after 8 failed cycles. Earlier cycles
inferred V4 discovery from cache_creation/cache_read ratios vs V0 and hit
a Case-B heisenbug that wipes variant-V4/.claude/ mid-pipeline, collapsing
V4 onto V0 at the cache layer (see .planning/research/ahol/HEISENBUG-AUDIT.md).
Direction B measures outcome rather than state: did Claude Code enumerate
the variant's project-level skills at invocation? The session JSONL under
~/.claude/projects/<slug>/ contains a `skill_listing` attachment whose
`content` names discovered skills. V4 populated -> variant names appear;
V4 bare -> only ~10 built-ins. 3/5 markers passes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

CLAUDE_PROJECTS_DIR: Path = Path.home() / ".claude" / "projects"
MIN_MARKERS_FOR_PASS: int = 3


def _slug_candidates(round_id: str, variant_id: str, task_id: str) -> list[str]:
    """Candidate Claude Code slugs. cwd -> replace `/` and `_` with `-`, prefix `-`.
    macOS resolves /tmp to /private/tmp first.
    """
    priv = f"/private/tmp/ahol-run-{round_id}/{variant_id}/{task_id}/repo"
    plain = f"/tmp/ahol-run-{round_id}/{variant_id}/{task_id}/repo"
    return [
        "-" + priv.lstrip("/").replace("/", "-").replace("_", "-"),
        "-" + plain.lstrip("/").replace("/", "-").replace("_", "-"),
        "-" + priv.lstrip("/").replace("/", "-"),
    ]


def _locate_session_jsonl(
    round_id: str, variant_id: str, task_id: str,
    projects_dir: Path = CLAUDE_PROJECTS_DIR,
) -> tuple[Optional[Path], str]:
    """Find the JSONL for this task. Returns (path, reason) or (None, reason)."""
    if not projects_dir.is_dir():
        return None, f"projects_dir_missing: {projects_dir}"
    for slug in _slug_candidates(round_id, variant_id, task_id):
        d = projects_dir / slug
        if d.is_dir():
            jsonls = sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
            if jsonls:
                return jsonls[0], f"found_via_slug: {slug}"
    matches = [m for m in projects_dir.glob(f"*{round_id}*{variant_id}*") if m.is_dir()]
    matches.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for m in matches:
        jsonls = sorted(m.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if jsonls:
            return jsonls[0], f"found_via_glob: {m.name}"
    return None, (
        f"jsonl_not_found: tried {_slug_candidates(round_id, variant_id, task_id)} "
        f"and glob *{round_id}*{variant_id}* under {projects_dir}"
    )


def _extract_discovery_corpus(jsonl_path: Path) -> tuple[Optional[str], str]:
    """Return (corpus, diag). corpus = first user content + skill_listing content.
    Both are pre-first-assistant locations where Claude Code names discovered skills.
    """
    parts: list[str] = []
    seen_user = seen_listing = False
    try:
        with jsonl_path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict):
                    continue
                etype = entry.get("type")
                if etype == "user" and not seen_user:
                    seen_user = True
                    msg = entry.get("message")
                    if isinstance(msg, dict):
                        c = msg.get("content")
                        if isinstance(c, str):
                            parts.append(c)
                        elif isinstance(c, list):
                            for b in c:
                                if isinstance(b, dict) and isinstance(b.get("text"), str):
                                    parts.append(b["text"])
                elif etype == "attachment" and not seen_listing:
                    att = entry.get("attachment")
                    if isinstance(att, dict) and att.get("type") == "skill_listing":
                        seen_listing = True
                        c = att.get("content")
                        if isinstance(c, str):
                            parts.append(c)
                if etype == "assistant":
                    break
    except OSError as exc:
        return None, f"io_error: {exc}"
    if not parts:
        return None, "parse_error: no first-user or skill_listing content"
    return "\n".join(parts), "ok"


def verify_variant_discovery(
    round_id: str, variant_id: str, task_id: str, expected_markers: list[str],
    projects_dir: Path = CLAUDE_PROJECTS_DIR,
) -> tuple[bool, str, list[str]]:
    """Verify a variant discovered its project skills. Returns (ok, diag, found).
    ok = >= MIN_MARKERS_FOR_PASS markers present in the first-user/skill_listing
    corpus. 3/5 tolerates truncation without being a free pass; 0-2 means bare.
    """
    jsonl_path, locate_diag = _locate_session_jsonl(
        round_id, variant_id, task_id, projects_dir=projects_dir,
    )
    if jsonl_path is None:
        return False, locate_diag, []
    corpus, parse_diag = _extract_discovery_corpus(jsonl_path)
    if corpus is None:
        return False, f"{parse_diag} (jsonl={jsonl_path.name})", []
    found = [m for m in expected_markers if m in corpus]
    ok = len(found) >= MIN_MARKERS_FOR_PASS
    diag = f"{'PASS' if ok else 'FAIL'} {len(found)}/{len(expected_markers)} via {jsonl_path.name}"
    return ok, diag, found


def select_variant_markers(
    skills_dir: Path, count: int = 5, prefix: str = "gsd-", min_length: int = 12,
) -> list[str]:
    """Pick `count` distinctive skill names from skills_dir/ deterministically.
    gsd- prefix is empirically reliable in Claude Code's skill_listing; min_length
    rules out substring collisions. Sorted by descending length.
    """
    if not skills_dir.is_dir():
        raise ValueError(f"skills_dir does not exist: {skills_dir}")
    names = [
        p.name for p in skills_dir.iterdir()
        if p.is_dir() and p.name.startswith(prefix) and len(p.name) >= min_length
    ]
    names.sort(key=lambda x: (-len(x), x))
    if len(names) < count:
        raise ValueError(
            f"only {len(names)} {prefix!r} skills with len>={min_length} under "
            f"{skills_dir}; need {count}"
        )
    return names[:count]
