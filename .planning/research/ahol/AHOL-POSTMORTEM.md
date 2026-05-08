# AHOL Post-Mortem (v1)

**Status:** Phase 1 deliverable of milestone `harness-pivot-v1` (substrate migration to real harness optimization). Written 2026-05-08 at HEAD `bf6dd7a` to capture methodology errors before context fades.

**Scope:** The Autonomous Harness Optimization Loop (AHOL) work tracked in `.planning/research/ahol/` from circa 2026-04-12 through 2026-05-08. Rounds in `.ahol/ahol.db` from `spike-V0-vs-V4-20260424-1102` through `ablation-django-13128-20260505-0402`.

**Companion artifacts in this directory:**
- `AHOL-C6-DIRECTION-MEMO.md` (post-ablation revision dated 2026-05-05)
- `ABLATION-DJANGO-13128.md` (the diagnostic that surfaced the methodology error)
- `MILESTONE-PLAN-harness-pivot-v1.md` (the next-cycle plan that this post-mortem is Phase 1 of)
- `HARNESS-RESEARCH-2026-05-08.md` (the deep research artifact backing the migration)

This post-mortem deliberately overlaps these other documents on factual details. Its value is the synthesis: naming the methodology errors plainly so the next milestone can avoid them.

---

## 1. What was actually mutated

Across every AHOL variant we ever ran (V0, V1, V2, V3, V4, V5, V6, V7, plus the V4-no-{skills,agents,hooks,rules-or-commands} ablation set), the mutation alphabet was:

```
add_hook              add_rule_file               install_full_donnyclaude
remove_hook (stub)    remove_rule_file (stub)
modify_hook_config    modify_skill_frontmatter
                      modify_compaction_threshold
                      modify_reasoning_effort
add_rule_to_agent_prompt (stub)
remove_rule_from_agent_prompt (stub)
```

Every implemented mutation is **a file inside the worktree's `.claude/` directory or a single scalar in `settings.json`**. Concretely:
- `add_hook`: copy a JS hook from `packages/hooks/` into `.claude/hooks/`.
- `add_rule_file`: copy a rule directory tree from `packages/rules/` into `.claude/rules/`.
- `install_full_donnyclaude`: copy all five `packages/{hooks,skills,agents,rules,commands}` trees plus `.mcp.json` into `.claude/`.
- `modify_skill_frontmatter`: edit a YAML field inside one `.claude/skills/<name>/SKILL.md` file.
- `modify_compaction_threshold` / `modify_reasoning_effort`: write a single number or enum into `.claude/settings.json`.

We did NOT mutate: the agent loop (Claude Code's outermost while-loop), the tool catalog (Claude Code's tool surface), the action representation (tool-call vs ReAct vs bash-only), the model, sampling parameters beyond `reasoning_effort` (low/medium/high), trajectory length cap, multi-agent topology, verification or rollback strategies in the scaffold, observation truncation/summarization policy, or context-management strategy beyond `compaction.threshold`.

We held those layers fixed because we ran on top of Claude Code, which exposes none of them as project-scope configuration.

---

## 2. What the harness layers actually look like

Compare the AHOL mutation alphabet above against the 20-layer harness taxonomy in `HARNESS-RESEARCH-2026-05-08.md` (Part 1). Mapping AHOL's reachable layers to that taxonomy:

| Taxonomy layer | AHOL reach |
|---|---|
| 1. Agent loop / control flow | none — Claude Code's loop is closed-source TypeScript, not configurable from `.claude/` |
| 2. Action representation | none — fixed by the bound model's tool-call API |
| 3. Tool catalog design | none — Claude Code's catalog is fixed and opaque |
| 4. Tool schema and description quality | none — same |
| 5. Observation / tool-result handling | none — Claude Code's 25K cap and `<response clipped>` marker are hardcoded |
| 6. History / context management | partial — `compaction.threshold` is one knob; nothing else |
| 7. Action parser / output extraction | none |
| 8. System prompt design | indirect via `add_rule_file` (rules append to system prompt) |
| 9. Trajectory length cap / step budget | none from project scope |
| 10. Sampling parameters | partial — `reasoning_effort` only; no temperature, no top_p |
| 11. Retry / voting / self-consistency | none |
| 12. Verification and rollback | indirect via PostToolUse hooks (e.g. `gsd-verify-edit.js`) |
| 13. Sub-agent orchestration topology | indirect via `add_hook` for some hooks that spawn Task subagents |
| 14. Memory / persistent state | indirect via skill files (`.claude/skills/*/SKILL.md`) and rules |
| 15. Retrieval / RAG layer | none — Claude Code's retrieval is opaque |
| 16. MCP server integration | partial via `.mcp.json` copy in `install_full_donnyclaude` |
| 17. Environment / sandbox layer | none — Docker config is per-task, set by AHOL infra not by variants |
| 18. Compaction / summarization triggers | partial via `compaction.threshold` |
| 19. Hooks / middleware | full — this is the layer AHOL actually exposed |
| 20. Output guardrails / validators | indirect via PostToolUse hooks |

Three layers had partial reach (6, 10, 18). One had full reach (19). The other sixteen — including layers 1, 2, 3, 4, 5, 7, 9, 11, 15, 17 which carry the most causal weight per published evidence — were inaccessible.

The published evidence on which layers carry causal weight:
- Layer 17 (sandbox): Anthropic's Quantifying Infrastructure Noise (Feb 2026) shows ±6pp swing on Terminal-Bench from container resource configuration alone.
- Layer 1 (loop): Live-SWE-agent (arXiv 2511.13646) reaches 79.2% on SWE-bench Verified by autonomously evolving its own scaffold loop.
- Layer 10 (sampling): Anthropic's own Sonnet 4.5 announcement: 77.2% averaged over 10 trials on Verified, with reasoning-effort and temperature both materially load-bearing.
- Layer 8 (system prompt design): ETH Zurich's Evaluating AGENTS.md (arXiv 2602.11988): LLM-generated context files **reduced** SWE-bench Lite success by 3% on average and increased inference costs by 20%+. Developer-committed files improved performance only 4%. **This is the empirical refutation of the donnyclaude theory of change.**

AHOL was varying layer 19 (hooks) and layer 8 (prose-level system-prompt augmentation via rules) while holding layers 1, 17, 10, 2, 3, 5, 7, 9, 11 fixed. The signal-to-noise ratio guaranteed indecisive results.

---

## 3. What the empirical results actually showed

Round-by-round, what we measured and what it actually meant after correction:

### `comparison-V0-vs-V4-x5-20260428-1457` (first V0-vs-V4 head-to-head)
- **What we recorded:** Both V0 and V4 0/5 on django-13128, all `tokens_used=0`.
- **What that actually was:** Track 4 / Track 5 auth-quota path failure. Round was BLOCKED, not informative.

### `variance-V0-x5-20260428-0422` (V0 alone × 5 reps on AHOL-Proxy-15)
- **What we recorded:** V0 hit 4/5 on django-13128.
- **What that actually was:** Genuine V0 performance under one Max session window. Established a single-session baseline; not a population estimate.

### `comparison-V4-x5-vs-variance-baseline-20260430-0501` (V4 alone × 5 reps)
- **What we recorded:** V4 hit 0/5 on django-13128, mean 700K tokens/task, completed swebench scoring.
- **What that actually was:** Five runs in one Max session window, all producing patches that genuinely failed swebench tests. The DECOMPOSE verdict was issued from this single-session snapshot.

### `ablation-django-13128-20260505-0402` (the ablation that motivated this post-mortem)
- **What we recorded:** V4 hit 5/5, V0 hit 4/5, ablations between 2/4 and 5/5. Inversion of the regression hypothesis.
- **What that actually was:** Different Max session window, different Anthropic model state, different patches. The Apr 30 V4 5/5-failed patches still fail swebench today (verified via re-scoring), so the swebench environment did not shift. **What changed between Apr 30 and May 5 was per-session model-output variance.** Same harness install, different patch content.

### Cross-cutting patterns
- Cache-token gating (the original Tracks 1+2 calibration design) failed across 8 cycles because the metric was downstream of session state we couldn't observe. We pivoted to discovery-based calibration. This took weeks.
- Track 4 (auth detection) and Track 5 (quota probe) caught real failures but only after they had already burned a multi-million-token round.
- The `ablation-django-13128-20260505-0402` round itself burned 24M tokens on data that 29/29 task_runs initially recorded as `passed=0` because Docker daemon went offline mid-round; predictions.json recovery via re-scoring saved the data but the daemon outage was undetected by AHOL's pre-flight gates.

### What none of this tells us
- Whether donnyclaude's `.claude/` install helps, hurts, or is neutral on the average task. We never accumulated enough cross-session data on enough tasks to distinguish session variance from harness effect.
- Whether any single donnyclaude component (skills, agents, hooks, rules, commands) carries different causal weight than any other. The single ablation we ran had pass-rate deltas within rep-to-rep noise.
- Whether donnyclaude is better or worse than mini-SWE-agent or any other published scaffold. We never measured a published-baseline reference run on AHOL's substrate.

---

## 4. The methodology errors, named explicitly

### 4.1 Mutation alphabet too narrow

Stated above. Every variant was a `.claude/` content swap. The hidden layers (loop, tool catalog, action representation, sampling, sandbox) carry most of the published causal weight for harness optimization. Varying only the visible layers is methodologically equivalent to studying car aerodynamics by changing the seat covers.

**Correction for `harness-pivot-v1`:** Move to mini-SWE-agent (~100 lines of forkable Python where every layer is editable). See `MILESTONE-PLAN-harness-pivot-v1.md` Phase 5.

### 4.2 Sample size too small for the variance regime

We ran 5 reps on 1 task, or 5 reps on 15 tasks, in single Max sessions. Bjarnason et al.'s evidence puts per-model-per-task variance at ~2–4 tasks at 3 reps on similar benchmarks. Our 5-rep × 1-task design has a 95% binomial CI of roughly [0.28, 0.99] at p=0.8 — wide enough that 0/5, 3/5, and 5/5 are all consistent with each other.

The session-window correlation made it worse: all 5 reps shared model-output state. The Apr 30 V4 5/5-fail vs May 5 V4 5/5-pass result demonstrates that single-session 5-rep snapshots can be 100pp off from cross-session aggregate. We measured single-session snapshots and treated them as harness-attributable.

**Correction:** Pre-register sample sizes against an empirical variance floor measured on the actual substrate. Published methodology specifies n=3 reps minimum for directional, n=10 for decision-grade. See `MILESTONE-PLAN-harness-pivot-v1.md` Phase 9 (variance characterization) and Phase 10 (methodology spec).

### 4.3 Infrastructure noise not measured or controlled

Anthropic's infra-noise paper (Feb 2026) puts container-resource configuration alone at ±6pp on Terminal-Bench, ±1.5pp on SWE-bench. AHOL ran on default Docker Desktop on macOS with no resource specs reported, no time-of-day controls, and no cross-rep environment validation. The Docker-daemon-died-mid-round event in `ablation-django-13128-20260505-0402` is the load-bearing example: 24M tokens of data nearly lost because the AHOL pre-flight checked Docker liveness once at calibration entry and never again.

**Correction:** Sandbox specs reported in every result. 3× resource headroom per Anthropic's recommendation. Pre-round, mid-round, and per-variant Docker liveness probes. Time-of-day sampling for cross-session runs. See `MILESTONE-PLAN-harness-pivot-v1.md` Phase 3 (hardware pre-flight) and Phase 10 (methodology spec).

### 4.4 Benchmark validity untested on the substrate

We never reproduced a published baseline on AHOL's substrate. Without that, every ablation result was uncalibrated — we couldn't tell whether our 7.0/10 vs 7.8/10 V4-vs-V0 numbers on AHOL-Proxy-15 reflected real signal, our scoring pipeline, our prompt template, or the bound model's session state. ETH Zurich and SEAL evidence shows benchmark-specific drift is large enough that this isn't a hypothetical concern.

**Correction:** First operational milestone of `harness-pivot-v1` is reproducing a published Sonnet 4.6 baseline on Verified-50 within 3pp. If we can't reproduce, we don't ablate. See `MILESTONE-PLAN-harness-pivot-v1.md` Phase 7 and Phase 14 (REPRODUCTION GATE).

### 4.5 Pre-registration of effect sizes absent

AHOL ran ablations and reported deltas as findings. None of those deltas were pre-registered against a noise floor. The DECOMPOSE verdict treated a 0.8pp pass-rate gap as significant; the Anthropic infra-noise paper says 1.5pp on SWE-bench is the floor, 3pp is the floor for Terminal-Bench. Most "wins" we documented were within the published noise band.

**Correction:** Every ablation declares its expected effect size and a noise-floor threshold BEFORE the run. Deltas under threshold are null results, not weak wins. See `MILESTONE-PLAN-harness-pivot-v1.md` Phase 13 onward and the cross-cutting principles.

### 4.6 Prior verdicts (DECOMPOSE, CUT-MODE-overstated) over-claimed certainty

The DECOMPOSE verdict in `COMPARISON-V4-X5-VS-BASELINE.md` and the related CUT-MODE-overstated finding in `AHOL-C6-DIRECTION-MEMO.md` were issued from single-session, single-benchmark, undersampled, uncalibrated data. They are honest records of what was measured at the time. Their language ("DECOMPOSE", "CUT-MODE-overstated") implied a level of certainty the data does not support. Re-reading them with knowledge of the four errors above: they are observations about one Max-session-window of donnyclaude's `.claude/` package on a 15-task benchmark, not facts about agent-harness optimization.

**Correction:** Those verdicts are documented and frozen; they are not actionable for `harness-pivot-v1`. Re-litigating them requires the new substrate to be in place and a multi-session re-baseline to run. See `AHOL-C6-DIRECTION-MEMO.md` post-ablation revision.

---

## 5. What stays usable from AHOL

Not everything was wasted. The following artifacts and patterns transfer forward:

- **Track 4 (auth detection) and Track 5 (quota probe) patterns.** The pre-flight halt-on-known-failure-mode design is correct and should port to mini-SWE-agent's run loop. Add Track 6 (Docker daemon liveness probe) per the prior closed-loop note.
- **Token-free recovery via saved predictions.json.** AHOL archived `predictions.json` per task automatically; this enabled the Docker-daemon-outage recovery in `ablation-django-13128-20260505-0402` at zero token cost. Mirror this pattern in mini-SWE-agent's runner.
- **Discovery-based calibration via session-JSONL inspection** (`packages/ahol/runner/discovery.py`). The shape of the gate — does the bound model actually load what it's supposed to load — is correct and reusable. The specific implementation is donnyclaude-bound; the pattern is portable.
- **Bjarnason et al. variance baseline citation** (arXiv:2602.07150). Already used in `VARIANCE-V0-CHARACTERIZATION.md`; carry forward into `harness-pivot-v1` Phase 9 methodology spec.
- **The deep research bundle** preserved at `.planning/research/ahol/HARNESS-RESEARCH-2026-05-08.md` (this filename relative to donnyclaude). It's the most concentrated harness-design knowledge available to a solo builder, and Phase 12 of the next milestone explicitly depends on reading it end-to-end.
- **The infrastructure code** (`packages/ahol/runner/{ahol.py,benchmarks.py,variants.py,discovery.py}`). It is donnyclaude-bound but the SQLite schema, the swebench-scoring wrapper, and the per-task log archive design are reusable templates for the harness-lab runner.

---

## 6. Why this milestone is closing now (not later)

The ablation result inverted the premise. With V4 reproducing 5/5 and the Apr 30 V4 0/5 confirmed as session-variance not harness-attributable, AHOL's substrate has been demonstrated unable to produce decision-grade evidence about its own component classes. The honest options were: (a) burn ~150M more tokens on a multi-session re-baseline to either confirm or refute, on the same substrate, or (b) move to a substrate where the layers we want to study are actually accessible.

We chose (b). The methodology lessons are the most valuable artifact from this milestone; this document captures them so they are not re-learned.

---

*Closes Phase 1 of `harness-pivot-v1`. Next: Phase 2 (quarantine donnyclaude / create harness-lab repo).*
