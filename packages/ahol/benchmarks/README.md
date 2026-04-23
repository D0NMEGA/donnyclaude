# AHOL Benchmarks

Target benchmarks for the AHOL (Autonomous Harness Optimization Loop) project. This document specifies the three evaluation suites AHOL uses to validate harness changes at three different cadences: weekly dev rounds, monthly fresh-task rounds, and quarterly champion validation.

## Cadence Overview

| Cadence | Benchmark | Purpose |
|---|---|---|
| Weekly | AHOL-Proxy-30 | Dev-round composite for rapid iteration |
| Monthly | SWE-bench-Live | Fresh-task, contamination-free evaluation |
| Quarterly | SWE-Bench Pro | Champion validation for shipped harness versions |

---

## 1. SWE-Bench Pro (Quarterly Champion Validation)

Large-scale professional SWE benchmark from Scale AI, used for quarterly validation of candidate champion harness configurations on the SEAL leaderboard.

- **Official repo**: https://github.com/scaleapi/SWE-bench_Pro-os
- **Dataset**: https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro
- **Leaderboard (public)**: https://labs.scale.com/leaderboard/swe_bench_pro_public
- **Leaderboard (private)**: https://labs.scale.com/leaderboard/swe_bench_pro_private
- **Docker image source**: Docker Hub, organization `jefzda`, repository `jefzda/sweap-images`. Per-instance tags are resolved via the `dockerhub_tag` column in the HuggingFace dataset.
- **Image pull size**: approximately 972 MB compressed per instance image (representative tag measurement). Multiply by instance count for total footprint; caching reuses base layers.
- **Pinned version SHA**: to be pinned before first spike run. Repo main branch at 73 commits, no formal release tags published. Pin both the GitHub repo HEAD SHA and the HuggingFace dataset revision before each quarterly run.
- **Per-task token budget target**: approximately 200K tokens per task for quarterly validation runs.
- **Task count**: 731 public instances across 11 GPL repositories. Full private dataset reports 1,865 human-verified tasks across 41 repositories; public set is the evaluation target here.
- **Approximate wall-clock duration per full run**: TBC. Long-horizon tasks with 250-turn SEAL cap imply a multi-hour to multi-day run depending on parallel worker count. Plan for a dedicated evaluation host or batch scheduler.

## 2. SWE-bench-Live (Monthly Fresh-Task Dev Rounds)

Live, continuously updated SWE benchmark from Microsoft Research (NeurIPS 2025 D&B), used for monthly fresh-task evaluation to detect contamination and measure generalization to recent issues.

- **Official repo**: https://github.com/microsoft/SWE-bench-Live
- **Leaderboard**: https://swe-bench-live.github.io/
- **Docker image source**: Docker Hub, user `starryzhang`. Per-instance image naming follows `starryzhang/sweb.eval.{arch}.{instance_id}` where `arch` is `x86_64` for Linux or `win` for Windows.
- **Image pull size**: TBC. Not documented by the authors. Expect per-instance images on the order of hundreds of MB based on comparable SWE-bench Docker setups.
- **Pinned version SHA**: to be pinned before first spike run. Latest notable release tag observed: `v1.0-multi-language-multi-os-benchmarking` (March 2026). Freeze the HEAD SHA of main plus the month-specific dataset snapshot at run time.
- **Per-task token budget target**: approximately 200K tokens per task for monthly runs.
- **Task count**: 1,890 issue-resolution tasks spanning 223 repositories as of recent release. The `lite` and `verified` splits are frozen for fair comparison; the `full` test split grows by approximately 50 newly verified issues per month.
- **Approximate wall-clock duration per full run**: TBC. Depends on split selected. A subset run (50 monthly new tasks plus the verified split) with 10 parallel workers is the expected AHOL monthly execution profile; plan on several hours of wall-clock.

## 3. AHOL-Proxy-30 (Weekly Dev-Round Composite)

Internal composite benchmark for rapid weekly harness iteration. Thirty tasks drawn from three upstream suites to balance shell-task realism, bug-fix realism, and algorithmic hard-subset coverage.

### Composition

| Slice | Upstream source | Task count |
|---|---|---|
| Terminal tasks | Terminal-Bench-Core v0.1.1 | 15 |
| Filtered bug fixes | HAL SWE-bench Verified Mini | 10 |
| Algorithmic hard subset | BigCodeBench-Hard | 5 |

### Composition Rationale

- **Terminal-Bench-Core v0.1.1** contributes real shell tasks. It targets terminal-native work (filesystem, package management, process orchestration) that pure issue-resolution benchmarks miss. 15 tasks gives the harness meaningful coverage of non-patch-style work.
- **HAL SWE-bench Verified Mini** contributes filtered-and-repaired bug fixes. The 50-task mini derivative is human-validated and storage-optimized (5 GB vs 130 GB for full Verified), so it keeps weekly-round friction low while preserving distributional fidelity. 10 tasks samples the mini pool without exhausting it.
- **BigCodeBench-Hard** contributes the algorithmic hard subset. 148 tasks in the upstream hard split stress reasoning-heavy library-API composition problems that shell and patch benchmarks do not exercise. 5 tasks keeps the slice tight while still surfacing algorithmic regressions.

### Upstream Sources

**Terminal-Bench-Core v0.1.1**
- Repo: https://github.com/laude-institute/terminal-bench
- Project site: https://www.tbench.ai/
- Docker image source: build-from-source. Each task ships a dedicated Docker environment built via the harness at run time; no single central prebuilt registry is documented for v0.1.1.
- Image pull size: TBC per task. Task environments vary; expect a few hundred MB per task image post-build.
- Pinned version: dataset version string `0.1.1` (invoked via `--dataset-name terminal-bench-core --dataset-version 0.1.1`). Commit SHA to be pinned before first spike run; the repo has no formal release tags published.
- Full upstream task count: approximately 80 tasks in the v0.1.1 core set.

**HAL SWE-bench Verified Mini**
- Leaderboard: https://hal.cs.princeton.edu/swebench_verified_mini
- Source repo: https://github.com/mariushobbhahn/SWEBench-verified-mini
- Base dataset: https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified
- Docker image source: Docker Hub / GHCR. Epoch AI maintains a prebuilt registry at `ghcr.io/epoch-research/swe-bench.eval.x86_64.{instance_id}` covering all 500 Verified instances; Mini uses a filtered 50-task subset of those images.
- Image pull size: approximately 5 GB total for the 50-task Mini subset (vs 130 GB for full Verified). Per-instance images are typically a few hundred MB.
- Pinned version SHA: to be pinned before first spike run. No formal release tags published on the Mini repo; 12 commits on main at snapshot time.
- Full upstream task count: 50 tasks.

**BigCodeBench-Hard**
- Repo: https://github.com/bigcode-project/bigcodebench
- Dataset: https://huggingface.co/datasets/bigcode/bigcodebench-hard
- Docker image source: Docker Hub, image `bigcodebench/bigcodebench-evaluate` (plus `bigcodebench/bigcodebench-generate` for generation). Single harness image covers all hard tasks.
- Image pull size: TBC. Not documented by the authors. Expect a single image on the order of 1 to 3 GB given the library footprint (sklearn, matplotlib, flask, pandas, seaborn, etc.).
- Pinned version SHA: dataset version `v0.1.4` on HuggingFace (148 tasks, latest hard subset revision observed). Pin harness at release `v0.2.4` (March 2025) or a later tagged release. Commit SHA to be pinned before first spike run.
- Full upstream task count: 148 tasks in the hard split.

### AHOL-Proxy-30 Budgets

- **V0 baseline (Q1b patch-only template)**: roughly 100K tokens per task. 30 tasks nominal target approximately 3M tokens per full round (floor case).
- **V4 full donnyclaude**: up to 500K tokens per task. 30 tasks ceiling approximately 15M tokens per full round.
- **Nominal target per variant**: 10M tokens per round (midpoint between V0 floor and V4 ceiling).
- **Cost per variant**: roughly $100 per round with prompt caching enabled at current pricing.

### Execution Pattern

- Full 30-task sequential run in one Docker context per variant.
- One Docker daemon session spans all 30 tasks to amortize image pulls and base-layer cache.
- Sequential execution (not parallel) per variant for token-accounting clarity and deterministic log ordering.
- Per-variant artifacts: task-level traces, aggregate scorecard, token-usage telemetry, wall-clock timing.

### Approximate Wall-Clock Duration per Full Run

- 30 tasks per variant, sequential.
- Rough estimate: 2 to 6 hours per variant per round depending on task mix, model latency, and retry behavior. TBC until first spike run calibrates.

---

## Open Items Before First Spike Run

1. Pin SWE-Bench Pro repo SHA and HuggingFace dataset revision.
2. Pin SWE-bench-Live repo SHA and monthly dataset snapshot.
3. Pin Terminal-Bench-Core v0.1.1 commit SHA and confirm Docker build profile.
4. Pin HAL SWE-bench Verified Mini subset SHA and confirm GHCR auth for Epoch AI image registry.
5. Pin BigCodeBench harness release tag and HuggingFace dataset revision.
6. Measure actual image pull sizes for SWE-bench-Live, Terminal-Bench-Core, and BigCodeBench-Hard to replace TBC entries.
7. Calibrate wall-clock duration estimates after the first end-to-end AHOL-Proxy-30 run.
