# AHOL D1 Spike Results

Generated: 2026-04-23 UTC
Spike scope: SWE-bench Lite noise-floor measurement on bd1f8d2 harness state.
Budget authorized: 12 wall-clock hours, 6M tokens.
Hard constraint: no em dashes; spike writes to `.planning/research/ahol/` only.

## Pre-spike smoke test: PASS WITH CAVEAT

**Method**: Spawned a fresh `claude --print --model opus "list the files in this directory"` subprocess from a `/tmp/donny-smoke-bd1f8d2/` working directory containing a project-local `.claude/settings.json` overlay that registered the bd1f8d2 hooks (gsd-session-start.js and skill-index.js) on SessionStart. Inspected the resulting JSONL.

**Why a project-local overlay**: donnyclaude is not currently enabled as a Claude Code plugin in the active session, so `packages/hooks/hooks.json` is not read by Claude Code. The overlay registers the bd1f8d2 hooks for the smoke test only, leaving the user's `~/.claude/settings.json` untouched and the test reversible.

**Findings**:

| Check | Result | Evidence |
|---|---|---|
| WS-4 gsd-session-start.js fires | PASS | `Session context:` marker appears 2 times in the smoke JSONL; exit 0 |
| WS-4 emits structured additionalContext | PASS | Branch line, recent commits, test runner, backup path all present |
| WS-1 skill-index.js fires (hook executes, exit 0) | PASS | Hook listed in hook_success attachment with content emitted |
| WS-1 emits prompt-aware top-K manifest | DOES NOT FIRE on SessionStart | Direct invocation of `skill-index.js` with `{session_id, cwd}` stdin returns the FALLBACK message: `"Skill index ready: 105 skills available via progressive disclosure. Reference a skill by name to load its full content on demand."` because no prompt is present in SessionStart stdin. |
| Hook errors in stderr | NONE | grep for error/fatal/exception in JSONL only matches text inside skill description content (e.g., continuous-learning skill description), not actual hook stderr |
| Session completes cleanly | PASS | Exit 0, response: "The directory contains only a .claude subdirectory" |

**Architecture finding to surface as a follow-up**: WS-1 was registered on SessionStart but its prompt-aware-matching design requires a user prompt to be present in stdin. SessionStart fires before any user prompt exists, so the hook always falls through to its neutral fallback message. The Path B install-time `disable-model-invocation` flip on 95 non-top-K skills (committed in `bd1f8d2`) still delivers the 78% always-loaded catalog reduction documented in DELTA.md, because that work is install-time, not session-time. What is dormant is the SessionStart hook's runtime prompt-aware refinement.

The fix is a one-line registration change: move the WS-1 hook from `SessionStart` to `UserPromptSubmit` in `packages/hooks/hooks.json`, where the prompt is available. This is out of scope for this spike (no packages/ changes in spike). Recommend a follow-up commit `fix(hooks): WS-1 trigger UserPromptSubmit for actual prompt-aware behavior` after the spike concludes.

**Pre-spike smoke verdict**: PASS. The harness runs cleanly under bd1f8d2. The WS-1 trigger placement is a known, documented, fixable gap; it does not block the SWE-bench Lite spike.

## Bucketing plan (10 SWE-bench Lite tasks, one per difficulty bucket)

Per Q10, dev-round subset is 10 tasks selected stratified by difficulty. SWE-bench Lite contains 300 tasks across 11 repositories. Native `difficulty` labels in the dataset metadata may not be granular enough; if not, fall back to historical Claude Code pass-rate stratification on SWE-bench Verified.

**Selection strategy** (to be finalized in Docker setup phase below):
1. Load SWE-bench Lite metadata.
2. If a `difficulty` field exists with at least 5 distinct values, bin into 10 quantile buckets and pick the median task from each bucket.
3. If not, use SWE-bench Verified pass-rate-by-task-id (publicly available from Anthropic's Claude 4.5 leaderboard submissions) to stratify into 10 quantiles by historical Claude Code performance, then pick one task per quantile, intentionally including some hard-for-Claude tasks at the upper tail.

**Locked task IDs** (placeholders until Docker harness is set up and metadata is loaded):
1. astropy__astropy-11693 (typical mid-difficulty astropy bug fix)
2. django__django-11099 (Django ORM, well-trodden)
3. django__django-13710 (Django admin, harder)
4. matplotlib__matplotlib-22871 (mpl rendering, mid)
5. mwaskom__seaborn-3010 (seaborn data viz, mid)
6. pylint-dev__pylint-7080 (linter logic, harder)
7. pytest-dev__pytest-5103 (test framework internals, mid)
8. scikit-learn__scikit-learn-13439 (sklearn, hard)
9. sphinx-doc__sphinx-8595 (docs generator, mid)
10. sympy__sympy-13895 (symbolic math, hard)

These are illustrative until verified against the actual SWE-bench Lite dataset. The actual selection will be recorded in `BUCKETING.md` after Docker setup and dataset load.

## Docker harness setup: BLOCKED

**Method**: `docker --version` to confirm the Docker daemon is available.

**Result**: `command not found: docker`. Docker is not installed on this machine.

**Implication**: SWE-bench Lite requires Docker for its task containers (each task spins up a per-repo, per-task container with a pinned environment). Without Docker, the actual benchmark runs cannot execute. The 6M-token spike budget cannot be spent until Docker is installed or an alternative isolation approach is adopted.

**Three resolution paths** (user choice required):

1. **Install Docker Desktop for Mac.** ~500 MB install, requires admin password. After install, docker --version returns `Docker version X.Y.Z`. Spike can proceed.
2. **Use a colima-based Docker alternative.** `brew install colima docker` is a lighter-weight Docker runtime for macOS. Equivalent functionality.
3. **Substitute SWE-bench Lite with a Docker-free proxy benchmark.** Examples: a focused subset of `tests/install.test.js` runs against a candidate harness state (cheap, self-contained, but only measures install correctness, not coding-task pass rate). This invalidates the spike's external-validity goal but produces SOME variance number.

**Recommendation**: Path 1 or 2. Path 3 defeats the Correction-1 directive that AHOL benchmarks must be public, externally-validatable, leaderboard-comparable.

## Run results: PENDING

| Metric | Value | Status |
|---|---|---|
| Run 1 score (10 SWE-Lite tasks, harness bd1f8d2) | TBD | BLOCKED on Docker |
| Run 2 score (same harness, same tasks) | TBD | BLOCKED on Docker |
| Run 3 score (same harness, same tasks) | TBD | BLOCKED on Docker |
| Sigma (standard deviation across 3 runs) | TBD | depends on runs |
| Wall-clock per run | TBD | estimated 2 to 4 hours per run with full Claude Code agent |
| Tokens per run | TBD | estimated 0.3M to 0.6M per run |

## Go / no-go thresholds (per user directive)

| Sigma | Verdict |
|---|---|
| < 2 percentage points | **GO** for full AHOL build |
| 2 to 3 percentage points | **TIGHTEN**: AHOL is viable but needs more tasks per dev round (e.g., 20 instead of 10) to overcome variance |
| > 3 percentage points | **NO-GO** until noise sources are identified (cache effects, model nondeterminism, task instability) |

These thresholds are fixed; the spike will report sigma and emit the verdict programmatically once runs land.

## What the user controls now

1. **Docker authorization**: install Docker Desktop, install Colima, or accept Path 3 (Docker-free proxy benchmark with reduced validity).
2. **WS-1 follow-up**: confirm or defer the UserPromptSubmit-trigger fix recommended above.
3. **Spike continuation**: with Docker installed, the runs can proceed in this session or in a longer-running follow-up. 6 hours of compute time and 6M tokens is too long for a single interactive turn; surfaces a separate execution plan.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
