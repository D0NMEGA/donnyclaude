# V4 ×5 vs variance-V0 baseline on AHOL-Proxy-15 — DECOMPOSE

**Round:** `comparison-V4-x5-vs-variance-baseline-20260430-0501`
**Date:** 2026-04-30 (CDT)
**HEAD at run:** `e63c7a5` (Tracks 1+2 + Track 3 baseline + Tracks 4+5 defenses)
**V0 reference:** `variance-V0-x5-20260428-0422` (mean 7.80, sample stddev 0.447)
**Verdict:** **DECOMPOSE** — V4 is within the empirical 1-task gate of V0; donnyclaude has no detectable effect on patch-task pass rate at AHOL-Proxy-15's resolution

This is the first AHOL comparison run with empirically-grounded statistical machinery. The variance round established stddev=0.447 for V0 at n=5; this V4×5 round measures V4 against that baseline. The 1-task gate at 2σ confidence is the load-bearing decision threshold.

## 1. Round metadata + pre-flight

| Field | Value |
|---|---|
| round_id | `comparison-V4-x5-vs-variance-baseline-20260430-0501` |
| Started | 2026-04-30T10:01:36Z (05:01 CDT) |
| Ended | 2026-04-30T11:38:03Z (06:38 CDT) |
| Wall-clock | 5785.6s (96.4 min) |
| Total tokens | 14,166,535 (within 22M cap; Track 2 not triggered) |
| Tasks | 75 (5 V4 reps × 15 tasks) |
| Concurrency | 1 (controls for time-of-day drift) |
| Budget cap | 22M (Track 2 enforced) |

| Pre-flight check | Status | Detail |
|---|---|---|
| HEAD clean | ✓ | `e63c7a5` |
| Tracks 4+5 deployed | ✓ | Self-test PASS including `_self_test_auth_detect()` |
| Calibration | ✓ | re-ran (HEAD changed); `calibration-84a55e7d` PASS at `e63c7a5`, V4 5/5 markers on both tasks, 600.2s wall (includes Track 5 probe) |
| **Track 5 quota probe** | ✓ | Logged `"calibration-check: pre-flight quota probe OK"` inline; probe consumed ~5K opus tokens |
| Docker | ✓ | 29.4.0 |
| Disk | ✓ | 33 GB free |
| Manifest schema | ⚠ corrected | `V4a/b/c/d/e` form rejected by `^(V[0-9]+|variant-[0-9a-z-]+)$`; used `variant-v4-rep-{a..e}` for storage. Display labels `V4a..V4e` used in this report. |

## 2. V4 per-rep pass counts (10 SWE-bench scoreable tasks)

| | V4a | V4b | V4c | V4d | V4e |
|---|:-:|:-:|:-:|:-:|:-:|
| sum (max 10) | **7** | **7** | **7** | **7** | **7** |
| total tokens | 2,996,691 | 2,880,446 | 2,859,757 | 2,661,406 | 2,768,235 |
| wall (s) | 1,209.4 | 1,151.9 | 1,168.7 | 1,110.8 | 1,144.1 |

Five identical pass counts. **Observed V4 stddev = 0.** This is striking and warrants its own discussion (§7).

## 3. V4 statistics + comparison to V0 baseline

| metric | V0 baseline (variance round) | V4 (this round) |
|---|---:|---:|
| n reps | 5 | 5 |
| mean pass count | 7.80 | **7.00** |
| sample stddev (n−1) | 0.447 | **0.000** |
| min | 7 | 7 |
| max | 8 | 7 |
| mean total_tokens | 2,172,580 | 2,833,307 |

**Pooled stddev** for the comparison: √((0.447² + 0²) / 2) = **0.316 tasks**.
**2σ confidence interval** on the delta: ±0.632 tasks.

## 4. Comparison verdict — DECOMPOSE

| | value |
|---|---:|
| V4 mean − V0 mean | **−0.80 tasks** |
| \|delta\| | 0.80 |
| 2σ pooled CI | ±0.632 |
| Interval excludes zero? | YES (0.80 > 0.632) |
| ≥ 1-task gate? | **NO** (0.80 < 1.00) |

Per the spec verdict mechanism:
> If \|V4_mean - V0_mean\| < 1 task **OR** interval includes zero: **DECOMPOSE** (within noise)

\|delta\| = 0.80 < 1 task → first condition met → **DECOMPOSE**.

Interpretation: even though Welch-style analysis would call the V0→V4 difference statistically detectable (V0 stddev alone gives a 2σ band of 0.632 tasks, which the 0.80 delta exceeds by ~26%), the magnitude is below the empirically-grounded 1-task gate from the variance round. AHOL-Proxy-15 has only one flaky task (django-13128, V0 4/5); a 1-task swing is fully within that single-flake noise envelope. The benchmark cannot resolve the V0→V4 difference reliably at this n.

**This is a legitimate scientific result, not a failure.** donnyclaude as encoded in V4 has *no detectable improvement* over V0 on patch-task pass rate at AHOL-Proxy-15's resolution. To resolve sub-1-task harness effects, the benchmark must be expanded.

## 5. Cost analysis

| metric | V0 (variance) | V4 (this) | ratio |
|---|---:|---:|---:|
| mean total tokens | 2,172,580 | 2,833,307 | **1.30×** |
| mean tokens / SWE task (n=10) | ~217K | ~283K | 1.30× |
| mean wall_s per rep | 960.9 | 1,157.0 | 1.20× |

Compared to prior V4/V0 measurements:
- Apr 24 retry spike (`de51ec4`): V4/V0 = **1.56×**
- Apr 28 BLOCKED partial (`4b03ce2`): V4/V0 ≈ **1.81×** (n=1, unstable)
- This round (n=5 vs n=5): V4/V0 = **1.30×**

The 1.30× this-round number is the most credible to date because it has matched n on both sides. The 1.56× and 1.81× prior numbers were either single-rep or single-rep-partial.

**Per-task cost variance (V4 stddev across 5 reps):** comparable to V0 — see §7 token table. V4 is bimodal-cost on django-14349 (228K–628K range) and consistent on most others. The cost-axis variance is within the same order of magnitude as V0's per-task variance from the variance round.

## 6. Per-task pass-rate distribution V4 vs V0

| task_id | V0 | V4 | classification |
|---|:-:|:-:|---|
| astropy__astropy-12907 | 5/5 | 5/5 | both deterministic-pass |
| django__django-11477 | 0/5 | 0/5 | both deterministic-fail (out of reach) |
| **django__django-13128** | **4/5** | **0/5** | **V4 regression** (V0's lone flake → reliably-fail under V4) |
| django__django-14349 | 5/5 | 5/5 | both deterministic-pass |
| django__django-15572 | 5/5 | 5/5 | both deterministic-pass |
| django__django-17087 | 5/5 | 5/5 | both deterministic-pass |
| pydata__xarray-3151 | 5/5 | 5/5 | both deterministic-pass |
| scikit-learn__scikit-learn-10844 | 5/5 | 5/5 | both deterministic-pass |
| sphinx-doc__sphinx-8120 | 5/5 | 5/5 | both deterministic-pass |
| sympy__sympy-15599 | 0/5 | 0/5 | both deterministic-fail (out of reach) |

**V4 helps (≥2/5 lift):** 0 tasks
**V4 hurts (≤−2/5):** 1 task — `django__django-13128` (V0 4/5 → V4 0/5)
**V4 affects only the known flake:** YES — django-13128 is the only differentiator, and it's the exact task variance round identified as V0's only flaky task

The entire round-level V4→V0 −0.80 mean delta is concentrated on a single task. Specifically, V4 took V0's only flaky task (4/5 with one fail) and converted it into a reliably-failing task (0/5). This is the opposite of the harness-improvement hypothesis — V4's instructions, skills, or hooks are doing *something* on django-13128 that prevents V0's normal pass path from succeeding.

**Per-task token comparison (V0 mean → V4 mean):**

| task | V0 μ | V4 μ | V4/V0 |
|---|---:|---:|---:|
| astropy-12907 | 127,836 | 199,438 | 1.56× |
| django-11477 (both fail) | 241,203 | 231,532 | 0.96× |
| **django-13128** (V4 regression) | 627,267 | 680,439 | 1.08× |
| django-14349 | 346,357 | 370,989 | 1.07× |
| django-15572 | 93,348 | 150,086 | 1.61× |
| django-17087 | 125,474 | 209,392 | 1.67× |
| xarray-3151 | 167,720 | 273,950 | 1.63× |
| sklearn-10844 | 113,366 | 174,116 | 1.54× |
| sphinx-8120 | 236,309 | 400,205 | 1.69× |
| sympy-15599 (both fail) | 93,701 | 143,160 | 1.53× |

V4 is consistently ~1.5–1.7× costlier on tasks both harnesses solve. On django-11477 (which both fail) V4 is 4% *cheaper* — V4 may give up earlier on a hopeless task. On django-13128 V4 is only 8% costlier despite always failing where V0 sometimes succeeds, meaning V4 isn't trying *harder* and failing — it's taking a different path that doesn't pass.

## 7. Methodological notes

### Cross-round comparison validity

V0 baseline captured Apr 28 04:23 CDT; V4 captured Apr 30 05:01 CDT. ~49 hours apart. V0 stability across this window is supported by:
- V0a in BLOCKED comparison-V0-vs-V4 round (Apr 28 14:57 CDT) hit 7/10 — same as V0a in variance round.
- No infrastructure changes that would affect V0 behavior between Apr 28 and Apr 30 (Tracks 4+5 changes are auth/quota guards; do not touch run_task scoring or benchmark loaders).
- Calibration `calibration-84a55e7d` at HEAD `e63c7a5` confirms V4 discovery still works on the same 2 tasks as prior calibrations, indicating stable variant differentiation.

The cross-round V0 reference is methodologically defensible.

### V4 zero-stddev finding

Five V4 reps producing identical 7/10 outcomes is unusually deterministic. Possible explanations:
- **(a)** V4's harness fully dictates the path Claude takes on each task — same skills load, same hooks fire, same agent invocation patterns → same patches → same outcomes.
- **(b)** V4's cost overhead (1.30× V0) reflects extra context/exploration that paradoxically *narrows* the model's behavior compared to V0's tighter prompt — V4 may have less Claude-side variance because more of the answer is forced by the prompt.
- **(c)** n=5 is too small to estimate true V4 variance; the next 5 reps could surface flakes.

If V4's true stddev matches V0's 0.447, the pooled stddev would have been √((0.447² + 0.447²) / 2) = 0.447, 2σ = 0.894 tasks, and the −0.80 delta would land squarely inside the noise envelope (DECOMPOSE for both reasons). So the literal calculation here is a lower-bound on noise; the verdict (DECOMPOSE) is robust to plausible alternative V4 stddev values.

The user's invalidation criterion was *"V4 stddev > 1.5 tasks"* — we observed 0.0, the opposite of the failure mode. n=5 is sufficient under this stability.

### Resolution limit confirmed

This round confirms what variance round inferred: AHOL-Proxy-15 cannot resolve sub-1-task harness deltas. The entire signal here is one flaky task (django-13128) which V4 happens to break. If V4 had instead lifted django-13128 to 5/5, the delta would be +0.20 (DECOMPOSE again — same verdict, opposite direction). To determine whether V4 is actually helpful, neutral, or harmful requires either:
- More tasks per round (Terminal-Bench-Core ingestion, target n=30+),
- More reps per variant (n=15+ to drive the 1-task threshold below the single-flake gap),
- Or task-level analysis as the primary signal (this report's §6) rather than round-level pass counts.

Recommendation: pursue Terminal-Bench-Core ingestion before any further comparison rounds.

## 8. Tracks 4+5 verification

| Track | Status | Detail |
|---|---|---|
| Track 4 (auth detection in run_task) | ✓ ARMED, ✓ FIRED 0× | No auth/quota banners detected in any of 75 task stdouts. Round completed cleanly. |
| Track 5 (pre-flight quota probe) | ✓ FIRED, ✓ PASSED | `calibration-check: pre-flight quota probe OK` printed inline before calibration tasks ran. Probe took ~5K opus tokens. |
| Track 1 (extract_metrics fast-fail) | ✓ ALL 25 BCB rows = 0 tokens, max wall 1.58s |
| Track 2 (--budget-cap halt) | ✓ NOT TRIGGERED | 14.17M ≪ 22M cap |
| Heisenbug RuntimeError | ✓ 0 fires |
| Log alerts (auth/budget/halting/Traceback) | ✓ 0 matches in /tmp/ahol-v4-comparison.log |

Tracks 4+5 false-positive concerns: zero observed in this round (no positive matches at all means no false positives could surface). The next test of these tracks will require quota actually being low at probe time or a real auth failure — neither expected on this hardware until next quota window edge.

## 9. Recommended next action

**Immediate (no benchmark change):**
- DECOMPOSE verdict published. Update GROUP-C-SCOPE.md (or wherever the gate threshold is documented) to reflect: AHOL-Proxy-15 with 1-task gate cannot detect V0↔V4-scale differences; conclude that as a deliberate result rather than a measurement failure.
- Document django-13128 as a sentinel task: V4-style harnesses regress on it; it's a useful "did the harness change something specific to mid-cost django bug-fix tasks?" probe.

**Medium-term blocker for further comparison rounds:**
- Ingest Terminal-Bench-Core v0.1.1 to bring AHOL-Proxy-30 to its full 30 tasks (currently 15-task partial composite). At n=30 the standard error on a binomial pass-rate is √2 smaller than at n=15, halving the noise floor. The 1-task gate becomes a 0.7-task gate; sub-1-task harness deltas like the one observed here become resolvable.
- Investigate why V4 reliably fails django-13128. Is it skill load order, hook timing, agent spawn cost, command-disabling, or some specific mutation in V4.json's bundle? A targeted ablation (V4 minus each subset of mutations) on django-13128 alone would isolate it.

**Out of scope for this report:**
- Further V4-vs-V0 measurements until benchmark expands; the marginal information is low at this resolution.
- Re-running V0 — the variance baseline is stable and reused-validated.

## 10. Round file locations

- DB: `.ahol/ahol.db` (rows under `comparison-V4-x5-vs-variance-baseline-20260430-0501`)
- Trace: `.ahol/traces/round-comparison-V4-x5-vs-variance-baseline-20260430-0501.jsonl`
- Logs: `.ahol/logs/round-comparison-V4-x5-vs-variance-baseline-20260430-0501/variant-variant-v4-rep-{a..e}/`
- Stdout: `/tmp/ahol-v4-comparison.log`

---

*Generated 2026-04-30 from `comparison-V4-x5-vs-variance-baseline-20260430-0501` round data. DECOMPOSE verdict per spec §4. Tracks 1+2+4+5 verified live; Track 4 armed but did not fire (no auth failure). V4 stddev=0 across 5 reps is the most surprising finding; recommend a follow-up investigation into V4's regression on django-13128 specifically.*
