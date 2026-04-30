# V0 vs V4 ×5 comparison on AHOL-Proxy-15 — BLOCKED

**Round:** `comparison-V0-vs-V4-x5-20260428-1457`
**Date:** 2026-04-28 (CDT)
**HEAD at run:** `c2a1011` (Tracks 1+2 + variance characterization committed)
**Verdict:** **BLOCKED** — Max subscription quota exhausted mid-round
**Salvageable signal:** V0 rep a (full, 15/15 tasks) + V4 rep a (partial, 5/15 SWE tasks before quota hit). Insufficient data for the 5×5 design; recoverable signal is n=1 each side, which is below the empirically-grounded 1-task gate from `variance-V0-x5-20260428-0422`.

## 1. Round metadata + pre-flight summary

| Field | Value |
|---|---|
| round_id | `comparison-V0-vs-V4-x5-20260428-1457` |
| Started | 2026-04-28T19:57:55Z (14:57 CDT) |
| Ended | 2026-04-28T21:13:08Z (16:13 CDT) |
| Wall-clock | 4121.7s (68.7 min) |
| total_tokens (DB) | 3,824,175 |
| Tasks inserted | 150 (10 variants × 15 tasks) |
| Tasks with real claude work | 20 (V0a 15 + V4a first 5) |
| Tasks fast-failed post-quota | 130 |
| Budget cap | 35M (untriggered; quota hit ≪ cap) |
| Concurrency | 1 (interleaved manifest order) |

| Pre-flight check | Status | Detail |
|---|---|---|
| HEAD clean | ✓ | `c2a1011` |
| Calibration | ✓ | re-ran per spec (HEAD changed since `ae407931`); new `calibration-623ae699` PASS at `c2a1011`, V4 5/5 markers on both tasks, 484s |
| Docker | ✓ | 29.4.0 |
| Disk | ✓ | 35 GB free |
| Claude auth | ✓ at start | OK at 14:57 CDT; quota exhausted at 15:23 CDT after V4a task 4 |
| Manifest schema | ⚠ corrected | `V0a/V4a` form rejected by `^(V[0-9]+|variant-[0-9a-z-]+)$`; used `variant-v0-rep-{a..e}` and `variant-v4-rep-{a..e}` per the variance round's working pattern |

## 2. What actually happened

Per-variant rollup from `task_runs`:

| variant_id | tasks | passed | total_tokens | wall_s |
|---|---:|---:|---:|---:|
| variant-v0-rep-a | 15 | 7 | 2,006,784 | 943.7 |
| variant-v4-rep-a | 15 | 4 | 1,817,391 | 729.2 |
| variant-v0-rep-b | 15 | 0 | 0 | 291.8 |
| variant-v4-rep-b | 15 | 0 | 0 | 296.0 |
| variant-v0-rep-c | 15 | 0 | 0 | 293.2 |
| variant-v4-rep-c | 15 | 0 | 0 | 289.8 |
| variant-v0-rep-d | 15 | 0 | 0 | 287.8 |
| variant-v4-rep-d | 15 | 0 | 0 | 402.4 |
| variant-v0-rep-e | 15 | 0 | 0 | 288.9 |
| variant-v4-rep-e | 15 | 0 | 0 | 295.1 |

The break: V4a task 5 (`django__django-17087`) returned `exit_code=1`, `tokens_used=0`, `wall=36.8s`. The first task log under `variant-v0-rep-b` shows the `claude` stdout payload that's been returned for every task since:

```
You're out of extra usage · resets 7:40pm (America/Chicago)
```

This is the Max subscription quota-exhaustion message, not an OAuth/auth failure. The quota window resets at 19:40 CDT (~04:13 hours after the break). Until reset, every `claude` invocation returns the same one-line stdout, exits 1, and the AHOL pipeline correctly classifies it as a fast-fail (no session JSONL → Track 1 returns zero metrics → no contamination).

Track 1 worked exactly as designed: every one of the 130 post-quota tasks shows `tokens_used = 0` instead of contaminated 50M+ aggregations from the parent session. Without Track 1 the round summary would have shown total_tokens in the 6-billion range and the budget-cap (Track 2) would have correctly halted — but only AFTER many minutes of phantom "successful" tasks. With Track 1 the contamination is closed but **AHOL has no defensive detection of the actual quota-exhaustion message**; the runner happily continues launching tasks against an exhausted quota for ~50 minutes.

This is a genuine harness gap. See §7 for the recommended Track 4 fix.

## 3. Salvageable per-variant data

Only V0a (full) and V4a (partial 5 SWE tasks) ran with real claude. Pass matrix on the 10 SWE-bench scoreable tasks, restricted to data that actually ran:

| task_id | V0a | V4a | V4 lift |
|---|:-:|:-:|:-:|
| astropy__astropy-12907 | ✓ (128K) | ✓ (199K) | tied |
| django__django-11477 | ✗ (341K) | ✗ (259K) | tied (both fail) |
| django__django-13128 | ✗ (509K) | ✓ (523K) | **V4 +1** |
| django__django-14349 | ✓ (219K) | ✓ (724K) | tied |
| django__django-15572 | ✓ (93K) | ✓ (113K) | tied |
| django__django-17087 | ✓ (116K) | — quota | n/a |
| pydata__xarray-3151 | ✓ (167K) | — quota | n/a |
| scikit-learn__scikit-learn-10844 | ✓ (94K) | — quota | n/a |
| sphinx-doc__sphinx-8120 | ✓ (246K) | — quota | n/a |
| sympy__sympy-15599 | ✗ (94K) | — quota | n/a |

V0a final on 10 SWE-bench scoreable: **7/10**, 2.0M tokens.
V4a complete on 5 SWE-bench scoreable: **4/5**, 1.82M tokens.

## 4. Verdict: BLOCKED

Per the spec's verdict mechanism: *"If pipeline failure prevented clean measurement: BLOCKED."* The 5×5 design requires 50 task outcomes per variant class on the same 10 SWE-bench tasks. We have 10 V0 outcomes (one rep) and 5 V4 outcomes (partial rep, first 5 tasks). The pooled-stddev t-test the design called for cannot be computed with n=1 per class.

What we *can* say from the salvage data:
- V0a 7/10 is consistent with the variance round (`variance-V0-x5-20260428-0422`) where V0a was also 7/10 and V0b/c/d/e were 8/10 each (mean 7.8). This single V0a measurement does not contradict that variance characterization.
- V4a's only deviation from V0a in the first 5 tasks was a flip on django-13128 (V0a fail, V4a pass). The variance round identified django-13128 as the lone flaky task at 4/5 V0 pass rate. So **V4a's "lift" is on the exact task that V0 itself flips on randomly**. With n=1 measurement on a known coin-flip task, this is statistically zero-information. It is exactly the regime the variance round warned about: a single 1-task delta on n=10 with one flake is indistinguishable from noise.

If we generously assumed V4 lifts to 8/10 mean (one flake-flip from V0 mean 7.8) and stddev matched V0's 0.447, the delta of ~0.2 tasks is well below the 1-task gate at 2σ. Even if the round had completed cleanly, the partial-data signal would not have crossed the gate.

## 5. Cost analysis (partial)

| metric | V0a | V4a (partial 5 tasks) | ratio |
|---|---:|---:|---:|
| total tokens | 2,006,784 | 1,817,391 | 0.91× |
| tasks measured | 15 | 5 SWE + 5 BCB fast-fail | — |
| tokens/SWE-task (mean) | 200,679 | 363,478 | **1.81×** |
| wall_clock_sec | 943.7 | 729.2 | 0.77× |

V4 per-task cost on the 5 SWE tasks it completed: ~363K tokens vs V0's ~200K — **~1.81× per-SWE-task**. This is a thinner delta than the prior `de51ec4` retry spike's V4/V0 = 1.56× ratio (which itself was on n=10 V0 vs n=10 V4). The number is unstable on n=5 partial.

Per-task cost on the 4 SWE tasks both ran:
- astropy: V0 128K → V4 199K (+55%)
- django-11477: V0 341K → V4 259K (-24%)
- django-13128: V0 509K → V4 523K (+3%)
- django-14349: V0 219K → V4 724K (+231%)
- django-15572: V0 93K → V4 113K (+22%)

Wide spread on individual tasks. django-14349's 3.3× cost increase under V4 is consistent with V4 doing more search/verification before patching. Not enough data to call it a stable pattern.

## 6. Per-task lift / regression (partial — 5 of 10 tasks only)

With only 5 SWE-bench tasks for V4a:

- **Lift candidates (V4 ≥2/5 over V0 — none qualify since only n=1 V4 measurement per task):** 0 tasks
- **Regression candidates (V4 ≤−2/5 vs V0):** 0 tasks
- **Neutral (within 1/5):** 5 tasks (all measurements landed within the bound, but n=1 per side disqualifies any stable pattern claim)

This section will be meaningful only after a clean re-run.

## 7. Track 4 recommendation: defensive auth/quota detection

**The gap:** AHOL ran for ~50 minutes after the quota was exhausted, inserting 130 zero-token task rows. Track 1 prevented contamination correctly but did not prevent the wasted wall-clock or the non-actionable DB rows.

**The fix:** in `_run_swebench` or `run_task` (whichever invokes claude), inspect the stdout payload for known quota/auth failure signatures BEFORE returning. If detected, raise an exception that propagates up to `run_variant` and triggers `shutdown.set("auth_exhausted")`. Patterns to detect:
- `out of extra usage` (this round)
- `Not logged in` (general auth failure)
- `Please run /login` (general auth failure)
- HTTP 401/403 surfaced through stderr

Map the signal to a new `Shutdown.reason` value. Exit code 3 (distinct from 0/1/2/130). Add to `--budget-cap` style enforcement in `run_variant` so the round halts after the first detection.

This is one Track-2-style edit: ~30 LOC, single function, can be smoked tested with synthetic stdin.

**Out of scope this report; flag for a future infra fix commit before any future comparison runs are launched.**

## 8. Apr 24 → Apr 28 V0 drift assessment

The variance round earlier today (Apr 28 04:23–05:43 CDT) measured V0 mean = 7.80 across 5 reps. This round's V0a measured 7/10. The two are within ±1 task, which is inside the empirical noise floor.

Specifically:
- variance round V0a: 7/10
- this round V0a: 7/10 (same task set, same harness, ~10 hours later)
- Both fail on django-11477 and sympy-15599; both pass on the other 8.

So no evidence of between-window drift in V0 behavior. The Apr 24 retry spike's 9/10 V0 still looks like the outlier vs the now-stable 7-8/10 picture. The drift hypothesis has additional disconfirming evidence from this round's V0a.

## 9. Heisenbug + Track 1/2 verification

| Check | Status |
|---|---|
| Heisenbug fires (RuntimeError matching prior signature) | 0 |
| Track 1 (extract_metrics fast-fail zeros) | ✓ all 130 post-quota rows + 25 BCB rows show `tokens_used=0`; warning fires correctly |
| Track 2 (--budget-cap halt) | ✓ untriggered (3.8M ≪ 35M); query ran ~150× without false positive |
| Budget-cap halt branch exercised | NO (still untested in production) |

Tracks 1+2 worked exactly as the variance round predicted. The new gap is a **separate** harness defect that the variance round didn't surface because it never hit quota.

## 10. Open question: was launching this round preventable

In hindsight, the cumulative tokens in the prior 6 hours of this same Claude Code session were:
- variance-V0-x5: 10.86M
- calibration ae407931: ~80K
- calibration 623ae699: ~80K (just before this round)
- comparison V0a: 2.0M
- comparison V4a (partial): 1.8M
- session monitoring overhead: minimal

That's ~14.8M for the AHOL invocations PLUS the parent session's own claude usage (this conversation has spawned its own invocations through tools, agents, etc.). Per the user memory `project_max_subscription_quota_cadence.md`: "Max x5 resets ~every 5h; spikes burn 5-10M, full rounds 30-60M. Probe before launching long AHOL work; schedule across resets."

The pre-flight should have included a Max-quota probe (e.g., a tiny `claude` invocation that checks the current usage banner before launch), not just an auth probe. The auth probe at /tmp passed because auth was fine; quota was not checked.

This is a second harness gap, separate from Track 4: pre-flight needs a quota probe in addition to an auth probe. **Recommend adding it before any future comparison run.**

## 11. Recommended next action

In priority order:

1. **Wait for quota reset** (19:40 CDT ≈ ~04:00 hours from break time; if reset already passed by the time this report is read, can re-run immediately).
2. **Implement Track 4 + quota-probe before re-running.** Both are small fixes; combined ~50 LOC. Without them the same failure mode can recur silently. Specifically:
   - Track 4: AHOL detects "out of extra usage" / "Not logged in" in claude stdout, halts via `shutdown.set("auth_exhausted")`, exit code 3.
   - Quota probe: a `--quota-check` flag (or in-line pre-flight inside `--manifest` execution) that runs one tiny claude invocation, parses the banner if present, errors out before the round begins if quota is "out of extra usage."
3. **Re-run the same comparison design** after both fixes land. The empirical 1-task gate from the variance round still holds; the 27M-token estimate still holds; the 4-5h wall-clock estimate still holds. The reset window allows it.
4. **Do NOT lower the gate or accept this BLOCKED data as a verdict.** The salvage data (V0a 7/10, V4a 4/5 on first 5 tasks) is informational only.

## 12. Round file locations

- DB: `.ahol/ahol.db` (rows under `comparison-V0-vs-V4-x5-20260428-1457`)
- Trace: `.ahol/traces/round-comparison-V0-vs-V4-x5-20260428-1457.jsonl`
- Logs: `.ahol/logs/round-comparison-V0-vs-V4-x5-20260428-1457/variant-variant-{v0,v4}-rep-{a..e}/`
  - The first quota-failure stdout is preserved at `variant-variant-v0-rep-b/task-astropy__astropy-12907.log` (and every subsequent log)
- Stdout: `/tmp/ahol-comparison.log`

---

*Generated 2026-04-28 from `comparison-V0-vs-V4-x5-20260428-1457` round data. BLOCKED verdict per spec §4. Tracks 1+2 verified live; Track 4 (auth/quota detection) recommended before re-run.*
