---
phase: 19-supervisor-foundation
plan: 03
subsystem: cc-autopilot
tags: [supervisor, daemon, observe-only, cco-dream, idempotency, jsonl, PILOT-02, PILOT-05]
dependency-graph:
  requires:
    - "19-01 (bridge.py: read_bridge / discover_sessions / is_stale / STALE_SECONDS)"
    - "19-02 (registry.py: read_registry / resolve_pane / reconcile / tmux_live_panes)"
    - "~/.claude/bin/cco-dream (byte-stable safety boundary, md5 d8055242bffbee5cb3ea557340c6a444)"
  provides:
    - "autopilot.daemon: observe-only poll loop (evaluate_session / poll_once / main) + 7-field JSONL action log"
    - "autopilot.runner: the cco-dream subprocess seam (build_cco_dream_argv / CCO_DREAM / self_test_argv) — the only path to claude -p"
    - "autopilot.idempotency: disk-persisted per-(session_id,event) fire-once state (already_fired / record_fired / clear_fired)"
  affects:
    - "Phase 20 (PILOT-06/07): flips observe-only -> act (the send-keys /compact trigger rides evaluate_session's would_compact + clear_fired re-arm)"
    - "Phase 19-04 (PILOT-01/02): launchd plist + ~/.zshrc wrapper + tmux install + the LIVE cco-dream no-op probe (runs self_test_argv once)"
tech-stack:
  added: []
  patterns:
    - "compose-not-fork: daemon shells cco-dream by subprocess (argv list), never edits/forks it (v4.0 discipline); md5-pinned byte-unchanged"
    - "observe-only staging (mirrors cco-dream --dry-run): full detect loop, logs would-act decisions, takes NO action"
    - "injected clock + injected subprocess.run: deterministic staleness/idempotency tests; real tmux/cco-dream/claude never spawned in unit tests"
    - "atomic temp+rename for on-disk state (crash-safe; survives KeepAlive restart)"
key-files:
  created:
    - "~/Developer/cc-autopilot/autopilot/runner.py (71 lines)"
    - "~/Developer/cc-autopilot/autopilot/idempotency.py (104 lines)"
    - "~/Developer/cc-autopilot/autopilot/daemon.py (217 lines)"
    - "~/Developer/cc-autopilot/tests/test_runner.py (141 lines — runner seam + idempotency)"
    - "~/Developer/cc-autopilot/tests/test_daemon.py (247 lines — observe-only loop + JSONL + idempotency)"
    - "~/Developer/cc-autopilot/tests/test_composition.py (40 lines — cco-dream byte-unchanged md5 pin)"
  modified:
    - ".planning/phases/19-supervisor-foundation/19-VALIDATION.md (19-03 status rows green; nyquist_compliant/wave_0_complete -> true)"
decisions:
  - "Kept the test_runner.py file as the home for BOTH the runner seam AND the idempotency tests (per the plan's task-1 wording), rather than a separate test_idempotency.py."
  - "Composition pin lives in a dedicated tests/test_composition.py (not folded into test_daemon.py) so the daemon tests stay behavior-focused; the plan allowed either."
  - "main() gained an `iterations` kwarg (None=forever) purely so the loop is unit-testable without an infinite loop or real sleep; production launchd run passes no iterations (runs forever)."
metrics:
  duration: "6m 19s"
  completed: "2026-06-21"
  tasks: 3
  files-created: 6
  files-modified: 1
---

# Phase 19 Plan 03: Observe-Only Supervisor Daemon + cco-dream Seam + Idempotency Summary

The Phase-19 integration point: an **observe-only** supervisor daemon that composes plan 01's bridge reader and plan 02's registry resolver into the full detect loop (discover → read bridge → resolve pane → reconcile liveness → evaluate the would-be 60% trigger) and **logs structured `would-act` decisions taking NO action** — proving the foundation while the `cco-dream` safety seam (the only path to `claude -p`) and disk-persisted, restart-surviving idempotency are wired and tested.

## What Was Built

- **`autopilot/runner.py`** — the cco-dream boundary seam. `build_cco_dream_argv(*, metric, surface, dry_run=True, max_cost=None)` returns a subprocess **argv list** `[CCO_DREAM, "--metric", metric, "--surface", surface, ...]` that is *structurally incapable* of carrying the skip-permissions bypass flag (the literal token appears nowhere in the package) and never uses `shell=True`. `self_test_argv(surface)` returns the benign `echo 0 --dry-run` no-op probe (plan 04 runs it live). `CCO_DREAM` is an absolute path so a sparse launchd env still finds it.
- **`autopilot/idempotency.py`** — per-`(session_id, event)` fire-once state at `~/.claude/.autopilot/state/<session_id>.json` (`{event: {used_pct, ts}}`), written atomically (temp + `os.replace`). `already_fired` reads from disk so a **fresh process after a KeepAlive restart still sees the arming**; `record_fired` arms; `clear_fired` re-arms for the next crossing. Concrete `except (OSError, ValueError)` only — no bare except.
- **`autopilot/daemon.py`** — `evaluate_session` runs the decision ladder (no_bridge→`no_op`, stale→`stale_skip`, no pane→`unmapped`, under threshold→`no_op` + re-arm, at/over threshold→`would_compact` armed once); `poll_once` discovers → reconciles → evaluates → appends one **7-field JSONL** event (`{ts, session_id, pane, cwd, used_pct, decision, reason}`) per session; `main` is the ~10s (config-overridable) loop whose body is wrapped in `except Exception as` (logs + continues, never a bare except, never dies on one bad poll). **Sends no keystroke and drives no `claude -p`.**

## How to Verify

```bash
# cc-autopilot suite (this plan + Wave-1): 56 passed
~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ -q
# Full suite (19-VALIDATION.md) — cc-autopilot + ~/.claude/bin cco-* regression: 177 passed
~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ ~/.claude/bin -q
# Boundary byte-unchanged (compose-not-fork):
md5 -q ~/.claude/bin/cco-dream      # == d8055242bffbee5cb3ea557340c6a444
# Hard invariants (all return NOTHING):
grep -aR 'dangerously-skip-permissions\|shell=True' ~/Developer/cc-autopilot/autopilot/
grep -aR 'send-keys' ~/Developer/cc-autopilot/autopilot/daemon.py
ruff check ~/Developer/cc-autopilot/autopilot/   # All checks passed!
```

### Observed results

| Gate | Result |
|------|--------|
| `pytest tests/test_runner.py -q` | **16 passed** |
| `pytest tests/test_daemon.py -q` | **12 passed** |
| `pytest tests/test_composition.py -q` | **2 passed** |
| `pytest tests/ -q` (cc-autopilot) | **56 passed, 0 skipped** |
| `pytest tests/ ~/.claude/bin -q` (FULL) | **177 passed, 0 skipped, 0 failed** in 37.50s |
| `md5 -q ~/.claude/bin/cco-dream` (pre AND post) | `d8055242bffbee5cb3ea557340c6a444` (byte-unchanged) |
| `grep -aR 'dangerously-skip-permissions\|shell=True' autopilot/` | (empty) |
| `grep -aR 'send-keys' autopilot/daemon.py` | (empty) |
| 4 decisions in daemon.py | `no_op` / `stale_skip` / `unmapped` / `would_compact` (count 4) |
| `ruff check autopilot/` | All checks passed |

## Hard Invariants Held

1. **OBSERVE-ONLY (D-12):** full detect loop runs; `test_poll_sends_no_keystroke_or_claude_p` proves the stubbed subprocess captured ZERO `send-keys` / `claude -p` across a 90%-over-threshold poll. Decisions logged, nothing sent.
2. **cco-dream BYTE-UNCHANGED (D-16):** md5 identical pre- and post-work; `test_cco_dream_byte_unchanged` pins it; the daemon composes by subprocess only.
3. **NO skip-permissions / NO shell=True:** absent from the entire `autopilot/` package (grep-verified; `test_build_argv_never_carries_skip_permissions` proves it for any input, including a smuggle attempt).
4. **IDEMPOTENCY (D-15):** `test_two_polls_one_crossing_fires_once` (one `would_compact` across two polls of one 70% reading), `test_state_survives_simulated_restart` (fresh reader of the on-disk file still `already_fired`), `test_rearm_after_drop_then_recross_fires_again` (drop re-arms → second crossing fires).
5. **7-field JSONL (D-13):** `test_every_log_line_is_a_seven_key_dict` asserts every appended line parses to the exact `{ts, session_id, pane, cwd, used_pct, decision, reason}` key set.

## Threat Model Coverage

All five register entries mitigated and tested: T-19-09 (skip-flag-incapable argv), T-19-10 (argv-list, no shell=True), T-19-11 (60s `stale_skip` + reconcile drop), T-19-12 (atomic disk state survives restart), T-19-13 (`main` survives a bad poll — `test_main_survives_a_bad_poll`).

## Deviations from Plan

None — plan executed exactly as written. The three small Claude's-discretion choices (test file layout, dedicated `test_composition.py`, `main(iterations=...)` for testability) are documented in frontmatter `decisions` and were all explicitly within the plan's latitude.

### Lint-loop notes (not deviations)

- The PostToolUse `ty` loop emitted `unresolved-import: autopilot` / `unresolved-import: .` on the test/daemon files — the known false positive (ty runs without the package on its path; the existing Wave-1 tests import `from autopilot import ...` identically and pass). The real gate is `~/.local/bin/pytest` (all green) + `ruff` (clean).
- Reworded three docstring/comment lines in `runner.py`/`daemon.py` to refer to "the skip-permissions bypass flag" and "tmux keystroke" *without* the literal `dangerously-skip-permissions` / `send-keys` / `shell=True` tokens, so the hard-invariant package greps return nothing while the documentation intent is preserved. (The test files legitimately contain the literal flag in assertions; the invariant greps target `autopilot/`, not `tests/`.)

## Notes for Phase 20 / 19-04

- **Phase 20 act path:** flip observe-only by acting on `evaluate_session`'s `would_compact` (send the `/compact` keystroke via tmux to the resolved `pane`); the `clear_fired` re-arm on under-threshold is already wired so a later re-crossing re-fires.
- **19-04 live probe:** `runner.self_test_argv(<throwaway-git>)` is the exact argv to run once against the live `cco-dream` to smoke-test the seam (D-16). `main()` is the launchd entry point — production passes no `iterations` (runs forever); plan 04 builds the `__main__.py` entry + the `com.user.ccautopilot.plist`.
- **No `~/.claude/` edits this plan** — only `~/Developer/cc-autopilot/` (not a git repo) + the `.planning/` SUMMARY/VALIDATION (committed to claudecodeoptimized). No `.bak` needed.

## Self-Check: PASSED

- All 6 created files exist (paths + line counts verified above; all exceed `min_lines`).
- cco-dream md5 byte-unchanged pre/post (`d8055242bffbee5cb3ea557340c6a444`).
- Full suite 177 passed / 0 failed / 0 skipped; ruff clean; all hard-invariant greps empty.
- No git commit for code (cc-autopilot is not a git repo, per the commit model); only this SUMMARY + VALIDATION committed to claudecodeoptimized.
