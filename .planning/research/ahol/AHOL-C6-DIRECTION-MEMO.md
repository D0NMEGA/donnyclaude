# AHOL C6 — Direction memo (session close 2026-05-05)

Hand-off document for the next session. Records where AHOL stands at session
close, what the deep-research artifact contributed, what experiment is next,
and what is deliberately deferred. Read this before resuming.

## Current state as of close of session 2026-05-05

- **HEAD:** `2f22f14` (`comparison(ahol): V4 x5 vs variance baseline on AHOL-Proxy-15 - DECOMPOSE`).
- **AHOL-Proxy-15 noise floor:** 1 task at 2σ. Empirically grounded from
  `variance-V0-x5-20260428-0422` (mean 7.80, sample stddev 0.447, CV 5.7%).
  Set as the binding gate threshold for any future cross-variant comparison
  on this benchmark.
- **V4 verdict:** **DECOMPOSE.** V4×5 mean = 7.00 vs V0 baseline 7.80
  (`comparison-V4-x5-vs-variance-baseline-20260430-0501`). |delta| = 0.80
  tasks, below the 1-task gate.
- **Where the delta lives:** entirely on `django__django-13128`. V0 was 4/5
  on it (the lone flaky task in the variance round); V4 is 0/5 (reliably
  fails). Every other SWE-bench scoreable task in the suite was tied between
  V0 and V4: 7 tasks at 5/5, 2 tasks at 0/5 (`django-11477`, `sympy-15599`).
- **V4×5 zero observed variance** (7/7/7/7/7) is a **sampling artifact of
  the saturated 15-task bench**, not "deterministic narrowing." With 7
  deterministic-pass and 2 deterministic-fail tasks, all randomness lives
  in the single flaky task; if V4 reliably fails that one, V4 has no
  remaining axis on which to vary at this n.
- **Tracks 1+2+4+5 all live in the runner.** Tracks 1+2 verified in two
  rounds; Track 4 unit-tested for pattern mapping but in-flight halt
  branch unexercised; Track 5 exercised every calibration run.

## Research findings (deep research artifact 2026-05-05)

Externally-sourced context that reframes the verdict above. Treat these as
working assumptions, not all proven against this codebase yet.

- **AHOL-Proxy-15 cannot detect realistic harness improvements.** Per
  Bjarnason et al. (arXiv:2602.07150), per-attempt stddev on full
  SWE-bench Verified is **1.5–2.2pp**; AHOL-Proxy-15 with our 1-task gate
  resolves to ~10pp at best. We are 5–7× too coarse to see real harness
  effects.
- **The field has converged on minimal scaffolds.** mini-SWE-agent
  (~100 LoC) scores >74% on Verified. Anthropic's own SWE-bench harness
  uses 2 tools (bash + str_replace) and nothing else. Live-SWE-agent at
  79.2% Verified is a fork of mini-SWE-agent.
- **ETH AGENTS.md study (Feb 2026)** shows LLM-generated context files
  reduce success **0.5–2pp at +20% cost.** This matches the V4/V0 cost
  ratio observed here (1.30×) almost exactly — V4's overhead profile
  matches the documented "instruction-overhead regression" pattern, not
  the "broken harness" pattern.
- **The django-13128 regression is most likely targeted instruction
  interference**, per LLM Task Interference literature, not generalized
  harness damage. Specific instructions in V4's bundle (some skill,
  hook, or rule) interact with this specific task's pattern; the rest
  of the bundle is neutral.
- **Meta-Harness ablation (Stanford)** found that **tools and middleware
  transfer across base models; prose strategy does not.** Skills, agent
  prompts, and rule files are prose strategy by donnyclaude's
  classification — predicted to be the *least* portable component class.
  Hooks, MCP servers, and the bin/ install path are tools/middleware —
  the *most* portable.
- **Claude Code as substrate is non-stationary.** Anthropic ships changes
  to the loop, model routing, and prompt-cache behavior on a ~weekly
  cadence; cross-week comparisons inherit that drift. mini-SWE-agent
  and OpenHands V1 SDK are stationary by construction.
- **For a future EEG pivot:** NeuroWeaver (arXiv:2602.13473), EEG-Reptile
  (arXiv:2412.19725), and AutoML-EEG with a GEPA outer loop over a
  constrained EEG-pipeline DSL are the substrate options. **Not** the
  skill-stack approach; that pattern doesn't apply to ML-pipeline
  optimization.
- **Recommended substrates if continuing harness research:**
  mini-SWE-agent or OpenHands V1 SDK. **Not** Claude Code, due to the
  non-stationary baseline above.

## Next experiment authorized

**Single-component ablation on `django__django-13128` only.**

The DECOMPOSE verdict + the targeted-interference hypothesis (research
finding #4 above) means the highest-information experiment AHOL can run
without expanding the benchmark is to isolate which component class in
V4 causes the django-13128 regression. The result determines whether
donnyclaude is salvageable as an AHOL substrate or whether to migrate.

### Design

| Condition | Description | Expected pass rate (hypothesis) |
|---|---|---|
| V0 | Zero-mutation baseline (control) | 4–5/5 (matches variance round 4/5) |
| V4 | Full donnyclaude (current) | 0/5 (matches comparison round) |
| V4 −skills | V4 with no skills installed | TBD |
| V4 −agents | V4 with no agents installed | TBD |
| V4 −hooks | V4 with no hooks installed | TBD |
| V4 −rules+commands | V4 with no rules/ or commands/ | TBD |

Whichever ablation **restores 4–5/5** identifies the component class
responsible for the interference. This is the diagnostic before deciding
scrap-vs-salvage on donnyclaude as an AHOL substrate.

### Cost

- **Tasks:** 5 conditions × 10 reps × 1 task = 50 invocations
- **Wall-clock:** ~30–45 min at concurrency=1
- **Tokens:** ~3–5M (~95% V4-class invocations averaging ~600K each on
  this specific task per the comparison round data)
- **Quota:** fits comfortably in one Max x5 reset window
- **Pre-flight:** Track 5 quota probe + calibration if HEAD changes

### Implementation notes for next session

- Need 6 new variant fixtures or one fixture with 6 variants:
  `variant-v0-rep-{a..j}`, `variant-v4-rep-{a..j}`, `variant-v4-no-skills-rep-{a..j}`,
  etc. Schema-compliant naming required (`^(V[0-9]+|variant-[0-9a-z-]+)$`).
- The bootstrap path in `packages/ahol/runner/variants.py` already supports
  selective install via the mutation registry — extend it with `remove_skills`,
  `remove_agents`, `remove_hooks`, `remove_rules_commands` mutations.
- Use `--task-limit` or filter the benchmark loader to return only
  `django__django-13128`. May need a small dispatch tweak in
  `load_tasks` or a new `--task-id` filter flag.

## Deferred / not in scope

- **Terminal-Bench-Core ingestion** (would expand AHOL-Proxy-30 to full
  30 tasks, halve the noise floor to ~0.7-task gate). Deferred pending
  the django-13128 ablation result. If salvage path wins, this is the
  next infra investment. If migration path wins, this becomes moot.
- **Migration to mini-SWE-agent or OpenHands V1 SDK substrate.** Deferred
  pending ablation. Triggered if ablation shows the regression is in
  prose-strategy components (skills/agents/rules) — i.e., the components
  research predicts won't transfer cross-base-model anyway.
- **EEG pivot architecture** (NeuroWeaver-style). Separate planning thread.
  Not an AHOL extension; would be a new project under a different roadmap.
- **DanMLProject NotebookEdit hook patch** in `~/Desktop/DanMLProject/`.
  Past tense, leave uncommitted indefinitely. Out of scope for AHOL and
  for any future donnyclaude session unless the user explicitly redirects.
- **Heisenbug fix.** The calibration redesign (discovery-based gate via
  session-JSONL marker inspection) circumvents it; the bug itself remains
  unfixed and deliberately so per `HEISENBUG-AUDIT.md`.
- **Self-test coverage expansion** for Tracks 4+5 in-flight halt branches.
  Pattern mapping is unit-tested; integration is verified live in real
  rounds. Acceptable until either branch fires unexpectedly.

## Pointers for the next session

- This memo: `.planning/research/ahol/AHOL-C6-DIRECTION-MEMO.md`
- Variance baseline: `.planning/research/ahol/VARIANCE-V0-CHARACTERIZATION.md`
- DECOMPOSE verdict: `.planning/research/ahol/COMPARISON-V4-X5-VS-BASELINE.md`
- Tracks 1+2 commit: `93849f5`
- Tracks 4+5 commit: `e63c7a5`
- Latest verdict commit: `2f22f14`
- Deep research bundle (if needed by reviewer): `~/Downloads/donnyclaude-deep-research-2026-05-05.zip`

---

*Generated 2026-05-05 at session close, HEAD `2f22f14`. Next session: start
the django-13128 ablation per "Next experiment authorized" above. Do not
re-litigate the DECOMPOSE verdict; do not re-measure V0; do not migrate to
a new substrate without first running the ablation.*
