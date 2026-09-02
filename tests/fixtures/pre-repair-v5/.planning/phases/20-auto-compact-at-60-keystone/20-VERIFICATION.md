---
status: PARTIAL
agent: donny-verifier
phase: 20-auto-compact-at-60-keystone
verified: 2026-07-01T16:53:48Z
verdict: human_needed
score: 9/10
human_verification:
  - test: "D-09 live round-trip: with act mode enabled, let a real Claude session cross 60% context, then confirm the daemon sends /compact to the correct tmux pane via send-keys (text appears in the TUI, not absorbed as pasted text) and the bridge used_pct drops on the next poll."
    expected: "The session visibly runs /compact; the autopilot.jsonl emits compact_sent; a subsequent bridge read shows used_pct < 60; no other pane is touched."
    why_human: "Unit tests inject stub run= and sleep= callables — the real tmux binary is never spawned. Only an operator can prove that the -l flag submits the literal /compact keystroke through the live TUI rather than being swallowed as bracketed-paste, and that the native compaction drop is reflected in the bridge JSON. Per 20-04-PLAN.md (autonomous: false), this gate is an OPERATOR RESIDUAL by design."
---

# Phase 20: Auto-Compact at 60% Keystone Verification Report

**Phase Goal:** When a session crosses 60% context, the supervisor sends `/compact` to that exact session's tmux pane via `send-keys` (no focus stolen, no other pane touched), firing at most once per fill cycle (re-arms only after a compaction drops usage back down), proven end-to-end on the live binary.
**Verified:** 2026-07-01T16:53:48Z
**Status:** PARTIAL  **Verdict:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| T1  | Automated suite exits 0 (72 passed / 0 failed) | [OK] VERIFIED | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests -q` → `72 passed in 1.78s` |
| T2  | PILOT-06: send-keys literal built as argv list `["tmux","send-keys","-t",pane,"-l","/compact"]` — never a shell string | [OK] VERIFIED | `action.send_keys_literal_argv` returns exactly that list; `test_compact_send_keys_argv` passes |
| T3  | PILOT-06: Enter is a SEPARATE send-keys argv list call — `["tmux","send-keys","-t",pane,"Enter"]` | [OK] VERIFIED | `action.send_keys_enter_argv` returns that list; `send_compact` calls it after the settle sleep |
| T4  | PILOT-06: 0.4s settle (ENTER_SETTLE_SECS) between the literal call and the Enter call | [OK] VERIFIED | `ENTER_SETTLE_SECS = 0.4` constant; `sleep(ENTER_SETTLE_SECS)` called between the two `run()` invocations in `send_compact` |
| T5  | PILOT-07 fire-once (D-05 arm-on-send): `idempotency.record_fired` called ONLY in `outcome == action.SENT` branch; BUSY and DEDUPED carry no arm | [OK] VERIFIED | Structural grep + code read of `evaluate_session` lines 130-147: `record_fired` appears exactly in the `if outcome == action.SENT:` guard; neither the `DEDUPED` nor `busy_skip` returns call it. `test_fire_once_arm_on_send` exercises this path. |
| T6  | PILOT-07 re-arm (D-07 hysteresis): `clear_fired` gated on `used < rearm_below (45)`, NOT `< threshold (60)` | [OK] VERIFIED | `daemon.py` lines 121-126: `if used < rearm_below` (REARM_BELOW_PCT = 45) guards `clear_fired`; `test_rearm_hysteresis_band` verifies sessions in [45%, 60%) stay armed |
| T7  | D-10 observe-only default: `act=False` in all function signatures; daemon reads config each poll | [OK] VERIFIED | `evaluate_session(act: bool = False)`, `poll_once(act: bool = False)`, `main()` reads `act = config.act_enabled(config_path)` before each `poll_once`; `test_observe_only_no_send` confirms no send-keys on observe path |
| T8  | D-10 config safe-default-off: `act_enabled()` returns False on absent/malformed config.json; live config.json absent | [OK] VERIFIED | `config.py` `except (OSError, ValueError): return False`; `~/.claude/.autopilot/config.json` ABSENT (confirmed live); `test_act_enabled_missing_file_is_false` + `test_act_enabled_malformed_is_false` pass |
| T9  | D-02 compose-not-fork: `cco-dream` byte-unchanged; no `runner`/`cco-dream` import in `action.py`; no `send-keys` string assembled in `daemon.py` | [OK] VERIFIED | `md5 -q ~/.claude/bin/cco-dream` = `d8055242bffbee5cb3ea557340c6a444` (matches expected); `action.py` imports: `subprocess, time, typing, pathlib, json, os` only; daemon.py 0 grep hits for `send-keys` |
| T10 | D-09 live round-trip: `/compact` keystroke submits through live TUI and used_pct drops in bridge | ? HUMAN | OPERATOR RESIDUAL — unstarted. Recorded honestly in INSTALL.md §"Task 3 — Phase 20 LIVE verification record" with 7-step discharge procedure. Not a defect; autonomous:false by design. |

**Score:** 9/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `~/Developer/cc-autopilot/autopilot/action.py` | send_compact with LOCKED argv form, idle guard, marker dedupe | [OK] VERIFIED | Substantive (76+ lines); wired via `from . import action` in daemon.py; `send_compact` called in evaluate_session act branch |
| `~/Developer/cc-autopilot/autopilot/config.py` | act_enabled safe-default-off | [OK] VERIFIED | Substantive; wired via `from . import config` in daemon.py; `config.act_enabled(config_path)` called each poll in main() |
| `~/Developer/cc-autopilot/autopilot/daemon.py` (act branch) | evaluate_session act path with D-05 arm-on-send | [OK] VERIFIED | Substantive (260 lines); act path lines 132-147 structurally correct; arm-on-send and hysteresis confirmed |
| `~/Developer/cc-autopilot/tests/test_action.py` | send_compact contracts, idle guard, marker dedupe | [OK] VERIFIED | Present; test_compact_send_keys_argv, test_busy_pane_skips_send, test_marker_dedupe, 3 argv-builder unit asserts |
| `~/Developer/cc-autopilot/tests/test_config.py` | act_enabled edge cases | [OK] VERIFIED | Present; test_act_enabled_missing_file_is_false, test_act_enabled_malformed_is_false, test_act_enabled_true |
| `~/Developer/cc-autopilot/tests/test_daemon.py` (Phase 20 appended tests) | observe-only, mapped-only, fire-once, re-arm hysteresis | [OK] VERIFIED | 4 tests appended: test_observe_only_no_send, test_act_only_on_mapped_pane, test_fire_once_arm_on_send, test_rearm_hysteresis_band |
| `~/Developer/cc-autopilot/INSTALL.md` (Phase 20 section) | Honest D-09 OPERATOR RESIDUAL record; act-mode enable/disable docs | [OK] VERIFIED | Phase 20 section appended; 5-row live-check table with all rows "OPERATOR RESIDUAL — unstarted"; 7-step discharge procedure; no fabricated DISCHARGED claim |

---

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `daemon.main()` | `config.act_enabled()` | called each poll before `poll_once` | [OK] WIRED | `act = config.act_enabled(config_path)` at daemon.py line 244 |
| `daemon.evaluate_session` | `action.send_compact()` | act branch at threshold | [OK] WIRED | `outcome = action.send_compact(session_id, pane, tmpdir=tmpdir, run=run)` at line 139 |
| `action.send_compact` | `idempotency.record_fired` | ONLY via `outcome == SENT` guard in evaluate_session | [OK] WIRED | `if outcome == action.SENT: idempotency.record_fired(...)` at line 141; DEDUPED and busy_skip returns are bare — no record_fired reachable from them |
| `idempotency.clear_fired` | `rearm_below (45)` guard | `if used < rearm_below` in evaluate_session step 4 | [OK] WIRED | Line 122: `if used is not None and used < rearm_below and idempotency.already_fired(...)` — structurally distinct from the `threshold (60)` comparison |
| `action.send_compact` | `compact_marker_present()` | called FIRST (zero tmux calls on dedup) | [OK] WIRED | `if compact_marker_present(session_id, tmpdir=tmpdir): return DEDUPED` is the first branch in send_compact before any tmux call |
| `action.send_compact` | `is_pane_idle()` | capture-pane probe before send | [OK] WIRED | `if not is_pane_idle(pane, run=run): return BUSY` is called after marker check, before any send-keys call |

---

### Data-Flow Trace (Level 4)

Not applicable. The cc-autopilot daemon is a Python stdlib process with no React/UI components. Data flows from the bridge JSONL file (read) through evaluate_session logic to an argv list (built) passed to subprocess.run (or its test stub). The unit tests inject `run=` callables that capture argv without spawning tmux; the live data-flow (real tmux, real session) is the D-09 operator gate item.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite exits 0 | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests -q` | `72 passed in 1.78s` | [OK] PASS |
| cco-dream byte-unchanged (D-02) | `md5 -q ~/.claude/bin/cco-dream` | `d8055242bffbee5cb3ea557340c6a444` | [OK] PASS |
| config.json absent (D-10 default) | `ls ~/.claude/.autopilot/config.json` | ABSENT | [OK] PASS |
| D-09 live round-trip | Requires live session at 60%+ + act mode enabled | Not run (OPERATOR RESIDUAL) | ? SKIP |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| PILOT-06 | 20-02-PLAN.md, 20-03-PLAN.md | Supervisor sends /compact to owning pane via tmux send-keys without stealing window focus | [OK] SATISFIED (automated) | send_compact builds LOCKED argv lists; pane is the session's own %N from registry; no window-focus change; tests pass |
| PILOT-07 | 20-02-PLAN.md, 20-03-PLAN.md | 60% trigger fires at most once per fill cycle; re-arms only after compaction drops usage down; verified end-to-end against live binary | [OK] SATISFIED (automated); ? SC-3 HUMAN | Fire-once (D-05) and re-arm hysteresis (D-07) both unit-proven (test_fire_once_arm_on_send, test_rearm_hysteresis_band); SC-3 "verified end-to-end against the live binary" = D-09 OPERATOR RESIDUAL |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | — | — | No blockers or warnings found |

Notes:
- `IDLE_PROMPT_MARKER = "❯"` — correct ASCII escape form (BSD-grep-safe), not raw Unicode glyph. The known macOS grep binary-file trap is avoided.
- `except (OSError, ValueError)` in config.py and `except OSError` in daemon.py — explicit exception types, no bare except (per D-03 / global rule).
- `except Exception as e` in daemon.main() — correctly NOT a bare except; labeled with `# noqa: BLE001` and the rationale comment; the daemon must survive one bad poll.

---

### Human Verification Required

#### 1. D-09 Live Round-Trip (OPERATOR RESIDUAL)

**Test:** With a real `CC_TMUX=1` Claude session mapped in the registry, enable act mode (`echo '{"act": true}' > ~/.claude/.autopilot/config.json`), then bring the session's context to 60%+ (or wait for a natural fill). Observe the daemon's next poll.

**Expected:**
1. `autopilot.jsonl` emits a `compact_sent / threshold_crossed` event for that session.
2. The `/compact` text appears as a submitted command in the Claude TUI (not shown as bracketed-paste).
3. The session visibly runs its compact flow.
4. A subsequent bridge read shows `used_pct` dropped below 60%.
5. No other tmux pane receives any keystrokes.

**Why human:** The unit tests inject `run=fake_run` and `sleep=lambda _: None` stubs — the real `tmux` binary is never spawned in CI. Only an operator running a live session can confirm: (a) the `-l` literal flag passes `/compact` through the TUI correctly and is not absorbed as pasted text; (b) the bridge JSON actually reflects the post-compact drop; (c) pane isolation holds in a real multi-session environment. This is the D-09 gate, recorded in INSTALL.md §"Task 3" as `OPERATOR RESIDUAL — unstarted`, per `20-04-PLAN.md` (`autonomous: false`). Discharge the gate using the 7-step procedure in INSTALL.md.

---

### Gaps Summary

No gaps. All 9 automated must-haves are verified. The one open item (D-09 live round-trip / PILOT-07 SC-3) is an OPERATOR RESIDUAL by explicit design decision recorded in 20-CONTEXT.md and 20-04-PLAN.md — it is not a defect or an incomplete task. The automated suite (72 passed / 0 failed) proves the full mechanism; the live proof is the operator's to discharge via the 7-step procedure in INSTALL.md. Status is PARTIAL (human_needed) solely because that gate is open.

---

_Verified: 2026-07-01T16:53:48Z_
_Verifier: Claude (donny-verifier)_
