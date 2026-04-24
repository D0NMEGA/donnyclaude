#!/usr/bin/env python3
"""variants.py - AHOL variant worktree bootstrap and mutation application.

Bootstraps Tier-3 variant worktrees from packages/ahol/baseline/bootstrap.sh and
applies variant-specific mutations from a manifest. Implements the 10 atomic
mutation types declared in CONTAMINATION-ANALYSIS.md plus an
install_full_donnyclaude composite handler used by the V4 spike control. C3
status: add_hook, add_rule_file, modify_skill_frontmatter,
modify_compaction_threshold, modify_reasoning_effort, install_full_donnyclaude
fully implemented; remove_hook, modify_hook_config, add_rule_to_agent_prompt,
remove_rule_from_agent_prompt, remove_rule_file stubbed (NotImplementedError).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import jsonschema

logger = logging.getLogger("ahol.variants")

MODULE_DIR: Path = Path(__file__).resolve().parent
REPO_ROOT_DEFAULT: Path = MODULE_DIR.parent.parent.parent
CONTRACTS_DIR_DEFAULT: Path = REPO_ROOT_DEFAULT / "packages" / "ahol" / "contracts"
BASELINE_DIR_DEFAULT: Path = REPO_ROOT_DEFAULT / "packages" / "ahol" / "baseline"
SCHEMA_FILENAME = "variant-manifest.schema.json"
BOOTSTRAP_TIMEOUT_SEC = 60

ALLOWED_ATOMIC_MUTATIONS: tuple[str, ...] = (
    "add_hook", "remove_hook", "modify_hook_config",
    "add_rule_to_agent_prompt", "remove_rule_from_agent_prompt",
    "add_rule_file", "remove_rule_file",
    "modify_skill_frontmatter",
    "modify_compaction_threshold", "modify_reasoning_effort",
)
COMPOSITE_MUTATIONS: tuple[str, ...] = ("install_full_donnyclaude",)
ALL_MUTATION_TYPES: tuple[str, ...] = ALLOWED_ATOMIC_MUTATIONS + COMPOSITE_MUTATIONS

DEFERRED_HANDLERS: frozenset[str] = frozenset({
    "remove_hook", "modify_hook_config",
    "add_rule_to_agent_prompt", "remove_rule_from_agent_prompt",
    "remove_rule_file",
})

V4_INSTALL_MAP: tuple[tuple[str, str], ...] = (
    ("packages/hooks", ".claude/hooks"),
    ("packages/skills", ".claude/skills"),
    ("packages/agents", ".claude/agents"),
    ("packages/rules", ".claude/rules"),
    ("packages/commands", ".claude/commands"),
)

_BOOTSTRAP_LOCK = threading.Lock()
_BOOTSTRAP_CACHE: dict[str, Path] = {}


@dataclass(frozen=True)
class VariantManifest:
    """VariantManifest(name='V4', mutations=[{mutation_type, params}], description='...')."""

    name: str
    mutations: tuple[dict[str, Any], ...]
    description: Optional[str] = None


def _load_schema(contracts_dir: Path) -> dict[str, Any]:
    with (contracts_dir / SCHEMA_FILENAME).open("r", encoding="utf-8") as fh:
        return json.load(fh)  # type: ignore[no-any-return]


def load_variant_manifest(
    path: Path, contracts_dir: Optional[Path] = None,
) -> list[VariantManifest]:
    """load_variant_manifest(Path('V0.json')) returns list[VariantManifest], schema-validated.

    Accepts either {"variants": [...]} or a single bare variant entry (auto-wrapped).
    Enforces variant-name uniqueness across the manifest.
    """
    schema_dir = contracts_dir or CONTRACTS_DIR_DEFAULT
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict) and "variants" not in data and "name" in data:
        data = {"variants": [data]}
    if not isinstance(data, dict):
        raise ValueError(f"variant manifest at {path} must be a JSON object")
    jsonschema.validate(instance=data, schema=_load_schema(schema_dir))
    out: list[VariantManifest] = []
    seen: set[str] = set()
    for entry in data["variants"]:
        name = str(entry["name"])
        if name in seen:
            raise ValueError(f"duplicate variant name in manifest {path}: {name!r}")
        seen.add(name)
        bundle = entry["mutation_bundle_json"]
        muts = tuple(bundle.get("mutations", []))
        out.append(
            VariantManifest(name=name, mutations=muts, description=entry.get("description"))
        )
    return out


def _run_bootstrap_sh(target: Path, repo_root: Path) -> None:
    """Invoke packages/ahol/baseline/bootstrap.sh with AHOL_TARGET=target."""
    bootstrap_sh = repo_root / "packages" / "ahol" / "baseline" / "bootstrap.sh"
    if not bootstrap_sh.is_file():
        raise FileNotFoundError(f"bootstrap.sh not found at {bootstrap_sh}")
    env = {**os.environ, "AHOL_TARGET": str(target)}
    proc = subprocess.run(
        [str(bootstrap_sh)], env=env, cwd=str(repo_root),
        capture_output=True, text=True, check=False, timeout=BOOTSTRAP_TIMEOUT_SEC,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"bootstrap.sh failed for target {target}: rc={proc.returncode} stderr={proc.stderr.strip()}"
        )
    logger.debug("bootstrap.sh OK %s -> %s", target, proc.stdout.strip())


def bootstrap_variant(
    variant: VariantManifest, ahol_home: Path, repo_root: Optional[Path] = None,
) -> Path:
    """bootstrap_variant(vm, ahol_home, repo_root) returns absolute path to .ahol/worktrees/variant-{name}/.

    Idempotent within a process via _BOOTSTRAP_CACHE: a second call for the same
    variant name in the same round returns the cached path without re-running
    bootstrap.sh. Stale or invalid worktrees are torn down and rebuilt.
    """
    rr = repo_root or REPO_ROOT_DEFAULT
    target = ahol_home / "worktrees" / f"variant-{variant.name}"
    cache_key = str(target)
    with _BOOTSTRAP_LOCK:
        cached = _BOOTSTRAP_CACHE.get(cache_key)
        if cached is not None and cached.is_dir():
            ok, diag = validate_variant_worktree(cached, list(variant.mutations))
            if ok:
                return cached
            logger.warning("cached worktree %s failed re-validation: %s", cached, diag)
            cleanup_variant(cached)
            _BOOTSTRAP_CACHE.pop(cache_key, None)
        if target.is_dir():
            ok, diag = validate_variant_worktree(target, list(variant.mutations))
            if ok:
                _BOOTSTRAP_CACHE[cache_key] = target
                return target
            logger.warning("worktree %s exists but invalid (%s); recreating", target, diag)
            cleanup_variant(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        _run_bootstrap_sh(target, rr)
        for mutation in variant.mutations:
            apply_mutation(mutation, target, rr)
        ok, diag = validate_variant_worktree(target, list(variant.mutations))
        if not ok:
            raise RuntimeError(
                f"variant {variant.name} post-bootstrap validation failed at {target}: {diag}"
            )
        _BOOTSTRAP_CACHE[cache_key] = target
        return target


def apply_mutation(
    mutation: dict[str, Any], worktree: Path, repo_root: Optional[Path] = None,
) -> None:
    """Dispatch one mutation to its handler. Unknown types raise with the valid list."""
    mt = mutation.get("mutation_type")
    params = mutation.get("params") or {}
    if not isinstance(mt, str):
        raise ValueError(
            f"mutation missing 'mutation_type' string; got {mt!r}; valid: {list(ALL_MUTATION_TYPES)}"
        )
    handler = _MUTATION_HANDLERS.get(mt)
    if handler is None:
        raise ValueError(
            f"unknown mutation_type {mt!r}; valid: {list(ALL_MUTATION_TYPES)}"
        )
    if mt in DEFERRED_HANDLERS:
        raise NotImplementedError(
            f"mutation_type {mt!r} is stubbed in C3; deferred to a later phase. "
            f"Fully implemented in C3: add_hook, add_rule_file, modify_skill_frontmatter, "
            f"modify_compaction_threshold, modify_reasoning_effort, install_full_donnyclaude."
        )
    handler(params, worktree, repo_root or REPO_ROOT_DEFAULT)


def _handle_add_hook(params: dict[str, Any], target: Path, repo_root: Path) -> None:
    """add_hook params={'hook_files': ['gsd-session-start.js', ...]} copies named files from packages/hooks/."""
    hook_files = params.get("hook_files") or []
    if isinstance(hook_files, str):
        hook_files = [hook_files]
    if not isinstance(hook_files, list) or not all(isinstance(h, str) for h in hook_files):
        raise ValueError(f"add_hook params.hook_files must be a list of filenames; got {hook_files!r}")
    src_root = repo_root / "packages" / "hooks"
    dst_root = target / ".claude" / "hooks"
    dst_root.mkdir(parents=True, exist_ok=True)
    for hf in hook_files:
        src = src_root / hf
        if not src.is_file():
            raise FileNotFoundError(f"add_hook source missing: {src}")
        shutil.copy2(src, dst_root / hf)
        logger.debug("add_hook %s -> %s", src, dst_root / hf)


def _handle_add_rule_file(params: dict[str, Any], target: Path, repo_root: Path) -> None:
    """add_rule_file params={'sources': ['common', 'python']} copies files or dirs from packages/rules/."""
    sources = params.get("sources") or []
    if isinstance(sources, str):
        sources = [sources]
    if not isinstance(sources, list) or not all(isinstance(s, str) for s in sources):
        raise ValueError(f"add_rule_file params.sources must be a list of paths; got {sources!r}")
    src_root = repo_root / "packages" / "rules"
    dst_root = target / ".claude" / "rules"
    dst_root.mkdir(parents=True, exist_ok=True)
    for s in sources:
        src = src_root / s
        if not src.exists():
            raise FileNotFoundError(f"add_rule_file source missing: {src}")
        if src.is_dir():
            shutil.copytree(src, dst_root / s, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst_root / s)
        logger.debug("add_rule_file %s -> %s", src, dst_root / s)


def _handle_modify_skill_frontmatter(
    params: dict[str, Any], target: Path, repo_root: Path,
) -> None:
    """modify_skill_frontmatter params={'skill_name': 'foo', 'field': 'description', 'value': 'new'}."""
    skill_name = params.get("skill_name")
    field_name = params.get("field")
    new_value = params.get("value")
    if not isinstance(skill_name, str) or not isinstance(field_name, str):
        raise ValueError("modify_skill_frontmatter requires skill_name and field as strings")
    if not isinstance(new_value, (str, int, float, bool)):
        raise ValueError("modify_skill_frontmatter requires scalar 'value'")
    skill_md = target / ".claude" / "skills" / skill_name / "SKILL.md"
    if not skill_md.is_file():
        raise FileNotFoundError(f"modify_skill_frontmatter target missing: {skill_md}")
    text = skill_md.read_text(encoding="utf-8")
    lines = text.splitlines()
    in_fm = False
    for i, line in enumerate(lines):
        if line.strip() == "---":
            if not in_fm:
                in_fm = True
                continue
            break
        if in_fm and line.startswith(f"{field_name}:"):
            lines[i] = f"{field_name}: {new_value}"
            break
    suffix = "\n" if text.endswith("\n") else ""
    skill_md.write_text("\n".join(lines) + suffix, encoding="utf-8")


def _handle_modify_compaction_threshold(
    params: dict[str, Any], target: Path, repo_root: Path,
) -> None:
    """modify_compaction_threshold params={'threshold': 0.85} writes settings.json compaction.threshold."""
    threshold = params.get("threshold")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool):
        raise ValueError("modify_compaction_threshold requires numeric 'threshold' param")
    settings = target / ".claude" / "settings.json"
    data = json.loads(settings.read_text(encoding="utf-8"))
    compaction = data.setdefault("compaction", {})
    compaction["threshold"] = threshold
    settings.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _handle_modify_reasoning_effort(
    params: dict[str, Any], target: Path, repo_root: Path,
) -> None:
    """modify_reasoning_effort params={'effort': 'high'} writes settings.json reasoning.effort."""
    effort = params.get("effort")
    if effort not in ("low", "medium", "high"):
        raise ValueError(f"modify_reasoning_effort requires effort in low|medium|high; got {effort!r}")
    settings = target / ".claude" / "settings.json"
    data = json.loads(settings.read_text(encoding="utf-8"))
    reasoning = data.setdefault("reasoning", {})
    reasoning["effort"] = effort
    settings.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _handle_install_full_donnyclaude(
    params: dict[str, Any], target: Path, repo_root: Path,
) -> None:
    """V4 composite: copy donnyclaude packages tree (hooks, skills, agents, rules, commands) into worktree."""
    claude_dir = target / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)
    installed: list[str] = []
    for src_rel, dst_rel in V4_INSTALL_MAP:
        src = repo_root / src_rel
        if not src.is_dir():
            logger.warning("install_full_donnyclaude: source missing, skipping %s", src)
            continue
        dst = target / dst_rel
        if dst.exists():
            shutil.rmtree(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dst)
        installed.append(dst_rel)
    for mcp_candidate in (
        repo_root / ".mcp.json",
        repo_root / ".claude" / ".mcp.json",
    ):
        if mcp_candidate.is_file():
            shutil.copy2(mcp_candidate, claude_dir / mcp_candidate.name)
            installed.append(f".claude/{mcp_candidate.name}")
            break
    logger.info(
        "install_full_donnyclaude installed %d trees into %s: %s",
        len(installed), target, installed,
    )


def _stub_handler_factory(name: str) -> Callable[[dict[str, Any], Path, Path], None]:
    def _stub(params: dict[str, Any], target: Path, repo_root: Path) -> None:
        raise NotImplementedError(f"{name}: stubbed handler reached (C3 deferred)")
    _stub.__name__ = f"_handle_{name}_stub"
    return _stub


_MUTATION_HANDLERS: dict[str, Callable[[dict[str, Any], Path, Path], None]] = {
    "add_hook": _handle_add_hook,
    "remove_hook": _stub_handler_factory("remove_hook"),
    "modify_hook_config": _stub_handler_factory("modify_hook_config"),
    "add_rule_to_agent_prompt": _stub_handler_factory("add_rule_to_agent_prompt"),
    "remove_rule_from_agent_prompt": _stub_handler_factory("remove_rule_from_agent_prompt"),
    "add_rule_file": _handle_add_rule_file,
    "remove_rule_file": _stub_handler_factory("remove_rule_file"),
    "modify_skill_frontmatter": _handle_modify_skill_frontmatter,
    "modify_compaction_threshold": _handle_modify_compaction_threshold,
    "modify_reasoning_effort": _handle_modify_reasoning_effort,
    "install_full_donnyclaude": _handle_install_full_donnyclaude,
}


def validate_variant_worktree(
    worktree: Path, expected_mutations: list[dict[str, Any]],
) -> tuple[bool, str]:
    """Confirm baseline invariants survived bootstrap and any expected post-mutation markers exist."""
    sprompt = worktree / "system-prompt.txt"
    invoke = worktree / "invoke.sh"
    settings = worktree / ".claude" / "settings.json"
    for required in (sprompt, invoke, settings):
        if not required.is_file():
            return False, f"missing baseline file: {required}"
    if not os.access(invoke, os.X_OK):
        return False, f"invoke.sh not executable: {invoke}"
    for mutation in expected_mutations:
        mt = mutation.get("mutation_type")
        params = mutation.get("params") or {}
        if mt == "add_hook":
            for hf in params.get("hook_files") or []:
                if not (worktree / ".claude" / "hooks" / hf).is_file():
                    return False, f"add_hook marker missing: .claude/hooks/{hf}"
        elif mt == "add_rule_file":
            for s in params.get("sources") or []:
                if not (worktree / ".claude" / "rules" / s).exists():
                    return False, f"add_rule_file marker missing: .claude/rules/{s}"
        elif mt == "install_full_donnyclaude":
            for src_rel, dst_rel in V4_INSTALL_MAP:
                if not (REPO_ROOT_DEFAULT / src_rel).is_dir():
                    continue
                if not (worktree / dst_rel).is_dir():
                    return False, f"install_full_donnyclaude marker missing: {dst_rel}"
    return True, "ok"


def cleanup_variant(worktree_path: Path) -> None:
    """Remove a variant worktree. Refuses anything not under .ahol/worktrees/."""
    p = worktree_path.resolve() if worktree_path.exists() else worktree_path
    parts = p.parts
    if "worktrees" not in parts or ".ahol" not in parts:
        raise ValueError(f"cleanup_variant refuses non-worktree path: {p}")
    if not p.is_dir():
        return
    shutil.rmtree(p)
    logger.debug("cleanup_variant removed %s", p)


def reset_bootstrap_cache() -> None:
    """Clear the in-process bootstrap cache. Used by self-tests and round teardown."""
    with _BOOTSTRAP_LOCK:
        _BOOTSTRAP_CACHE.clear()
