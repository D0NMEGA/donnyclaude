# AHOL Runner

Python Tier-1 orchestrator + Tier-2 variant-runner for AHOL. Tier-3 per-task
invocations shell out to `packages/ahol/baseline/invoke.sh` which calls
`claude --print`.

See `packages/ahol/GROUP-C-SCOPE.md` for full scope,
`packages/ahol/contracts/` for schemas, and
`packages/ahol/context-budgets.md` for the 15K-token Tier-3 target.

## Files

| File | Role |
|------|------|
| `ahol.py` | Tier-1 orchestrator. Entry point: `python3 packages/ahol/runner/ahol.py`. |
| `benchmarks.py` | Benchmark loaders invoked by `ahol.load_tasks()`. |
| `__init__.py`, `../__init__.py` | Namespace markers so the package is importable as `ahol.runner`. |
| `py.typed`, `../py.typed` | PEP 561 marker so mypy treats the package as typed. |
| `requirements.txt` | Runtime + dev dependencies. |

## Invocation

### Self-test (no network, no claude, no docker, under 3s)

```
python3 packages/ahol/runner/ahol.py --self-test
```

Mock round with 2 variants x 2 tasks. Exercises SQLite schema, OTel span
emission, schema validation, and shutdown paths.

### Self-test-benchmarks (network required, under 40s on a warm cache)

```
python3 packages/ahol/runner/ahol.py --self-test-benchmarks
```

Exercises `load_swe_bench_lite`, `load_swe_bench_live`, and
`load_ahol_proxy_30` with `limit=1`. Downloads the three upstream HuggingFace
datasets on first run; subsequent runs reuse the HF cache.

### Real round (future; gated on Group C Tasks C3 through C5)

```
python3 packages/ahol/runner/ahol.py \
  --manifest .ahol/manifest.json \
  --round-id 2026-04-30T00:00:00Z \
  --benchmark ahol-proxy-15 \
  --concurrency 2
```

## Benchmark dispatch

`ahol.load_tasks(benchmark_name, limit=None)` dispatches to:

| `benchmark_name` | Loader | Current size | Notes |
|------------------|--------|--------------|-------|
| `self-test` | canned mocks in `ahol.load_tasks` | 2 | no network |
| `swe-bench-lite` | `benchmarks.load_swe_bench_lite` | 300 tasks | `princeton-nlp/SWE-bench_Lite` test split |
| `swe-bench-live` | `benchmarks.load_swe_bench_live` | approximately 1,890 tasks (rolling) | override via `SWE_BENCH_LIVE_DATASET` env var |
| `ahol-proxy-30` | `benchmarks.load_ahol_proxy_30` | **15 tasks (partial)** | Terminal-Bench-Core 15 slots DEFERRED |
| `ahol-proxy-15` | `benchmarks.load_ahol_proxy_30` | 15 tasks | alias for the partial composite |

Unknown names raise `ValueError` with the full valid list.

## Expected dataset sizes and first-run download times

Measured on the 2018 MBP 16 GB dev host, warm HF cache at
`~/.cache/huggingface/` for SWE-bench_Lite and SWE-bench_Verified,
cold cache for SWE-bench-Live and bigcodebench-hard.

| Dataset | Tasks | Approx size | First-run time |
|---------|------:|-------------|----------------|
| `princeton-nlp/SWE-bench_Lite` | 300 | ~30 MB compressed | ~1 to 2s (cache warm), several seconds on cold pull |
| `SWE-bench-Live/SWE-bench-Live` | ~1,890 | ~250 MB compressed | ~25 to 30s cold |
| `princeton-nlp/SWE-bench_Verified` | 500 | ~50 MB compressed | ~2 to 5s |
| `bigcode/bigcodebench-hard` | 148 per split x 4 splits | ~20 MB | ~2s |

Total cold-pull budget: under 1 GB and under 1 minute on a reasonable network.

## Cache locations

| Path | Contents |
|------|----------|
| `~/.cache/huggingface/datasets/` | HuggingFace dataset cache (authoritative for all four datasets above). Respected by the `datasets` library by default. |
| `~/.cache/ahol/datasets/` | Reserved for AHOL-specific dataset derivatives (for example, resolved HAL Verified Mini instance lists). Currently unused; placeholder for future loader materialization. |
| `~/.claude/projects/<slug>/<uuid>.jsonl` | Claude Code session logs. `ahol.runner.ahol._extract_metrics` parses these post-hoc to recover per-task token counts and tool-call counts. |

## Deterministic ordering

Every loader sorts by `instance_id` before applying `limit`. Re-running any
loader with the same args on the same dataset revision returns the same Task
ordering. Tests and benchmark rounds can rely on this invariant.

## Schema

Every Task returned by every loader is validated against
`packages/ahol/contracts/task.schema.json` before return. The schema requires
`instance_id`, `problem_statement`, `repo`, and `base_commit` (40-char hex).
BigCodeBench-Hard tasks synthesize a `base_commit` as `sha1(task_id)` since
the benchmark has no real upstream commit.

## mypy

Run from `packages/` so the `ahol.runner` namespace resolves:

```
cd packages && PYTHONPATH=. python3 -m mypy --strict ahol/runner/ahol.py ahol/runner/benchmarks.py
```

Expected: `Success: no issues found in 2 source files`.

## Scope deviations (carried over from C1)

- `invoke-task.sh` conflated into `invoke.sh` + `ahol.py`; raw trace logging
  lives in `ahol._write_task_log` rather than a separate shell wrapper.
- `load_ahol_proxy_30` returns 15 tasks today (not 30). Terminal-Bench-Core
  v0.1.1 ingestion is deferred because per-task Docker environment building
  at load time is outside C2 scope. See spike-results.md for the C6 decision
  on whether 15 tasks suffices for the V0 vs V4 spike.
