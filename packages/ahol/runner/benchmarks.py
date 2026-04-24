"""ahol.runner.benchmarks - dataset loaders for AHOL benchmarks.

Exports four public functions:
    load_swe_bench_lite(instance_ids=None, limit=None)
    load_swe_bench_live(date_window=None, limit=None)
    load_ahol_proxy_30(limit=None)        -- partial 15-task composite today
    validate_task(task)                   -- jsonschema validate a Task

Dispatch happens in ahol.load_tasks(benchmark_name, limit). See packages/ahol/
benchmarks/README.md for upstream dataset specs. Each loader is deterministic:
same args + same dataset version returns the same Task ordering (sorted by
instance_id). Each Task is validated against packages/ahol/contracts/
task.schema.json before return.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import jsonschema
from datasets import load_dataset  # type: ignore[import-untyped]

from ahol.runner.ahol import CONTRACTS_DIR, Task, load_schema

logger = logging.getLogger("ahol.benchmarks")

SWE_BENCH_LITE_DATASET = "princeton-nlp/SWE-bench_Lite"
SWE_BENCH_VERIFIED_DATASET = "princeton-nlp/SWE-bench_Verified"
SWE_BENCH_LIVE_DATASET_DEFAULT = "SWE-bench-Live/SWE-bench-Live"
BIGCODEBENCH_HARD_DATASET = "bigcode/bigcodebench-hard"
BIGCODEBENCH_HARD_SPLIT = "v0.1.4"

AHOL_CACHE_DIR: Path = Path.home() / ".cache" / "ahol" / "datasets"
TASK_SCHEMA_NAME = "task.schema.json"


def _synthetic_base_commit(task_id: str) -> str:
    """sha1(task_id) as a stable 40-char hex base_commit for benchmarks without a real commit pin."""
    return hashlib.sha1(task_id.encode("utf-8")).hexdigest()


def validate_task(task: Task) -> None:
    """validate_task(Task(id='django__django-11099', ...)) raises on schema violation."""
    payload: dict[str, Any] = {
        "instance_id": task.id,
        "problem_statement": task.issue_body,
        "repo": task.repo,
        "base_commit": task.base_commit,
    }
    schema = load_schema(TASK_SCHEMA_NAME)
    jsonschema.validate(instance=payload, schema=schema)


def _hf_load(dataset_name: str, split: Optional[str] = None, retries: int = 1) -> Any:
    """Load a HuggingFace dataset with one retry; raise with cache hint on failure."""
    attempt = 0
    last_exc: Optional[BaseException] = None
    while attempt <= retries:
        try:
            t0 = time.monotonic()
            ds = load_dataset(dataset_name, split=split) if split else load_dataset(dataset_name)
            logger.info(
                "loaded dataset %s (split=%s) in %.2fs", dataset_name, split, time.monotonic() - t0
            )
            return ds
        except Exception as exc:
            last_exc = exc
            attempt += 1
            logger.warning("dataset load failed (attempt %d): %s", attempt, exc)
    raise RuntimeError(
        f"failed to load dataset {dataset_name!r} (split={split!r}) after {retries + 1} attempts. "
        f"Check network and ~/.cache/huggingface/ + {AHOL_CACHE_DIR}. Root cause: {last_exc!r}"
    ) from last_exc


def _row_to_task_swe(row: dict[str, Any]) -> Task:
    """Map a SWE-bench-style row (instance_id, problem_statement, repo, base_commit) to Task."""
    return Task(
        id=str(row["instance_id"]),
        issue_body=str(row.get("problem_statement") or ""),
        repo=str(row.get("repo") or ""),
        base_commit=str(row.get("base_commit") or "0" * 40),
    )


def load_swe_bench_lite(
    instance_ids: Optional[list[str]] = None, limit: Optional[int] = None,
) -> list[Task]:
    """load_swe_bench_lite(limit=5) returns 5 Task objects from princeton-nlp/SWE-bench_Lite test split."""
    ds = _hf_load(SWE_BENCH_LITE_DATASET, split="test")
    id_filter = set(instance_ids) if instance_ids else None
    tasks: list[Task] = []
    for row in ds:
        if id_filter and str(row["instance_id"]) not in id_filter:
            continue
        tasks.append(_row_to_task_swe(dict(row)))
    tasks.sort(key=lambda t: t.id)
    if limit is not None:
        tasks = tasks[: max(0, limit)]
    for t in tasks:
        validate_task(t)
    logger.info("load_swe_bench_lite returned %d tasks", len(tasks))
    return tasks


def load_swe_bench_live(
    date_window: Optional[str] = None, limit: Optional[int] = None,
) -> list[Task]:
    """load_swe_bench_live(limit=5) returns 5 Task objects from the current rolling SWE-bench-Live.

    Dataset name is overridable via SWE_BENCH_LIVE_DATASET env var because the
    Microsoft Research SWE-bench-Live benchmark is rolling (new tasks added
    monthly) and the canonical name may change across releases.
    """
    ds_name = os.environ.get("SWE_BENCH_LIVE_DATASET", SWE_BENCH_LIVE_DATASET_DEFAULT)
    if date_window:
        logger.info("SWE-bench-Live date_window=%r (applied as post-load filter)", date_window)
    ds = _hf_load(ds_name, split="test")
    tasks: list[Task] = []
    for row in ds:
        tasks.append(_row_to_task_swe(dict(row)))
    tasks.sort(key=lambda t: t.id)
    if date_window:
        tasks = [t for t in tasks if date_window in t.id]
    if limit is not None:
        tasks = tasks[: max(0, limit)]
    for t in tasks:
        validate_task(t)
    logger.info("load_swe_bench_live returned %d tasks (dataset=%s)", len(tasks), ds_name)
    return tasks


def _load_hal_verified_mini(n: int = 10) -> list[Task]:
    """Return n Task objects drawn deterministically from princeton-nlp/SWE-bench_Verified.

    HAL SWE-bench Verified Mini is a hand-curated 50-task subset of Verified
    (published at mariushobbhahn/SWEBench-verified-mini). The canonical 50
    instance_ids are not published as a standalone HuggingFace dataset at time
    of writing, so this loader applies a deterministic stride across the full
    Verified test split to produce a Mini-equivalent slice. Override the
    selection by setting HAL_VERIFIED_MINI_IDS to a comma-separated ID list.
    """
    override = os.environ.get("HAL_VERIFIED_MINI_IDS")
    ds = _hf_load(SWE_BENCH_VERIFIED_DATASET, split="test")
    rows = sorted((dict(r) for r in ds), key=lambda r: r["instance_id"])
    picked: list[dict[str, Any]]
    if override:
        wanted = {x.strip() for x in override.split(",") if x.strip()}
        picked = [r for r in rows if r["instance_id"] in wanted][:n]
    else:
        stride = max(1, len(rows) // max(1, n))
        picked = rows[::stride][:n]
    return [_row_to_task_swe(r) for r in picked]


def _load_bigcodebench_hard(n: int = 5) -> list[Task]:
    """Return n Task objects from bigcode/bigcodebench-hard v0.1.4.

    BigCodeBench rows have (task_id, instruct_prompt, complete_prompt, test, ...).
    AHOL synthesizes repo='bigcode/bigcodebench-hard' and sha1(task_id) as the
    base_commit so every Task satisfies task.schema.json's 40-char hex regex.
    """
    ds = _hf_load(BIGCODEBENCH_HARD_DATASET, split=BIGCODEBENCH_HARD_SPLIT)
    rows = sorted((dict(r) for r in ds), key=lambda r: r["task_id"])
    stride = max(1, len(rows) // max(1, n))
    picked = rows[::stride][:n]
    tasks: list[Task] = []
    for r in picked:
        task_id = str(r["task_id"])
        body = str(r.get("instruct_prompt") or r.get("complete_prompt") or r.get("prompt") or "")
        tasks.append(
            Task(
                id=task_id,
                issue_body=body,
                repo="bigcode/bigcodebench-hard",
                base_commit=_synthetic_base_commit(task_id),
            )
        )
    return tasks


def load_ahol_proxy_30(limit: Optional[int] = None) -> list[Task]:
    """load_ahol_proxy_30() returns the weekly composite: 10 Verified-Mini + 5 BigCodeBench-Hard.

    The 15 Terminal-Bench-Core v0.1.1 slots specified in packages/ahol/
    benchmarks/README.md are DEFERRED. Terminal-Bench-Core ingestion requires
    building per-task Docker environments at load time, which is outside the
    scope of C2. Full 30-task composite lands in a later task. Current partial
    composite returns 15 tasks (10 + 5). The 'ahol-proxy-15' benchmark name
    alias resolves to this same loader.
    """
    logger.warning(
        "AHOL-Proxy-30 partial: Terminal-Bench-Core v0.1.1 (15 tasks) deferred; "
        "returning 15-task composite = 10 HAL-Verified-Mini + 5 BigCodeBench-Hard"
    )
    tasks: list[Task] = []
    tasks.extend(_load_hal_verified_mini(n=10))
    tasks.extend(_load_bigcodebench_hard(n=5))
    for t in tasks:
        validate_task(t)
    if limit is not None:
        tasks = tasks[: max(0, limit)]
    logger.info("load_ahol_proxy_30 returned %d tasks (partial composite)", len(tasks))
    return tasks


def self_test_benchmarks(limit_per_loader: int = 1) -> int:
    """Run each public loader with limit=1; return 0 on pass, 1 on any loader failure."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    overall_t0 = time.monotonic()
    failures: list[tuple[str, str]] = []
    passed: list[tuple[str, int, float]] = []
    cases: list[tuple[str, Any]] = [
        ("swe-bench-lite", lambda: load_swe_bench_lite(limit=limit_per_loader)),
        ("swe-bench-live", lambda: load_swe_bench_live(limit=limit_per_loader)),
        ("ahol-proxy-15", lambda: load_ahol_proxy_30(limit=limit_per_loader)),
    ]
    for name, fn in cases:
        case_t0 = time.monotonic()
        try:
            tasks = fn()
            if not tasks:
                failures.append((name, "loader returned 0 tasks"))
                continue
            for t in tasks:
                validate_task(t)
            passed.append((name, len(tasks), time.monotonic() - case_t0))
            logger.info("self-test-benchmarks %s OK (%d tasks)", name, len(tasks))
        except Exception as exc:
            failures.append((name, f"{type(exc).__name__}: {exc}"))
            logger.error("self-test-benchmarks %s FAIL: %s", name, exc)
    elapsed = time.monotonic() - overall_t0
    if failures:
        print(f"self-test-benchmarks FAIL ({len(failures)} of {len(cases)}):")
        for name, reason in failures:
            print(f"  {name}: {reason}")
        return 1
    print(
        f"self-test-benchmarks PASS: {len(passed)} loaders OK in {elapsed:.2f}s "
        f"(" + ", ".join(f"{n}={k} in {t:.1f}s" for n, k, t in passed) + ")"
    )
    return 0
