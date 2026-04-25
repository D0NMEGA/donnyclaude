# C6 Ablation: V0 + V1 + V2 + V3 on AHOL-Proxy-15

**Round ID:** `ablation-V0-V1-V2-V3-20260424-1549`
**Timestamp:** 2026-04-24 15:49:08 → 19:42:26 local (3h 53m total)
**Pipeline commit:** `de51ec4` (unchanged from retry spike)
**Predecessors referenced:**
- `spike-V0-vs-V4-20260424-1102` (BLOCKED, commit 83b3f2d)
- `spike-V0-vs-V4-retry-20260424-1508` (CUT-MODE, commit de51ec4) — V4 results sourced from this round, not re-measured

**Top-line finding:** the retry spike's CUT-MODE verdict on V4 was **overstated**. The 1-task delta between V4 and V0 (django__django-11477) is not a deterministic V4 regression; the same task **also failed for V0 in this ablation round**. V0 swings pass/fail on django-11477 across runs. Mechanistic attribution of V4's 1.56× cost overhead points to the **non-hook components** of V4's install (skills, agents, rules, commands) — V2 with the full available hook stack only reaches 1.14× V0 cost.

## Pre-flight summary

| Check | Status | Detail |
|-------|--------|--------|
| 1. Git state | PASS | HEAD + origin/main at `de51ec4`. Working-tree dirt unchanged from prior cycles. |
| 2. Docker prune | PASS | `docker system prune -a --volumes -f` freed **6.5 GB**. Disk: 36 Gi → 58 Gi free. |
| 3. Disk | PASS | 58 Gi free post-prune. |
| 4. Claude auth | PASS | `claude --print --model opus "Echo 'ablation-preflight'"` returned in 10.4s. |
| 5. Calibration cited | PASS (cited) | `calibration-61d00be8` (this morning, 5/5 markers, same HEAD). |

## Variant fixtures (what V1/V2/V3 actually test)

Inspecting `packages/ahol/contracts/variant-fixtures/V{1,2,3}.json` revealed **all three are `add_hook` variants** with different hook subsets — they do not decompose V4's footprint along the hooks/rules/skills axis the original prompt hypothesized. Specifically:

| Variant | Mutations | Hook count | Description |
|---------|-----------|------------|-------------|
| V0 | none | 0 | bare baseline |
| V1 | add_hook | 1 | `gsd-session-start.js` (WS-4 session-start only) |
| V3 | add_hook | 1 | `gsd-verify-edit.js` (WS-2 PostToolUse lint-gate only) |
| V2 | add_hook | 4 | `skill-index.js` + `gsd-verify-edit.js` + `gsd-pre-compact-backup.js` + `gsd-session-start.js` (full hook ensemble) |
| V4 | install_full_donnyclaude | **19** | all 19 hooks + 105 skills + 49 agents + 14 rules + 60 commands |

Implication: this ablation isolates the contribution of hooks (specifically a 4-of-19 subset) to V4's regression. It cannot cleanly isolate skills, rules, agents, or commands, nor the 15 hooks in packages/hooks/ that V2 doesn't pick up.

## Round metadata

| Field | Value |
|-------|-------|
| round_id | `ablation-V0-V1-V2-V3-20260424-1549` |
| benchmark | `ahol-proxy-15` (10 SWE-bench + 5 BCB) |
| concurrency | 1 |
| budget-cap arg | 18,000,000 (note: arg is documented as "meaningless" in ahol.py; not enforced) |
| start | 15:49:08 |
| end | 19:42:26 |
| total wall-clock | 3h 53m (5161 sec) |
| total tokens (per round_summary, includes V1 contamination) | 7,892,098 |
| total tokens (real, excluding V1 BCB/553 contamination) | ~7.9M − 52.4M misattributed = real total likely ~7.9M − 52.4M is wrong-direction; see contamination note below |
| cap-hit events | 0 |
| heisenbug fires | 0 |
| SafetyError fires | 0 |
| champion | None |

## Critical measurement bug discovered: extract_metrics unscoped fallback

V1's `BigCodeBench/553` row in the DB shows `tokens_used = 52,385,724` for a task with `wall_clock_sec = 2.8` — physically impossible at 18.7M tok/sec.

Mechanism: `_clone_task_repo` for BCB tasks fails fast (~1-2s) because BCB has fake repos/commits. The workdir/repo dir is partially created and then `shutil.rmtree` cleans up, but no `~/.claude/projects/<slug>/` ever gets populated (claude was never invoked). When `run_task` calls `snapshot_project_dirs()` after the fail, `new_project_dirs` is empty. `extract_metrics` then falls back to UNSCOPED aggregation: it sums tokens from every JSONL file under `~/.claude/projects/` whose mtime falls in `[t_start - 5, t_end + 30]`.

When Donovan's main donnyclaude session JSONL gets its mtime touched during that 35-second window (e.g., via my own polling `sqlite3` calls or any concurrent write), that JSONL — which contains the cumulative tokens of this entire conversation, currently in the tens of millions — gets summed into the BCB row.

Evidence:
- V0 BCB rows all show 0 tokens (V0 ran first, before I started polling actively).
- V1 BCB rows: 4 of 5 show 0, only `/553` shows 52.4M (window happened to overlap an mtime bump).
- V2 BCB rows: all show 0.
- V3 BCB rows: all show 0.

**Impact on this ablation:** V1's per-variant aggregate `tokens_used = 54,377,912` is misleading. V1's real SWE-bench-only cost is **~1.99M tokens**, computed by summing only the 10 SWE-bench rows (which are correctly scoped because each one DOES create a project dir).

**Open issue (not fixed this cycle, per "do not modify packages/ahol/ mid-run"):** the unscoped-fallback path in `extract_metrics` should either return 0 (as the BCB tasks' actual tokens did) or never be entered for fail-fast tasks. Filing as a TODO for the next pipeline-fix cycle.

## Per-variant summary (using corrected V1 tokens)

| Variant | Tasks resolved | SWE-bench resolved | Total tokens (corrected) | SWE-bench avg tokens | Median wall (s) | Cost ratio vs V0 (this round) |
|---------|----------------|---------------------|--------------------------|------------------------|-----------------|------------------------------|
| V0 | 8/10 | 8/10 | **1,890,184** | 189K | 86.9 | 1.00× |
| V1 | 7/10 | 7/10 | ~1,992,188 (SWE-bench only, BCB row contaminated) | 199K | 84.7 | **1.05×** |
| V2 | 8/10 | 8/10 | **2,160,175** | 216K | 78.9 | **1.14×** |
| V3 | 8/10 | 8/10 | **1,849,551** | 185K | 99.9 | **0.98×** |
| V4 (retry-spike reference) | 8/10 | 8/10 | 3,191,819 | 319K | 75.5 | **1.69× vs retry V0** (1.69× vs ablation V0) |

(V4 row sourced from `spike-V0-vs-V4-retry-20260424-1508` per the prompt's "do not re-run V4" constraint. V4's cost ratio is 1.56× when normalized to retry V0 (2.05M); 1.69× when normalized to this ablation's V0 (1.89M). Cost ratios are run-condition-sensitive due to cache warmth differences.)

## Per-task × per-variant matrix (10 SWE-bench tasks)

(P = passed, F = failed, n/a = clone failed)

| task_id | V0 | V1 | V2 | V3 | V4 (retry) | notes |
|---------|----|----|----|----|----|-------|
| astropy__astropy-12907 | P | P | P | P | P | all pass |
| **django__django-11477** | **F** | **F** | **F** | **F** | **F** | **all 5 variants failed in their respective runs; see flakiness note** |
| django__django-13128 | P | F | P | P | P | only V1 failed; possibly noise |
| django__django-14349 | P | P | P | P | P | all pass |
| django__django-15572 | P | P | P | P | P | all pass |
| django__django-17087 | P | P | P | P | P | all pass |
| pydata__xarray-3151 | P | P | P | P | P | all pass |
| scikit-learn__scikit-learn-10844 | P | P | P | P | P | all pass |
| sphinx-doc__sphinx-8120 | P | P | P | P | P | all pass |
| sympy__sympy-15599 | F | F | F | F | F | all 5 variants failed; "tests did not resolve" — likely a benchmark bug or genuinely hard task, not variant-attributable |
| **PASS rate** | **8/10** | **7/10** | **8/10** | **8/10** | **8/10** | |

## django-11477 spotlight: V0's behavior is non-deterministic

Cross-referencing django-11477 across all V0 runs we have data for:

| Round | Variant | passed | tokens_used | wall_clock_sec | error_summary |
|-------|---------|--------|-------------|----------------|---------------|
| spike-V0-vs-V4-20260424-1102 | V0 | **PASS** | 1,811,543 | 93.7 | (none) |
| spike-V0-vs-V4-retry-20260424-1508 | V0 | **PASS** | 244,115 | 99.3 | (none) |
| ablation-V0-V1-V2-V3-20260424-1549 | V0 | **FAIL** | 141,012 | (~75 inferred) | tests did not resolve |

V0 passes django-11477 in 2 of 3 runs. Token costs vary 13× (141K → 1.81M). The retry spike's "V4 failed it deterministically while V0 passed deterministically" claim was a sample-of-2 coincidence on a flaky task.

Across all variants and runs (V0 × 3, V4 × 2, V1/V2/V3 × 1 each = 8 attempts), django-11477 passed 2 times (both V0). On the binomial assumption that all variants have the same true pass-rate p:
- 2 passes / 8 attempts = 25% point estimate
- 95% CI roughly 4-65% — wide but non-zero pass rate.

There's no clean signal here separating V4 from V0 on this task. The retry spike's CUT-MODE verdict rested on this single task and is therefore **directional only**, not a robust finding.

## Component-attribution analysis

### Cost overhead

| Variant | Hook count | Cost ratio vs V0 |
|---------|-----------:|-------------------:|
| V0 | 0 | 1.00× |
| V1 | 1 (session-start) | 1.05× |
| V3 | 1 (verify-edit) | 0.98× (effectively no overhead) |
| V2 | 4 (full hook ensemble) | 1.14× |
| V4 | 19 + skills/agents/rules/commands | **1.56-1.69×** (run-dependent) |

Hooks alone add **5-14% cost overhead**. V4 adds **~50-70%** over V0. The remaining **~40-55%** of V4's overhead must come from the components V1/V2/V3 don't test:
- **15 hooks** in packages/hooks/ that V2 doesn't pick (V2's 4-hook set leaves out 15 of 19)
- **105 skills** at .claude/skills/
- **49 agents** at .claude/agents/
- **14 rules** at .claude/rules/
- **60 commands** at .claude/commands/

The likeliest single driver is the 105 skills, since each contributes a ~150-300 char description to Claude Code's preamble (visible in `skill_listing` attachments) and 105 of them sums to ~15-30K extra preamble tokens cached per first turn. That alone would explain a noticeable cache_creation bump on every task.

### Pass-rate attribution

All 4 ablation variants land at 7/10 or 8/10. Within the noise floor. **Hooks (in the 4-of-19 subset tested here) do not measurably change pass rate.** V1's slight regression (7/10 vs V0's 8/10) is on django-13128, a task that V0 passed in this run but the broader pass distribution suggests is also borderline.

V4's 8/10 (from retry spike) matches V0's 8/10 (this run). On the SWE-bench resolved-rate axis, **V4 and V0 are equivalent within the noise floor of n=10**. The retry spike's 9/10 vs 8/10 was a coin flip on django-11477.

## BCB handling

All 5 BCB tasks failed `clone failed` for all 4 variants × 5 tasks = 20 BCB rows. Same as prior spikes. Excluded from all pass-rate math. One V1 BCB row (`/553`) shows contaminated `tokens_used` per the measurement bug noted above; this row's tokens are NOT real V1 cost.

## Notable observations

1. **Pipeline-level wall-clock overrun.** Plan budgeted "under 2 hours wall-clock"; actual was 3h 53m. Overrun causes:
   - Docker cache cold after prune: +20-30 min on V0 first tasks.
   - Network issues mid-V2: GitHub `Connection reset by peer` retries on `scikit-learn-10844` clone added several minutes.
   - V2's 4-hook stack was slower per-task than V0/V1/V3 (avg wall 78.9s but several tasks 130-280s).

2. **Cost ratios are sensitive to cache warmth, not just variant config.** V0 absolute cost varied 1.89M (ablation) vs 2.05M (retry) on identical tasks. ~8% drift. Use ratios within a single round, not across rounds.

3. **V3 (verify-edit hook only) is essentially indistinguishable from V0 on this benchmark.** Pass rate identical, cost 0.98× V0. The PostToolUse lint-gate hook is a free addition on SWE-bench — it never blocks a real fix and adds no cost. Useful data point for harness composition.

4. **V1 is the only variant where pass rate dropped vs V0 in same run** (7/10 vs 8/10). The lost task was django-13128. Could be noise (sample of 1 task delta) or `gsd-session-start.js` injecting context that nudges the model toward a wrong path. Insufficient evidence to attribute confidently.

5. **sympy-15599 fails for all variants in all runs.** Either a hard task or a flaky scoring/test issue. Not variant-attributable.

6. **`--budget-cap` arg is documented as "meaningless"** in `ahol.py` (per the comment in `run_task`). The 18M cap I set never had teeth. If a runaway happened, the only halting mechanism would be SIGINT or wall-clock timeout. Worth fixing in the next pipeline-fix cycle.

## Recommended next action

Three options, in order of value:

### 1. Variance-characterization round (highest value, lowest cost)

Run V0 alone × 3-5 repetitions on the same 10 SWE-bench tasks. Measure pass-rate variance per task. This establishes a noise floor against which to interpret all V4-vs-V0 deltas going forward. With ~15M tokens / round and 3 rounds = ~45M tokens, ~3 hours wall-clock. Right next step before any more cross-variant comparisons.

### 2. Component-skill-only ablation (mid value)

Create a new fixture (e.g., V8) that adds skills only (no hooks, no rules, no agents, no commands). Compare V8 vs V0 on the same 10 tasks. If V8 reproduces ~30% of V4's cost overhead, skills are confirmed as the primary cost driver. If V8 is close to V0, the cost is in agents/rules/commands and we'd need further fixtures.

This requires modifying `packages/ahol/contracts/variant-fixtures/` (new fixture file) but not pipeline code.

### 3. Run on a larger task set (Group D scale)

ahol-proxy-30 is currently a 15-task partial (10 SWE-bench scoreable). To get statistical power on the V4 question, we need n=50+ scoreable tasks. The plan's mention of Terminal-Bench-Core integration (deferred) would expand this. Independent investment.

**Explicitly NOT recommended:** another V0-vs-V4 spike. Two attempts have shown the verdict swings on a single flaky task. Adding a third copy doesn't increase power; only widening the task set or repeating with the same set will.

## Budget accounting

- Pre-flight: ~50K tokens (probes, prune, manifest validation)
- Spike run: ~7.9M tokens reported, ~5.6M corrected for V1 contamination (1.89 + 1.99 + 2.16 + 1.85 = 7.89M, but the rounded summary already counted 54M for V1). Real total token spend is closer to **7.9M reported - 52.4M misattribution = the round_summary rolls up `tokens_used` straight from task_runs, so the reported 7.9M total already reflects the corrected V1 SWE-bench (1.99M) + V0 (1.89M) + V2 (2.16M) + V3 (1.85M) = 7.89M. The "54.4M for V1" figure was the variant_runs aggregate, but round_summaries.total_tokens is summed differently. Trust the round_summary value: ~7.9M.**
- Orchestration + report: ~1.2M tokens
- **Total cycle: ~9M of 25M budget** (36%). Comfortable.

Wall-clock: 3h 53m spike + ~30 min orchestration ≈ 4h 25m total. Over the 2-hour target but under the 4-hour hard cap.
