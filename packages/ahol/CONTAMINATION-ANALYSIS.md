# AHOL Contamination Analysis

## Thesis

The environment running AHOL cannot be the environment AHOL is testing. AHOL measures how harness-level artifacts (skills, agents, rules, hooks, MCP servers, settings) shift Claude Code outcomes. If the measurement apparatus shares artifacts with the system under test, every observation is confounded. Contamination separation is therefore a scientific precondition, not an operational nicety.

This document justifies the three-tier environment separation adopted by AHOL, cites three pieces of evidence, lays out the initial variant matrix, and explains why V0 vs V4 is the first comparison to run.

## The Three Tiers

### Tier 1: Production (`~/.claude/`)

The user's full donnyclaude install: 105 skills, 49 agents, 8 hooks, 70 rules, MCP servers, plus the user's personal settings. This is the day-to-day environment where the user ships real work. AHOL does not touch it. AHOL does not read from it, write to it, or link against it. Tier 1 is sacred for two reasons: it is the user's primary workflow (cannot be disturbed), and its complexity makes it unusable as a control (too many moving parts to attribute any effect).

### Tier 2: AHOL Baseline (`.ahol/baseline/`)

The experimental control. Contents:

- `settings.json` with the minimum viable config.
- Q1b patch-only system prompt (no project augmentation, no CLAUDE.md ingestion beyond the CWD itself).
- Tool allowlist restricted to Read, Bash, Edit.
- CLI wrapper that sets CLAUDE_HOME to this directory.
- Zero skills, zero agents, zero rules, zero hooks, zero commands, zero MCP servers.

Tier 2 is the negative control. It is the Claude Code binary running with the thinnest possible scaffold. Every AHOL measurement anchors against Tier 2 to isolate the contribution of whatever harness bundle Tier 3 adds.

### Tier 3: AHOL Variants (`.ahol/worktrees/variant-N/`)

Each variant is Tier 2 plus exactly one explicit mutation bundle, described in a variant manifest JSON. Allowed mutation types:

- `add_hook`, `remove_hook`, `modify_hook_config`
- `add_rule_to_agent_prompt`, `remove_rule_from_agent_prompt`
- `add_rule_file`, `remove_rule_file`
- `modify_skill_frontmatter`
- `modify_compaction_threshold`
- `modify_reasoning_effort`

The manifest is the source of truth. If a mutation is not in the manifest, it is not in the variant. This discipline keeps the search space finite and the attribution clean.

## Evidence

### Evidence 1: The 2.66M-Token Django Smoke Test

Source: `/Users/donmega/Desktop/donnyclaude/.planning/research/ahol/ws1-refinement-smoke.md`.

A single `claude --print "help me set up a Django REST API"` subprocess consumed 2.66M tokens against a 50K nominal expectation. The model interpreted the prompt as an implementation request and scaffolded a full Django project: `settings.py`, `urls.py`, models, views, serializers, tests, a dev server, the entire pipeline. The harness dominated the signal over the prompt-task-model combo. A 53x token overrun would render every downstream cost and latency model meaningless.

The takeaway for contamination: you cannot study harness effects if the harness is allowed to freelance the task specification. Tier 2 exists so that a prompt like "help me set up a Django REST API" produces an answer shaped by the prompt, not by whatever invocation flags, skill triggers, and rule steers happen to be resident. The smoke test is the cautionary case: run harness-under-test plus harness-under-measurement at the same time and you measure neither.

### Evidence 2: HumanLayer 14-22% Rule-File Reasoning Tax

Source: HumanLayer blog post cited in the donnyclaude ecosystem-landscape research.

Quote: "Agent-generated CLAUDE.md files actually hurt performance while costing 20%+ more. Agents spent 14-22% more reasoning tokens processing instructions." And: "Lots of files too-heavily-steered the model to use specific tools, causing worse outcomes. Less (instructions) is more."

The implication for AHOL is direct. Rule files are not free. They levy a reasoning tax of roughly 14-22% on every generation, and the direction of the outcome effect is not guaranteed positive. A baseline environment that happens to include rule files would bias AHOL toward measuring rule-augmented-vs-rule-augmented deltas, missing the rule contribution entirely. Tier 2 omits rule files so that Tier 3 variants which add rule files expose the per-file contribution, tax included.

### Evidence 3: GEPA Discriminative Power on Bleve

Source: `/Users/donmega/Desktop/donnyclaude/.planning/research/ahol/REALITY-CHECK.md`, citing the gskill case study on gepa-ai.github.io/gepa (blog dated 2026-02-18).

The gskill result: learned skills boosted Claude Haiku 4.5 from 79.3% to 100% pass rate on Bleve, and Claude Sonnet 4.5 from 94.8% to 100%, with a 47% duration reduction. Both models hit the ceiling under the right harness.

Two implications for AHOL. First, harness-level artifacts have a measurable per-variant effect size in the range of 5 to 20 percentage points on pass rate, plus meaningful duration shifts. Second, effects that large are detectable at small-N only if the baseline is noise-free. A dirty baseline with stray skills triggering on corner-case file globs would drown the signal in variance between runs. Tier 2 is engineered for low-variance small-N runs: nothing fires unless the variant explicitly installs it.

## Initial Variant Matrix

| Variant | Contents | Role |
|---------|----------|------|
| V0 | Baseline only | Negative control |
| V1 | Baseline + WS-4 session-start hook | Single-hook isolation |
| V2 | Baseline + WS-1/2/3/4 hook stack | Full hook stack, no skills or rules |
| V3 | Baseline + WS-2 PostToolUse verify-edit hook only | Lint-gate middleware isolation (runs project lint and typecheck after every Edit or Write, injects failures back into context) |
| V4 | Baseline + full donnyclaude | Positive control |
| V5 | Baseline + 70 rules, no skills, no hooks | Rule-only contribution |
| V6 | Baseline + WS-3 PreCompact active-backup hook only | State-recovery middleware isolation (serializes session state to .claude/backups/ before compaction) |
| V7 | Baseline + hook stack + Context7 MCP | Hook plus MCP interaction probe |

The V0 and V4 endpoints anchor the range. V1, V2, V3, V5, V6, V7 decompose the middle to identify per-component contribution and interaction effects.

### Rationale for middleware-weighted V3 and V6

Hooks fire on every matched tool use within a session (deterministic, every turn). Skills fire only when the model or prompt invokes them (probabilistic, occasional). For the AHOL spike's variant-sweep design, per-turn leverage is higher than per-prompt leverage. Middleware-weighted variants (V3 and V6 in their current form) isolate hook contributions more cleanly than skill variants would.

The V0 (bare baseline) vs V4 (full donnyclaude) comparison remains the Group C spike pair. The 8-variant sweep including the revised V3 and V6 is deferred to post-spike Group D work.

## Why V0 vs V4 First

The V0 vs V4 comparison maximally differentiates harness complexity in a single head-to-head. Three possible outcomes, each with a clear follow-up:

- **V0 >> V4**: donnyclaude is net-negative. Cut-mode AHOL is the right framing. Find which pieces to remove. Subsequent variants drop components from V4 until the regression closes.
- **V4 >> V0**: donnyclaude is net-positive. Grow-mode AHOL is the right framing. Find which additions to stack onto V0. Subsequent variants add components to V0 until the gain is captured.
- **V0 ~= V4**: the endpoints are indistinguishable at small-N. Decompose via the V1-V7 sweep to identify per-component contribution, including cases where individual components help but cancel each other in the full stack.

Running V0 vs V4 first answers the question that sets the agenda for everything after it. Any other ordering risks spending runs on components whose direction has not yet been established at the level of the full harness.

## Closing

Contamination separation is not hygiene theater; it is the scientific precondition for attributing outcomes to harness changes. Without Tier 2 as the empty baseline, the 2.66M Django result is ambiguous: was it Claude, was it donnyclaude, was it the prompt? With Tier 2 plus Tier 3 single-mutation variants, each outcome is attributable. The mutation manifest names the independent variable, the baseline fixes every other variable, and the outcome metric is the dependent variable. That is a designed experiment, not a vibes benchmark.

CLAUDE_HOME override makes separation practical. The Claude Code binary respects CLAUDE_HOME for skills, agents, rules, hooks, MCP, and settings directory lookup. Tier 2 and Tier 3 set CLAUDE_HOME to their respective directories, leaving the user's real `~/.claude` untouched during AHOL runs. A one-line environment variable is the difference between a sound experimental protocol and contaminating the user's working environment with test artifacts. AHOL uses that one line.
