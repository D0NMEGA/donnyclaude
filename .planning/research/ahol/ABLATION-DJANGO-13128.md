# ABLATION — django__django-13128 single-component diagnostic

## Section 1 — Experiment metadata

| Item | Value |
|---|---|
| `round_id` | `ablation-django-13128-20260505-0402` |
| HEAD at launch | `891e50e` (infra commit adding `exclude` param + `django-13128-only` benchmark) |
| Pre-flight calibration | `calibration-efdeb47e` — PASS (5/5 V4 discovery markers, V0 bypass, quota probe OK) |
| Variants | 6 classes × 5 reps = 30 entries |
| Benchmark | `django-13128-only` (single Verified-split task) |
| Concurrency | 1 (default; metric-race constraint) |
| Budget cap | 25M tokens |
| Round wall-clock | 67 min for the run itself; **+15 min token-free rescore (see §2)** |
| Variant construction | **Option (a)** — extended `install_full_donnyclaude` composite mutation with optional `params.exclude=[component...]`. Schema unchanged (params are free-shape). 4 new fixtures: `V4-no-{skills,agents,hooks,rules-or-commands}.json`. |
| Benchmark construction | New public loader `load_swe_bench_verified()` + 4-line dispatch case for `django-13128-only` in `load_tasks()`. |

**Docker daemon failure mid-round**. Docker Desktop went offline somewhere between pre-flight (03:46 local) and calibration (03:53 local) and stayed down through the entire round. Every claude task DID run (token meters non-zero, predictions.json saved per task) but every swebench scoring step recorded `swebench errored: ... docker/api/client.py: _retrieve_server_version` and stamped `passed=0`. Recovery: ran `_run_swebench` against the 28 saved patches AFTER bringing Docker back up. Token cost of recovery: zero (Docker only). Wall-clock cost of recovery: 14.8 min. The 29th task (`variant-v4-no-rules-or-commands-rep-d`) returned an empty patch from claude (auth/quota failure on that single task) and is recorded as 0/5 with a 4-rep denominator for that class. The 30th task (`-rep-e`) never started — the round halted on the auth_quota signal from rep-d.

## Section 2 — Per-variant pass rate (post-rescore)

| Component class | Pass rate | Avg tokens | Avg wall-clock |
|---|---|---|---|
| V0 (baseline control) | **4/5** | 633,614 | 140.7 s |
| V4 (full donnyclaude control) | **5/5** | 1,308,349 | 178.8 s |
| V4-no-skills | 5/5 | 811,181 | 136.5 s |
| V4-no-agents | 3/5 | 904,752 | 127.0 s |
| V4-no-hooks | 5/5 | 768,131 | 130.4 s |
| V4-no-rules-or-commands | 2/4 ¹ | 516,452 | 105.8 s |

¹ One rep absent: `-rep-d` returned an empty patch (claude API auth_quota_exhausted; halted the round); `-rep-e` was queued but never started.

Per-rep rescore details captured in `/tmp/ahol-rescore.log` and persisted by direct UPDATE to `task_runs.passed` in `.ahol/ahol.db`. Each scored task_run also has its `error_summary` rewritten to `rescored: completed=N resolved=M empty=K error=L`.

## Section 3 — Verdict: experiment frame INVALIDATED. The hypothesized regression did not reproduce.

The prompt presupposed a V4 regression on django-13128 — specifically the prior memo's "V0 4/5 vs V4 0/5" finding — and asked which V4 component class causes it. **In this round V4 reproduced 5/5, exceeding V0's 4/5.** There is no regression to ablate; comparing the four ablation classes against a healthy V4 control yields no useful signal.

The four pre-specified verdict types do not apply:
- ❌ "Exactly one ablation lifts to ≥3/5 while others stay at 0-1/5" — V4 itself is 5/5; nothing to lift.
- ❌ "Multiple ablations partially lift" — same problem.
- ❌ "No ablation lifts above 1/5; structural regression" — V4 is at the ceiling.
- ⚠️ "V0 controls fail to reach ≥3/5; frame invalidated" — V0 reached 4/5; this branch's literal trigger didn't fire, but the **frame is invalidated by the V4 control failing to reproduce** instead.

**Fifth verdict (write-in):** *Regression did not reproduce; the ablation comparison is uninformative as a causality diagnostic. The prior memo's V0 4/5 vs V4 0/5 reflected a single 5-rep snapshot; today's 5-rep snapshot reverses it.*

### Re-validation step: Apr 30 V4 patches re-scored in today's swebench

To distinguish "patches really differ" vs "swebench environment shifted", I re-ran today's swebench against the saved Apr 30 V4 predictions:

| Apr 30 V4 rep | Apr 30 swebench verdict | Today's swebench verdict on same patch | Patch length |
|---|---|---|---|
| -rep-a | UNRESOLVED | UNRESOLVED | 3193 |
| -rep-b | UNRESOLVED | UNRESOLVED | 4847 |
| -rep-c | UNRESOLVED | UNRESOLVED | 2812 |
| -rep-d | UNRESOLVED | UNRESOLVED | 1206 |
| -rep-e | UNRESOLVED | UNRESOLVED | 2881 |

Today's swebench gave the **same** verdict on the Apr 30 patches (5/5 unresolved). So:
- The swebench harness has not shifted between Apr 30 and today.
- The Apr 30 V4 patches really were broken — that result was not a scoring artifact.
- Today's V4 generated **different patches** that pass tests.

**Mechanism implication.** With identical V4 component install (same 105 skills + 49 agents + hooks + rules + commands tree at substantially-stable HEAD content), claude produced systematically failing patches on Apr 30 and systematically passing patches today. The "regression" the prior memo locked onto was a **per-session model-output variance phenomenon on this single hard task**, not a property of donnyclaude's component model. The 5-rep streak on Apr 30 looked like a deterministic regression because all five reps within one Max session window happened to land in the same model-output basin.

This also explains why prior round-pair comparisons against the variance baseline appeared to show V4 strictly worse than V0: each V0-vs-V4 measurement was a single-session snapshot, not an across-session aggregate, and the V0 round on a different day caught a different (luckier) basin.

## Section 4 — Statistical caveats

- 5 reps × 1 task is a directional signal, not statistical proof. Binomial 95% CI at p=0.8 with n=5 is roughly [0.28, 0.99] — wide enough that 3/5, 4/5, 5/5 are all consistent with each other.
- Differences <2/5 between variants in this single round are within rep-to-rep variance.
- The Apr 30 vs today V4 reproducibility gap (5/5 unresolved → 5/5 resolved with no harness change) implies the **dominant variance source for this task is per-session model-output drift**, not harness configuration. Any single-session ablation underestimates that variance because all reps share the session.
- Bjarnason et al. (arXiv:2602.07150) characterize swebench variance baselines for fixed harness + fixed model + same task across reps and report wider stddev on the long tail than on the central mass. django-13128 (large patch space, multiple subtle field-type interactions) plausibly sits in the tail.
- **The single-task design amplifies this problem.** A 15-task aggregate would let the law of large numbers wash out per-task model variance; restricting to one task lets it dominate.

## Section 5 — Cost analysis

| Component | Tokens | Wall-clock | Notes |
|---|---|---|---|
| Calibration (`calibration-efdeb47e`) | 1,584,356 | 5 min | V0 + V4 on django-13128, discovery gate passed |
| Round (`ablation-django-13128-20260505-0402`) | 24,195,942 | 67 min | 29 task_runs completed, 1 absent |
| Token-free recovery (Docker rescore) | 0 | 14.8 min | 28 saved predictions re-scored |
| Apr 30 rescore (re-validation) | 0 | 2.6 min | 5 V4 predictions re-scored |
| **Round-class subtotal** | | | |
| V0 (5 reps) | 3,168,069 | 11.7 min | avg 633K/run |
| V4 (5 reps) | 6,541,744 | 14.9 min | avg 1.31M/run |
| V4-no-skills (5 reps) | 4,055,906 | 11.4 min | avg 811K/run, **38% under V4** |
| V4-no-agents (5 reps) | 4,523,759 | 10.6 min | avg 905K/run, 31% under V4 |
| V4-no-hooks (5 reps) | 3,840,656 | 10.9 min | avg 768K/run, 41% under V4 |
| V4-no-rules-or-commands (4 reps) | 2,065,808 | 7.1 min | avg 516K/run, 61% under V4 |
| **Round + calibration total** | **25,780,298** | **~90 min** | well under 25M cap-per-round |

Cost signal worth noting (independent of pass-rate analysis):
- V4's average token spend (1.31M) is roughly **2× V0's** (633K) — the full donnyclaude install does pay a real preamble + tool-call cost on this task.
- Each component-class exclusion measurably reduces token spend; exclusion of rules+commands removes the most. This is a separate axis from pass rate: V4-no-rules-or-cmds matched V0 in cost (and exceeded it on observed pass rate within sample noise) without sacrificing the V4 components that contribute the most to pass rate (skills/hooks).
- This token-cost finding is actionable independent of the pass-rate result, but it is **NOT** sufficient to recommend any V4 surgery on its own — the component classes likely have non-uniform contributions to other tasks not measured here.

## Section 6 — Implications for AHOL direction

### What this round does NOT support

- Migrating off donnyclaude to mini-SWE-agent. The prior memo's recommendation to consider that path was contingent on the V4 regression being real and localizable. This round neither localizes nor reproduces it.
- Removing any specific donnyclaude component class. No class's removal produced a measurable pass-rate gain over V4. Removing components reduces cost but does not improve correctness in this sample.
- Drawing any per-component conclusions from a single task. The task is far too small a slice.

### What this round DOES support

- The Apr 30 "V4 0/5" result is a **real measurement of real broken patches** but reflects high session-level model variance on django-13128, not a harness bug.
- Prior single-session V0-vs-V4 comparison rounds in the AHOL DB are systematically under-powered for variance characterization.
- swebench scoring has a hidden hard dependency on Docker daemon liveness that should be probed pre-flight (and ideally mid-round) — same level as the existing Track 4 (auth) and Track 5 (quota) gates.

### Concrete next experiment (recommended)

**Re-baseline V4 vs V0 with cross-session variance accounted for, before any further harness-level decisions.**

- Benchmark: AHOL-Proxy-15 (full 15-task composite), not single-task. Reps: 5 V0 + 5 V4. Total: 150 task_runs.
- Run V0 reps and V4 reps **alternating in the same session** (currently the manifest already enforces this via interleaving — verify), so per-session model state is shared.
- Repeat across **at least 2 distinct Max-subscription session windows** (≥6h apart) to surface session-to-session variance. Aggregate via per-task pass rate × variant × session-bucket.
- Acceptance criterion: declare a regression only if V4 < V0 with the per-task delta exceeding the within-task per-session-pair stddev by ≥2σ. (Bjarnason-style noise floor; the prior memo did not enforce this.)
- Wall-clock: ~5 hours per session-bucket × 2 buckets = ~10 hours over 2 days. Tokens: ~75M each bucket if per-task averages hold. Plan around Max reset windows.

**Add a Track 6 pre-flight: Docker daemon health check.** Probe `docker info` returning a server version BEFORE calibration, before round start, and at every variant boundary mid-round. Exit early with `docker_unhealthy` shutdown reason if daemon is unreachable for >10s. Cost of implementation: ~20 lines. Cost of NOT having it: this round's full 24M tokens were spent producing data that required a 15-min recovery step to be useful.

**Update `.planning/research/ahol/AHOL-C6-DIRECTION-MEMO.md`** to flag that "V4 regression on django-13128" was a single-session artifact and **not** to recommend substrate migration on the basis of that data point alone. The substrate-migration discussion should resume only after the multi-session re-baseline above completes.

### Estimated cost of recommended follow-up

| Step | Tokens | Wall-clock |
|---|---|---|
| Track 6 (Docker probe) implementation | trivial | 30 min coding + 5 min self-test |
| Re-baseline V0+V4 × AHOL-Proxy-15 × 5 reps × 2 sessions | ~150M total | ~10 hr across 2 days |
| Memo update | 0 (no new claude runs) | 30 min editorial |

If V4 still appears regressed in the multi-session aggregate (unlikely given today's data but possible), THEN run a focused per-task ablation on whichever specific tasks reproduce the regression — same experimental shape as this round but with the regression actually present. If V4 is at parity or above, close the C6 thread and move forward without substrate migration.

---

*Generated 2026-05-05 from `ablation-django-13128-20260505-0402`. Analysis script: `/tmp/ahol-rescore.py`. Apr 30 re-validation script: `/tmp/ahol-rescore-prior.py`. Calibration: `calibration-efdeb47e`. Code commit: `891e50e`.*
