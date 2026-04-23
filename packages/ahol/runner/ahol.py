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
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
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
    """Task(id='django__django-11099', issue_body='...', repo='django/django', base_commit='d26b...')."""

    id: str
    issue_body: str
    repo: str
    base_commit: str


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
    """extract_metrics(before_snap, t_start, t_end) aggregates over session files modified in window."""
    after = snapshot_session_files()
    candidates: set[Path] = set()
    for p, mt in after.items():
        if t_start - 2.0 <= mt <= t_end + 2.0 and (p not in before or mt > before[p]):
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


def load_manifest(path: Path) -> list[Variant]:
    """load_manifest(Path('manifest.json')) returns list[Variant] from a JSON array of entries."""
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError(f"manifest at {path} must be a JSON array")
    out: list[Variant] = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError(f"manifest entry not a dict: {entry!r}")
        vid = entry.get("id")
        if not isinstance(vid, str) or not vid:
            raise ValueError(f"manifest entry missing 'id': {entry!r}")
        bundle = entry.get("harness_bundle", [])
        if not isinstance(bundle, list):
            raise ValueError(f"'harness_bundle' must be a list: {entry!r}")
        mode = entry.get("mode", "baseline")
        if not isinstance(mode, str):
            raise ValueError(f"'mode' must be a string: {entry!r}")
        out.append(Variant(id=vid, harness_bundle=[str(x) for x in bundle], mode=mode))
    return out


def load_tasks(benchmark_name: str, limit: Optional[int] = None) -> list[Task]:
    """load_tasks('self-test') returns 2 canned mock tasks; other benchmarks are C2 scope."""
    if benchmark_name == "self-test":
        return [
            Task(id="self-test-task-01", issue_body="mock 01", repo="mock/repo",
                 base_commit="0" * 40),
            Task(id="self-test-task-02", issue_body="mock 02", repo="mock/repo",
                 base_commit="1" * 40),
        ]
    raise NotImplementedError(
        f"benchmark loader for {benchmark_name!r} is C2 scope; see packages/ahol/benchmarks/README.md"
    )


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
        before = snapshot_session_files() if not use_mock else {}
        stdout = stderr = ""
        exit_code: Optional[int] = None
        error_summary: Optional[str] = None
        tokens_used: int
        tool_call_count: Optional[int]
        cache_read: int
        passed: bool
        patch_sha: Optional[str]

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
            invoke_sh = BASELINE_DIR / "invoke.sh"
            if not invoke_sh.is_file():
                raise FileNotFoundError(f"invoke.sh not found at {invoke_sh}")
            env = {**os.environ, "AHOL_BASELINE": str(variant_harness_path),
                   "TASK_PROMPT": task.issue_body}
            try:
                proc = subprocess.run(
                    [str(invoke_sh)], env=env, capture_output=True, text=True,
                    timeout=TASK_TIMEOUT_SEC, check=False,
                )
                stdout = proc.stdout
                stderr = proc.stderr
                exit_code = proc.returncode
            except subprocess.TimeoutExpired as exc:
                so = exc.stdout
                se = exc.stderr
                stdout = so if isinstance(so, str) else (so.decode("utf-8", "replace") if so else "")
                stderr = se if isinstance(se, str) else (se.decode("utf-8", "replace") if se else "")
                exit_code = 124
                error_summary = f"invoke.sh exceeded TASK_TIMEOUT_SEC={TASK_TIMEOUT_SEC}"
            t_end = time.monotonic()
            m = extract_metrics(before, t_start, t_end)
            tokens_used = int(m["tokens_used"] or 0)
            tool_call_count = m["tool_call_count"]
            cache_read = int(m["cache_read_input_tokens"] or 0)
            passed = exit_code == 0 and "Patch applied" in stdout
            patch_sha = hashlib.sha1(stdout.encode(errors="replace")).hexdigest() if passed else None
            if exit_code != 0 and not error_summary:
                lines = stderr.strip().splitlines() or ["nonzero exit"]
                error_summary = lines[-1][:500]

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


def _resolve_variant_harness(variant: Variant, use_mock: bool) -> Path:
    """Return AHOL_BASELINE path for this variant. Mock: BASELINE_DIR. Real: variant worktree (C3)."""
    if use_mock:
        return BASELINE_DIR
    target = DEFAULT_AHOL_HOME / "worktrees" / f"variant-{variant.id}"
    if not target.is_dir():
        logger.info("variant harness not bootstrapped at %s; falling back to BASELINE_DIR", target)
        return BASELINE_DIR
    return target


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
            manifest_path.write_text(json.dumps([
                {"id": "V0", "harness_bundle": [], "mode": "baseline"},
                {"id": "variant-test-01", "harness_bundle": ["ws2"], "mode": "middleware"},
            ]))
            round_id = "self-test-" + uuid.uuid4().hex[:8]
            conn = init_db(tmp_path / "ahol.db")
            tracer = setup_tracer(round_id, ahol_home, otlp_endpoint=None)
            shutdown = Shutdown()
            manifest = load_manifest(manifest_path)
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


def main(argv: Optional[list[str]] = None) -> int:
    """AHOL CLI; --self-test runs a mock cycle, otherwise runs a real round."""
    p = argparse.ArgumentParser(
        prog="ahol.py",
        description="AHOL Tier 1 orchestrator. See packages/ahol/GROUP-C-SCOPE.md.",
    )
    p.add_argument("--self-test", action="store_true", help="Run mock no-op cycle and exit")
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
    if not args.manifest or not args.round_id:
        p.error("--manifest and --round-id required unless --self-test is set")
    ahol_home = DEFAULT_AHOL_HOME
    conn = init_db(ahol_home / "benchmarks.db")
    tracer = setup_tracer(args.round_id, ahol_home, args.otlp_endpoint)
    shutdown = Shutdown()
    shutdown.install()
    manifest = load_manifest(args.manifest)
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
