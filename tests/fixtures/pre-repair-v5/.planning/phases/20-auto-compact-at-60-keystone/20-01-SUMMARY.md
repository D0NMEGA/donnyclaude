---
status: PASS
agent: donny-executor
phase: 20-auto-compact-at-60-keystone
plan: 01
subsystem: testing
tags: [tdd, pytest, tmux, send-keys, cc-autopilot, red, act-path]

# Dependency graph
requires:
  - phase: 19-supervisor-foundation
    provides: observe-only daemon (evaluate_session / poll_once, bridge, registry, idempotency), pytest harness (conftest fixtures, stub_subprocess), the cc-autopilot package layout
provides:
  - RED act-path test contracts (test_action.py, test_config.py, 4 appended test_daemon.py act tests)
  - importable autopilot/action.py + autopilot/config.py skeletons carrying the LOCKED constants
  - two shared fixtures (fake_tmux argv-capturing tmux stub, write_nudge_marker dedupe sibling)
affects: [20-02, 20-03, 20-04, PILOT-06, PILOT-07]

# Tech tracking
tech-stack:
  added: []  # stdlib-only; pytest already present from Phase 19
  patterns:
    - "TDD RED-first for the act path: failing contracts + importable skeletons before any behavior"
    - "Injected run=/sleep= stubs (fake_tmux) so the real tmux binary is never spawned in unit tests"
    - "ASCII-only source: the idle marker is the \\u276f escape, never a raw glyph (BSD-grep binary-file trap)"
    - "External product delivered live + tracked via .bak-20-01-*; per-task .planning ledger commits"

key-files:
  created:
    - ~/Developer/cc-autopilot/autopilot/action.py
    - ~/Developer/cc-autopilot/autopilot/config.py
    - ~/Developer/cc-autopilot/tests/test_action.py
    - ~/Developer/cc-autopilot/tests/test_config.py
  modified:
    - ~/Developer/cc-autopilot/tests/conftest.py
    - ~/Developer/cc-autopilot/tests/test_daemon.py

key-decisions:
  - "Skeletons carry the LOCKED constants + NotImplementedError bodies so the RED tests collect and fail on behavior, not ImportError"
  - "The 4 daemon act tests target the FINAL Wave-2 poll_once(act=, run=) signature: RED via TypeError now, GREEN in Wave 2"
  - "requirements-completed is empty: Wave 0 ships no production behavior; PILOT-06/07 complete only when Waves 1-3 land + the live gate (D-09) passes"

patterns-established:
  - "fake_tmux fixture: stateful argv-capturing tmux stub (settable pane_content / live_panes) mirroring stub_subprocess"
  - "Act tests assert on fake_tmux.calls (argv) + the JSONL log, never on the raw glyph"

requirements-completed: []  # PILOT-06/07 are contributed-to (RED scaffolding) but NOT completed by this Wave-0 plan

# Metrics
duration: 19min
completed: 2026-07-01
---

# Phase 20 Plan 01: Wave-0 TDD RED (Act-Path Contracts + Skeletons) Summary

**Authored every failing act-path test that pins the 60% send-keys /compact keystone (send-keys argv, idle busy_skip, marker dedupe, mapped-only, arm-on-send fire-once, <45% hysteresis, observe-only default) plus the importable action.py/config.py skeletons carrying the LOCKED constants - 13 RED tests against 59 still-green Phase-19 tests.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-07-01T03:10:55Z
- **Completed:** 2026-07-01T03:30:45Z
- **Tasks:** 3
- **Files touched (live product):** 6 (4 created, 2 modified) + 2 .bak of record

## Accomplishments

- `autopilot/action.py` skeleton: the LOCKED constants (`COMPACT_TEXT="/compact"`, `ENTER_SETTLE_SECS=0.4`, `IDLE_PROMPT_MARKER="\u276f"`, `CAPTURE_TAIL_LINES=8`, `SENT/BUSY/DEDUPED`) + 6 typed `NotImplementedError` signatures (`send_compact`, `is_pane_idle`, `compact_marker_present`, 3 argv builders). No `cco-dream`/`runner` reference (D-02).
- `autopilot/config.py` skeleton: `act_enabled` + `DEFAULT_CONFIG_PATH` (observe-only SAFE default, D-10).
- `tests/test_action.py`: the 3 VALIDATION-mapped names (`test_compact_send_keys_argv` T-20-01, `test_busy_pane_skips_send` T-20-02, `test_marker_dedupe` D-12) + 3 argv-builder asserts - RED on `NotImplementedError`.
- `tests/test_config.py`: act-toggle safe-default (missing / malformed / absent-key / false -> False; only `{"act": true}` -> True) - T-20-05.
- `tests/test_daemon.py`: 4 appended act tests (`test_observe_only_no_send`, `test_act_only_on_mapped_pane`, `test_fire_once_arm_on_send`, `test_rearm_hysteresis_band`) targeting the final `poll_once(act=, run=)` - RED via `TypeError` (act kwarg not yet wired).
- `tests/conftest.py`: two shared fixtures added additively (`fake_tmux`, `write_nudge_marker`); the 5 existing fixtures untouched.
- **Result:** whole suite collects (72 tests, zero ImportError); 59 Phase-19 tests GREEN; 13 new tests RED for the right reason (9 `NotImplementedError` + 4 `TypeError`). ruff-clean; every new `.py` ASCII-only.

## Task Commits

Each task committed atomically (the external cc-autopilot product is not git-tracked; the git-tracked artifact per task is the `.planning/` ledger append, with the live code delivered in place + `.bak` of record):

1. **Task 1: action.py + config.py importable skeletons** - `b6d6616` (test)
2. **Task 2: conftest fixtures + RED test_action/test_config** - `7045ac9` (test)
3. **Task 3: append act-path integration tests to test_daemon.py** - `42b7527` (test)

**Plan metadata:** (this SUMMARY + STATE + ROADMAP) - see final `docs(20-01)` commit.

## Files Created/Modified

Created (live, cc-autopilot):
- `~/Developer/cc-autopilot/autopilot/action.py` - send-keys /compact action skeleton (LOCKED constants + NotImplementedError sigs)
- `~/Developer/cc-autopilot/autopilot/config.py` - act-toggle skeleton (DEFAULT_CONFIG_PATH + act_enabled)
- `~/Developer/cc-autopilot/tests/test_action.py` - RED PILOT-06 action contracts (argv, busy_skip, dedupe)
- `~/Developer/cc-autopilot/tests/test_config.py` - RED T-20-05 safe-default toggle contracts

Modified (live, cc-autopilot; each with a `.bak-20-01-*` of record):
- `~/Developer/cc-autopilot/tests/conftest.py` - +fake_tmux, +write_nudge_marker (backup: `conftest.py.bak-20-01-1782876105`)
- `~/Developer/cc-autopilot/tests/test_daemon.py` - +4 act-path integration tests (backup: `test_daemon.py.bak-20-01-1782876424`)

## Decisions Made

- Skeletons ship the LOCKED constants verbatim so they can never drift and so the RED tests collect against real symbols (a clean behavior-RED, not a collection ImportError).
- The daemon act tests are written against the eventual Wave-2 `poll_once(act=, run=)` signature, so they are RED now via the missing kwarg (`TypeError`) and turn GREEN when Wave 2 wires the act branch - no test rewrite needed.
- `requirements-completed` left empty: PILOT-06/07 are only scaffolded here; they are satisfied when Waves 1-3 implement the behavior and the D-09 live send-keys round-trip gate passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Split `import subprocess, time` into separate lines (action.py)**
- **Found during:** Task 1
- **Issue:** The plan's literal `import subprocess, time` shorthand trips ruff `E401` (multiple imports on one line), which would fail the hard `ruff check ... exits 0` acceptance gate.
- **Fix:** Wrote them as separate `import` lines, matching the existing one-import-per-line convention in daemon.py/registry.py. Both imports are used (`subprocess.run`, `time.sleep` defaults).
- **Files modified:** autopilot/action.py
- **Verification:** `ruff check autopilot/action.py` exits 0.
- **Committed in:** b6d6616 (Task 1)

**2. [Rule 3 - Blocking] Omitted the unused `import json` from the config.py skeleton**
- **Found during:** Task 1
- **Issue:** The plan's literal `import json, os` leaves `json` unused in the skeleton (act_enabled is a NotImplementedError stub), tripping ruff `F401` and failing the ruff gate.
- **Fix:** Imported only `os` (used by `DEFAULT_CONFIG_PATH`); Wave 1 adds `import json` when it fills `act_enabled`. No acceptance grep requires `import json` in the skeleton.
- **Files modified:** autopilot/config.py
- **Verification:** `ruff check autopilot/config.py` exits 0; `from autopilot import config` succeeds.
- **Committed in:** b6d6616 (Task 1)

**3. [Rule 1 - Bug] Fixed a pre-existing non-ASCII byte in conftest.py to meet the ASCII gate**
- **Found during:** Task 2
- **Issue:** Task 2's acceptance criterion requires `LC_ALL=C grep -c '[^\x00-\x7f]' tests/conftest.py == 0`, but the original (Phase-19) `write_bridge` docstring already contained a section-sign glyph ("RESEARCH sec 2.1"), so the gate could never pass on my additions alone.
- **Fix:** Replaced the pre-existing section-sign with the ASCII "sec" (docstring-only, non-functional). My own additions use the \u276f escape, never a raw glyph.
- **Files modified:** tests/conftest.py
- **Verification:** `LC_ALL=C grep -c '[^\x00-\x7f]' tests/conftest.py` == 0; the 5 existing fixtures still present and green.
- **Committed in:** 7045ac9 (Task 2)

---

**Total deviations:** 3 auto-fixed (2 blocking ruff-gate fixes, 1 pre-existing-non-ASCII fix). **Impact:** All three were required to pass the plan's own hard acceptance gates (ruff-clean, ASCII-clean); no behavior change, no scope creep. The two import adjustments are cosmetic-to-the-skeleton and Wave 1 restores `import json` when it is actually used.

**Scope note:** `tests/test_daemon.py` retains 3 pre-existing Phase-19 em-dash comment lines (192/199/236). These were left untouched deliberately - the plan says "never modify the Phase-19 tests above", Task 3 has no ASCII grep gate for this file, and its acceptance greps use `grep -a` (text mode) precisely to tolerate them.

## Known Stubs

These are the INTENTIONAL deliverable of a Wave-0 TDD RED plan (the plan states "NO production behavior ships this plan"); they do not block this plan's goal and each has a named resolving wave:

| Stub | File | Reason / Resolving wave |
|------|------|-------------------------|
| `send_compact`, `is_pane_idle`, `compact_marker_present`, `send_keys_*_argv` raise `NotImplementedError` | autopilot/action.py | Skeleton for RED collection; **Wave 1 (20-02)** implements the send-keys /compact action + fail-closed idle guard + marker dedupe. |
| `act_enabled` raises `NotImplementedError` | autopilot/config.py | Skeleton for RED collection; **Wave 1 (20-02)** implements the safe-default act toggle. |
| `poll_once`/`evaluate_session` have no `act=`/`run=` act branch | autopilot/daemon.py (unchanged this plan) | The 4 daemon act tests are RED against the future signature; **Wave 2 (20-03)** wires the act branch (arm-on-send, <45% hysteresis, observe-only default). |

The 13 RED tests are the expected state of this wave, not a defect: they fail on `NotImplementedError` / `TypeError`, never on ImportError/collection error.

## Issues Encountered

- Transient authoring slips: the Write/Edit path normalized the \u276f unicode escape and a copied section-sign / em-dash back into raw glyphs twice (action.py, conftest.py, test_daemon.py). Caught each time by `LC_ALL=C grep '[^\x00-\x7f]'` and fixed byte-precisely with a small Python `str.replace` (the escape expressed unambiguously in Python source). Final state: every new `.py` is ASCII-clean.
- `DONNY_TOOLS` env var points at a non-existent `gsd-tools.cjs`; used the explicit `donny-tools.cjs` path the workflow references. This build of donny-tools has no `roadmap`/`requirements`/`config-get` subcommands, so ROADMAP.md was updated directly and requirements were (correctly) not marked.

## Next Phase Readiness

- **Ready for 20-02 (Wave 1):** the RED contracts + skeletons are the exact API to implement. action.py fills the 6 signatures against `test_action.py`; config.py fills `act_enabled` against `test_config.py`.
- **Ready for 20-03 (Wave 2):** the 4 daemon act tests pin the `poll_once(act=, run=)` behavior (arm-on-send, `<45%` re-arm, mapped-only, observe-only default).
- No blockers. The live send-keys -> /compact round-trip (D-09) remains the operator gate discharged in 20-04 (Wave 3), out of scope here.

## Self-Check: PASSED

- Created files exist on disk: `autopilot/action.py`, `autopilot/config.py`, `tests/test_action.py`, `tests/test_config.py`, and `20-01-SUMMARY.md` - all FOUND.
- Task commits exist: `b6d6616` (Task 1), `7045ac9` (Task 2), `42b7527` (Task 3) - all FOUND.
- Backups of record exist: `conftest.py.bak-20-01-1782876105`, `test_daemon.py.bak-20-01-1782876424` - both FOUND.
- Suite state confirmed: 72 collect / 59 Phase-19 green / 13 new RED (9 NotImplementedError + 4 TypeError); ruff-clean; every new `.py` ASCII-only.

---
*Phase: 20-auto-compact-at-60-keystone*
*Completed: 2026-07-01*
