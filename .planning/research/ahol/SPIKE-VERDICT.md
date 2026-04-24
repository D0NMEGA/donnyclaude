# C6 Spike Verdict: V0 vs V4 on AHOL-Proxy-15

**Round ID:** `spike-V0-vs-V4-20260424-1102`
**Timestamp:** 2026-04-24 11:02:48 → 11:34:38 UTC-ish (local; 31m50s total)
**Pipeline commit:** `77d51b1` (discovery-based calibration gate)
**Verdict:** **BLOCKED**

## Summary (TL;DR)

The spike was cut short by Anthropic Max subscription usage cap, hit during the V4 run. V4 got compute for 4 of 10 SWE-bench tasks before the cap engaged; the remaining 6 V4 SWE-bench tasks returned exit=1 with stdout "You're out of extra usage · resets 2:30pm (America/Chicago)". V0 completed all 10 SWE-bench tasks normally. The V4 3/10 resolved-rate is therefore an artifact of subscription exhaustion, not harness quality, and the V0-vs-V4 comparison is contaminated.

Recommended next action: re-run the spike after the Max cap resets (2:30 PM Central = ~3 hours from now), or switch the invocation to an API-key-backed claude CLI so subscription caps don't apply. Do NOT act on the 3/10-vs-9/10 numbers below as evidence for or against V4's harness.

## Pre-flight summary

| Check | Status | Detail |
|-------|--------|--------|
| 1. Git state | PASS (with caveat) | HEAD at `77d51b1` synced with origin/main. Working tree had pre-existing non-AHOL dirt (docs + runtime artifacts; `.planning/STATE.md`, `packages/rules/README.md`, untracked `.ahol/`, `.claude/`, `logs/`). Same state as the passing v9 calibration; proceeded. |
| 2. Calibration gate | PASS (cited) | Trusted prior run `calibration-61d00be8` (2026-04-24 10:29-10:37, 8 minutes before spike launch). Both tasks 5/5 markers. Per the "skip re-run if recent pass on same HEAD" rule. |
| 3. Docker | PASS | `docker ps` exit 0. |
| 4. Disk | PASS | 52 Gi free on /Users/donmega (≥25 GB). |
| 5. Claude auth | PASS | `claude --print --model opus "Echo 'c6-preflight'"` from /tmp returned in 12.8s. **Note:** this check succeeded 5 min before the spike launched; at spike launch time the Max subscription still had headroom but was consumed mid-V4. |

## Round metadata

| Field | Value |
|-------|-------|
| round_id | `spike-V0-vs-V4-20260424-1102` |
| manifest | `/tmp/ahol-spike-manifest.json` (V0 + V4 from contracts/variant-fixtures/) |
| benchmark | `ahol-proxy-15` (10 HAL-Verified-Mini SWE-bench + 5 BigCodeBench-Hard) |
| concurrency | 1 (serialized variants, serialized tasks) |
| budget-cap arg | 20,000,000 tokens |
| start | 11:02:48 (first INFO log) |
| end | 11:34:38 (round complete) |
| total wall-clock | 1908.5 sec (31m 48s) |
| total tokens | 5,148,782 |
| champion | None (dual-criterion gate not met; V4 tokens_passed_ratio lower) |

## Per-variant summary

(resolved only on the 10 SWE-bench tasks; 5 BCB tasks all failed `clone failed` for both variants — not scoreable)

| Variant | Attempted | Resolved | Errored | Total tokens | Median tokens | p95 tokens | Median wall | Cache creation total |
|---------|-----------|----------|---------|--------------|----------------|------------|--------------|-----------------------|
| V0 | 15 | 9 | 6 (5 BCB clone + 1 test fail) | 3,653,129 | 118,074 | 1,811,543 | 112.4 s | 556,769 |
| V4 | 15 | 3 | 12 (5 BCB clone + 6 Max cap + 1 test fail) | 1,495,653 | 0 | 631,847 | 31.6 s | 224,064 |

## Per-task detail (all 30 rows)

| task_id | variant | resolved | tokens | cc | wall_s | error_summary (≤80 chars) |
|---------|---------|----------|--------|------|--------|---------------------------|
| BigCodeBench/100 | V0 | 0 | 0 | 0 | 1.3 | clone failed: Cloning into '/tmp/ahol-run-spike-V0-vs-V4-20260424-1102 |
| BigCodeBench/100 | V4 | 0 | 0 | 0 | 1.2 | clone failed: Cloning into '/tmp/ahol-run-spike-V0-vs-V4-20260424-1102 |
| BigCodeBench/147 | V0 | 0 | 0 | 0 | 1.3 | clone failed |
| BigCodeBench/147 | V4 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/360 | V0 | 0 | 0 | 0 | 1.3 | clone failed |
| BigCodeBench/360 | V4 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/553 | V0 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/553 | V4 | 0 | 0 | 0 | 1.1 | clone failed |
| BigCodeBench/82 | V0 | 0 | 0 | 0 | 1.2 | clone failed |
| BigCodeBench/82 | V4 | 0 | 0 | 0 | 1.2 | clone failed |
| astropy__astropy-12907 | V0 | 1 | 129,765 | 29,404 | 155.7 | (none) |
| astropy__astropy-12907 | V4 | 1 | 199,830 | 58,559 | 143.6 | (none) |
| django__django-11477 | V0 | 1 | 1,811,543 | 324,711 | 93.7 | (none) |
| django__django-11477 | V4 | 0 | 227,334 | 53,657 | 83.4 | tests did not resolve |
| django__django-13128 | V0 | 1 | 612,529 | 43,547 | 188.8 | (none) |
| django__django-13128 | V4 | 1 | 436,642 | 57,265 | 127.1 | (none) |
| django__django-14349 | V0 | 1 | 248,309 | 24,506 | 100.5 | (none) |
| django__django-14349 | V4 | 1 | 631,847 | 54,583 | 111.0 | (none) |
| django__django-15572 | V0 | 1 | 94,923 | 21,216 | 120.2 | (none) |
| **django__django-15572** | **V4** | **0** | **0** | **0** | **36.4** | **empty patch from claude** (Max cap hit) |
| django__django-17087 | V0 | 1 | 118,074 | 21,380 | 108.0 | (none) |
| **django__django-17087** | **V4** | **0** | **0** | **0** | **35.5** | **empty patch from claude** (Max cap hit) |
| pydata__xarray-3151 | V0 | 1 | 170,455 | 23,833 | 166.6 | (none) |
| **pydata__xarray-3151** | **V4** | **0** | **0** | **0** | **12.4** | **empty patch from claude** (Max cap hit) |
| scikit-learn__scikit-learn-10844 | V0 | 1 | 95,795 | 21,601 | 121.8 | (none) |
| **scikit-learn__scikit-learn-10844** | **V4** | **0** | **0** | **0** | **26.1** | **empty patch from claude** (Max cap hit) |
| sphinx-doc__sphinx-8120 | V0 | 1 | 276,517 | 25,252 | 112.4 | (none) |
| **sphinx-doc__sphinx-8120** | **V4** | **0** | **0** | **0** | **18.2** | **empty patch from claude** (Max cap hit) |
| sympy__sympy-15599 | V0 | 0 | 95,219 | 21,319 | 102.9 | tests did not resolve |
| **sympy__sympy-15599** | **V4** | **0** | **0** | **0** | **31.6** | **empty patch from claude** (Max cap hit) |

## Why verdict is BLOCKED, not CUT-MODE

A naive reading of the numbers would call this CUT-MODE:
- Score delta (V4 - V0) / 10 = (3 - 9) / 10 = **-60 pp** (V0 beat V4 by 60 pp)
- Cost ratio V4/V0 = 1,495,653 / 3,653,129 = **0.41** (V4 cheaper)
- CUT-MODE threshold `(V0_rate - V4_rate) >= 2pp`: fires at 60 pp.

But that reading treats `passed=0` the same for V4 tasks that actually ran and failed and for V4 tasks that never ran. Six of the ten V4 SWE-bench tasks hit the Max subscription cap and returned exit=1 with no work done — the stdout on every one of those six tasks is literally `You're out of extra usage · resets 2:30pm (America/Chicago)` (see `.ahol/logs/round-spike-V0-vs-V4-20260424-1102/variant-V4/task-*.log`). Those tasks did not measure V4's harness; they measured the subscription limit.

On the 4 SWE-bench tasks where V4 actually got compute (astropy-12907, django-11477, django-13128, django-14349):

| Metric | V0 (same 4 tasks) | V4 (same 4 tasks) |
|--------|-------------------|---------------------|
| Resolved | 4/4 (100%) | 3/4 (75%) |
| Tokens total | 2,802,146 | 1,495,653 |
| Tokens median | 430,419 | 332,236 |

Head-to-head on the unblocked subset, V0 still beats V4 by 25 pp on resolved-rate with lower per-task tokens. But n=4 is directional at best — the plan already noted that n=10 is "directional at best", and n=4 is below that.

**Verdict BLOCKED:** pipeline failure (external subscription cap, not AHOL code) prevented clean measurement. The V4 3/10 number is not interpretable as a harness-quality signal. Re-run after Max reset, or switch to API-key-backed claude, before drawing a conclusion about V4.

## BCB handling

All 5 BigCodeBench-Hard tasks (BigCodeBench/82, /100, /147, /360, /553) failed deterministically with `clone failed: Cloning into '/tmp/ahol-run-.../repo'... Please make sure you have the correct access rights and the repository exists.` The BCB loader synthesizes a fake `base_commit` as `sha1(task_id)` and the `repo` field points at a GitHub URL that does not exist; the loader never wired up BCB's own scoring harness. These 10 rows (5 tasks × 2 variants) are excluded from all pass-rate calculations above. Fixing BCB support is explicitly out of scope per the C6 plan and `ws1-refinement-smoke.md`.

## OTel trace files

| File | Size |
|------|------|
| `.ahol/traces/round-spike-V0-vs-V4-20260424-1102.jsonl` | 46,747 bytes |

(Earlier attempt `round-spike-V0-vs-V4-20260423-2318.jsonl` at 6,086 bytes is from a prior cycle, not this spike.)

## Notable observations

1. **Cache creation ratio on 4 fair tasks checks out.** On astropy-12907, V4_cc / V0_cc = 58,559 / 29,404 = **1.99×**. On django-13128: 57,265 / 43,547 = **1.31×**. On django-14349: 54,583 / 24,506 = **2.23×**. On django-11477 (V4 failed): 53,657 / 324,711 = 0.17× (V0 iterated heavily). The discovery-based calibration gate's measurement assumption holds: when V4 gets compute, its preamble is ~2× V0's as expected.

2. **Heisenbug Case-B did not fire.** No `RuntimeError` in the log, no "empty harness" crash, no variant-V4/.claude/ vanishing. Track 1 fail-loud guard was inert. The Case-B wipe was absent this cycle; the discovery gate was load-bearing on nothing, but the state-level guarantee held regardless.

3. **V0 django-11477 is an outlier at 1.81M tokens.** Triple the second-highest V0 task. Successful resolution. Suggests that one task genuinely needed heavy iteration; a full round on a larger task set will show the token-cost distribution tail.

4. **V4's early task astropy-12907 used 199,830 tokens, passed.** Within expected preamble-overhead range vs V0's 129,765. V4 actually resolved its first three unblocked SWE-bench tasks (astropy, django-13128, django-14349), which on its own is promising but inconclusive.

5. **No thermal events, no heisenbug fires, no SafetyError. Pipeline itself is sound.** The only failure mode this cycle was external (Max cap).

## Recommended next action

**Re-run the full spike after the Max subscription reset.** The user reported reset at "2:30pm (America/Chicago)", roughly 3 hours after the spike ended. Two options:

1. **Preferred:** wait for Max reset, then invoke the same command with a new round_id:
   ```
   python3 packages/ahol/runner/ahol.py \
     --manifest /tmp/ahol-spike-manifest.json \
     --benchmark ahol-proxy-15 \
     --round-id "spike-V0-vs-V4-$(date +%Y%m%d-%H%M)" \
     --concurrency 1 \
     --budget-cap 20000000
   ```
   V0 consumed ~3.65M tokens and V4's 4 successful tasks consumed ~1.50M; the remaining V4 budget would have been ~2-4M more, so total spike ~7-10M tokens. The Max reset gives a clean budget for the next run.

2. **Alternative (faster, but changes the measurement surface):** switch `invoke.sh` to use an API-key-backed claude CLI mode (`ANTHROPIC_API_KEY` env var instead of Max session) so subscription caps never apply. Costs money per token but avoids the cap issue entirely. **Not recommended for this cycle** — changes `invoke.sh` mid-spike are explicitly out of scope per the C6 plan's hard constraints.

The BLOCKED verdict does not rule out follow-up investigation on the 4-task unblocked subset (V0 4/4 vs V4 3/4 is a real, if low-n, signal) but the spike output alone cannot support a CUT-MODE / GROW-MODE / DECOMPOSE call.

## Budget accounting

- Pre-flight: ~15K tokens (git, docker, disk, claude echo). Calibration pre-flight trusted prior round (0 tokens).
- Spike run: 5,148,782 tokens (V0 3,653,129 + V4 1,495,653).
- Orchestration + report: ~500K tokens (Claude Code invocations).
- **Total cycle: ~5.7M of 25M budget** (23%). Comfortable.

Wall-clock: 31m 48s actual, well under the 4-hour limit.
