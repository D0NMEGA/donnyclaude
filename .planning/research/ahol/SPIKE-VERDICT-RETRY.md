# C6 Spike Retry Verdict: V0 vs V4 on AHOL-Proxy-15

**Round ID:** `spike-V0-vs-V4-retry-20260424-1508`
**Timestamp:** 2026-04-24 15:08:10 → 15:40:28 local (32m 18s total)
**Pipeline commit:** `83b3f2d` (unchanged from the BLOCKED run; same HEAD as `77d51b1` plus only SPIKE-VERDICT.md)
**Predecessor:** `spike-V0-vs-V4-20260424-1102` → BLOCKED (Max cap hit mid-V4). Committed in `83b3f2d`.
**Verdict:** **CUT-MODE** (directional; n=10)

## Summary (TL;DR)

Clean run, zero cap hits, zero heisenbug fires, zero SafetyError. V0 beat V4 9/10 vs 8/10 on the SWE-bench-scoreable subset, while V4 cost 1.56× V0's tokens for that worse outcome. Mechanically, this trips the CUT-MODE threshold `(V0_rate - V4_rate) >= 2pp` at +10pp. n=10 means the 10pp delta = 1 task (django-11477, which V4 also failed in the morning's BLOCKED run while V0 passed both times). Directional CUT-MODE, not publication-grade.

The one task V4 failed and V0 passed was `django__django-11477` — a deterministic V4 failure across both spike attempts. Every other SWE-bench task (9 of 10) was resolved by both variants; V4 paid 1.5–2× V0's token cost for the same outcome.

Recommended next: ablation round with V1/V2/V3 single-mutation variants on the same 10 SWE-bench tasks to isolate which component of V4's full-donnyclaude install is responsible for the regression on django-11477 and the ~1.56× token overhead elsewhere.

## Pre-flight summary

| Check | Status | Detail |
|-------|--------|--------|
| 1. Git state | PASS | HEAD + origin/main at `83b3f2d`. Working-tree dirt pre-existing (docs + runtime artifacts; same state as the passing calibration and the morning spike). |
| 2. Calibration gate | PASS (cited) | Trusted `calibration-61d00be8` (2026-04-24 10:29–10:37, 5/5 markers on both tasks). Same HEAD, same fixtures, 4h38m before this spike launched. |
| 3. Docker | PASS | `docker ps` exit 0. |
| 4. Disk | PASS | 37 Gi free on /Users/donmega (≥25 GB). Down from 52 Gi at morning pre-flight; docker/swebench images are consuming space. Worth pruning before the next multi-round session. |
| 5. Claude auth | PASS | `claude --print --model opus "Echo 'c6-retry-preflight'"` from /tmp returned in 10.8s, no cap message. Max reset confirmed (reset was ~2:30 PM Central, probe fired at ~3:07 PM Central). |

## Round metadata

| Field | Value |
|-------|-------|
| round_id | `spike-V0-vs-V4-retry-20260424-1508` |
| manifest | `/tmp/ahol-spike-manifest.json` (V0 + V4 from contracts/variant-fixtures/) |
| benchmark | `ahol-proxy-15` (10 HAL-Verified-Mini SWE-bench + 5 BigCodeBench-Hard) |
| concurrency | 1 (serialized variants, serialized tasks) |
| budget-cap arg | 20,000,000 tokens |
| start | 15:08:10 |
| end | 15:40:28 |
| total wall-clock | 1938 sec (32m 18s) |
| total tokens | 5,243,801 |
| champion | V0 (score 0.900) |
| cap-hit events | 0 |
| heisenbug fires (Track 1 RuntimeError) | 0 |
| SafetyError fires | 0 |

## Per-variant summary

(Resolved-rate computed on the 10 SWE-bench-scoreable tasks only; 5 BCB tasks all failed `clone failed` and are excluded from all pass-rate math.)

| Variant | Attempted | SWE-bench resolved | Errored | Total tokens | Median tokens | p95 tokens | Median wall | Cache creation total |
|---------|-----------|---------------------|---------|--------------|----------------|------------|--------------|-----------------------|
| V0 | 15 | **9/10** | 6 (5 BCB clone + 1 sympy tests did not resolve) | 2,051,982 | 118,512 | 724,076 | 77.0 s | 294,645 |
| V4 | 15 | **8/10** | 7 (5 BCB clone + django-11477 tests did not resolve + sympy tests did not resolve) | 3,191,819 | 199,857 | 1,172,141 | 75.5 s | 543,041 |

## Per-task detail (all 30 rows)

| task_id | variant | resolved | tokens | cc | wall_s | error_summary (≤80 chars) |
|---------|---------|----------|--------|------|--------|---------------------------|
| BigCodeBench/82  | V0 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/82  | V4 | 0 | 0 | 0 | 1.3 | clone failed |
| BigCodeBench/100 | V0 | 0 | 0 | 0 | 1.3 | clone failed |
| BigCodeBench/100 | V4 | 0 | 0 | 0 | 1.3 | clone failed |
| BigCodeBench/147 | V0 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/147 | V4 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/360 | V0 | 0 | 0 | 0 | 1.3 | clone failed |
| BigCodeBench/360 | V4 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/553 | V0 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/553 | V4 | 0 | 0 | 0 | 1.2 | clone failed |
| astropy__astropy-12907 | V0 | 1 | 129,761 | 55,543 | 144.8 | (none) |
| astropy__astropy-12907 | V4 | 1 | 199,857 | 58,573 | 138.7 | (none) |
| django__django-11477 | V0 | 1 | 244,115 | 26,511 | 99.3 | (none) |
| **django__django-11477** | **V4** | **0** | **297,614** | **50,635** | **92.2** | **tests did not resolve** (also failed in BLOCKED run) |
| django__django-13128 | V0 | 1 | 724,076 | 44,441 | 171.2 | (none) |
| django__django-13128 | V4 | 1 | 1,172,141 | 77,753 | 181.1 | (none) |
| django__django-14349 | V0 | 1 | 170,985 | 22,905 | 97.7 | (none) |
| django__django-14349 | V4 | 1 | 226,091 | 49,284 | 96.3 | (none) |
| django__django-15572 | V0 | 1 | 94,968 | 21,237 | 80.8 | (none) |
| django__django-15572 | V4 | 1 | 150,462 | 48,983 | 79.1 | (none) |
| django__django-17087 | V0 | 1 | 118,512 | 21,230 | 87.1 | (none) |
| django__django-17087 | V4 | 1 | 225,459 | 50,930 | 78.2 | (none) |
| pydata__xarray-3151 | V0 | 1 | 195,300 | 33,734 | 67.3 | (none) |
| pydata__xarray-3151 | V4 | 1 | 266,971 | 76,560 | 59.4 | (none) |
| scikit-learn__scikit-learn-10844 | V0 | 1 | 95,880 | 21,632 | 69.3 | (none) |
| scikit-learn__scikit-learn-10844 | V4 | 1 | 152,268 | 26,150 | 69.3 | (none) |
| sphinx-doc__sphinx-8120 | V0 | 1 | 183,093 | 26,065 | 77.0 | (none) |
| sphinx-doc__sphinx-8120 | V4 | 1 | 350,172 | 55,080 | 75.5 | (none) |
| sympy__sympy-15599 | V0 | 0 | 95,292 | 21,347 | 86.9 | tests did not resolve |
| sympy__sympy-15599 | V4 | 0 | 150,784 | 49,093 | 72.1 | tests did not resolve |

## Score delta and cost ratio

- **V0 resolved rate:** 9/10 = 90%
- **V4 resolved rate:** 8/10 = 80%
- **Score delta (V4 - V0) / 10:** `(8 - 9) / 10` = **-10 pp** (V0 beat V4 by 10 pp)
- **Cost ratio V4/V0:** `3,191,819 / 2,051,982` = **1.556** (V4 spent 1.56× V0's tokens)

## Verdict

Threshold table (from `.planning/research/ahol/spike-results.md`):

| Verdict | Condition |
|---------|-----------|
| CUT-MODE | `(V0_rate - V4_rate) >= 2pp` OR `(V4_cost / V0_cost) >= 2` without proportional score gain |
| GROW-MODE | `(V4_rate - V0_rate) >= 2pp` AND `(V4_cost / V0_cost) < 2` |
| DECOMPOSE | neither |
| BLOCKED | pipeline failure prevented clean measurement |

Applied:

- `(V0_rate - V4_rate) = +10 pp >= 2 pp` → **CUT-MODE fires on score delta.**
- `(V4_cost / V0_cost) = 1.56 < 2` → the cost-only CUT-MODE arm does not fire.
- GROW-MODE requires `(V4_rate - V0_rate) >= 2pp`; observed is -10 pp. Does not fire.
- DECOMPOSE requires neither CUT nor GROW; CUT fires. Does not apply.

**VERDICT: CUT-MODE (directional).**

With n=10, 2 pp = 0.2 tasks, and the observed 10 pp delta is exactly 1 task (django-11477). The plan acknowledges this threshold is "directional at best" and "full statistical validation requires Group D's larger task set". This spike is a go/no-go on the V4 middleware hypothesis; it returns a no-go.

## BCB handling

All 5 BigCodeBench-Hard tasks (BigCodeBench/82, /100, /147, /360, /553) failed deterministically with `clone failed: Cloning into '/tmp/ahol-run-.../repo'... Please make sure you have the correct access rights and the repository exists.` Same failure as the BLOCKED run — BCB loader synthesizes a fake `base_commit` as `sha1(task_id)` and `repo` points at a GitHub URL that does not exist; the pipeline has no BCB scoring harness. These 10 rows (5 tasks × 2 variants) are excluded from all pass-rate and resolved-rate math. Wiring up BCB's own scoring is deferred per C6 plan and `ws1-refinement-smoke.md`.

## Notable observations

1. **Cache creation ratios match calibration.** Per-task V4/V0 cc ratio on the 10 SWE-bench tasks ranges 1.05× (astropy) to 2.40× (django-17087), median ≈ 1.8×. Calibration predicted 1.9–2.4×; the median is right at the low end. Preamble measurement is behaving as designed.

2. **django-11477 is the only task where verdict pivoted.** Both spike attempts reproduce this failure deterministically for V4 (tests did not resolve at ~230–300K tokens in both runs) while V0 resolves it both times (1.81M in morning, 244K in retry — huge V0 variance on this task). This is the single most interesting data point to investigate for ablation.

3. **V0 tokens dropped 44% from morning to retry (3.65M → 2.05M) despite identical task set and pass rate (both 9/10).** Likely warm caches: HuggingFace datasets cached, git clone caches warm, swebench docker images cached. Cache_creation per V0 task was also different (37K avg morning vs 29K retry on same tasks). This means cost numbers are sensitive to run conditions; use cost ratios not absolute costs when comparing across cycles.

4. **django-13128 is V4's most expensive task at 1.17M tokens (62% over V0's 724K) and 181s wall-clock.** Passed. The heavy tail of per-task cost sits on this one task for V4.

5. **sympy-15599 fails for both variants.** Likely a genuinely hard task (or one where the bundled test suite is flaky). Not a V4 regression; it's a V0 failure too.

6. **V4 failure mode on django-11477:** both V4 runs failed with `tests did not resolve` — the patch was applied (tokens > 0, non-empty diff implied) but tests didn't pass. This is a quality-of-patch issue for V4, not a cap or infrastructure issue. Ablation should focus on: is V4 generating a subtly wrong patch here that V0 happens to get right?

7. **Zero cap-hit events this run. Zero heisenbug fires. Zero SafetyError.** All three safety rails were inert, which is the right state.

## OTel trace files

| File | Size |
|------|------|
| `.ahol/traces/round-spike-V0-vs-V4-retry-20260424-1508.jsonl` | 47,153 bytes |

## Recommended next action

**Ablation round.** The V1–V7 fixtures under `packages/ahol/contracts/variant-fixtures/` are designed exactly for this case: each applies a single mutation (add_hook, add_rule_file, modify_skill_frontmatter, modify_compaction_threshold, modify_reasoning_effort, plus combinations) vs V0 baseline. A round with V0 + V1 + V2 + V3 on the same 10 SWE-bench tasks would isolate which component of V4's full-donnyclaude install caused django-11477 to fail and drives the 1.56× cost overhead. Specifically, the variants to prioritize:

- **V1 (add_hook):** tests whether the 19 hooks alone cause the regression. Hooks are the most likely culprit — packages/hooks/ contains `gsd-workflow-guard.js`, `gsd-prompt-guard.js`, `gsd-read-guard.js`, which could block or redirect claude's Edit/Bash calls mid-task.
- **V2 (add_rule_file):** tests whether the 14 rule files (coding-style.md, patterns.md, testing.md, etc.) cause distraction. Lower prior on this being the issue, but cheap to test.
- **V3 (modify_skill_frontmatter) or V4-component-only variant:** tests skill-discovery overhead without hooks.

Budget for ablation round: ~10-15M tokens if V0 + V1 + V2 + V3 at 4 variants × 10 SWE-bench tasks = 40 task invocations, averaging 200K tokens = ~8M, call it 10-15M with cushion.

**Explicitly NOT recommended: Run a third V0-vs-V4 spike.** The verdict is directional but mechanically clear. A third copy of the same 2-variant comparison won't increase statistical power because the task set is fixed at n=10. To bump statistical power, go to Group D's larger task set; to understand the mechanism, go to ablation.

**Infrastructure note (not a verdict issue):** Docker disk consumption grew from 52 Gi free → 37 Gi free across the two spike attempts. A full ablation round will add more. Run `docker system prune -a` between rounds or when disk drops below 30 Gi.

## Budget accounting (this cycle)

- Pre-flight: ~15K tokens (probes + git + docker + disk). Calibration cited, not re-run.
- Spike run: 5,243,801 tokens.
- Orchestration + report: ~800K tokens.
- **Total cycle: ~6.1M of 25M budget** (24%). Comfortable.

Wall-clock: 32m 18s spike, total cycle ~35 min. Well under the 4-hour limit.
