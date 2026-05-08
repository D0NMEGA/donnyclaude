# Milestone: Substrate Migration to Real Harness Optimization

**Milestone ID:** `harness-pivot-v1`
**Created:** 2026-05-08
**Predecessor:** AHOL v1 (DECOMPOSE verdict, ablation indecisive, donnyclaude substrate confirmed inadequate)
**Successor target:** Reusable harness ablation methodology + a working harness-v1 substrate that can be ported to EEG/BCI work

## The bet, stated plainly

**Bet:** A solo builder can produce decision-grade evidence about coding-agent harness layers if and only if the substrate exposes those layers as small, named, ablatable units AND the measurement methodology accounts for infrastructure noise + benchmark variance. AHOL failed because donnyclaude exposed only one layer (project-scope `.claude/` config) on top of a closed agent loop, while the actual causal weight lives in the hidden layers (loop, tools, sampling, context management).

**Falsification:** If after Phase 14 the harness-v1 fork on mini-SWE-agent does NOT reproduce a published Sonnet-4-class baseline within 3pp, the bet is invalidated and the methodology has a defect that isn't substrate choice. Triggers a Phase 15A diagnostic loop instead of proceeding.

**Win condition:** By Phase 27, ship a locked harness-v1 substrate with one published-quality ablation memo (sampling × step budget Pareto frontier) and a documented methodology that ports to non-coding domains.

**Out-of-scope for this milestone:** Multi-model routing as primary architecture, claw-code fork, OpenMythos anything, web/iOS/Liquid Glass adaptation, EEG pivot. Those are downstream milestones gated on harness-v1 working.

---

## Phase 1 — Capture the AHOL post-mortem before context fades

**Bet:** The methodology errors that produced AHOL's DECOMPOSE verdict are the most valuable artifact from the failed milestone, and they will fade from memory faster than the technical work will.

**Action:**
- Write `.planning/research/ahol/AHOL-POSTMORTEM.md` covering: (1) what was actually mutated (`.claude/` files only), (2) what the harness layers looked like in retrospect (the 20-layer taxonomy from research artifact), (3) what the empirical results actually showed once interpreted correctly (single-task variance, not localized regression), (4) the methodology errors named explicitly (mutation alphabet too narrow, n too small, infra noise unmeasured, benchmark validity untested).

**Exit criteria:** Document committed. Cross-references the deep research artifact and the previous DIRECTION-MEMO post-ablation revision.

**Effort:** 30 min. No code. No tokens.

**Dependency:** None. Start here.

---

## Phase 2 — Quarantine donnyclaude / AHOL workspace

**Bet:** Mixing the new substrate work into the existing donnyclaude tree will produce confusion about which artifact belongs to which methodology. Clean separation now is cheap; later it isn't.

**Action:**
- Create new repo: `harness-lab` (separate git repo, not a donnyclaude subdir).
- Tag donnyclaude HEAD as `ahol-v1-final`. Document in donnyclaude README that AHOL is paused, not abandoned, and link to harness-lab.
- Move the deep research artifact and post-mortem into `harness-lab/research/`.

**Exit criteria:** harness-lab repo exists, empty except research/. donnyclaude tagged.

**Effort:** 30 min.

**Dependency:** Phase 1.

---

## Phase 3 — Hardware and tooling pre-flight

**Bet:** Substrate setup will surface dependency issues that, if discovered mid-Phase-5, will block evaluation runs. Front-load discovery.

**Action:**
- Verify Docker Desktop running with ≥6GB RAM allocated and ≥3× resource headroom enabled (per Anthropic infrastructure-noise paper).
- Verify Python 3.11+ environment via `uv` or `pyenv`.
- Verify ANTHROPIC_API_KEY available (or confirm OAuth-Max workaround for Sonnet baselines).
- Provision OpenRouter account with $30 starting credit.
- Document hardware specs and free disk in `harness-lab/research/HARDWARE.md`.

**Exit criteria:** All four verifications pass; HARDWARE.md committed.

**Effort:** 60 min.

**Dependency:** Phase 2.

---

## Phase 4 — Provider account survey

**Bet:** The cost gap between providers (Moonshot direct vs OpenRouter vs Anthropic API vs Max OAuth) will be larger than the engineering cost to support multiple, but the model choice has to be locked before substrate work to avoid retest cycles.

**Action:**
- Survey Moonshot direct (USD payment friction), OpenRouter (markup, rate limits), Anthropic API direct, Anthropic Max via Claude Code OAuth (rate limit ceiling). Document cost per 1M tokens for K2.6 + Sonnet 4.6 + Opus 4.7.
- Confirm OpenRouter rate limits sufficient for ~250 trajectory burst (50 tasks × 5 reps).
- Pick one primary provider for K2.6 (probably OpenRouter), one secondary (Moonshot direct as fallback).

**Exit criteria:** `harness-lab/research/PROVIDERS.md` committed with cost table and primary/secondary picks.

**Effort:** 30 min.

**Dependency:** Phase 3.

---

## Phase 5 — Fork mini-SWE-agent v2

**Bet:** mini-SWE-agent's published baseline (>74% Verified with Sonnet 4) is reproducible by a solo builder within one working day if the fork is clean and the eval harness is correctly configured. If reproduction fails, the bet is bigger than substrate choice.

**Action:**
- Fork `SWE-agent/mini-swe-agent` at a pinned commit SHA. Document SHA in harness-lab.
- Install via `pip install -e .` in a fresh venv inside harness-lab/.
- Run `mini` (interactive mode) on a trivial test problem (sum two numbers in Python). Confirm tool loop, parse, and execute work end-to-end.
- Run `mini-extra swebench --instances django__django-13128 --workers 1 --model anthropic/claude-sonnet-4-6` (one task, one rep) as a smoke test.

**Exit criteria:** Single-instance smoke test produces a preds.json. Cost spent ≤ $0.50.

**Effort:** 90 min.

**Dependency:** Phase 4.

---

## Phase 6 — Wire SWE-bench evaluation pipeline

**Bet:** Scoring is a separate failure mode from generation (per the AHOL Docker daemon issue). Make the eval pipeline work cleanly before any benchmark run.

**Action:**
- Install sb-cli OR set up local SWE-bench harness via Docker. Pick one. Document choice.
- Score the Phase 5 smoke test preds.json. Confirm pass/fail signal works.
- Write a thin Python wrapper `score_round.py` that takes a preds.json path and outputs structured JSON with per-task pass/fail + cost.

**Exit criteria:** Smoke test scored end-to-end. score_round.py committed.

**Effort:** 90 min.

**Dependency:** Phase 5.

---

## Phase 7 — Reproduce a published Sonnet 4.6 baseline (50 tasks, 1 rep)

**Bet:** If the substrate plus eval pipeline reproduce within 3pp of mini's published Sonnet 4 baseline (~74-77% on Verified), the methodology is sound. If not, there is a setup defect that all subsequent ablations would inherit.

**Action:**
- Pick 50 instances from SWE-bench Verified. Use the Hobbhahn 2025 Verified-Mini subset if accessible; otherwise random sample with fixed seed.
- Run mini-SWE-agent + Sonnet 4.6 (`anthropic/claude-sonnet-4-6`) at default config: temperature default, max_steps=250, default system prompt.
- 1 rep per task.
- Score and report mean pass rate ± Wilson CI.

**Exit criteria:** Mean pass rate within [70%, 85%] band. Cost ≤ $30. Commit `baselines/sonnet-46-verified-50-rep1.json`.

**Decision gate:** If outside band, branch to Phase 7A (debug substrate before continuing). If inside, proceed.

**Effort:** 2-3 hours wallclock; ~$15-25.

**Dependency:** Phase 6.

---

## Phase 7A (CONDITIONAL) — Substrate debugging

**Triggered by:** Phase 7 result outside [70%, 85%].

**Bet:** Substrate failures cluster around three causes — eval harness misconfiguration, provider routing wrong, or Docker resource starvation. Diagnose by elimination.

**Action:**
- Re-run 5 instances with verbose logging.
- Inspect: parse failure rate, mean step count, mean tokens, Docker container exit codes.
- Compare to mini-SWE-agent's published trajectories on the same instances.

**Exit criteria:** Root cause identified and fixed; Phase 7 re-runs in band.

**Effort:** Up to 1 day.

---

## Phase 8 — Reproduce K2.6 published baseline (50 tasks, 1 rep)

**Bet:** Kimi K2.6's published 80.2% on Verified is reproducible via OpenRouter at the cost claim of ~$0.60/$2.50 per 1M tokens. If reproduction fails or cost is materially higher than projected, K2.6 is not the right primary model and the substrate must be revisited.

**Action:**
- Same 50-instance subset as Phase 7.
- Run mini-SWE-agent + Kimi K2.6 (`moonshotai/kimi-k2.6` via OpenRouter).
- 1 rep per task.
- Compare to Phase 7 pass rate and cost.

**Exit criteria:** Pass rate within [75%, 85%] band. Cost ≤ $10 (target: $5-8). Commit `baselines/kimi-k26-verified-50-rep1.json`.

**Decision gate:** If pass rate < 75%, K2.6 is not delivering published numbers under your config. Branch to Phase 8A. If cost > 1.5× projection, document and consider Moonshot-direct as fallback.

**Effort:** 2-3 hours; $5-15.

**Dependency:** Phase 7.

---

## Phase 8A (CONDITIONAL) — K2.6 routing diagnosis

**Triggered by:** Phase 8 pass rate or cost outside band.

**Bet:** OpenRouter quality varies by upstream provider (Moonshot vs Together vs Fireworks). If cost or quality is off, the upstream choice is the lever.

**Action:**
- Re-run 10 instances pinned to a specific OpenRouter provider via `provider.order` field.
- Compare to Moonshot-direct.
- Pick the upstream that reproduces published numbers.

**Exit criteria:** Phase 8 re-runs in band with specific provider documented.

**Effort:** 2 hours.

---

## Phase 9 — Variance characterization (3 reps × 50 tasks, both models)

**Bet:** Per-model variance on Verified-50 is ~2-4 tasks at 3 reps based on Bjarnason et al. evidence. Knowing the actual noise floor for THIS substrate is required before any ablation comparisons can be statistically defensible.

**Action:**
- Run Sonnet 4.6 × 3 reps on the 50 tasks (3 separate temperature=0 runs at different times of day).
- Run K2.6 × 3 reps same protocol.
- Compute per-task pass rate, per-rep total pass count, mean ± stddev, coefficient of variation.
- Compute per-task agreement: how many tasks pass 3/3, 2/3, 1/3, 0/3?

**Exit criteria:** Per-model variance documented. Empirical 2σ noise floor stated as a number of tasks. Commit `baselines/variance-characterization-v0.json` and a memo.

**Effort:** ~6-8 hours wallclock; $20-40 total.

**Dependency:** Phase 8.

---

## Phase 10 — Write the methodology spec

**Bet:** Every published harness optimization paper that produced credible evidence (Meta-Harness, Live-SWE-agent, Bjarnason et al.) had an explicit methodology document BEFORE running ablations. AHOL didn't, and that's why the verdicts drifted. Lock the methodology now.

**Action:**
- Write `harness-lab/METHODOLOGY.md` covering:
  - Substrate (mini-SWE-agent fork + commit SHA)
  - Models (K2.6 primary, Sonnet 4.6 reference baseline, Opus 4.7 reserved for capability-ceiling tests)
  - Eval (SWE-bench Verified-50 subset by default; Multilingual or held-out for contamination control)
  - Sample size minimum: n=3 reps for directional, n=10 for decision-grade
  - Statistical reporting: mean ± Wilson CI, paired comparisons via per-task delta, stddev floor stated explicitly
  - Infra controls: Docker resource specs, time-of-day sampling, model API version pinning
  - Utility scoring: SICA-style w_score=0.5, w_cost=0.25, w_time=0.25
  - Reproducibility: pinned harness SHA, pinned eval SHA, pinned model API version, pinned seed where applicable
  - Pre-registration: what effect size is "real" given sample size, declared before run, not after
- Commit and tag as `methodology-v1`.

**Exit criteria:** METHODOLOGY.md committed and tagged.

**Effort:** 2-3 hours.

**Dependency:** Phase 9 (variance numbers needed for the noise-floor section).

---

## Phase 11 — Lock harness-v0 (the baseline configuration)

**Bet:** Every ablation needs a stable reference point. Without an explicit lock, baseline drift will contaminate cross-phase comparisons.

**Action:**
- Snapshot the mini-SWE-agent fork at the exact YAML config used for Phases 7-9.
- Tag in harness-lab as `harness-v0`.
- Document: model = K2.6, all sampling defaults, max_steps=250, bash-only tool catalog, default system prompt.

**Exit criteria:** Tag exists. Config archived in `configs/harness-v0.yaml`.

**Effort:** 30 min.

**Dependency:** Phase 10.

---

## Phase 12 — Read the three reference architectures end-to-end

**Bet:** The 100 lines of mini-SWE-agent are the most concentrated harness-design knowledge available; reading the OpenHands V1 SDK paper provides the production-grade comparison; reading Meta-Harness provides the methodology comparison. All three are required to make Phase 13+ design choices intelligently.

**Action:**
- Read every file in mini-SWE-agent/. Annotate which lines correspond to which of the 20 harness layers from the taxonomy.
- Read OpenHands V1 SDK paper (arXiv 2511.03690) sections on the nine components.
- Read Meta-Harness paper (Stanford IRIS, arXiv 2603.28052) sections on methodology, evaluation gating, and the filesystem-trace optimizer.
- Write `harness-lab/research/SUBSTRATE-NOTES.md` with: which layers mini exposes cleanly, which require fork-edits, which are coupled to LiteLLM, which are coupled to SWE-bench scoring.

**Exit criteria:** SUBSTRATE-NOTES.md committed.

**Effort:** 4-6 hours.

**Dependency:** Phase 11. Can run in parallel with Phase 13 only if reading is genuinely complete first.

---

## Phase 13 — First real ablation: sampling parameters

**Bet:** Sampling parameters (temperature, reasoning_effort) are the highest-leverage cheapest harness-layer ablation. Published evidence puts the effect at 3-8pp. Effect size > variance floor (Phase 9), so this is a clean test of the methodology.

**Action:**
- Sweep `temperature ∈ {0, 0.2, 0.7}` × `reasoning_effort ∈ {default, high}` where supported (K2.6 supports thinking modes; Sonnet 4.6 has extended thinking).
- 50-task subset, 3 reps per cell, primary model = K2.6.
- Pre-register: effect must exceed Phase 9 stddev × 2 to count as real.
- Plot pass rate vs cost per cell. Identify Pareto frontier.

**Exit criteria:** `ablations/01-sampling.md` committed with Pareto plot, declared winning config, and pre-registered effect size analysis.

**Effort:** 6-9 hours wallclock; $30-60.

**Dependency:** Phase 12.

---

## Phase 14 — REPRODUCTION GATE

**Bet:** If Phases 7, 8, and 9 reproduced published baselines and Phase 13 produced a coherent Pareto frontier, the substrate is validated as a measurement instrument. If not, we stop adding ablations and diagnose.

**Action:**
- Review Phases 7-13 deliverables holistically.
- Confirm: baselines reproduce within 3pp; variance numbers match published ranges; Phase 13 effect sizes are credible.
- Decision: PROCEED to Phase 15 (substrate validated) or BRANCH to Phase 14A (substrate has unexplained behavior).

**Exit criteria:** Decision documented in `harness-lab/research/REPRODUCTION-GATE.md`.

**Effort:** 1 hour.

**Dependency:** Phase 13.

**This is the milestone-level falsification gate.** If Phase 14 says "branch," the bet is partially invalidated.

---

## Phase 14A (CONDITIONAL) — Substrate revalidation

**Triggered by:** Phase 14 says branch.

**Action:**
- Identify which sub-phase produced unexpected results.
- Run targeted re-tests with different upstream provider, different time-of-day, different SWE-bench subset.
- If still inconsistent: consider migrating to OpenHands V1 SDK as alternate substrate.

**Effort:** Up to 1 week.

---

## Phase 15 — Second ablation: step budget

**Bet:** SWE-rebench evidence shows GLM-4.6 hits step cap 2× as often as 4.5; step budget is genuinely load-bearing for some models. K2.6 may be the same.

**Action:**
- Sweep `max_steps ∈ {50, 100, 250, 500}`.
- Hold sampling at Phase 13 winning config.
- 50-task subset, 3 reps.
- Plot pass rate vs cost; identify diminishing-return point.

**Exit criteria:** `ablations/02-step-budget.md` committed.

**Effort:** 6-9 hours; $30-60.

**Dependency:** Phase 14.

---

## Phase 16 — Third ablation: tool catalog (bash vs +str_replace_editor)

**Bet:** Adding a structured edit tool on top of bash-only is Anthropic's default for their published Verified scaffold. Effect should be 2-5pp on Claude; effect on K2.6 is unmeasured and worth knowing.

**Action:**
- Implement Anthropic-style str_replace_editor tool in mini-SWE-agent fork (port from SWE-agent/tools/edit_anthropic).
- Variant A: bash-only (control, harness-v0).
- Variant B: bash + str_replace_editor.
- 50-task subset, 3 reps each.

**Exit criteria:** `ablations/03-tool-catalog.md` committed.

**Effort:** 1 day code + 6-9 hours run; $30-60.

**Dependency:** Phase 15.

---

## Phase 17 — Fourth ablation: action representation (parsing strategy)

**Bet:** Parse-failure rate and recovery semantics affect total cost more than mean pass rate; finding the parser that minimizes wasted turns is a cost-optimization win even if pass rate is flat.

**Action:**
- Variant A: regex bash-fence extraction (mini default).
- Variant B: native tool-call API (where supported by both K2.6 and Sonnet 4.6).
- Measure parse-failure rate per turn, mean tokens per task, pass rate.

**Exit criteria:** `ablations/04-action-rep.md` committed.

**Effort:** 1 day code + 6-9 hours run; $30-60.

**Dependency:** Phase 16.

---

## Phase 18 — Fifth ablation: context management (linear vs compaction)

**Bet:** On hard tasks where K2.6 hits step cap, context bloat is a plausible mechanism. Compaction at 75% may both reduce cost and improve completion rate on long tasks.

**Action:**
- Variant A: linear history (mini default).
- Variant B: trigger compaction at 75% of model context window via Anthropic compaction primitive (Sonnet) or manual summarization (K2.6).
- Focus on the long-tail tasks (those that hit step budget in Phase 15).

**Exit criteria:** `ablations/05-context-mgmt.md` committed.

**Effort:** 1-2 days code + 6-9 hours run; $30-60.

**Dependency:** Phase 17.

---

## Phase 19 — Sixth ablation: validation hook (run-tests-before-submit)

**Bet:** Agentless's evidence shows validation steps are nearly free and net-positive. Adding a deterministic "run failing test, check pass" hook before submit should add 1-3pp at low cost.

**Action:**
- Variant A: no validation (control).
- Variant B: hook runs `pytest <fail-to-pass-test>` after patch generation; if fail, append result and let agent retry one more turn.
- 50-task subset, 3 reps.

**Exit criteria:** `ablations/06-validation-hook.md` committed.

**Effort:** 1 day code + 6-9 hours run; $30-60.

**Dependency:** Phase 18.

---

## Phase 20 — Synthesis: harness-v1 configuration

**Bet:** The winning configurations from Phases 13-19 compose roughly additively if conflicts have been avoided. Compose them into harness-v1 and validate against the baseline.

**Action:**
- Combine winning sampling config (Phase 13) + winning step budget (Phase 15) + winning tool catalog (Phase 16) + winning parser (Phase 17) + winning context strategy (Phase 18) + validation hook (Phase 19) into a single config.
- Run on the 50-task subset, 3 reps.
- Compare to Phase 9 baseline numbers.
- Pre-register: combined effect should be within ±3pp of sum of individual effects.

**Exit criteria:** `harness-v1` config tagged. Combined ablation memo `ablations/07-harness-v1-synthesis.md` committed.

**Effort:** 1 day code + 6-9 hours run; $30-60.

**Dependency:** Phase 19.

---

## Phase 21 — Generalization test: held-out benchmark

**Bet:** Improvements measured on Verified may be partially driven by training-set contamination. A held-out benchmark (SWE-bench Multilingual or SWE-rebench) tests whether harness-v1's gains generalize.

**Action:**
- Run harness-v0 (baseline) and harness-v1 (synthesized) on 30-task held-out subset.
- 3 reps each.
- Compare delta to Phase 20 delta.

**Exit criteria:** `ablations/08-held-out.md` committed. Delta on held-out within ±2pp of Verified delta means no contamination signal; larger gap means caveat the result.

**Effort:** 6-9 hours wallclock; $30-60.

**Dependency:** Phase 20.

---

## Phase 22 — Synthesis decision gate

**Bet:** By Phase 22, we have either (a) a harness-v1 that beats harness-v0 by a measurable margin on both Verified AND held-out, or (b) clear evidence the methodology produces null results. Both are publishable; both are decision-grade.

**Action:**
- Review Phases 20-21 deliverables.
- Decision: harness-v1 is GOOD (deploy as primary), MARGINAL (use as default but don't claim wins), or NULL (no measurable improvement).

**Exit criteria:** `harness-lab/research/SYNTHESIS-VERDICT.md` with decision and reasoning.

**Effort:** 2 hours.

**Dependency:** Phase 21.

---

## Phase 23 — Public methodology memo

**Bet:** Writing the milestone up as a publishable artifact forces the methodology to be defensible and creates a reusable template for the EEG pivot.

**Action:**
- Write `harness-lab/research/HARNESS-V1-MEMO.md` (~3000 words) covering: substrate, methodology, ablation results, harness-v1 final config, comparison to published baselines, caveats. Format suitable for a blog post or arXiv preprint.
- Decide whether to publish externally (separate decision; doesn't gate the milestone).

**Exit criteria:** Memo committed.

**Effort:** 1-2 days.

**Dependency:** Phase 22.

---

## Phase 24 — Stretch: Live-SWE-agent-style runtime tool synthesis

**Bet:** Live-SWE-agent's 79.2% on Verified comes from runtime tool synthesis on top of mini-SWE-agent. If harness-v1 is at, say, 76%, adding runtime synthesis could close the gap with Live-SWE-agent's reported number — a real test of whether the methodology can compose with a substantially different layer.

**Action:**
- Read Live-SWE-agent paper carefully; clone reference repo.
- Implement runtime tool-creation as harness-v2 mutation on top of harness-v1.
- 30-task subset, 3 reps.
- Compare to harness-v1 and to Live-SWE-agent's published number.

**Exit criteria:** `ablations/09-runtime-tool-synthesis.md` committed.

**Decision gate:** If this works, harness-v2 supersedes harness-v1 as default; if it doesn't, document why (likely budget or context-management interaction).

**Effort:** 3-5 days code + 6-9 hours run; $40-80.

**Dependency:** Phase 23. Optional within milestone.

---

## Phase 25 — Stretch: Meta-Harness-style outer-loop optimizer

**Bet:** Meta-Harness's outer-loop optimizer over harness *code* (with filesystem trace access) is the published version of what AHOL was trying to be. Implementing a small version validates whether the methodology genuinely supports automated harness search.

**Action:**
- Implement a lightweight outer-loop optimizer using Sonnet 4.6 as proposer agent and harness-v1 as inner harness.
- Budget: 50 candidate evaluations on a 30-task held-in subset.
- Track: best candidate, mean candidate, diversity.
- Compare best evolved harness to harness-v1.

**Exit criteria:** `ablations/10-meta-harness.md` committed. Decision: did the outer loop find improvements beyond hand-tuned harness-v1?

**Effort:** 1-2 weeks. Cost: $200-500 (this is the expensive ablation).

**Dependency:** Phase 24.

**Note:** This phase is optional within the milestone but is the one that most directly redeems AHOL as an idea. Skip without guilt if budget/calendar pressure dictates.

---

## Phase 26 — Methodology port-test: 5-task BCI/EEG smoke test

**Bet:** The methodology (substrate fork, layer ablation, locked config, utility scoring) ports cleanly to non-coding domains. Running a 5-task EEG-pipeline-discovery smoke test validates the port without committing the full EEG milestone.

**Action:**
- Define 5 EEG-pipeline tasks: subject-specific best-pipeline-discovery on 5 BCI-IV-2a-style subjects. Tools: scipy/MNE Python REPL, predefined CSP/CAR/LDA/SVM/Riemannian classifier set.
- Reuse harness-v1 substrate; swap tool catalog and system prompt for the BCI domain.
- Reuse SICA-style utility scoring (substituting per-subject classification accuracy for SWE pass rate).
- 5 tasks × 3 reps.

**Exit criteria:** Smoke test produces a number. Commit `eeg-port/SMOKE-TEST.md`. NOT a real EEG milestone — just a port-test of the methodology.

**Effort:** 2-3 days for tool catalog + 1 day run; ~$30.

**Dependency:** Phase 23 (minimum). Can defer past Phase 25.

---

## Phase 27 — Milestone close-out

**Bet:** A milestone that doesn't have an explicit close phase will leak into the next milestone and contaminate it. Close cleanly.

**Action:**
- Write `harness-lab/MILESTONE-CLOSE.md`: phases completed, phases skipped, costs spent, lessons.
- Tag final harness state.
- Decide next milestone: EEG pivot (use Phase 26 as foundation) OR harness-v2 (extend with Live-SWE-agent / Meta-Harness if Phases 24-25 produced strong signal) OR pause.
- Write `harness-lab/NEXT.md` stating next milestone hypothesis.

**Exit criteria:** MILESTONE-CLOSE.md and NEXT.md committed.

**Effort:** 4 hours.

**Dependency:** All prior phases.

---

## Cost and time projection (revised against actual data)

Counting only required phases (1-23, 27): roughly 4-6 weeks of part-time work, $200-400 in API costs, ~50-80 hours of focused engineering.

Adding stretch phases (24-26): 6-10 weeks, $500-1000 total.

These are point estimates; the variance on a solo build is real. Pre-registering a budget per phase and tracking against it is part of the methodology; deviation > 50% triggers a re-plan, not a push-through.

## Phase dependency graph (text)

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → [7A?] → 8 → [8A?] → 9 → 10 → 11 → 12 → 13 → 14 (GATE)
                                                                          ↓
                                                              [14A? branch]
                                                                          ↓
                                                                          15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 27
                                                                                                                  ↓
                                                                                                                  24 → 25 → 26 (stretch)
```

## Anti-patterns this plan explicitly rejects

1. Mutating donnyclaude `.claude/` content as the primary action surface (the AHOL trap).
2. Forking claw-code (legal hazard, complexity hazard, no Max OAuth).
3. Adopting OpenMythos as a reference (it is a model architecture, not a harness).
4. Multi-model routing as a Phase 1-10 concern (premature; defer past Phase 23).
5. Running ablations without pre-registered effect sizes (the AHOL methodology error).
6. Reporting deltas under 3pp as wins (within infra-noise per Anthropic).
7. Optimizing system prompt length or skill descriptions in lieu of tool/loop layers (AHOL trap restated).
8. Skipping the variance characterization phase (Phase 9) and proceeding to ablations on uncalibrated noise floor.
9. Skipping the held-out generalization test (Phase 21) — Verified contamination is real.
10. Letting context bleed across milestones — quarantine in Phase 2 is non-optional.

## Cross-cutting principles

- **Every phase has a deliverable in git.** No phase completes without a commit.
- **Every ablation has pre-registered effect sizes.** Deltas under threshold are null results, not weak wins.
- **Every cost estimate is real-money budgeted.** Going over by 50% triggers a re-plan, not a push-through.
- **Every published-baseline reproduction is a falsification opportunity.** If we can't reproduce what other people published, the methodology has a defect.
- **Every methodology choice is reusable.** This isn't just for coding agents; the EEG pivot inherits Phase 10's METHODOLOGY.md verbatim.
