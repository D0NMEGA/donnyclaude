---
status: PASS
agent: donny-executor
phase: 20-auto-compact-at-60-keystone
plan: 02
subsystem: infra
tags: [tdd, pytest, tmux, send-keys, compact, cc-autopilot, green, act-path, safe-default]

# Dependency graph
requires:
  - phase: 20-auto-compact-at-60-keystone (plan 01)
    provides: RED act-path contracts (test_action.py, test_config.py), importable action.py/config.py skeletons with the LOCKED constants, the fake_tmux + write_nudge_marker fixtures
  - phase: 19-supervisor-foundation
    provides: bridge._tmp + bridge.STALE_SECONDS (marker freshness), registry.tmux_live_panes (injected-run fail-closed template), idempotency._read_state (try/except + isinstance shape)
provides:
  - action.send_compact (marker-dedupe -> fail-closed idle guard -> literal /compact + 0.4s settle + SEPARATE Enter), all argv LISTS
  - action.is_pane_idle (fail-closed capture-pane idle probe) + action.compact_marker_present (fresh nudged.json dedupe read) + the 3 pure argv builders
  - config.act_enabled (safe-default-off act toggle) + DEFAULT_CONFIG_PATH
affects: [20-03, 20-04, PILOT-06, PILOT-07]

# Tech tracking
tech-stack:
  added: []  # stdlib-only; pytest/ruff already present from Phase 19
  patterns:
    - "Injected run=/sleep= so the real tmux binary is never spawned in unit tests (mirrors registry.tmux_live_panes)"
    - "Fail-closed idle guard: getattr(result,'returncode',1)!=0 / OSError / absent marker -> False (never send blind)"
    - "Marker dedupe checked FIRST in send_compact so a fresh manual/native /compact is never raced (D-12), zero tmux calls"
    - "Safe-default-off config: only an explicit act=true enables; missing/malformed/non-dict all -> False (D-10)"
    - "External product delivered live + tracked via .bak-20-02-*; per-task .planning ledger commits (code not git-tracked)"

key-files:
  created: []
  modified:
    - ~/Developer/cc-autopilot/autopilot/action.py
    - ~/Developer/cc-autopilot/autopilot/config.py

key-decisions:
  - "send_compact ORDER is load-bearing: marker->DEDUPED (first, zero tmux calls) -> not idle->BUSY (only the capture probe) -> literal + settle + separate Enter->SENT"
  - "Kept the LOCKED IDLE_PROMPT_MARKER as the \\u276f unicode ESCAPE (never a raw glyph) so the source stays ASCII (BSD-grep binary-file trap); edits never touched that line"
  - "requirements-completed left empty: this wave builds and unit-proves the send-keys MECHANISM, but PILOT-06 completes only when Wave 2 wires the daemon act branch and Wave 3's D-09 live round-trip gate passes"

patterns-established:
  - "compact_marker_present reuses bridge._tmp + bridge.STALE_SECONDS for the *-nudged.json freshness window (no new staleness constant)"
  - "config.act_enabled mirrors idempotency._read_state's try/except (OSError, ValueError) + isinstance(data, dict) shape exactly"

requirements-completed: []  # PILOT-06 contributed-to (send-keys action built + unit-proven), NOT completed until Wave 2 (daemon) + Wave 3 (D-09 live gate)

# Metrics
duration: 22min
completed: 2026-07-01
---

# Phase 20 Plan 02: Wave-1 TDD GREEN (send-keys /compact action + act toggle) Summary

**Implemented the PILOT-06 send-keys /compact mechanism (action.py) - marker-dedupe -> fail-closed idle guard -> literal `/compact` + 0.4s settle + a SEPARATE Enter, all argv LISTS to the `%N` pane - plus the safe-default-off act toggle (config.py), turning the 9 Wave-0 RED contracts GREEN while the 4 daemon act tests stay RED for Wave 2, with the cco-dream runner seam byte-unchanged (D-02).**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-01T15:45Z
- **Completed:** 2026-07-01T16:07Z
- **Tasks:** 2
- **Files touched (live product):** 2 modified + 2 .bak of record

## Accomplishments

- `autopilot/action.py` filled (skeleton -> working):
  - 3 pure argv builders as LISTS: `send_keys_literal_argv` -> `[tmux, send-keys, -t, pane, -l, /compact]`, `send_keys_enter_argv` -> `[..., Enter]`, `capture_pane_argv` -> `[tmux, capture-pane, -p, -t, pane]` (T-20-01, no shell string).
  - `is_pane_idle`: `run(capture_pane_argv, capture_output=True, text=True)`, then fail-closed - `(OSError, ValueError)` or `getattr(result,'returncode',1)!=0` -> False; else the last `CAPTURE_TAIL_LINES` of stdout must contain `IDLE_PROMPT_MARKER` (T-20-02, never send into a blind/busy pane).
  - `compact_marker_present`: `claude-ctx-{id}-nudged.json` under `bridge._tmp(tmpdir)`, True only if it exists AND is fresh (`time.time() - getmtime <= bridge.STALE_SECONDS`) so a stale marker cannot permanently suppress the keystone (D-12).
  - `send_compact`: the ordered orchestration - marker->`DEDUPED` (checked FIRST, zero tmux calls) -> not idle->`BUSY` (only the capture probe ran) -> `run(literal)` + `sleep(ENTER_SETTLE_SECS=0.4)` + `run(Enter)` -> `SENT`.
- `autopilot/config.py` filled: `act_enabled` opens + `json.load`s the config; `(OSError, ValueError)` -> False (missing / malformed), non-dict -> False, else `bool(data.get("act", False))`. Only an explicit `act=true` enables acting; observe-only is the SAFE default (D-10, T-20-05).
- No `cco-dream` / `runner` import and no `--dangerously-skip-permissions` in the keystroke path (D-02); the runner seam is byte-unchanged.
- **Result:** the 9 Wave-0 RED contracts (6 `test_action.py` + 3 `test_config.py`) are GREEN; the full suite is **4 failed / 68 passed** (was 13/59) - the only reds are the 4 Wave-2 daemon act tests (`TypeError: poll_once() got an unexpected keyword argument 'act'`), intentionally still RED for plan 20-03. Package-wide ruff clean; both files ASCII-only; no bare except.

## Task Commits

Each task committed atomically. The external cc-autopilot product is not git-tracked; the git-tracked artifact per task is the `.planning/` ledger append (`20-LEDGER.jsonl`), with the live code delivered in place + a `.bak-20-02-*` of record:

1. **Task 1: action.py send-keys /compact action** - `52700a5` (feat) [+ backup `action.py.bak-20-02-1782921615`]
2. **Task 2: config.py act toggle (safe-default-off)** - `c1e0bdd` (feat) [+ backup `config.py.bak-20-02-1782921851`]

**Plan metadata:** (this SUMMARY + STATE + ROADMAP) - see the final `docs(20-02)` commit.

_TDD note: the RED phase shipped in Wave 0 (plan 01); this Wave-1 plan is GREEN-only, hence one `feat` commit per file (no separate `test` commit)._

## Files Created/Modified

Modified (live, cc-autopilot; each with a `.bak-20-02-*` of record):
- `~/Developer/cc-autopilot/autopilot/action.py` - filled the 6 signatures: 3 argv builders + `is_pane_idle` + `compact_marker_present` + `send_compact` (backup: `action.py.bak-20-02-1782921615`).
- `~/Developer/cc-autopilot/autopilot/config.py` - filled `act_enabled` (backup: `config.py.bak-20-02-1782921851`).

Added `import os` + `from . import bridge` to action.py and `import json` to config.py (all used; import block one-per-line per ruff I001/E401 and the existing daemon.py/registry.py convention).

## Decisions Made

- **send_compact check order is a correctness decision, not incidental:** the marker dedupe runs BEFORE the idle probe so a crossing that a manual/native `/compact` already handled costs zero tmux calls (test_marker_dedupe asserts neither `capture-pane` nor `send-keys` runs); the idle guard runs before any send so a busy pane costs only the capture probe.
- **Freshness on the dedupe marker (not mere existence):** reused `bridge.STALE_SECONDS` (60s) so a stale `-nudged.json` cannot permanently suppress the 60% keystone - matches the D-12 rationale and the Phase-19 staleness discipline.
- **`requirements-completed` intentionally empty:** the send-keys action + act toggle are built and unit-proven here, but PILOT-06/07 are only satisfied once Wave 2 (20-03) wires the daemon act branch and Wave 3 (20-04) discharges the D-09 live send-keys -> `/compact` round-trip gate. Mirrors plan 20-01's stance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wrote the plan's comma-shorthand imports one-per-line (ruff gate)**
- **Found during:** Tasks 1 and 2
- **Issue:** The plan action wrote imports as `import os, time, subprocess` (action.py) and implied `import json` (config.py). A single comma-import line trips ruff `E401`/`I001`, which would fail the hard `ruff check ... exits 0` acceptance gate.
- **Fix:** Added `import os` (action.py) and `import json` (config.py) as separate lines in sorted order, plus `from . import bridge` in the local-import group - matching the existing daemon.py/registry.py convention (the same adjustment plan 20-01 made for its skeleton).
- **Files modified:** autopilot/action.py, autopilot/config.py
- **Verification:** `ruff check ~/Developer/cc-autopilot/autopilot` exits 0.
- **Committed in:** 52700a5 (Task 1), c1e0bdd (Task 2)

---

**Total deviations:** 1 auto-fixed (1 blocking ruff-gate compliance). **Impact:** cosmetic import-formatting only; no behavior change, no scope creep. All argv/behavior matches the RED contracts exactly (tests unmodified).

## Issues Encountered

- **`ty` unresolved-import false positive (known class):** the PostToolUse lint-loop's `ty` reports `error[unresolved-import] Cannot resolve imported module '.'` on `from . import bridge`. This is a standalone-type-checker limitation on relative package imports (the same false-positive class as the `unresolved-import: pytest` one) - `daemon.py`/`__main__.py` use the identical `from . import ...` convention, and the real gates (ruff + pytest) are green. Not a defect; no action taken.
- **Lint-loop mid-edit snapshots:** the hook fired between the two-edit sequences on each file (imports added but body still a stub), transiently reporting `F401 unused` + `NotImplementedError`. Both resolved the instant the body edit landed; re-verified green by running ruff + pytest directly.
- **donny-tools build:** this `donny-tools.cjs` build exposes `state`/`commit`/`init` but has no `roadmap`/`requirements`/`config-get` subcommands, so ROADMAP.md was updated directly and PILOT-06 was (correctly) not auto-marked complete - consistent with plan 20-01.

## User Setup Required

None - no external service configuration required (`user_setup: []` in the plan frontmatter).

## Next Phase Readiness

- **Ready for 20-03 (Wave 2):** `action.send_compact(session_id, pane, *, tmpdir, run, sleep)` and `config.act_enabled(config_path)` are the exact seams the daemon act branch composes. The 4 daemon act tests (`test_observe_only_no_send`, `test_act_only_on_mapped_pane`, `test_fire_once_arm_on_send`, `test_rearm_hysteresis_band`) pin the `poll_once(act=, run=)` behavior (arm-on-send fire-once, `<45%` hysteresis re-arm, observe-only default) - still RED by design.
- **Ready for 20-04 (Wave 3):** the live send-keys -> `/compact` round-trip (D-09 operator gate) remains the manual end-to-end proof, discharged in INSTALL.md; out of scope here.
- No blockers. The daemon remains observe-only (nothing calls `send_compact` yet); the running LaunchAgent loads valid files at all times (whole-file writes).

## Self-Check: PASSED

- Modified files exist on disk: `autopilot/action.py`, `autopilot/config.py` - both FOUND.
- Backups of record exist: `action.py.bak-20-02-1782921615`, `config.py.bak-20-02-1782921851` - both FOUND.
- SUMMARY exists: `20-02-SUMMARY.md` - FOUND.
- Task commits exist: `52700a5` (Task 1), `c1e0bdd` (Task 2) - both FOUND.
- Suite state confirmed: 6/6 test_action.py + 3/3 test_config.py GREEN; full suite 4 failed / 68 passed (the 4 reds are the intended Wave-2 daemon act tests); package ruff exit 0; both files ASCII-only; cco-dream md5 `d8055242bffbee5cb3ea557340c6a444` byte-unchanged (D-02).

---
*Phase: 20-auto-compact-at-60-keystone*
*Completed: 2026-07-01*
