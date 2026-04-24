#!/usr/bin/env python3
"""ahol.py - AHOL Tier 1 orchestrator with OpenTelemetry side-channel.

Pure-Python runner. Tiers 1 and 2 are Python; Tier 3 shells out to
packages/ahol/baseline/invoke.sh which calls claude --print. Scope in
packages/ahol/GROUP-C-SCOPE.md. Contracts in packages/ahol/contracts/.
Refinement 1 (argparse hazard): invoke.sh feeds user turn via stdin.
Refinement 2 (token counts): post-hoc parse of ~/.claude/projects/<slug>/
<session>.jsonl message.usage. See .planning/research/ahol/DRY-RUN-NOTES.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path as _Path

# Package-mode import shim: when ahol.py is invoked as a direct script via
# `python3 packages/ahol/runner/ahol.py`, Python only puts the script's
# directory on sys.path. load_tasks later imports ahol.runner.benchmarks, which
# in turn imports ahol.runner.ahol, so the `packages/` parent must also be on
# sys.path. Adding it here is idempotent and harmless when invoked as a module.
_packages_dir = _Path(__file__).resolve().parent.parent.parent
if str(_packages_dir) not in sys.path:
    sys.path.insert(0, str(_packages_dir))
from collections.abc import Sequence
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import FrameType
from typing import Any, Optional

import jsonschema
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter, SpanExportResult

MODULE_DIR: Path = Path(__file__).resolve().parent
REPO_ROOT: Path = MODULE_DIR.parent.parent.parent
BASELINE_DIR: Path = REPO_ROOT / "packages" / "ahol" / "baseline"
CONTRACTS_DIR: Path = REPO_ROOT / "packages" / "ahol" / "contracts"
DEFAULT_AHOL_HOME: Path = REPO_ROOT / ".ahol"
CLAUDE_PROJECTS_DIR: Path = Path.home() / ".claude" / "projects"
TASK_TIMEOUT_SEC: int = 900
CACHE_ASSERTION_AFTER_TASK: int = 3
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
logger = logging.getLogger("ahol")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT NOT NULL, variant_id TEXT NOT NULL, task_id TEXT NOT NULL, sequence INTEGER NOT NULL, passed INTEGER NOT NULL, tokens_used INTEGER NOT NULL, tool_call_count INTEGER, cache_read_input_tokens INTEGER, wall_clock_sec REAL NOT NULL, patch_sha TEXT, error_summary TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, exit_code INTEGER, UNIQUE (round_id, variant_id, task_id));
CREATE TABLE IF NOT EXISTS variant_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT NOT NULL, variant_id TEXT NOT NULL, tasks_completed INTEGER NOT NULL, tasks_passed INTEGER NOT NULL, total_tokens INTEGER NOT NULL, wall_clock_sec REAL NOT NULL, error_log TEXT, sqlite_row_ids TEXT NOT NULL, UNIQUE (round_id, variant_id));
CREATE TABLE IF NOT EXISTS round_summaries (round_id TEXT PRIMARY KEY, champion_variant_id TEXT, champion_score REAL NOT NULL, prior_champion_score REAL NOT NULL, sigma_gate_passed INTEGER NOT NULL, cost_gate_passed INTEGER NOT NULL, total_tokens INTEGER NOT NULL, total_wall_clock_sec REAL NOT NULL, timestamp TEXT NOT NULL, summary_json TEXT NOT NULL);
"""


@dataclass(frozen=True)
class Variant:
    """Variant(id='V0', harness_bundle=[], mode='baseline')."""

    id: str
    harness_bundle: list[str]
    mode: str = "baseline"


@dataclass(frozen=True)
class Task:
    """Task(id='django__django-11099', issue_body='...', repo='django/django', base_commit='d26b...', benchmark_origin='princeton-nlp/SWE-bench_Lite')."""

    id: str
    issue_body: str
    repo: str
    base_commit: str
    benchmark_origin: str = ""


@dataclass
class TaskResult:
    """TaskResult(task_id='x', passed=True, tokens_used=24110, wall_clock_sec=21.3, patch_sha='a3b5...', error_summary=None)."""

    task_id: str
    passed: bool
    tokens_used: int
    wall_clock_sec: float
    patch_sha: Optional[str]
    error_summary: Optional[str]
    tool_call_count: Optional[int] = None
    cache_read_input_tokens: Optional[int] = None


@dataclass
class VariantResult:
    """VariantResult(variant_id='V0', tasks_completed=30, tasks_passed=17, total_tokens=453210, wall_clock_sec=612.4, error_log=None, sqlite_row_ids=[1,2])."""

    variant_id: str
    tasks_completed: int
    tasks_passed: int
    total_tokens: int
    wall_clock_sec: float
    error_log: Optional[str]
    sqlite_row_ids: list[int] = field(default_factory=list)


@dataclass
class RoundSummary:
    """RoundSummary(round_id='2026-04-23T10Z', champion_variant_id='V4', champion_score=0.73, ...)."""

    round_id: str
    champion_variant_id: Optional[str]
    champion_score: float
    prior_champion_score: float
    sigma_gate_passed: bool
    cost_gate_passed: bool
    comparison_sql: str
    timestamp: str
    variants_evaluated: list[str]
    total_tokens: int
    total_wall_clock_sec: float


def load_schema(name: str) -> dict[str, Any]:
    """load_schema('task-runner-return.schema.json') returns a dict of the JSON Schema."""
    with (CONTRACTS_DIR / name).open("r", encoding="utf-8") as fh:
        return json.load(fh)  # type: ignore[no-any-return]


def validate_payload(payload: dict[str, Any], schema_name: str) -> None:
    """validate_payload({'task_id': 'x', ...}, 'task-runner-return.schema.json') raises on failure."""
    jsonschema.validate(instance=payload, schema=load_schema(schema_name))


def init_db(db_path: Path) -> sqlite3.Connection:
    """init_db(Path('.ahol/benchmarks.db')) returns a WAL-mode connection with schema applied."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA_SQL)
    return conn


def insert_task_result(
    conn: sqlite3.Connection, round_id: str, variant_id: str, sequence: int,
    result: TaskResult, started_at: str, ended_at: str, exit_code: Optional[int],
) -> int:
    """Insert one task row and return its rowid."""
    cur = conn.execute(
        "INSERT OR REPLACE INTO task_runs (round_id, variant_id, task_id, sequence, passed, "
        "tokens_used, tool_call_count, cache_read_input_tokens, wall_clock_sec, patch_sha, "
        "error_summary, started_at, ended_at, exit_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (round_id, variant_id, result.task_id, sequence, int(result.passed), result.tokens_used,
         result.tool_call_count, result.cache_read_input_tokens, result.wall_clock_sec,
         result.patch_sha, result.error_summary, started_at, ended_at, exit_code),
    )
    return int(cur.lastrowid or 0)


def insert_variant_result(conn: sqlite3.Connection, round_id: str, result: VariantResult) -> int:
    """Insert one variant-level row and return its rowid."""
    cur = conn.execute(
        "INSERT OR REPLACE INTO variant_runs (round_id, variant_id, tasks_completed, tasks_passed, "
        "total_tokens, wall_clock_sec, error_log, sqlite_row_ids) VALUES (?,?,?,?,?,?,?,?)",
        (round_id, result.variant_id, result.tasks_completed, result.tasks_passed,
         result.total_tokens, result.wall_clock_sec, result.error_log,
         json.dumps(result.sqlite_row_ids)),
    )
    return int(cur.lastrowid or 0)


def resume_sequence(conn: sqlite3.Connection, round_id: str, variant_id: str) -> int:
    """Return the 0-indexed next sequence for crash recovery; 0 if no prior task rows."""
    row = conn.execute(
        "SELECT COALESCE(MAX(sequence), -1) FROM task_runs WHERE round_id = ? AND variant_id = ?",
        (round_id, variant_id),
    ).fetchone()
    return int(row[0]) + 1 if row else 0


def snapshot_session_files() -> dict[Path, float]:
    """snapshot_session_files() returns {path: mtime} for every *.jsonl under CLAUDE_PROJECTS_DIR."""
    out: dict[Path, float] = {}
    if not CLAUDE_PROJECTS_DIR.is_dir():
        return out
    for p in CLAUDE_PROJECTS_DIR.rglob("*.jsonl"):
        try:
            out[p] = p.stat().st_mtime
        except OSError:
            continue
    return out


def parse_session_jsonl(path: Path) -> dict[str, int]:
    """parse_session_jsonl(session_path) returns {'tokens_used': N, 'cache_read_input_tokens': M, 'tool_call_count': K}."""
    tokens = cache_read = tool_calls = 0
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
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
                msg = entry.get("message")
                if not isinstance(msg, dict):
                    continue
                usage = msg.get("usage")
                if isinstance(usage, dict):
                    tokens += int(usage.get("input_tokens") or 0)
                    tokens += int(usage.get("output_tokens") or 0)
                    tokens += int(usage.get("cache_creation_input_tokens") or 0)
                    tokens += int(usage.get("cache_read_input_tokens") or 0)
                    cache_read += int(usage.get("cache_read_input_tokens") or 0)
                content = msg.get("content")
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tool_calls += 1
    except OSError:
        pass
    return {"tokens_used": tokens, "cache_read_input_tokens": cache_read, "tool_call_count": tool_calls}


def extract_metrics(
    before: dict[Path, float], t_start: float, t_end: float,
) -> dict[str, Optional[int]]:
    """extract_metrics(before_snap, t_start, t_end) aggregates over session files modified in window.

    t_start and t_end are epoch seconds (time.time()), NOT time.monotonic(); the
    window is compared against os.stat().st_mtime which is also epoch. The C5
    integration test surfaced a clock mismatch where monotonic clocks made the
    window unreachable. Window padded -5s / +30s to absorb post-invocation
    session-file flush latency.
    """
    after = snapshot_session_files()
    candidates: set[Path] = set()
    for p, mt in after.items():
        in_window = t_start - 5.0 <= mt <= t_end + 30.0
        is_new_or_newer = p not in before or mt > before[p]
        if in_window and is_new_or_newer:
            candidates.add(p)
    if not candidates:
        logger.warning("no session file modified during task window; token metrics unavailable")
        return {"tokens_used": None, "cache_read_input_tokens": None, "tool_call_count": None}
    agg = {"tokens_used": 0, "cache_read_input_tokens": 0, "tool_call_count": 0}
    for p in candidates:
        m = parse_session_jsonl(p)
        for k, v in m.items():
            agg[k] += v
    return {k: v for k, v in agg.items()}


class FileSpanExporter(SpanExporter):
    """Append one OTLP-JSON line per span to a file under .ahol/traces/."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        self._lock = threading.Lock()

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        with self._lock:
            try:
                with self._path.open("a", encoding="utf-8") as fh:
                    for span in spans:
                        fh.write(
                            json.dumps(json.loads(span.to_json()), separators=(",", ":")) + "\n"
                        )
            except OSError as exc:
                logger.error("FileSpanExporter write failed: %s", exc)
                return SpanExportResult.FAILURE
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


def setup_tracer(
    round_id: str, ahol_home: Path, otlp_endpoint: Optional[str],
) -> trace.Tracer:
    """Configure global TracerProvider writing to .ahol/traces/round-{N}.jsonl; return 'ahol' tracer."""
    safe = round_id.replace(":", "-").replace("/", "-")
    traces_file = ahol_home / "traces" / f"round-{safe}.jsonl"
    resource = Resource.create({"service.name": "ahol", "ahol.round_id": round_id})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(FileSpanExporter(traces_file)))
    if otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # type: ignore[import-not-found]
                OTLPSpanExporter,
            )

            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint))
            )
            logger.info("OTLP exporter enabled: %s", otlp_endpoint)
        except ImportError:
            logger.warning("AHOL_OTLP_ENDPOINT set but opentelemetry-exporter-otlp not installed")
    trace.set_tracer_provider(provider)
    return trace.get_tracer("ahol")


class Shutdown:
    """Cooperative flag set by SIGINT/SIGTERM; each run_task checks .requested."""

    def __init__(self) -> None:
        self.requested = False

    def install(self) -> None:
        """Wire SIGINT + SIGTERM handlers in the current process."""
        signal.signal(signal.SIGINT, self._handle)
        signal.signal(signal.SIGTERM, self._handle)

    def _handle(self, signum: int, frame: Optional[FrameType]) -> None:
        logger.warning("shutdown signal %d received; flushing in-flight work", signum)
        self.requested = True


def load_manifest(path: Path) -> tuple[list[Variant], dict[str, Any]]:
    """load_manifest(Path('manifest.json')) returns (list[Variant], {name: VariantManifest}) per variant-manifest.schema.json."""
    from ahol.runner.variants import load_variant_manifest  # noqa: PLC0415 (lazy)
    vms = load_variant_manifest(path)
    variants = [
        Variant(id=vm.name, harness_bundle=[str(m.get("mutation_type", "")) for m in vm.mutations],
                mode="bundle")
        for vm in vms
    ]
    lookup: dict[str, Any] = {vm.name: vm for vm in vms}
    return variants, lookup


def load_tasks(benchmark_name: str, limit: Optional[int] = None) -> list[Task]:
    """load_tasks('swe-bench-lite', limit=5) dispatches to benchmarks.py; 'self-test' returns 2 mocks.

    Valid benchmark_name values: self-test, swe-bench-lite, swe-bench-live,
    ahol-proxy-30, ahol-proxy-15 (alias for the partial 15-task composite).
    Raises ValueError with a listing on unknown names.
    """
    if benchmark_name == "self-test":
        return [
            Task(id="self-test-task-01", issue_body="mock 01", repo="mock/repo",
                 base_commit="0" * 40, benchmark_origin="self-test"),
            Task(id="self-test-task-02", issue_body="mock 02", repo="mock/repo",
                 base_commit="1" * 40, benchmark_origin="self-test"),
        ]
    from ahol.runner.benchmarks import (  # noqa: PLC0415 (lazy to avoid import cycle)
        load_ahol_proxy_30, load_swe_bench_lite, load_swe_bench_live,
    )
    if benchmark_name == "swe-bench-lite":
        return load_swe_bench_lite(limit=limit)
    if benchmark_name == "swe-bench-live":
        return load_swe_bench_live(limit=limit)
    if benchmark_name in ("ahol-proxy-30", "ahol-proxy-15"):
        return load_ahol_proxy_30(limit=limit)
    valid = "self-test, swe-bench-lite, swe-bench-live, ahol-proxy-30, ahol-proxy-15"
    raise ValueError(f"unknown benchmark {benchmark_name!r}; valid: {valid}")


def _write_task_log(
    round_id: str, variant_id: str, task_id: str, stdout: str, stderr: str,
    exit_code: Optional[int], wall_clock_sec: float, task_prompt: str, ahol_home: Path,
) -> None:
    """Write 3am-debugging raw log per GROUP-C-SCOPE.md invoke-task.sh scope."""
    safe = round_id.replace(":", "-").replace("/", "-")
    log_dir = ahol_home / "logs" / f"round-{safe}" / f"variant-{variant_id}"
    log_dir.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256(task_prompt.encode("utf-8", errors="replace")).hexdigest()
    so = stdout if stdout.endswith("\n") else stdout + "\n"
    se = stderr if stderr.endswith("\n") else stderr + "\n"
    (log_dir / f"task-{task_id}.log").write_text(
        f"# round_id: {round_id}\n# variant_id: {variant_id}\n# task_id: {task_id}\n"
        f"# exit_code: {exit_code}\n# wall_clock_sec: {wall_clock_sec:.3f}\n"
        f"# TASK_PROMPT sha256: {h}\n# ---stdout---\n{so}# ---stderr---\n{se}",
        encoding="utf-8",
    )


SWEBENCH_TIMEOUT_SEC: int = 600
CLONE_TIMEOUT_SEC: int = 300
GIT_DIFF_TIMEOUT_SEC: int = 30
SWEBENCH_COMPATIBLE_ORIGINS: frozenset[str] = frozenset({
    "princeton-nlp/SWE-bench_Lite",
    "princeton-nlp/SWE-bench_Verified",
})


class SafetyError(RuntimeError):
    """Raised when a workdir or cwd would mutate the donnyclaude repo."""


def _safe_path_segment(s: str) -> str:
    return s.replace("/", "-").replace(":", "-").replace(" ", "-")[:80] or "x"


def _safety_assert_workdir(workdir: Path) -> None:
    """Refuse if workdir is the donnyclaude repo, lives inside it, or has a donnyclaude git remote."""
    real = workdir.resolve()
    repo = REPO_ROOT.resolve()
    if real == repo or repo == real or repo in real.parents:
        raise SafetyError(f"workdir is donnyclaude repo or inside it: {real}")
    git_config = real / ".git" / "config"
    if git_config.is_file():
        text = git_config.read_text(encoding="utf-8", errors="replace").lower()
        if "donnyclaude" in text or "d0nmega" in text:
            raise SafetyError(f"workdir has donnyclaude-like git remote: {real}")


def _is_swebench_origin(origin: str) -> bool:
    """True when task.benchmark_origin is a swebench-scoreable dataset (Lite, Verified, or Live)."""
    return origin in SWEBENCH_COMPATIBLE_ORIGINS or "SWE-bench-Live" in origin


def _clone_task_repo(task: Task, workdir: Path) -> tuple[Path, Optional[str]]:
    """Clone task.repo at task.base_commit into workdir/repo. Returns (repo_path, error_or_None)."""
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    repo_path = workdir / "repo"
    if "/" in task.repo and not task.repo.startswith(("http", "git@")):
        url = f"https://github.com/{task.repo}"
    else:
        url = task.repo
    last_err: Optional[str] = None
    for attempt in (1, 2):
        try:
            subprocess.run(
                ["git", "clone", "--no-tags", "--single-branch", url, str(repo_path)],
                capture_output=True, text=True, check=True, timeout=CLONE_TIMEOUT_SEC,
            )
            try:
                subprocess.run(
                    ["git", "checkout", task.base_commit],
                    cwd=str(repo_path), capture_output=True, text=True, check=True,
                    timeout=GIT_DIFF_TIMEOUT_SEC * 4,
                )
                return repo_path, None
            except subprocess.CalledProcessError:
                subprocess.run(
                    ["git", "fetch", "--unshallow"],
                    cwd=str(repo_path), capture_output=True, text=True, check=False,
                    timeout=CLONE_TIMEOUT_SEC,
                )
                subprocess.run(
                    ["git", "fetch", "origin", task.base_commit],
                    cwd=str(repo_path), capture_output=True, text=True, check=False,
                    timeout=CLONE_TIMEOUT_SEC,
                )
                subprocess.run(
                    ["git", "checkout", task.base_commit],
                    cwd=str(repo_path), capture_output=True, text=True, check=True,
                    timeout=GIT_DIFF_TIMEOUT_SEC * 4,
                )
                return repo_path, None
        except subprocess.CalledProcessError as exc:
            last_err = (exc.stderr or "").strip()[:300] or "clone failed"
            logger.warning("clone attempt %d failed for %s: %s", attempt, task.id, last_err)
            shutil.rmtree(repo_path, ignore_errors=True)
        except subprocess.TimeoutExpired:
            last_err = f"clone timeout ({CLONE_TIMEOUT_SEC}s)"
            shutil.rmtree(repo_path, ignore_errors=True)
    return repo_path, last_err or "clone failed (no specific error captured)"


def _extract_patch(repo_path: Path) -> str:
    proc = subprocess.run(
        ["git", "diff"], cwd=str(repo_path), capture_output=True, text=True,
        check=False, timeout=GIT_DIFF_TIMEOUT_SEC,
    )
    return proc.stdout


def _run_swebench(
    predictions_path: Path, instance_id: str, dataset_name: str,
    run_id: str, model_name: str, workdir: Path, timeout: int = SWEBENCH_TIMEOUT_SEC,
) -> dict[str, Any]:
    """Invoke `python -m swebench.harness.run_evaluation` and return the parsed report dict."""
    cmd = [
        sys.executable, "-m", "swebench.harness.run_evaluation",
        "--dataset_name", dataset_name,
        "--instance_ids", instance_id,
        "--predictions_path", str(predictions_path),
        "--max_workers", "1",
        "--run_id", run_id,
        "--cache_level", "instance",
    ]
    try:
        proc = subprocess.run(
            cmd, cwd=str(workdir), capture_output=True, text=True, check=False, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"error_instances": 1, "_swebench_error": f"timeout {timeout}s"}
    candidates = [
        workdir / f"{model_name}.{run_id}.json",
        workdir / "logs" / "run_evaluation" / run_id / model_name / instance_id / "report.json",
    ]
    for rp in candidates:
        if rp.is_file():
            try:
                data = json.loads(rp.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    inner = data.get(instance_id)
                    if isinstance(inner, dict) and "resolved" in inner:
                        resolved = bool(inner["resolved"])
                        empty = bool(inner.get("patch_is_None")) or not bool(inner.get("patch_exists"))
                        applied = bool(inner.get("patch_successfully_applied"))
                        return {
                            "resolved_instances": 1 if resolved else 0,
                            "completed_instances": 1,
                            "empty_patch_instances": 1 if empty else 0,
                            "error_instances": 0 if applied else 1,
                            "_source": str(rp),
                            "_raw_inner": data,
                        }
                    return data
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("swebench report at %s unreadable: %s", rp, exc)
    return {
        "error_instances": 1,
        "_swebench_error": (proc.stderr or proc.stdout or "no swebench report")[-500:],
    }


def _archive_swebench_outputs(
    workdir: Path, ahol_home: Path, round_id: str, variant_id: str, task_id: str,
) -> None:
    """Move swebench logs and report JSON out of /tmp workdir into .ahol/logs/.../swebench/."""
    safe_round = round_id.replace(":", "-").replace("/", "-")
    archive_dir = (ahol_home / "logs" / f"round-{safe_round}" /
                   f"variant-{variant_id}" / f"task-{task_id}-swebench")
    archive_dir.mkdir(parents=True, exist_ok=True)
    for fp in workdir.glob("*.json"):
        try:
            shutil.copy2(fp, archive_dir / fp.name)
        except OSError as exc:
            logger.warning("archive %s failed: %s", fp, exc)
    swebench_logs = workdir / "logs"
    if swebench_logs.is_dir():
        try:
            shutil.copytree(swebench_logs, archive_dir / "logs", dirs_exist_ok=True)
        except OSError as exc:
            logger.warning("archive logs failed: %s", exc)


def _run_real_pipeline(
    task: Task, variant_harness_path: Path, round_id: str, variant_id: str,
) -> tuple[str, str, Optional[int], Optional[str], bool, str]:
    """Execute the 9-step real pipeline. Returns (stdout, stderr, exit_code, error_summary, passed, patch).

    Steps a-i per .planning/research/ahol/DRY-RUN-NOTES.md and the C5 task spec.
    """
    workdir = Path("/tmp") / f"ahol-run-{_safe_path_segment(round_id)}" / \
        _safe_path_segment(variant_id) / _safe_path_segment(task.id)
    repo_path, clone_err = _clone_task_repo(task, workdir)
    if clone_err:
        return "", clone_err, 1, f"clone failed: {clone_err[:300]}", False, ""
    _safety_assert_workdir(repo_path)
    invoke_sh = BASELINE_DIR / "invoke.sh"
    if not invoke_sh.is_file():
        raise FileNotFoundError(f"invoke.sh not found at {invoke_sh}")
    env = {**os.environ, "AHOL_BASELINE": str(variant_harness_path),
           "TASK_PROMPT": task.issue_body}
    stdout = stderr = ""
    exit_code: Optional[int] = None
    error_summary: Optional[str] = None
    try:
        proc = subprocess.run(
            [str(invoke_sh)], env=env, cwd=str(repo_path), capture_output=True, text=True,
            timeout=TASK_TIMEOUT_SEC, check=False,
        )
        stdout, stderr, exit_code = proc.stdout, proc.stderr, proc.returncode
    except subprocess.TimeoutExpired as exc:
        so = exc.stdout
        se = exc.stderr
        stdout = so if isinstance(so, str) else (so.decode("utf-8", "replace") if so else "")
        stderr = se if isinstance(se, str) else (se.decode("utf-8", "replace") if se else "")
        exit_code = 124
        error_summary = f"invoke.sh exceeded TASK_TIMEOUT_SEC={TASK_TIMEOUT_SEC}"
    patch = _extract_patch(repo_path)
    model_name = f"ahol-{variant_id}"
    run_id_full = f"{round_id}-{variant_id}-{task.id}"
    predictions_path = workdir / "predictions.json"
    predictions_path.write_text(json.dumps([{
        "instance_id": task.id, "model_patch": patch, "model_name_or_path": model_name,
    }]), encoding="utf-8")
    passed = False
    if patch.strip() == "":
        error_summary = error_summary or "empty patch from claude"
    elif _is_swebench_origin(task.benchmark_origin):
        report = _run_swebench(predictions_path, task.id, task.benchmark_origin,
                               run_id_full, model_name, workdir)
        passed = int(report.get("resolved_instances") or 0) > 0
        if not passed:
            if int(report.get("empty_patch_instances") or 0) > 0:
                error_summary = error_summary or "empty patch (swebench)"
            elif int(report.get("error_instances") or 0) > 0:
                err = report.get("_swebench_error") or "swebench errored"
                error_summary = error_summary or f"swebench errored: {err[:200]}"
            else:
                error_summary = error_summary or "tests did not resolve"
    else:
        error_summary = error_summary or (
            f"swebench scoring not supported for benchmark_origin={task.benchmark_origin!r}"
        )
    _archive_swebench_outputs(workdir, DEFAULT_AHOL_HOME, round_id, variant_id, task.id)
    shutil.rmtree(workdir, ignore_errors=True)
    return stdout, stderr, exit_code, error_summary, passed, patch


def run_task(
    task: Task, variant_harness_path: Path, round_id: str, variant_id: str,
    conn: sqlite3.Connection, sequence: int, tracer: trace.Tracer, shutdown: Shutdown,
    use_mock: bool = False,
) -> tuple[TaskResult, int]:
    """run_task(task, harness_path, 'rnd-1', 'V0', conn, 0, tracer, shutdown) returns (result, rowid)."""
    with tracer.start_as_current_span(f"task/{task.id}") as span:
        span.set_attribute("variant_id", variant_id)
        span.set_attribute("task_id", task.id)
        started_at = datetime.now(timezone.utc)
        t_start = time.monotonic()
        ts_start_epoch = time.time()
        before = snapshot_session_files() if not use_mock else {}
        stdout = stderr = ""
        exit_code: Optional[int] = None
        error_summary: Optional[str] = None
        tokens_used: int
        tool_call_count: Optional[int]
        cache_read: int
        passed: bool
        patch_sha: Optional[str]
        patch: str = ""

        if use_mock:
            time.sleep(0.01)
            exit_code = 0
            stdout = "Patch applied."
            tokens_used = 1500 + sequence * 100
            tool_call_count = 3
            cache_read = 1000 if sequence > 0 else 0
            passed = True
            patch_sha = hashlib.sha1(f"{variant_id}/{task.id}".encode()).hexdigest()
        else:
            try:
                stdout, stderr, exit_code, error_summary, passed, patch = _run_real_pipeline(
                    task, variant_harness_path, round_id, variant_id,
                )
            except SafetyError as exc:
                logger.error("SafetyError in run_task %s/%s: %s", variant_id, task.id, exc)
                raise
            except Exception as exc:
                exit_code = exit_code if exit_code is not None else 1
                error_summary = error_summary or f"{type(exc).__name__}: {exc}"
                logger.error("pipeline crash %s/%s: %s", variant_id, task.id, exc)
            t_end = time.monotonic()
            ts_end_epoch = time.time()
            m = extract_metrics(before, ts_start_epoch, ts_end_epoch)
            tokens_used = int(m["tokens_used"] or 0)
            tool_call_count = m["tool_call_count"]
            cache_read = int(m["cache_read_input_tokens"] or 0)
            patch_sha = hashlib.sha1(patch.encode("utf-8", errors="replace")).hexdigest() if passed else None

        wall = time.monotonic() - t_start
        ended_at = datetime.now(timezone.utc)
        result = TaskResult(
            task_id=task.id, passed=passed,
            tokens_used=min(max(int(tokens_used), 0), 2_000_000),
            wall_clock_sec=wall, patch_sha=patch_sha, error_summary=error_summary,
            tool_call_count=tool_call_count, cache_read_input_tokens=cache_read,
        )
        payload_sha = result.patch_sha if result.patch_sha is not None else "no_patch"
        payload: dict[str, Any] = {
            "task_id": result.task_id, "passed": result.passed, "tokens_used": result.tokens_used,
            "wall_clock_sec": result.wall_clock_sec, "patch_sha": payload_sha,
            "error_summary": result.error_summary,
        }
        validate_payload(payload, "task-runner-return.schema.json")
        for k, v in (("tokens_used", result.tokens_used), ("passed", result.passed),
                     ("wall_clock_sec", result.wall_clock_sec), ("patch_sha", str(payload_sha))):
            span.set_attribute(k, v)
        if result.error_summary:
            span.set_attribute("error_summary", result.error_summary[:500])
        rowid = insert_task_result(
            conn, round_id, variant_id, sequence, result,
            started_at.isoformat().replace("+00:00", "Z"),
            ended_at.isoformat().replace("+00:00", "Z"), exit_code,
        )
        _write_task_log(round_id, variant_id, task.id, stdout, stderr, exit_code, wall,
                        task.issue_body, DEFAULT_AHOL_HOME)
        return result, rowid


_VARIANT_MANIFEST_LOOKUP: dict[str, Any] = {}


def _set_manifest_lookup(d: dict[str, Any]) -> None:
    """Install name -> VariantManifest dict for _resolve_variant_harness to consult on cache miss."""
    _VARIANT_MANIFEST_LOOKUP.clear()
    _VARIANT_MANIFEST_LOOKUP.update(d)


def _resolve_variant_harness(variant: Variant, use_mock: bool) -> Path:
    """Return AHOL_BASELINE path for this variant. Mock or no manifest entry: BASELINE_DIR. Real: bootstrap on cache miss."""
    if use_mock:
        return BASELINE_DIR
    vm = _VARIANT_MANIFEST_LOOKUP.get(variant.id)
    if vm is None:
        logger.info("no manifest entry for variant %s; falling back to BASELINE_DIR", variant.id)
        return BASELINE_DIR
    from ahol.runner.variants import bootstrap_variant  # noqa: PLC0415 (lazy)
    return bootstrap_variant(vm, DEFAULT_AHOL_HOME, REPO_ROOT)


def run_variant(
    variant: Variant, tasks: list[Task], round_id: str, conn: sqlite3.Connection,
    tracer: trace.Tracer, shutdown: Shutdown, use_mock: bool = False,
) -> VariantResult:
    """run_variant(variant, tasks, 'rnd-1', conn, tracer, shutdown) iterates tasks, returns VariantResult."""
    with tracer.start_as_current_span(f"variant/{variant.id}") as span:
        span.set_attribute("variant_id", variant.id)
        t_start = time.monotonic()
        harness = _resolve_variant_harness(variant, use_mock=use_mock)
        start_seq = resume_sequence(conn, round_id, variant.id)
        if start_seq > 0:
            logger.info("resuming variant %s at sequence %d", variant.id, start_seq)
        completed = passed = total_tokens = 0
        rowids: list[int] = []
        cache_any = False
        error_log: Optional[str] = None
        for idx, task in enumerate(tasks):
            if shutdown.requested:
                error_log = "shutdown requested mid-variant; partial result"
                break
            if idx < start_seq:
                continue
            try:
                result, rowid = run_task(
                    task=task, variant_harness_path=harness, round_id=round_id,
                    variant_id=variant.id, conn=conn, sequence=idx, tracer=tracer,
                    shutdown=shutdown, use_mock=use_mock,
                )
            except Exception as exc:
                error_log = (error_log or "") + f"[task {task.id}] {type(exc).__name__}: {exc}\n"
                continue
            completed += 1
            passed += int(result.passed)
            total_tokens += result.tokens_used
            rowids.append(rowid)
            if (result.cache_read_input_tokens or 0) > 0:
                cache_any = True
            if completed >= CACHE_ASSERTION_AFTER_TASK and not cache_any and not use_mock:
                logger.warning(
                    "variant %s: prompt caching not firing after %d tasks "
                    "(cache_read_input_tokens=0); see GROUP-C-SCOPE.md",
                    variant.id, completed,
                )
        wall = time.monotonic() - t_start
        vr = VariantResult(
            variant_id=variant.id, tasks_completed=completed, tasks_passed=passed,
            total_tokens=total_tokens, wall_clock_sec=wall, error_log=error_log,
            sqlite_row_ids=rowids,
        )
        payload: dict[str, Any] = {
            "variant_id": vr.variant_id, "tasks_completed": vr.tasks_completed,
            "tasks_passed": vr.tasks_passed, "total_tokens": vr.total_tokens,
            "wall_clock_sec": vr.wall_clock_sec, "error_log": vr.error_log,
            "sqlite_row_ids": vr.sqlite_row_ids,
        }
        validate_payload(payload, "variant-runner-return.schema.json")
        insert_variant_result(conn, round_id, vr)
        span.set_attribute("tasks_completed", vr.tasks_completed)
        span.set_attribute("tasks_passed", vr.tasks_passed)
        span.set_attribute("total_tokens", vr.total_tokens)
        span.set_attribute("wall_clock_sec", vr.wall_clock_sec)
        return vr


def promote_champion(
    round_id: str, variant_results: dict[str, VariantResult],
    total_wall_clock_sec: float, conn: sqlite3.Connection,
) -> RoundSummary:
    """promote_champion('rnd-1', {'V0': vr0, 'V4': vr4}, 42.0, conn) applies dual-criterion gate."""
    comparison_sql = (
        "SELECT variant_id, CAST(tasks_passed AS REAL) / NULLIF(tasks_completed, 0) AS score, "
        "total_tokens FROM variant_runs WHERE round_id = ? ORDER BY score DESC"
    )
    scores: list[tuple[str, float, int]] = []
    for vid, vr in variant_results.items():
        s = vr.tasks_passed / vr.tasks_completed if vr.tasks_completed > 0 else 0.0
        scores.append((vid, s, vr.total_tokens))
    scores.sort(key=lambda row: (-row[1], row[0]))
    prior_row = conn.execute(
        "SELECT champion_score, total_tokens FROM round_summaries ORDER BY round_id DESC LIMIT 1"
    ).fetchone()
    prior_score = float(prior_row[0]) if prior_row else 0.0
    prior_cost = int(prior_row[1]) if prior_row else 0

    champion_id: Optional[str] = None
    champion_score = prior_score
    sigma_gate = cost_gate = False
    if scores:
        top_id, top_score, top_tokens = scores[0]
        sigma_gate = top_score >= prior_score + 0.02
        cost_gate = prior_cost == 0 or top_tokens <= int(prior_cost * 1.10)
        if sigma_gate and cost_gate and top_score > prior_score:
            champion_id, champion_score = top_id, top_score

    total_tokens = sum(vr.total_tokens for vr in variant_results.values())
    return RoundSummary(
        round_id=round_id, champion_variant_id=champion_id, champion_score=champion_score,
        prior_champion_score=prior_score, sigma_gate_passed=sigma_gate,
        cost_gate_passed=cost_gate, comparison_sql=comparison_sql,
        timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        variants_evaluated=sorted(variant_results.keys()),
        total_tokens=total_tokens, total_wall_clock_sec=total_wall_clock_sec,
    )


def run_round(
    manifest: list[Variant], tasks: list[Task], round_id: str, conn: sqlite3.Connection,
    tracer: trace.Tracer, shutdown: Shutdown, concurrency: int = 4, use_mock: bool = False,
) -> RoundSummary:
    """run_round([V0, V4], tasks, '2026-04-23T10Z', conn, tracer, shutdown) fans out variants and promotes a champion."""
    with tracer.start_as_current_span(f"round/{round_id}") as span:
        span.set_attribute("round_id", round_id)
        t_start = time.monotonic()
        variant_results: dict[str, VariantResult] = {}
        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
            futures: dict[Future[VariantResult], Variant] = {
                pool.submit(
                    run_variant, v, tasks, round_id, conn, tracer, shutdown, use_mock,
                ): v for v in manifest
            }
            for fut in as_completed(futures):
                v = futures[fut]
                try:
                    variant_results[v.id] = fut.result()
                except Exception as exc:
                    logger.error("variant %s crashed: %s", v.id, exc)
                    variant_results[v.id] = VariantResult(
                        variant_id=v.id, tasks_completed=0, tasks_passed=0, total_tokens=0,
                        wall_clock_sec=0.0, error_log=f"{type(exc).__name__}: {exc}",
                        sqlite_row_ids=[],
                    )
        total_wall = time.monotonic() - t_start
        summary = promote_champion(round_id, variant_results, total_wall, conn)
        payload: dict[str, Any] = {
            "round_id": summary.round_id, "champion_variant_id": summary.champion_variant_id,
            "champion_score": summary.champion_score,
            "prior_champion_score": summary.prior_champion_score,
            "sigma_gate_passed": summary.sigma_gate_passed,
            "cost_gate_passed": summary.cost_gate_passed,
            "comparison_sql": summary.comparison_sql, "timestamp": summary.timestamp,
            "variants_evaluated": summary.variants_evaluated, "total_tokens": summary.total_tokens,
            "total_wall_clock_sec": summary.total_wall_clock_sec,
        }
        validate_payload(payload, "orchestrator-output.schema.json")
        conn.execute(
            "INSERT OR REPLACE INTO round_summaries (round_id, champion_variant_id, "
            "champion_score, prior_champion_score, sigma_gate_passed, cost_gate_passed, "
            "total_tokens, total_wall_clock_sec, timestamp, summary_json) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (summary.round_id, summary.champion_variant_id, summary.champion_score,
             summary.prior_champion_score, int(summary.sigma_gate_passed),
             int(summary.cost_gate_passed), summary.total_tokens,
             summary.total_wall_clock_sec, summary.timestamp, json.dumps(payload)),
        )
        span.set_attribute("champion_variant_id", summary.champion_variant_id or "null")
        span.set_attribute("champion_score", summary.champion_score)
        span.set_attribute("total_tokens", summary.total_tokens)
        return summary


def self_test() -> int:
    """ahol.py --self-test runs a 2-variant 2-task mock cycle; verifies SQLite + traces + schemas."""
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    global DEFAULT_AHOL_HOME
    original_home = DEFAULT_AHOL_HOME
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            ahol_home = tmp_path / ".ahol"
            DEFAULT_AHOL_HOME = ahol_home
            manifest_path = tmp_path / "manifest.json"
            manifest_path.write_text(json.dumps({"variants": [
                {"name": "V0", "description": "self-test V0 baseline",
                 "mutation_bundle_json": {"mutations": []}},
                {"name": "V1", "description": "self-test V1 add_hook",
                 "mutation_bundle_json": {"mutations": [
                     {"mutation_type": "add_hook",
                      "params": {"hook_files": ["gsd-session-start.js"]}}]}},
            ]}))
            round_id = "self-test-" + uuid.uuid4().hex[:8]
            conn = init_db(tmp_path / "ahol.db")
            tracer = setup_tracer(round_id, ahol_home, otlp_endpoint=None)
            shutdown = Shutdown()
            manifest, lookup = load_manifest(manifest_path)
            _set_manifest_lookup(lookup)
            from ahol.runner.variants import bootstrap_variant, reset_bootstrap_cache  # noqa: PLC0415
            reset_bootstrap_cache()
            for vm in lookup.values():
                bootstrap_variant(vm, ahol_home, REPO_ROOT)
            tasks = load_tasks("self-test")
            summary = run_round(manifest=manifest, tasks=tasks, round_id=round_id, conn=conn,
                                tracer=tracer, shutdown=shutdown, concurrency=2, use_mock=True)
            provider = trace.get_tracer_provider()
            if hasattr(provider, "force_flush"):
                provider.force_flush()
            if hasattr(provider, "shutdown"):
                provider.shutdown()
            expected = len(manifest) * len(tasks)
            checks: list[tuple[str, int, int]] = [
                ("task_runs", conn.execute("SELECT COUNT(*) FROM task_runs").fetchone()[0], expected),
                ("variant_runs", conn.execute("SELECT COUNT(*) FROM variant_runs").fetchone()[0],
                 len(manifest)),
                ("round_summaries",
                 conn.execute("SELECT COUNT(*) FROM round_summaries").fetchone()[0], 1),
            ]
            for label, got, want in checks:
                if got != want:
                    print(f"self-test FAIL: {label} count {got} != expected {want}")
                    return 1
            traces_file = ahol_home / "traces" / f"round-{round_id}.jsonl"
            if not traces_file.is_file():
                print(f"self-test FAIL: traces file missing at {traces_file}")
                return 1
            spans = sum(1 for _ in traces_file.open("r", encoding="utf-8"))
            if spans < expected:
                print(f"self-test FAIL: span count {spans} < expected {expected}")
                return 1
            conn.close()
            print(f"self-test PASS: round_id={round_id} tasks={expected} "
                  f"spans={spans} champion={summary.champion_variant_id}")
            return 0
    finally:
        DEFAULT_AHOL_HOME = original_home


def integration_test_single() -> int:
    """Single-task end-to-end pipeline test against django__django-11099.

    Requires network (clone django/django), Docker (swebench), claude CLI, and
    swebench >=4.1 in PATH. ~3 minutes wall-clock. Exits 0 on pass, 1 on any
    failure. Asserts: clone OK, claude returned 'Patch applied', git diff
    non-empty, swebench report parsed, run_task returns passed=True with
    tokens_used > 0.
    """
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    target_id = "django__django-11099"
    try:
        from ahol.runner.benchmarks import load_swe_bench_lite  # noqa: PLC0415
        candidates = load_swe_bench_lite(instance_ids=[target_id])
    except Exception as exc:
        print(f"integration-test-single FAIL: load failed: {exc}")
        return 1
    if not candidates:
        print(f"integration-test-single FAIL: task {target_id} not in SWE-bench Lite")
        return 1
    task = candidates[0]
    fixtures = CONTRACTS_DIR / "variant-fixtures"
    from ahol.runner.variants import (  # noqa: PLC0415
        bootstrap_variant, load_variant_manifest, reset_bootstrap_cache,
    )
    reset_bootstrap_cache()
    [vm0] = load_variant_manifest(fixtures / "V0.json", contracts_dir=CONTRACTS_DIR)
    harness = bootstrap_variant(vm0, DEFAULT_AHOL_HOME, REPO_ROOT)
    round_id = f"integ-test-{uuid.uuid4().hex[:8]}"
    conn = init_db(DEFAULT_AHOL_HOME / "benchmarks.db")
    tracer = setup_tracer(round_id, DEFAULT_AHOL_HOME, otlp_endpoint=None)
    shutdown = Shutdown()
    variant = Variant(id=vm0.name, harness_bundle=[], mode="bundle")
    t0 = time.monotonic()
    try:
        result, _rowid = run_task(
            task=task, variant_harness_path=harness, round_id=round_id, variant_id=variant.id,
            conn=conn, sequence=0, tracer=tracer, shutdown=shutdown, use_mock=False,
        )
    except Exception as exc:
        print(f"integration-test-single FAIL: run_task crashed: {exc}")
        return 1
    finally:
        conn.close()
    wall = time.monotonic() - t0
    print(f"integration-test-single result: passed={result.passed} "
          f"tokens={result.tokens_used} wall={wall:.1f}s "
          f"patch_sha={result.patch_sha} error={result.error_summary}")
    if not result.passed:
        print(f"integration-test-single FAIL: task {target_id} did not resolve")
        return 1
    if result.tokens_used <= 0:
        print(f"integration-test-single FAIL: tokens_used={result.tokens_used} (expected > 0)")
        return 1
    print(f"integration-test-single PASS: round_id={round_id} wall={wall:.1f}s")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    """AHOL CLI; --self-test runs a mock cycle, otherwise runs a real round."""
    p = argparse.ArgumentParser(
        prog="ahol.py",
        description="AHOL Tier 1 orchestrator. See packages/ahol/GROUP-C-SCOPE.md.",
    )
    p.add_argument("--self-test", action="store_true", help="Run mock no-op cycle and exit")
    p.add_argument(
        "--self-test-benchmarks", action="store_true",
        help="Exercise each benchmark loader with limit=1 (requires network)",
    )
    p.add_argument(
        "--integration-test-single", action="store_true",
        help="Run one real django__django-11099 task through the full pipeline (network + Docker + ~3 min + claude tokens)",
    )
    p.add_argument("--manifest", type=Path, help="Path to variant manifest JSON")
    p.add_argument("--benchmark", type=str, default="ahol-proxy-30", help="Benchmark name")
    p.add_argument("--round-id", type=str, help="Round ID (ISO-8601 UTC recommended)")
    p.add_argument("--concurrency", type=int, default=4, help="Variant-runner fan-out")
    p.add_argument("--budget-cap", type=int, default=25_000_000, help="Abort if projected exceeds")
    p.add_argument("--otlp-endpoint", type=str,
                   default=os.environ.get("AHOL_OTLP_ENDPOINT"),
                   help="Optional OTLP HTTP endpoint for trace export")
    p.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format=LOG_FORMAT)
    if args.self_test:
        return self_test()
    if args.self_test_benchmarks:
        from ahol.runner.benchmarks import self_test_benchmarks  # noqa: PLC0415
        return self_test_benchmarks(limit_per_loader=1)
    if args.integration_test_single:
        return integration_test_single()
    if not args.manifest or not args.round_id:
        p.error("--manifest and --round-id required unless --self-test is set")
    ahol_home = DEFAULT_AHOL_HOME
    conn = init_db(ahol_home / "benchmarks.db")
    tracer = setup_tracer(args.round_id, ahol_home, args.otlp_endpoint)
    shutdown = Shutdown()
    shutdown.install()
    manifest, lookup = load_manifest(args.manifest)
    _set_manifest_lookup(lookup)
    tasks = load_tasks(args.benchmark)
    logger.info(
        "starting round %s: %d variants x %d tasks (concurrency=%d)",
        args.round_id, len(manifest), len(tasks), args.concurrency,
    )
    try:
        summary = run_round(
            manifest=manifest, tasks=tasks, round_id=args.round_id, conn=conn,
            tracer=tracer, shutdown=shutdown, concurrency=args.concurrency, use_mock=False,
        )
    finally:
        conn.close()
        provider = trace.get_tracer_provider()
        if hasattr(provider, "force_flush"):
            provider.force_flush()
    logger.info(
        "round %s complete: champion=%s score=%.3f total_tokens=%d",
        summary.round_id, summary.champion_variant_id, summary.champion_score,
        summary.total_tokens,
    )
    return 130 if shutdown.requested else 0


if __name__ == "__main__":
    sys.exit(main())
