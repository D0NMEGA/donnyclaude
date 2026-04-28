# V0 variance characterization on AHOL-Proxy-15

**Round:** `variance-V0-x5-20260428-0422`
**Date:** 2026-04-28
**HEAD at run:** `93849f5` (Tracks 1+2 infra fixes pre-merged)
**Total wall-clock:** 4806.5s (~80 min) at concurrency=1
**Total tokens:** 10,862,899 (under 15M cap; Track 2 budget gate not triggered)
**Champion verdict:** none (no inter-rep delta exceeds the implicit gate; expected — they're all V0)

This round answered the open question after `53081a1`'s ablation: how much of the V0/V4 and V1/V2/V3 cross-variant deltas were real signal vs noise. Five repetitions of V0 against the same AHOL-Proxy-15 task set, no harness mutations, deterministic-by-construction except for whatever non-determinism Claude Code's loop introduces. Result: **inter-rep stddev = 0.447 tasks at n=10, with a single flaky task (django-13128, 4/5)**. The previous gate threshold of 2pp / 0.2 tasks is below the empirical noise floor by a factor of ~2.

## 1. Pre-flight summary

| Check | Status | Detail |
|---|---|---|
| Tracks 1+2 commit pushed | ✓ | `93849f5` → origin/main |
| Self-test passes | ✓ | `self-test-76ff4712`, 4 tasks 7 spans, champion V0 |
| Docker running | ✓ | 29.4.0 |
| Disk free | ⚠ | 36 GB at launch (above 25 GB minimum but tight); SWE-bench images already cached, no new pulls during run |
| Calibration cached | ✓ (re-run) | Prior `calibration-61d00be8` (Apr 24, HEAD ≤ `506d1ee`) was 4 days stale and HEAD changed (Tracks 1+2 landed). Re-ran per spec. New `calibration-ae407931` PASS at HEAD `93849f5`, 533s wall, V4 5/5 markers on each of 2 tasks. |
| Claude auth | ✓ | OAuth working without `--bare` (matches AHOL `invoke.sh` since `9c31479`) |

## 2. Round metadata

| Field | Value |
|---|---|
| round_id | `variance-V0-x5-20260428-0422` |
| Started (UTC) | 2026-04-28T09:23:02Z |
| Ended (UTC) | 2026-04-28T10:43:11Z |
| Wall-clock | 4806.5s (80.1 min) |
| Total tokens | 10,862,899 |
| Variants | 5 V0 reps (`variant-v0-rep-{a,b,c,d,e}`), all baseline mutation_bundle (zero mutations) |
| Benchmark | `ahol-proxy-15` (10 HAL-Verified-Mini SWE-bench + 5 BigCodeBench-Hard) |
| Concurrency | 1 (per spec) |
| Budget cap | 15,000,000 (now actually enforced via Track 2) |

## 3. Per-repetition pass count (10 SWE-bench scoreable tasks)

| Rep | tasks_passed | total_tokens | wall_s |
|---|---:|---:|---:|
| variant-v0-rep-a | 7 | 2,171,195 | 964.2 |
| variant-v0-rep-b | 8 | 1,839,181 | 929.4 |
| variant-v0-rep-c | 8 | 2,124,338 | 969.0 |
| variant-v0-rep-d | 8 | 2,301,257 | 972.2 |
| variant-v0-rep-e | 8 | 2,426,928 | 969.7 |

BCB tasks (5 each rep) all fast-fail at 0 tokens; not counted in pass-rate columns.

## 4. Per-task pass rate matrix (10 × 5)

| task_id | a | b | c | d | e | sum |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| astropy__astropy-12907 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| django__django-11477 | 0 | 0 | 0 | 0 | 0 | **0/5** |
| django__django-13128 | 0 | 1 | 1 | 1 | 1 | **4/5** ← flake |
| django__django-14349 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| django__django-15572 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| django__django-17087 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| pydata__xarray-3151 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| scikit-learn__scikit-learn-10844 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| sphinx-doc__sphinx-8120 | 1 | 1 | 1 | 1 | 1 | **5/5** |
| sympy__sympy-15599 | 0 | 0 | 0 | 0 | 0 | **0/5** |

7 tasks at 5/5, 2 tasks at 0/5, 1 task at 4/5.

## 5. Variance metrics

### Round-level pass count distribution

| metric | value |
|---|---:|
| mean | 7.80 tasks |
| sample stddev (n−1) | 0.447 tasks |
| population stddev | 0.400 tasks |
| coefficient of variation | 5.73% |
| min | 7 (V0a) |
| max | 8 (V0b/c/d/e) |
| range | 1 task |

### Per-task pass-rate distribution

- **Deterministic-pass (5/5):** 7 of 10 tasks (70%) — astropy, django-14349, django-15572, django-17087, xarray-3151, sklearn-10844, sphinx-8120
- **Deterministic-fail (0/5):** 2 of 10 tasks (20%) — django-11477, sympy-15599
- **Flaky (1≤p≤4 / 5):** 1 of 10 tasks (10%) — django-13128 at 4/5

The 0/5 tasks are NOT noise — they are reliably out of V0's reach. Reading the prior V0 retry spike's 9/10 number against this data: the prior result was n=1 measurement of a binary outcome, almost certainly the prior 9/10 was the outlier and the steady-state V0 pass rate on AHOL-Proxy-15 is closer to 7-8/10. (See §9 caveat on between-day shift.)

### Flaky tasks

Just one: **django__django-13128** at 4/5 (only V0a failed). This is the entire load-bearing source of round-level variance in this experiment.

## 6. Implication for AHOL gate threshold

| | Before this round | After this round |
|---|---|---|
| Threshold (% pass-rate) | 2pp | recommend 10pp |
| Threshold (tasks at n=10) | 0.2 | recommend **1 task** |
| Justification | placeholder from initial design | empirical 2σ ≈ 0.89, rounded up to 1 |

Per the spec: "Required threshold for 95% confidence at observed stddev: 2 × stddev rounded up to whole tasks." With sample stddev = 0.447, the 95% CI half-width is 0.89 tasks. Rounded up: 1 task. The previous 0.2-task threshold was below the empirical noise floor by ~4×; any cross-variant comparison on AHOL-Proxy-15 with a delta under 1 full task is indistinguishable from this single flaky task's coin-flip.

**Recommendation:** raise the SWE-bench-resolved-rate gate from 2pp to 10pp on AHOL-Proxy-15 (1-task delta minimum to declare a winner). For tighter discrimination, the right move is to expand the benchmark size, not lower the threshold.

Per the user's tiered rule:
- stddev > 1.5 tasks → ingest Terminal-Bench-Core before more comparison rounds
- stddev ≤ 1 → n=10 usable with corrected gate

We landed at stddev = 0.447 ≤ 1 → **current n=10 benchmark is usable with the 1-task gate** for the purpose of "is the new variant non-noise different from baseline?" The benchmark is NOT yet adequate for resolving sub-1-task deltas (the regime where many real harness improvements probably live).

### Re-reading 53081a1 in light of this

The ablation `53081a1` reported V1 7/10 vs V0 8/10 as a "regression." In this variance characterization V0 itself ranges 7-8/10. **The V1 7/10 row was within V0's own noise envelope.** The CUT-MODE verdict was overstated; the data showed only that V1 didn't lift outside the V0 noise band, which is the same thing the rest of the V0 reps showed about themselves. No harness conclusion can be drawn from a single 1-task delta.

## 7. Per-task token cost variance (across 5 reps)

| task_id | μ tokens | σ tokens | CV | notes |
|---|---:|---:|---:|---|
| astropy__astropy-12907 | 127,836 | 87 | 0.07% | fully deterministic |
| django__django-15572 | 93,348 | 4 | 0.00% | fully deterministic |
| sympy__sympy-15599 | 93,701 | 101 | 0.11% | deterministic on the failure path |
| pydata__xarray-3151 | 167,720 | 137 | 0.08% | fully deterministic |
| django__django-17087 | 125,474 | 13,079 | 10.42% | mild |
| django__django-11477 | 241,203 | 40,083 | 16.62% | failure-path variance |
| sphinx-doc__sphinx-8120 | 236,309 | 43,136 | 18.25% | mild-moderate |
| scikit-learn__scikit-learn-10844 | 113,366 | 26,223 | 23.13% | bimodal (~94K vs ~143K) |
| django__django-13128 | 627,267 | 151,212 | 24.11% | the flaky task |
| django__django-14349 | 346,357 | 191,457 | **55.28%** | 4× cost spread despite 5/5 pass |

Three regimes visible:
1. **Deterministic** (CV < 0.5%): 4 tasks. The model produces byte-identical or near-byte-identical token traces across reps. No useful variance signal.
2. **Mild variance** (CV 10–25%): 5 tasks. Different reasoning paths, similar outcomes. The pass/fail outcome is stable but the cost varies.
3. **High variance** (CV > 50%): 1 task. django-14349 has 4× cost spread (V0a 574K → V0b 145K) on the same harness, same task, all 5 reps passing. The cost-axis is its own noise dimension distinct from the pass-rate axis.

## 8. Track 1 + Track 2 verification

### Track 1: extract_metrics fast-fail contamination — VERIFIED FIXED

Pre-fix evidence (from `53081a1` ablation, V1's BigCodeBench/553 row): 52,400,000 tokens reported for a 2.8s task. Caused by parent-session JSONL contamination in unscoped `extract_metrics` fallback when no new project dir was created.

Post-fix evidence (this round, all 25 BCB rows):

```
task_id           tokens_used   wall_s
BigCodeBench/100         0      1.21–1.42 (5 reps)
BigCodeBench/147         0      1.16–1.24
BigCodeBench/360         0      1.16–1.35
BigCodeBench/553         0      1.13–1.30
BigCodeBench/82          0      1.14–1.22
```

All 25 BCB rows: `tokens_used = 0`, `wall_clock_sec ≤ 1.42`. The log shows the new warning: `"fast-fail or no-session-file path: returning zero-token metrics for variant-v0-rep-e/BigCodeBench/82"`. The contamination path that caused V1's 52.4M anomaly is closed.

Eliminated cumulative contamination on this round alone: ≥ 5 BCB tasks × 5 reps × ~50M each = **~1.25 billion phantom tokens** that would have appeared in unscoped pre-fix aggregation. Without the fix, the round summary would have shown "total_tokens" in the high hundreds of millions and the round-level budget cap would have spuriously triggered.

### Track 2: --budget-cap enforcement — UNTRIGGERED, OK

Round total tokens: 10,862,899. Cap: 15,000,000. Difference: 4,137,101 (27.6% headroom).

The cap was never approached. The new `run_variant` budget query fired after every task and returned values monotonically rising from 128K (after V0a task 1) to 10.86M (after V0e task 75); none crossed 15M. `shutdown.set("budget_exceeded")` was never invoked, exit code was 0 (clean completion), `shutdown.reason` stayed None.

This run does not exercise the budget-halt path, but does demonstrate the enforcement query runs ~75 times per round at acceptable cost (single SQLite SUM, sub-millisecond) and does not break the happy path. **Recommend a future spike with a deliberately-low cap (e.g. 5M) to actually exercise the halt code path** before relying on it for cost protection on a longer round.

## 9. Open question: between-day pass-rate shift on django-11477

The `de51ec4` retry spike on Apr 24 reported V0 at 9/10 on AHOL-Proxy-15. This round on Apr 28 reports V0 at 7-8/10. Two of the SWE-bench tasks here are 0/5 (django-11477, sympy-15599). It is possible that:

- (a) The 9/10 was an outlier on a single rep; the steady-state V0 pass rate is genuinely 7-8/10 and django-11477 is reliably-out-of-reach. Now that we have 5 reps, the steady-state estimate is more credible than the n=1 9/10.
- (b) Something between Apr 24 and Apr 28 shifted Claude's behavior on these tasks (model update, traffic-shaping, content-filter change). The Tracks 1+2 fixes don't touch the prompt or invocation, so they're not the cause.
- (c) Tasks 11477 and 15599 are themselves higher-variance than the other 8 — possible since we only saw n=1 of them on the prior spike — but observing 0/5 across this entire round suggests deterministic-fail in the V0 regime, not high variance.

(a) is the most parsimonious. (b) is testable: re-run V0 again next week and see if django-11477 pass rate moves. Recommend logging this as an open watch item for future variance rounds; do not adjust the gate threshold based on this.

## 10. What AHOL needs next

Based on this round's signal:

**Immediate (next 1-2 sessions):**
- Treat any cross-variant delta < 1 task on AHOL-Proxy-15 as inside the noise floor. Document in `GROUP-C-SCOPE.md` or wherever the gate threshold is defined.
- Update the comparison-round protocol to require ≥ 1-task delta before declaring a champion.
- Add a "sanity column" to round summaries: did the pass-count delta exceed 0.89 tasks (2σ)? Below that, no champion changes.

**Medium-term (before another comparison round at scale):**
- Expand benchmark size. Terminal-Bench-Core ingestion is the obvious next move per `benchmarks/README.md`. With n≈30, the standard error on a binomial pass-rate falls by √3, halving the noise floor.
- Run V0×3 again on Apr 30+ to test the (a)/(b) ambiguity above. Cheap (~6M tokens, ~50 min).
- Spike the budget-cap halt path with `--budget-cap 5000000` to verify Track 2's halt branch works in practice (this round only verified the no-trigger path).

**NOT recommended:**
- Lowering the gate below 1 task. The math says 0.89 tasks at this n; rounding up is the safe direction.
- Ingesting more BigCodeBench-Hard. The 5 BCB tasks all fast-fail at clone time; they contribute no signal at the pass-rate axis (good thing, given fix at Track 1; bad thing, in that they cost ~6 sec and 0 useful information per rep).

## 11. Round file locations

- DB: `.ahol/ahol.db` (round_id rows under `variance-V0-x5-20260428-0422`)
- Trace: `.ahol/traces/round-variance-V0-x5-20260428-0422.jsonl`
- Logs: `.ahol/logs/round-variance-V0-x5-20260428-0422/variant-variant-v0-rep-{a..e}/`
- Stdout/stderr: `/tmp/ahol-variance.log`

---

*Generated 2026-04-28 from `variance-V0-x5-20260428-0422` round data. Tracks 1+2 fixes verified live during this run.*
