# C6 V0 vs V4 Spike Pre-Flight Blockers

Captured: 2026-04-23

C6 spike was halted at pre-flight. Per the C6 task instruction:
> "If any pre-flight fails: stop, write
> .planning/research/ahol/PRE-FLIGHT-BLOCKERS.md documenting what failed and
> how to fix, do NOT proceed to the spike run."

This document records the failures so the next session (or a human operator)
can resolve them before retrying.

## Pre-flight result matrix

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `docker ps` returns OK | PASS | Daemon reachable, exit 0. |
| 2 | `bootstrap.sh` validates clean target | PASS | "bootstrapped OK" in temp target. |
| 3 | `ahol.py --self-test` under 15s | PASS | 2.35s wall-clock, champion=V0. |
| 4 | Benchmark loaders cached, return tasks under 60s each | PASS | swe-bench-lite=1.1s, swe-bench-live=6.5s, ahol-proxy-15=1.5s; total 9.12s. |
| 5 | At least 30 GB free for Docker images | **FAIL (soft)** | 24 GB free on `/System/Volumes/Data` (host disk Docker draws from). 6 GB shy of the 30 GB spec. |
| 6 | `claude --print --model opus` returns echo under 30s | PASS | 10.69s, returned "preflight-ok". |

Pre-flight 1 through 4 and 6 pass cleanly. Pre-flight 5 is borderline. The
hard blockers are not in this matrix; they are in the spike-execution layer
and were uncovered while validating that the manifest plan was runnable.

## Hard blockers (spike-execution layer)

### Blocker A: no per-task Docker container isolation

**Spec assumption** (from the C6 prompt):
> "Docker containers active: `docker ps | grep sweb | wc -l` should show
> active per-task containers"

**Reality** (verified by `grep -rn "docker\|swebench" packages/ahol/`):
ahol.py contains zero references to docker, swebench, run_evaluation,
run_instance, or any container orchestration primitive. `run_task` is:

```python
proc = subprocess.run([str(invoke_sh)], env=env, capture_output=True,
                       text=True, timeout=TASK_TIMEOUT_SEC, check=False)
```

That spawns `packages/ahol/baseline/invoke.sh` as a subprocess on the host,
which runs `claude --print` directly. There is no container, no isolation,
no per-task workspace.

**Why this is a safety blocker, not just a measurement blocker**: Claude is
invoked with the Edit tool enabled (Write is disallowed; Read, Bash, Edit
are allowed per the Q1b template). With no isolation, every Edit call lands
on the donnyclaude repo's host filesystem. Across 15 tasks x 2 variants =
30 Claude invocations, each tasked with "fix this Django/SymPy/etc. issue,"
the model will attempt to Edit files that do not exist (the issue references
upstream repos, but the host CWD is donnyclaude) and may successfully Edit
unrelated donnyclaude files in pursuit of a plausible-looking patch.

**Fix path** (estimated 1 to 3 days of new work):
- Implement `invoke-task.sh` per the original GROUP-C-SCOPE.md design (the
  C1 deviation conflated it into invoke.sh + ahol.py; C6 needs the
  container-isolated version).
- Pull or build per-task base images (SWE-bench publishes
  `sweb.eval.x86_64.{instance_id}` images for the SWE-bench Verified set;
  HAL Verified Mini and BigCodeBench-Hard need their own image strategy).
- Mount a per-task scratch dir as the container's CWD; pass the issue body
  via env or stdin; run `claude --print` inside the container.
- Extract the resulting patch via `git diff` inside the container before
  teardown.
- Commit cleanup discipline: `docker rm -f ahol-variant-V*-*` between tasks
  per the spike-results.md naming convention.

### Blocker B: no upstream-repo checkout per task

**Spec assumption**: each Task has `repo` and `base_commit` (validated by
task.schema.json). The model is supposed to read and edit code at that
commit.

**Reality**: ahol.py never clones, fetches, or checks out anything. The Task
fields exist as data; nothing consumes them. The `cwd=` argument is not
passed to the subprocess.run that invokes `invoke.sh`, so the model
inherits the host CWD (the donnyclaude repo).

**Fix path**: tied to Blocker A. The container approach naturally solves
this because the SWE-bench eval images already have the source tree at the
correct commit baked in. For non-SWE-bench tasks (BigCodeBench-Hard), build
a minimal scratch dir per task.

### Blocker C: no swebench scoring harness

**Spec assumption** (from the C6 prompt):
> "scores each task via swebench"

And:
> "Per-task detail table: ... patch_size_bytes, error_summary if any"

**Reality**: The `passed` field in `TaskResult` is computed in run_task as:

```python
passed = exit_code == 0 and "Patch applied" in stdout
```

That is a string match on the model's final message, not a verification
that the produced patch makes the hidden test suite pass. Every task where
the model says "Patch applied." (which the system prompt explicitly
instructs it to say) gets passed=True regardless of whether the patch
actually fixes the issue. Tasks where the model produces a correct patch
but says something else get passed=False. The metric has no relationship
to ground truth.

**Fix path**:
- For SWE-bench Verified subset (10 of the 15 AHOL-Proxy-15 tasks): adopt
  the official `swebench` Python harness (`pip install swebench`) and call
  `run_evaluation` against the predictions JSONL produced by the round.
  Run inside the existing SWE-bench eval images.
- For BigCodeBench-Hard subset (5 of 15): use the BCB harness'
  test-execution path against the produced patch.
- Wire the actual pass/fail back into the TaskResult before SQLite write.

### Blocker D: disk space at 24 GB

Borderline. Host disk has 24 GB available; the 30 GB spec accounts for 15
SWE-bench eval images at roughly 1 to 3 GB each (some sharing of base
layers reduces effective bytes; pessimistic estimate is 15 to 30 GB).

**Fix path** (cheap):
- Free at least 6 to 10 GB on `/System/Volumes/Data` before retrying. Likely
  candidates: `~/Library/Caches/`, `~/Downloads/`, build artifacts.
- Or: configure Docker Desktop to use an external drive for its VM image
  (Docker Desktop Settings -> Resources -> Disk image location).
- Re-run pre-flight 5 after cleanup to confirm at least 30 GB free.

## What the C6 spike currently CAN measure

If the spike were run as-is (which would be a mistake; see Blocker A safety
note), the data captured would be:
- token consumption per (variant, task) pair (correctly captured via session
  file post-hoc parsing)
- wall-clock per task (correctly captured)
- whether the model said "Patch applied." (mislabeled as "passed")
- whether the harness invocation crashed (correctly captured as exit_code)

That is a token-cost x wall-clock dataset, not a pass/fail dataset. It
cannot answer the V0 vs V4 question the spike is designed to answer.

## What the C6 spike CANNOT measure on the current infra

- Whether V4's harness (full donnyclaude) actually produces patches that
  make hidden tests pass at a higher rate than V0's harness (bare baseline).
- Whether scope-expansion or premature-termination failures (Q1B Gates 3,
  4, 5) are happening; these gates require inspecting the patch and the
  filesystem state, not just the stdout string.
- Anything about how the harness behaves under realistic per-task isolation
  (the host-CWD invocation may succeed for trivial reasons that disappear
  in a clean container).

## Path forward

Two options:

### Option 1: implement Blockers A, B, C properly before C6 (recommended)

- New phase: C5b "container isolation + swebench scoring" before C6 runs.
- Estimated 2 to 4 days of focused work plus a separate small spike to
  validate the container path on 1 task before the full 15-task spike.
- Preserves the scientific validity of the V0 vs V4 comparison.

### Option 2: redefine C6 as a token-cost x wall-clock dry run

- Run the spike as-is, accepting that "passed" is a meaningless field.
- Use the dataset to characterize per-task token cost distribution and
  variance under V0 vs V4 harness load.
- Defer pass-rate measurement to C5b + C6'.
- Carries the safety risk that Claude will Edit donnyclaude files; mitigate
  by running with the donnyclaude repo on a disposable git branch or in a
  ramdisk copy.

Option 1 is recommended because the spike's purpose per spike-results.md is
to set the agenda (cut-mode vs grow-mode vs decompose) for everything
after, and a measurement with no ground-truth pass/fail cannot do that.

## Files referenced

- `packages/ahol/GROUP-C-SCOPE.md` (Tier 1/2/3 separation; invoke-task.sh
  spec that was deviated in C1)
- `.planning/research/ahol/spike-results.md` (decision tree the spike's
  verdict feeds)
- `.planning/research/ahol/REALITY-CHECK.md` (gskill 5-20pp effect size that
  motivates the comparison)
- `packages/ahol/CONTAMINATION-ANALYSIS.md` (three-tier separation; the V0
  vs V4 framing)
- `packages/ahol/baseline/VALIDATION-CHECKLIST.md` (Gates 1 through 5 that
  the current passed-string-match cannot evaluate)

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
