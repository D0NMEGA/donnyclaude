---
status: PASS
agent: donny-executor
phase: 20-auto-compact-at-60-keystone
plan: 03
subsystem: infra
tags: [tdd, pytest, tmux, compact, cc-autopilot, daemon, act-path, arm-on-send, hysteresis, green]

# Dependency graph
requires:
  - phase: 20-auto-compact-at-60-keystone (plan 02)
    provides: action.send_compact (+ SENT/BUSY/DEDUPED constants), config.act_enabled (+ DEFAULT_CONFIG_PATH), the fake_tmux argv-capturing fixture
  - phase: 20-auto-compact-at-60-keystone (plan 01)
    provides: the 4 RED daemon act-path contracts (test_observe_only_no_send, test_act_only_on_mapped_pane, test_fire_once_arm_on_send, test_rearm_hysteresis_band)
  - phase: 19-supervisor-foundation
    provides: evaluate_session decision ladder + poll_once + main observe-only loop, idempotency record/already/clear_fired, registry pane resolution
provides:
  - daemon.py act-capable poll loop: evaluate_session act branch (send via action, arm-on-send, marker/idle outcomes), poll_once/main act threading
  - arm-on-send fire-once (record_fired only after a real SENT) + the <45% hysteresis re-arm (REARM_BELOW_PCT=45)
  - main() reads the safe-default-off act toggle each poll (observe->act with no launchctl reload)
affects: [20-04, PILOT-06, PILOT-07]

# Tech tracking
tech-stack:
  added: []  # stdlib-only; pytest/ruff already present from Phase 19
  patterns:
    - "Arm-on-send (D-05): idempotency.record_fired runs ONLY after action.send_compact returns SENT; a BUSY/DEDUPED outcome leaves the session un-armed so it re-tries next poll"
    - "Hysteresis re-arm (D-07): a named REARM_BELOW_PCT=45 constant gates clear_fired so a session in [45,60) stays armed and a lingering >threshold session is never re-fired"
    - "Observe-only preserved via a default-False act param: act off is byte-behavior-identical to Phase 19 (would_compact, no keystroke), so all 59 original tests stay green"
    - "Config read each poll (D-10): main() resolves act = config.act_enabled(config_path) per iteration, so flipping the toggle takes effect with no launchctl reload"
    - "External product delivered live + tracked via .bak-20-03-*; per-task .planning ledger commits (code not git-tracked)"

key-files:
  created: []
  modified:
    - ~/Developer/cc-autopilot/autopilot/daemon.py

key-decisions:
  - "Arm-on-send order is load-bearing (D-05): send FIRST, then arm ONLY on SENT; the BUSY and DEDUPED returns carry NO record_fired, so a best-effort idle-skip never consumes the one allowed fire"
  - "REARM_BELOW_PCT=45 is a named module constant (not <threshold): the re-arm clears only below the band so a compaction landing near 59% cannot instantly re-fire; a None reading never re-arms"
  - "Split the action/config imports across the two tasks (action in Task 1, config in Task 2) so each task's `ruff check` gate stays green -- an unused import fails F401 (Rule 3)"
  - "requirements-completed left empty: the daemon act branch is built and unit-proven, but PILOT-06/07 complete only when Wave 3 (20-04) discharges the D-09 live send-keys -> /compact round-trip gate (matches 20-01/20-02)"

patterns-established:
  - "The act branch composes action.send_compact (never a raw send-keys in daemon.py) and reads config.act_enabled -- the daemon orchestrates, the mechanism/toggle live in their own modules (D-01/D-02/D-10)"
  - "Docstrings kept in sync: the Phase-19 'emits NO tmux keystroke' claim was corrected to the observe-only-default + opt-in-act description"

requirements-completed: []  # PILOT-06/07 contributed-to (daemon act branch complete + unit-proven), NOT completed until Wave 3 (20-04) D-09 live gate

# Metrics
duration: 26min
completed: 2026-07-01
---

# Phase 20 Plan 03: Wave-2 TDD GREEN (daemon act branch -- the keystone integration) Summary

**Wired the act path into the observe-only daemon: `evaluate_session` now sends `/compact` via `action.send_compact` to a crossing session's own mapped `%N` pane, arms fire-once ONLY after a real send (D-05 arm-on-send), re-arms only below the 45% hysteresis band (D-07, `REARM_BELOW_PCT=45`), and `main()` reads the safe-default-off act toggle each poll (D-10) -- turning the 4 RED daemon act tests GREEN (full suite 72/72) with observe-only preserved as the shipped default and every sibling module byte-unchanged.**

## Performance

- **Duration:** ~26 min
- **Started:** 2026-07-01T16:19Z (daemon.py backup ts 1782922797)
- **Completed:** 2026-07-01T16:45Z
- **Tasks:** 2 (both TDD GREEN; RED contracts authored in Wave 0)
- **Files touched (live product):** 1 modified (daemon.py) + 1 .bak of record

## Accomplishments

- **Task 1 -- the act branch (`evaluate_session` step 5 + `poll_once` threading):**
  - `evaluate_session` gains keyword-only `act: bool = False` and `run: Callable = subprocess.run` (defaults keep every Phase-19 caller unchanged). Step 5 rewritten as the observe/act ladder:
    - `already_armed` -> `no_op` (idempotent, unchanged).
    - **act OFF (D-10 default):** `record_fired` on the decision + `would_compact` / `threshold_crossed` -- byte-behavior-identical to Phase 19 (log only, no keystroke).
    - **act ON + SENT:** `action.send_compact(session_id, pane, tmpdir=, run=)` FIRST, then `record_fired` ONLY on `action.SENT` (D-05 arm-on-send) -> `compact_sent` / `threshold_crossed`.
    - **act ON + DEDUPED:** `compact_deduped` / `marker_present`, NO arm (the marker owns this compaction, D-12).
    - **act ON + BUSY:** `busy_skip` / `pane_busy`, NO arm (re-tries next poll, D-05).
  - `poll_once` gains `act: bool = False` and threads `act=act, run=run` into the `evaluate_session` call. The discover -> reconcile -> log structure is otherwise unchanged.
- **Task 2 -- the hysteresis re-arm + production wiring:**
  - `REARM_BELOW_PCT = 45` module constant + `rearm_below: int = REARM_BELOW_PCT` kwarg on `evaluate_session`. Step 4 re-arm now clears the arming ONLY when `used is not None and used < rearm_below` (D-07), so `used` in `[45,60)` stays armed and a missing reading never re-arms.
  - `main()` gains `config_path: str = config.DEFAULT_CONFIG_PATH` and reads `act = config.act_enabled(config_path)` EACH poll before `poll_once(..., act=act)` (D-10) -- the operator flips observe<->act by editing the config file with no `launchctl` reload. `__main__.py` is byte-unchanged (its `main(interval=, tmpdir=)` call resolves `act` internally).
- **Result:** the 4 Wave-2 daemon act tests are GREEN; the FULL suite is **72 passed / 0 failed** (was 4 failed / 68 passed). Zero Phase-19 regression. Package-wide ruff clean; no bare except; the compact path has no raw `send-keys` and no `runner`/`cco-dream` import (D-01/D-02). `cco-dream` md5 `d8055242bffbee5cb3ea557340c6a444` byte-unchanged; mtimes prove only `daemon.py` changed this plan.

## Task Commits

Each task committed atomically. The external cc-autopilot product is not git-tracked; the git-tracked artifact per task is the `.planning/` ledger append (`20-LEDGER.jsonl`), with the live code delivered in place + a single `.bak-20-03-*` of record for the plan:

1. **Task 1: daemon act branch + arm-on-send fire-once** - `5b733bf` (feat) [backup `autopilot/daemon.py.bak-20-03-1782922797`]
2. **Task 2: <45% hysteresis re-arm + main() reads act toggle each poll** - `3d91fab` (feat)

**Plan metadata:** (this SUMMARY + STATE + ROADMAP) - see the final `docs(20-03)` commit.

_TDD note: the RED phase shipped in Wave 0 (plan 01); this Wave-2 plan is GREEN-only, hence one `feat` commit per task (no separate `test` commit)._

## Files Created/Modified

Modified (live, cc-autopilot; one `.bak-20-03-*` of record for the plan):
- `~/Developer/cc-autopilot/autopilot/daemon.py` - added `action`/`config` imports; `evaluate_session` act branch + `rearm_below`/`act`/`run` kwargs; `REARM_BELOW_PCT=45`; the <45% step-4 re-arm; `poll_once` act threading; `main()` per-poll act-toggle read; docstring accuracy updates. Backup: `autopilot/daemon.py.bak-20-03-1782922797`.

No other autopilot module changed: `action.py` / `config.py` / `runner.py` / `bridge.py` / `registry.py` / `idempotency.py` / `__main__.py` all byte-unchanged (mtimes predate the daemon.py edit window; only `daemon.py` was opened for edit).

## Decisions Made

- **Arm-on-send is the whole point of the keystone (D-05):** `record_fired` sits textually AFTER the `outcome == action.SENT` check; the `DEDUPED` and `BUSY` returns carry no `record_fired`. `test_fire_once_arm_on_send` drives busy-then-idle and asserts NO arm on busy + exactly one send on idle + no second send on re-poll -- it passes for the right reason (a busy_skip does not consume the one fire).
- **Hysteresis is a named constant, not a magic `<60`:** `REARM_BELOW_PCT = 45` gates the re-arm. `test_rearm_hysteresis_band` drives 70->50->70->40->70 and asserts exactly two total sends: the dip to 50 (>=45) stays armed (no second fire on the 70 re-cross), only the drop to 40 (<45) re-arms.
- **Observe-only stays the shipped default:** `act` defaults False through `poll_once`/`evaluate_session`, and `main()` resolves it from `config.act_enabled` which is safe-default-off. `~/.claude/.autopilot/config.json` is absent, so the running LaunchAgent stays observe-only after it relaunches into this code -- no toggle was created or enabled.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Split the `action`/`config` imports across the two tasks (ruff F401 gate)**
- **Found during:** Task 1 (and confirmed at Task 2)
- **Issue:** The plan's Task 1 behavior says "Add `from . import action, config`". But `config` is only used by `main()` (wired in Task 2). Importing it in Task 1 leaves it unused until Task 2, which trips ruff `F401` and fails Task 1's hard `ruff check ... exits 0` acceptance gate.
- **Fix:** Imported `action` in Task 1 (used immediately by the act branch) and added `config` in Task 2 (when `main()` uses it). Final import line is `from . import action, bridge, config, idempotency, registry`, exactly what the plan intends; only the timing was split to satisfy the plan's own per-task ruff gate.
- **Files modified:** autopilot/daemon.py
- **Verification:** `ruff check ~/Developer/cc-autopilot/autopilot` exits 0 after each task.
- **Committed in:** 5b733bf (Task 1), 3d91fab (Task 2)

**2. [Rule 1 - Correctness] Kept the `send-keys` token out of daemon.py so the T-20-01 grep reads clean**
- **Found during:** Task 1 verification
- **Issue:** A step-5 comment read "never a raw send-keys", so a naive `grep send-keys daemon.py` returned 1 -- muddying the T-20-01 threat verification ("no send-keys in daemon.py", the argv must live only in action.py).
- **Fix:** Reworded the comment to "never assembled here"; `grep -a send-keys daemon.py` is now 0. Behavior-neutral (comment only); the full suite re-ran 72/72.
- **Files modified:** autopilot/daemon.py
- **Verification:** `grep -ac 'send-keys' autopilot/daemon.py` == 0; full suite 72 passed.
- **Committed in:** 5b733bf (Task 1)

Also (not a behavior deviation): the Phase-19 module docstring said "this phase emits NO tmux keystroke", now false in act mode; it was corrected to the observe-only-default + opt-in-act description (keeping comments in sync).

---

**Total deviations:** 2 auto-fixed (1 blocking ruff-gate compliance, 1 correctness/grep-clean). **Impact:** cosmetic import-timing and comment wording only; no behavior change, no scope creep. All decision vocabulary, arm-on-send order, and the 45% band match the RED contracts exactly (tests unmodified).

## Issues Encountered

- **`ty` unresolved-import false positive (known class):** the PostToolUse lint-loop's `ty` reports `error[unresolved-import] Cannot resolve imported module '.'` on the relative package import. This is the standalone-type-checker limitation on relative imports (same class as the `unresolved-import: pytest` one); the real gates (ruff + pytest) are green. No action taken.
- **Lint-loop mid-edit snapshots:** the hook fired between edits in each batch (import added but the using edit not yet applied), transiently reporting `F401 .action`/`.config imported but unused`. Both cleared the instant the using edit landed; re-verified by running ruff + pytest directly (ruff exit 0, suite 72/72).
- **donny-tools build:** this build exposes `state`/`commit`/`init` but no `roadmap`/`requirements` subcommands, so STATE.md and ROADMAP.md were updated directly (the plan instructed "update STATE.md and ROADMAP.md yourself"), and PILOT-06/07 were correctly NOT auto-marked complete (their live gate is 20-04) -- consistent with 20-01/20-02.

## User Setup Required

None - no external service configuration required (`user_setup: []` in the plan frontmatter). The act toggle is deliberately NOT created; observe-only remains the shipped default until the operator opts in after the Wave-3 live gate.

## Next Phase Readiness

- **Ready for 20-04 (Wave 3, autonomous: false):** the daemon act branch is complete and unit-proven. What remains is the D-09 operator-run LIVE end-to-end gate -- contrive a >=60% session, enable the act toggle, let the daemon fire, and confirm `used_pct` drops in the bridge afterward -- recorded in INSTALL.md, plus the act-mode doc. Only then do PILOT-06/07 count as complete.
- The running LaunchAgent stays observe-only (config absent -> `act_enabled` False); whole-file writes mean it always loads a valid file. The daemon was not stopped and no act toggle was created.
- No blockers.

## Self-Check: PASSED

- Modified file exists on disk: `~/Developer/cc-autopilot/autopilot/daemon.py` - FOUND.
- Backup of record exists: `~/Developer/cc-autopilot/autopilot/daemon.py.bak-20-03-1782922797` - FOUND.
- SUMMARY exists: `20-03-SUMMARY.md` - FOUND (this file).
- Task commits exist: `5b733bf` (Task 1), `3d91fab` (Task 2) - both FOUND in git log.
- Suite state confirmed: 4 daemon act tests GREEN; FULL suite 72 passed / 0 failed (was 4/68); 0 Phase-19 regression; `ruff check autopilot` exit 0; no bare except; `grep -a send-keys daemon.py` == 0; `action.send_compact`==1, new vocab (compact_sent/busy_skip/compact_deduped)==3, `REARM_BELOW_PCT = 45`==1, `used < rearm_below`==1, `config.act_enabled`==1; cco-dream md5 `d8055242bffbee5cb3ea557340c6a444` byte-unchanged (D-02).

---
*Phase: 20-auto-compact-at-60-keystone*
*Completed: 2026-07-01*
