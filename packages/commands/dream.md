---
name: dream
description: "Launch a bounded, idle-sleep-surviving (caffeinate -i; not lid-close) autonomous loop that optimizes ONE operator-supplied metric on a git-worktree surface, keeping/discarding each iteration with a reviewable log."
command: true
---

# /dream - The Overnight Autonomous Optimization Loop

`/dream` runs `~/.claude/bin/cco-dream` - a **bounded**, **idle-sleep-surviving**,
**worktree-bounded** autonomous loop (AUTO-01/02/03, the v2.0 capstone). It
iterates against ONE operator-supplied metric on a single editable surface,
**keeping** an iteration only when it makes things better (and the bar is green)
and **discarding** it otherwise, and leaves a kept/discarded **log** you review
afterward.

This is the headline capstone made real. The keep/discard + bounded-termination
brains are verified in isolation (Plan 08-01); this command wires them into a
shell loop wrapped in `caffeinate -i` that survives the laptop *idle*-sleeping
(NOT a closed lid - see the lid-close limit below) and runs under v1's
catastrophe-only permission guard.

## What it is (parameterized, never hardcoded - D-01)

You supply, **at run time**:

- a **metric** = a shell command that emits ONE number (with a `direction`,
  `higher` or `lower` = better). The loop self-evaluates by running it.
- a **surface** = a path to a **git repository** the loop may edit. The loop
  creates a worktree of it and may ONLY write inside that worktree.

Nothing about the metric or surface is baked into the runner. A documented
DEFAULT/EXAMPLE invocation ships below, but it is illustrative - you choose the
target when you run it.

## Usage

CLI form (flags override `.cco/dream.yaml`):

```
/dream --metric '<cmd emitting ONE number>' --direction higher|lower --surface <git-repo-path> \
       [--max-iters N] [--target T] [--total-ceiling C] [--per-iter-budget B] \
       [--iter-timeout-sec S] [--log <path-no-ext>] [--model <m>] [--dry-run]
```

Config form - a `.cco/dream.yaml` in the directory you launch from (the loop's
own single editable config surface):

```yaml
metric: "pytest -q 2>/dev/null | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+'"  # emits ONE number
direction: higher          # higher|lower = better
surface: "/abs/path/to/a/git/repo"   # a git repo the loop may edit (a worktree of it)
max_iters: 6               # hard iteration cap
total_ceiling: 200000      # output-token ceiling for the whole run
per_iter_budget: 50000     # per-iteration output-token budget
iter_timeout_sec: 600      # wall-clock cap per claude -p attempt
target: null               # stop early when the metric reaches this (null = no target)
log: "~/.claude/cco-memory/dream/run-<ts>"   # path-no-ext for the kept/discarded log (.md + .jsonl)
```

**CLI flags override the yaml.** `--metric` and `--surface` are REQUIRED (via
CLI or yaml); the surface MUST be a git repo (else the runner refuses cleanly).

### Default / example invocation (ship it; illustrative, NOT hardcoded)

Optimize this harness's own cco-* self-test pass-count on a worktree of a chosen
dir:

```
/dream --metric 'cd ~/.claude/bin && (pytest -q 2>/dev/null | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || echo 0)' \
       --direction higher --surface ~/.claude/bin --max-iters 3 --target <n>
```

The metric must emit a SINGLE number. A fraction or multi-number string is your
responsibility (the brain takes the last numeric token). Pick your own
metric + surface for a real run.

## Keep / discard (D-05) - and ABORTED (SURFACE-01)

Each iteration is **KEPT iff the metric improves AND the green bar passes** -
otherwise it is **discarded** (a clean `git reset --hard && git clean -fd` in the
worktree). A red iteration is never kept; an unscoreable metric fails closed to
discard.

**ABORTED is distinct from a red discard (SURFACE-01).** Each iteration's
`claude -p` now runs with `--output-format json` and the runner **captures +
classifies** the result (it used to discard it with `>/dev/null 2>&1 || true`):

- **aborted** - an API/billing/rate abort (`is_error` + `error_during_execution`,
  or an `api_error_status` in {401,403,429,500,503,529}, or a non-null
  `api_error_status` even on a `success`). The loop **STOPS with
  `stop_reason=aborted`** *before* the keep/discard decision - **a pause, NOT a
  discarded failed optimization** (a rate-limit/pool-exhaustion is never a verdict
  on your change, so it is never discarded-and-retried as if the change was bad).
  This decision is **runner-owned** and bypasses the keep/discard brain.
- **bounded** - the agent hit its OWN native per-iteration ceiling
  (`error_max_turns` / `error_max_budget_usd` /
  `error_max_structured_output_retries`). This is **completed-but-unproductive**:
  the iteration is **discarded and the loop CONTINUES** (a normal native bound
  never stops the loop) - distinct from an abort.
- **unproductive** - an empty / unparseable / timeout-killed result (defensive):
  never treated as success, never as abort; discarded, loop continues.
- **success** - proceeds to the existing metric -> green -> keep/discard path
  unchanged.

The classifier is **hook-independent** (a pure function of the `-p` JSON result);
the **StopFailure** hook is at most optional enrichment with no decision control
(the loop never depends on it firing).

> **Setup before the agent loop (SURFACE-02).** Per-worktree setup runs via the
> **headless-safe Setup path BEFORE iteration 1's agent loop** - the runner runs
> an optional operator `.cco/dream-setup.sh` (screened by the same catastrophe
> predicate, cwd=worktree, wall-clock-bound, best-effort) at worktree creation,
> and `-p --init` is the verified headless Setup-hook trigger for
> `additionalContext`. Setup is **never** wired on Stop/PreToolUse.

**Green is computed INLINE** by driving the Phase-7 `cco-green-gate.js` as a
subprocess over the worktree (`green := the gate emits no "decision":"block"`) -
the **D-10-safe verify-then-log-only pattern**. The Phase-7 Stop hook firing
under headless `claude -p` is UNVERIFIED, so the runner does NOT rely on it; it
runs the same bar as a checker and reads the verdict. If the gate errors, green
is treated as **false** (fail-closed - no verdict means it cannot keep).

> **INFO (C-1) - the green bar only VETOES on a Python surface.** `cco-green-gate.js`
> applies its ruff -> type -> pytest bar ONLY when a Python project marker is
> present at/above the worktree (`pyproject.toml`, `pytest.ini`, `setup.cfg`,
> `tox.ini`, `ruff.toml`, `.ruff.toml`, or a `tests/` dir). On a **non-Python
> surface** the gate returns green (no-bar), so `green` is always true and the
> keep decision rests on **metric-improvement alone** (plus the worktree bound).
> That is by design: the green bar is a *veto* layer for Python work, not the sole
> keep criterion. For a non-Python surface, make your **metric itself** encode
> "still correct" (e.g. a build-must-pass-AND-score command) so a passing-but-broken
> change cannot be kept.

## Bounded - never open-ended (D-06)

The loop is bounded **four ways**, enforced by the verified 08-01 brain:
per-iteration budget + total ceiling + max-iters + stop-on-target. Defaults
(operator-overridable): `max_iters=6`, `total_ceiling=200000`,
`per_iter_budget=50000`, `iter_timeout_sec=600`, `target=none`. Even if you omit
every cap, `max_iters` defaults to 6 - **there is no continue-forever path.** A
wall-clock `timeout` also caps each `claude -p` attempt.

## Safety (D-08) - the unattended boundary (runner-primary, hook-insurance)

The loop is an **unattended autonomous editor**, so safety is paramount. As of
Phase 11 (RUNNER-01/02) the **runner itself is the PRIMARY safety boundary** —
two hook-INDEPENDENT layers it fully controls — and the PreToolUse hook is
**demoted to best-effort insurance** (kept + unchanged, never disabled). Every
safety property now holds **without** the hook firing (insurance against
headless-hook version-sensitivity, not a fix for a live break):

1. **RUNNER-01 - tool-layer `--disallowedTools` denylist** (hook-independent,
   coarse) - every iteration's `claude -p` is launched with an explicit
   `--disallowedTools` denylist of catastrophe command FAMILIES (`Bash(rm *)`,
   `Bash(sudo *)`, `Bash(dd *)`, `Bash(mkfs *)`, `Bash(chmod *)`, `Bash(chown *)`,
   `Bash(shutdown *)`, `Bash(reboot *)`, `Bash(diskutil *)`, `Bash(launchctl *)`).
   A **denylist**, not a narrow `--allowedTools` (which would block the open-ended
   agent's legitimate build/test/edit work); these families are never needed by an
   in-worktree agent. The runner shells its OWN git/metric OUTSIDE the agent's tool
   sandbox, so denying them never breaks the loop. **Honest limitation:** prefix
   matchers are coarse + compound-evadable (`cd /x && rm -rf /`, `bash -c '…'`,
   fork-bomb syntax, `mkfs.ext4`) - they block the NAIVE forms tool-side; the
   residue is covered by RUNNER-02 + the demoted hook.
2. **RUNNER-02 - wrapper-layer pre-flight catastrophe screen** (hook-independent,
   nuanced) - before the loop, the runner screens the OPERATOR-CONTROLLED command
   surface (`METRIC`, `ATTEMPT_CMD`) with the SAME `detectCatastrophe()` predicate
   the hook uses (reused via a `node -e require()` shim of `cco-permission-guard.js`
   - single source of truth, NOT forked). A match ABORTS the run
   (`decision=aborted reason=catastrophe-preflight`) before any iteration, in the
   runner process - no fired hook involved. (It cannot pre-screen the agent's
   not-yet-emitted autonomous Bash - that is layer 1 + the hook.)
3. **v1 `cco-permission-guard`** (PreToolUse) - **DEMOTED to best-effort
   insurance** for the residue layers 1-2 cannot cover (the agent's autonomous,
   compounded Bash). It stays **registered + byte-unchanged**, DENIES `rm -rf ~ / /`,
   `dd`-to-device, `mkfs`, fork bombs, etc., and already FAILS CLOSED for the
   catastrophe set (HARDEN-02). The runner NEVER passes
   `--dangerously-skip-permissions`; the guard is not disabled - just no longer the
   load-bearing guarantee.
4. **The git worktree write boundary** - the loop runs with `cwd=<worktree>` and
   the attempt is instructed to edit ONLY files inside it. Out-of-surface writes
   have no path; the blast radius is the worktree.
5. **A discard is a clean git revert** - a bad iteration leaves no trace.

> **INFO (C-2) - do not weaken the user guard with a project-local settings file.**
> The `cco-permission-guard` is wired in your **user** `~/.claude/settings.json`
> (always loaded). If the **surface repo** ships a permissive project-local
> `.claude/settings.json` (e.g. broad `allow` rules or a competing permission
> mode), it could weaken the always-loaded user guard for work inside that repo.
> Before pointing `/dream` at a surface, confirm the surface does NOT carry a
> project-local `.claude/settings.json` that loosens permissions; keep the
> catastrophe-only guard authoritative for the unattended loop.

## Idle-sleep survival - and the lid-close limit (D-02 / AUTO-03 / HARDEN-06)

The whole loop is wrapped in **`caffeinate -i`** - a no-**idle**-sleep assertion
held for the loop's duration and released on exit. Kick it off with the lid open
(or in clamshell, below) and the Mac will not **idle**-sleep mid-run.

> **HONEST LIMIT - `caffeinate -i` does NOT survive a closed lid.** macOS routes
> a **lid-close** sleep past power assertions: the `-i` (idle) assertion only
> blocks the *idle timer*, not the lid switch. **If you close the lid - especially
> on battery - the machine sleeps and the loop pauses**, regardless of
> `caffeinate`. There is no `caffeinate` flag that keeps a laptop awake through a
> closed lid on battery. For a genuinely unattended run with the lid effectively
> shut, use one of the real options below.

**Real options for a lid-closed / unattended run:**

1. **Clamshell mode** - connect an **external display + power adapter + an
   external keyboard/mouse**. macOS keeps the Mac awake with the lid shut in this
   configuration; the loop runs normally. This is the clean, supported path.
2. **`sudo pmset -b disablesleep 1`** - disables sleep on **battery** so the loop
   persists through a lid-close *without* an external display.
   - **Reset it afterward:** `sudo pmset -b disablesleep 0` (it persists until you
     do - leaving it on means the laptop never battery-sleeps again).
   - **Caveats:** needs **sudo**; it **drains the battery** with no idle-sleep
     fallback; and a closed lid has **no airflow**, so a long compute run can
     **build heat** / thermally throttle. Use it **on power with ventilation**,
     and prefer clamshell when you can. `caffeinate -i` (idle only) still wraps the
     loop in all cases.

**Scheduled-start upgrade (documented, not built):** to start the loop at a fixed
hour *while the Mac is asleep* (e.g. 2am), pair a **launchd LaunchAgent**
(`StartCalendarInterval`) with **`pmset repeat wake MTWRFSU 02:00:00`** to wake
the Mac, then have the agent launch `cco-dream` (still caffeinate-wrapped, and
under clamshell or `disablesleep` if the lid will be shut). Do NOT use **Hermes
cron** (`cron_mode: deny`) or **native Cron alone** (REPL-idle-bound, 7-day expiry
- not sleep-surviving). `caffeinate -i` bounds idle sleep; launchd+pmset is the
timed-start upgrade; clamshell / `disablesleep` is what survives a closed lid.

## The deliverable (AUTO-02)

A kept/discarded **log** (`<log>.md` + `<log>.jsonl`) - one metadata-only row per
iteration (`ts, iter, summary, before, after, decision, why`) - that you review
afterward. It records the metric before->after and keep|discard + why for every
iteration. `cco-ledger` shows the run's token cost (it reads the session jsonl
passively - no runner integration needed). The log is **metadata-only**: no
metric output bodies, no diffs, no file contents.

**Per-iteration cost + billing (BILLING-01).** Each iteration's `total_cost_usd`
(and `usage.service_tier`) is available from the captured `claude -p` JSON result
(SURFACE-01). `cco-ledger` already reports the run's cost passively; per-iteration
cost is parsed metadata-only (the number only, never the result body) and is **not**
written into the fixed-allowlist log sinks (they deliberately drop unknown keys to
prevent payload-smuggling - see `11-BILLING.md`). **Billing context:** Anthropic
**announced** (June 15 2026) a separate, dollar-capped **Agent-SDK credit pool** for
programmatic usage (`claude -p` / SDK / GitHub Actions) - **then paused it**; as of
2026-06-18 `claude -p` still draws from your subscription's interactive usage limits
(re-verify before relying - article 15036540). `/dream`'s `-p` iterations are exactly
that programmatic usage, so pool/limit **exhaustion** (whether the announced $-capped
pool or the interactive limit) comes back as an API error and is classified
**ABORTED (SURFACE-01)** - the loop **pauses cleanly** (`stop_reason=aborted`, before
keep/discard) rather than discarding a pool-exhaustion as a failed optimization and
retrying against an already-exhausted budget. See `11-BILLING.md` for the full finding.

## Guardrails (always)

- **Start with `--dry-run`** - it validates config, creates + tears down a
  worktree, runs the green check once, and starts NO `claude -p` attempt.
- The loop writes **ONLY inside the worktree**; a cleanup trap removes the
  worktree + scratch branch on exit (success or failure).
- **Concurrent/scheduled-overlap safe (SURFACE-03):** each run takes a `git
  worktree lock` on its worktree for the run's lifetime (the lock reason carries
  the owning PID), so a second overlapping `/dream` run's startup orphan-sweep
  will **not** reap an active worktree (no "branch already checked out" fatal). A
  crashed run (SIGKILL/power-loss — no cleanup trap) leaves a **dead-PID-locked**
  orphan that the **next** run's startup sweep reaps; live-PID and unparsable-PID
  locks are conservatively skipped (never reap what cannot be proven dead).
- **Reversible:** removing `~/.claude/bin/cco-dream` + `~/.claude/commands/dream.md`
  FULLY disarms `/dream`. It registers **no settings.json hook** - it is a command
  file + a bin script, not a hook; nothing auto-fires.
- **Metadata-only** logging; the metric you supply runs with your own privileges
  (it is your command) but is itself subject to the permission guard on any
  catastrophic call.
