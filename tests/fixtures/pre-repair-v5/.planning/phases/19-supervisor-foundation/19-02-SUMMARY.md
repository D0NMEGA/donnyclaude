---
phase: 19-supervisor-foundation
plan: 02
subsystem: infra
tags: [cc-autopilot, tmux, hooks, session-registry, pane-map, launchd-daemon, pilot-03, stdlib-python, node-hook]

# Dependency graph
requires:
  - phase: 19-supervisor-foundation (plan 01)
    provides: "conftest.py fixtures (registry_dir, stub_subprocess, write_bridge); autopilot/bridge.py (discover_sessions/is_stale) reused by reconcile for bridge-freshness liveness"
provides:
  - "session_id -> tmux pane registry (PILOT-03): SessionStart hook writes a per-session metadata record, SessionEnd removes it"
  - "autopilot/registry.py: read_registry / resolve_pane / reconcile / tmux_live_panes — the daemon-side join + D-10 liveness reconcile (no mis-routing)"
  - "two new ~/.claude/ hooks registered additively in settings.json (reversible, backed up)"
affects: [19-03 daemon poll loop (consumes resolve_pane + reconcile), 19-04 tmux wrapper (proves live $TMUX_PANE inheritance + multi-session no-mis-routing), phase-20 send-keys target, phase-21 resume]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-session registry file + atomic temp-write-then-rename (race-safe vs one shared file, RESEARCH §5.3)"
    - "Pane addressing ALWAYS by pane_id (%N) keyed on session_id, never session name (T-19-06)"
    - "D-10 dual-signal liveness reconcile: keep IFF pane in tmux list-panes AND session has a fresh bridge"
    - "Injected subprocess runner (run=subprocess.run) so the real tmux binary is never spawned in unit tests"
    - "~/.claude/ edits reversible + metadata-only (settings.json .bak; hooks delete-to-revert)"

key-files:
  created:
    - "~/.claude/hooks/cco-autopilot-register.js (SessionStart registry writer)"
    - "~/.claude/hooks/cco-autopilot-deregister.js (SessionEnd registry remover)"
    - "~/Developer/cc-autopilot/autopilot/registry.py (reader + resolver + reconcile)"
  modified:
    - "~/.claude/settings.json (appended both hooks to SessionStart[]/SessionEnd[]; backup .bak-19-02-1782080938)"
    - "~/Developer/cc-autopilot/tests/test_registry.py (replaced Wave-0 skip-stub with 14 real tests)"

key-decisions:
  - "Per-session registry file (registry.d/{session_id}.json) over one shared JSON — eliminates concurrent-write corruption and simplifies SessionEnd cleanup (RESEARCH §5.3)"
  - "reconcile requires BOTH liveness signals (pane present in tmux AND fresh bridge) so a missed SessionEnd from crash/kill -9 can never mis-route (D-10)"
  - "tmux_live_panes takes an injected run; registry.py contains no direct subprocess.run() call — the real tmux is never spawned in tests"
  - "D-11 honored: pane=null written when $TMUX_PANE absent; resolve_pane returns None for a null pane (live-confirmed on this session — tmux not yet installed)"

patterns-established:
  - "cco-hook substrate mirror: 10s pipe-hang guard, session_id traversal-reject (/[/\\\\]|\\.\\./), exit-0 on every path, metadata-only (matches cco-compact-nudge.js)"
  - "Reversible additive ~/.claude/ edits: back up settings.json to .bak-19-0N-*, append never replace, verify JSON validity + existing-hook integrity after"

requirements-completed: [PILOT-03]

# Metrics
duration: 4min
completed: 2026-06-21
---

# Phase 19 Plan 02: cc-autopilot session_id→pane Registry Summary

**A SessionStart/SessionEnd hook pair writes a per-session, atomic, metadata-only `session_id → tmux pane (%N)` registry, and the stdlib `autopilot/registry.py` resolves the owning pane per session with no swap and reconciles liveness against tmux + bridge freshness (D-10) so a missed SessionEnd can never mis-route — the PILOT-03 no-mis-routing keystone.**

## Performance

- **Duration:** ~4 min (217s)
- **Started:** 2026-06-21T22:27:36Z
- **Completed:** 2026-06-21T22:31:13Z
- **Tasks:** 3
- **Files created/modified:** 5 (2 hooks, settings.json, registry.py, test_registry.py)

## Accomplishments
- **PILOT-03 met at the unit level:** a deterministic `session_id → pane` map written by SessionStart, removed by SessionEnd; the daemon-side resolver returns the correct pane per session (two-record no-swap test) and reconciles liveness (D-10) with both pane-gone and stale-bridge drop paths tested.
- **Two reversible, metadata-only `~/.claude/` hooks** created and registered additively in the live `settings.json` (backup taken; existing SessionStart/SessionEnd entries byte-intact; JSON still valid).
- **`autopilot/registry.py` GREEN** — `read_registry` (malformed-file tolerant), `resolve_pane` (keyed on session_id), `reconcile` (D-10 dual-signal), `tmux_live_panes` (injected runner, argv-asserted, real tmux never spawned). 14 new tests; ruff clean.
- **Live end-to-end confirmation:** the newly-registered SessionStart hook fired for THIS session and wrote a well-formed `pane:null` (D-11 fallback) metadata record to `registry.d/` — proving the hook works in the real harness, not just the inline test.

## Task Commits

The deliverables live OUTSIDE git (`~/Developer/cc-autopilot/` is not a repo; `~/.claude/` is not git-tracked), so per the plan's commit model there are NO per-task code commits. Files were written to their absolute paths and verified in place. Only the SUMMARY is committed to `claudecodeoptimized`.

1. **Task 1: SessionStart + SessionEnd registry hooks** — written to `~/.claude/hooks/` (no commit; deletion reverts)
2. **Task 2: settings.json registration** — edited in place with `.bak-19-02-1782080938` backup (no commit)
3. **Task 3: registry.py (TDD RED→GREEN)** — written to `~/Developer/cc-autopilot/` (no commit)

**Plan metadata:** committed to claudecodeoptimized — `feat(19-02): cc-autopilot session_id→pane registry hooks + resolver` (this SUMMARY only)

## Files Created/Modified
- `~/.claude/hooks/cco-autopilot-register.js` (64 lines) — SessionStart hook: parses stdin `{session_id, cwd, source}`, inherits `$TMUX_PANE` (null fallback), atomic temp-write-then-rename of `registry.d/{session_id}.json` (idempotent upsert keyed on session_id). 10s pipe-hang guard, traversal-reject, exit-0 everywhere, metadata-only.
- `~/.claude/hooks/cco-autopilot-deregister.js` (34 lines) — SessionEnd hook: removes `registry.d/{session_id}.json` (best-effort; daemon does not trust it for liveness).
- `~/.claude/settings.json` — appended one group to `hooks.SessionStart[]` (3→4) and one matcher group to `hooks.SessionEnd[]` (2→3). All other keys untouched. Backup: `~/.claude/settings.json.bak-19-02-1782080938`.
- `~/Developer/cc-autopilot/autopilot/registry.py` (107 lines) — `read_registry` / `resolve_pane` / `reconcile` / `tmux_live_panes` + `_LIST_PANES_ARGV = ["tmux","list-panes","-aF","#{pane_id}"]`. Stdlib-only, type-hinted, no bare except.
- `~/Developer/cc-autopilot/tests/test_registry.py` (14 tests) — replaced the Wave-0 skip-stub with real RED→GREEN tests: read-all, malformed/keyless skip, empty dir, two-record no-swap resolve, unmapped/null-pane → None, reconcile keep/pane-gone/stale-bridge/mixed, `tmux_live_panes` parse+argv-assert, non-zero-exit and missing-binary → empty set, default-runner-is-subprocess.run.

## Decisions Made
- **Per-session registry file over one shared JSON** — the atomic temp+rename gives race-free concurrent writes from multiple sessions and trivial SessionEnd cleanup (RESEARCH §5.3, T-19-05).
- **reconcile keeps a record IFF `pane in live_panes` AND `sid in live_sessions`** — the D-10 dual-signal rule folds the "verify" half of the rejected pane↔pid↔cwd inference into a deterministic prune; a crash/`kill -9` that skips SessionEnd can never leave a dangling pane targetable (T-19-07).
- **Injected `run` for the tmux call** — `registry.py` has no direct `subprocess.run(` call; the unit tests assert the exact argv `["tmux","list-panes","-aF","#{pane_id}"]` via `stub_subprocess` and never spawn the real (uninstalled) binary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded hook comments to satisfy the literal "no transcript/message/content" acceptance grep**
- **Found during:** Task 1 (register hook verification)
- **Issue:** The acceptance criterion `grep -ai 'transcript\|message\|content' cco-autopilot-register.js` must return nothing, but my explanatory comments contained the words "transcript", "message", and "content" (in the sentence asserting the hook writes NONE of them). The code was already metadata-only; only the prose tripped the literal grep.
- **Fix:** Reworded both comments to "id/pane/cwd/pid/ts/source, never conversation text". Behavior unchanged; the grep now returns nothing and the criterion passes literally.
- **Files modified:** `~/.claude/hooks/cco-autopilot-register.js`
- **Verification:** `grep -ai 'transcript\|message\|content'` returns nothing; inline round-trip still prints PASS.

**2. [Rule 1 - Bug] Fixed my own test asserting the wrong introspection attribute**
- **Found during:** Task 3 (TDD GREEN — `test_tmux_live_panes_default_run_is_subprocess_run`)
- **Issue:** The test asserted `tmux_live_panes.__defaults__ == (subprocess.run,)`, but `run` is a keyword-only parameter (after `*`), so its default lives in `__kwdefaults__`, not `__defaults__` (which was `None`). The implementation was correct; the test assertion was wrong.
- **Fix:** Changed the assertion to `tmux_live_panes.__kwdefaults__["run"] is subprocess.run`.
- **Files modified:** `~/Developer/cc-autopilot/tests/test_registry.py`
- **Verification:** `pytest test_registry.py -q` → 14 passed.

---

**Total deviations:** 2 auto-fixed (2 bugs — one cosmetic-comment, one test-assertion). No production-logic change in either; both were test/criterion-fidelity fixes.
**Impact on plan:** None on scope. All acceptance criteria and the full suite pass.

## Issues Encountered
- **Edit tool multi-line exact-match miss (Task 1):** the first multi-line comment Edit failed to match (em-dash/arrow encoding); resolved by re-reading the exact lines and editing on a single unique line. No content impact.
- **`PIPESTATUS` empty under `| tail` subshell:** exit codes piped through `tail` rendered blank; re-ran each gate with `>/dev/null 2>&1; echo $?` to capture clean codes (pytest 0, ruff 0).

## Verification Results (exact)
- **Task 1 inline node round-trip:** `PASS` (exit 0) — `TMUX_PANE=%7` SessionStart writes `registry.d/testsess19.json` with `pane:"%7"`; deregister removes it. Plus D-11 null-pane fallback `PASS` (exit 0) and traversal-reject `PASS` (no file escaped `registry.d/`).
- **Task 2 settings.json:** `node -e "require(settings.json)"` → JSON-OK (exit 0); inline verify `PASS` (register under SessionStart, deregister under SessionEnd); existing-hook grep count = 2 (`cco-cerebrum-recall` + `cco-instinct-observe` intact); SessionStart 3→4, SessionEnd 2→3; KEEP-list keys all present.
- **Task 3:** `~/.local/bin/pytest tests/test_registry.py -q` → 14 passed (exit 0); `~/.local/bin/ruff check registry.py` → All checks passed (exit 0); `grep dangerously-skip-permissions registry.py` → nothing; no direct `subprocess.run(` call.
- **Full suite (per-wave):** `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ -q` → **26 passed, 2 skipped** (exit 0); was 12 passed + 3 skipped at baseline → exactly +14 real tests, −1 skip (the two remaining skips are 19-01's daemon/runner placeholders for plans 03/04). `ruff check ~/Developer/cc-autopilot/` → All checks passed (exit 0).
- **Live harness confirmation:** the registered SessionStart hook fired for this session and wrote `registry.d/f5209375-…json` = `{"session_id":"f5209375-…","pane":null,"cwd":"…/browser-harness","pid":37173,"ts":1782080962,"source":"compact"}` — metadata-only, `pane:null` (D-11, no tmux yet), no transcript content.

## settings.json Backup of Record
`~/.claude/settings.json.bak-19-02-1782080938` (taken before any edit; restore-to-revert).

## User Setup Required
None — no external service configuration required this plan. (tmux install + the `claude` wrapper that proves live `$TMUX_PANE` inheritance is plan 04.)

## Next Phase Readiness
- **Plan 19-03 (daemon poll loop)** can now consume `registry.resolve_pane(session_id, registry_dir=…)` and `reconcile(records, tmux_live_panes(), live_sessions=bridge.discover_sessions())` directly — the join + liveness API is GREEN and fixture-proven.
- **Plan 19-04 (tmux wrapper, manual integration)** owns the two deferred empiricals: D-11 live `$TMUX_PANE` inheritance (today's live record shows `pane:null` only because tmux isn't installed) and the multi-session no-mis-routing cross-check (success criterion 3).
- No blockers. The `~/.claude/` registry-hook bridge layer is in place, reversible (settings backup + delete-to-revert hooks), and metadata-only.

## Self-Check: PASSED

All claimed files verified present on disk (the 2 hooks, settings.json + its `.bak-19-02-1782080938`, registry.py, test_registry.py, this SUMMARY). All verification commands re-run with clean exit codes: test_registry.py 14 passed (exit 0), full suite 26 passed/2 skipped (exit 0), ruff exit 0, settings.json valid JSON with existing hooks intact. No git commits for the out-of-git deliverables (by design — only this SUMMARY is committed to claudecodeoptimized).

---
*Phase: 19-supervisor-foundation*
*Completed: 2026-06-21*
