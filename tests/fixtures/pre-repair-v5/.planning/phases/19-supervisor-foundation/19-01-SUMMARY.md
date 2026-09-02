---
phase: 19-supervisor-foundation
plan: 01
subsystem: infra
tags: [cc-autopilot, python, stdlib, pytest, tdd, bridge, statusline, supervisor]

# Dependency graph
requires:
  - phase: (none)
    provides: First plan of Phase 19; reads the existing ~/.claude/statusline.py bridge writer (no prior-phase code dependency)
provides:
  - "~/Developer/cc-autopilot/ Python package skeleton (autopilot/, stdlib-only, D-01)"
  - "Wave 0 pytest scaffolding: tests/conftest.py with 7 shared fixtures (bridge_dir, write_bridge, registry_dir, fake_now, stub_subprocess) reusable by plans 02/03"
  - "RED-then-GREEN tests/test_bridge.py (12 tests) + clean skip-stubs for test_registry/test_daemon/test_runner"
  - "autopilot/bridge.py — the bridge reader + 60s staleness gate + live-session discovery (PILOT-04): read_bridge, discover_sessions, is_stale, STALE_SECONDS"
  - "pyproject.toml wiring pytest pythonpath=['.'] so `import autopilot` resolves without an install step"
affects: [19-02, 19-03, daemon, registry, runner, send-keys, launchd]

# Tech tracking
tech-stack:
  added: [pytest (already installed at ~/.local/bin/pytest), ruff (already at ~/.local/bin/ruff); no runtime deps — stdlib-only]
  patterns:
    - "Wave 0 first: test scaffolding + shared fixtures + RED stubs for ALL modules scheduled before any implementation (19-VALIDATION.md)"
    - "Compose-not-fork the bridge: read the live statusline schema exactly, never re-emit a richer one"
    - "Injectable now() (int or callable) for deterministic, wall-clock-free staleness tests"
    - "Path-traversal guard on untrusted session_id before any path is built (mirrors cco-compact-nudge.js)"

key-files:
  created:
    - "~/Developer/cc-autopilot/autopilot/__init__.py"
    - "~/Developer/cc-autopilot/autopilot/bridge.py"
    - "~/Developer/cc-autopilot/tests/conftest.py"
    - "~/Developer/cc-autopilot/tests/test_bridge.py"
    - "~/Developer/cc-autopilot/tests/test_registry.py"
    - "~/Developer/cc-autopilot/tests/test_daemon.py"
    - "~/Developer/cc-autopilot/tests/test_runner.py"
    - "~/Developer/cc-autopilot/pyproject.toml"
  modified: []

key-decisions:
  - "Added pyproject.toml with [tool.pytest.ini_options] pythonpath=['.'] so `import autopilot.bridge` resolves at the repo root without an editable install (stdlib-only project, no src/ layout) — the missing-but-necessary wiring to make collection clean (Rule 3)."
  - "is_stale narrows now via isinstance(now, int) rather than callable(now): both satisfy the int-OR-callable contract the tests exercise, but isinstance narrows cleanly for the ty type-checker (callable() left a Top[(...) -> object] it refused to call)."
  - "Code deliverables live in ~/Developer/cc-autopilot/ which is intentionally NOT a git repo (matches the v4.0 pattern: product on-disk, only .planning/ tracked). No git commit for the .py files; only this SUMMARY is committed."

patterns-established:
  - "Wave 0 scaffolding pattern: conftest fixtures + RED stub for the wave's vertical + clean pytest.mark.skip stubs for later-plan modules so --collect-only is the per-task gate."
  - "Bridge read-side contract: read used_pct (int) + timestamp (epoch secs); > STALE_SECONDS (60) ⇒ stale; tolerate missing file (fresh session) and malformed JSON (catch OSError/ValueError, never bare except); exclude the *-nudged.json sibling from discovery."

requirements-completed: [PILOT-04]

# Metrics
duration: 3min
completed: 2026-06-21
---

# Phase 19 Plan 01: Supervisor Foundation — Bridge Reader + Wave-0 Test Scaffolding Summary

**Stood up the stdlib-only `cc-autopilot` package + Wave-0 pytest scaffolding (7 shared fixtures + RED stubs for all PILOT modules) and turned the bridge reader GREEN: `autopilot/bridge.py` reads a session's live `used_pct` from the `$TMPDIR/claude-ctx-{id}.json` statusline bridge, discovers live sessions (excluding the compact-nudge marker), and refuses any bridge >60s stale — with a path-traversal guard on the untrusted session_id (PILOT-04).**

## Performance

- **Duration:** 2m 45s
- **Started:** 2026-06-21T22:21:21Z
- **Completed:** 2026-06-21T22:24:06Z
- **Tasks:** 2 (both TDD)
- **Files created:** 8 (in `~/Developer/cc-autopilot/`)

## Accomplishments
- **PILOT-04 read side complete:** `bridge.py` reads `used_pct` from the live bridge, `discover_sessions()` globs `claude-ctx-*.json` and excludes the `*-nudged.json` sibling, `is_stale()` enforces the 60s freshness gate with an injectable `now`.
- **Wave 0 scaffolding the later plans depend on:** `tests/conftest.py` ships 7 fixtures (`bridge_dir`, `write_bridge`, `registry_dir`, `fake_now`, `stub_subprocess`, plus the implicit `tmp_path`/`monkeypatch` usage) byte-matching the live writer schema; `test_registry.py`/`test_daemon.py`/`test_runner.py` are clean `pytest.mark.skip` stubs so `--collect-only` is a stable per-task gate.
- **TDD RED→GREEN honored:** `test_bridge.py` was written first importing not-yet-existing symbols (RED — `ModuleNotFoundError: No module named 'autopilot.bridge'` observed), then `bridge.py` was implemented to turn all 12 tests GREEN.
- **Threat model fully implemented:** T-19-01 (traversal guard on `session_id` → tested with `../evil`, `a/b`, `a\\b`), T-19-02 (malformed JSON → `except (OSError, ValueError)`, tested), T-19-03 (60s staleness gate → tested at now-30/now-60/now-90).

## Task Commits

The code deliverables live in `~/Developer/cc-autopilot/`, which is **intentionally not a git repository** (matches the established v4.0 pattern: the product is on-disk, only `.planning/` is tracked in `claudecodeoptimized`). Per the plan's commit model, the `.py`/`.toml` files are therefore **not** git-committed; they were written to their absolute paths and verified via each task's `<verify>` + `<acceptance_criteria>`. Only this SUMMARY is committed to `claudecodeoptimized`.

1. **Task 1: Package skeleton + Wave 0 fixtures + RED stubs** — written to disk; `pytest --collect-only` → 3 stub modules collect, `test_bridge.py` RED (TDD-by-design until Task 2).
2. **Task 2: bridge.py reader + discovery + 60s staleness gate (PILOT-04)** — written to disk; `pytest tests/test_bridge.py` → 12 passed; `--collect-only` now exits 0 (all 5 modules).

**Plan metadata:** committed via `gsd-tools commit` (this SUMMARY only).

_Note: This TDD plan's RED state was the deliberate Task-1 collection-fail on `autopilot.bridge`; Task 2's implementation turned it GREEN (test file byte-unchanged from its RED form)._

## Files Created/Modified
- `~/Developer/cc-autopilot/autopilot/__init__.py` — package docstring/marker for the `autopilot` daemon package
- `~/Developer/cc-autopilot/autopilot/bridge.py` (102 lines) — `read_bridge`, `discover_sessions`, `is_stale`, `STALE_SECONDS=60`; the PILOT-04 reader
- `~/Developer/cc-autopilot/tests/conftest.py` (96 lines, 7 `def`) — shared Wave-0 fixtures
- `~/Developer/cc-autopilot/tests/test_bridge.py` (101 lines, 12 tests) — RED-first, now GREEN
- `~/Developer/cc-autopilot/tests/test_registry.py` — `pytest.mark.skip` stub (plan 02/03, PILOT-03)
- `~/Developer/cc-autopilot/tests/test_daemon.py` — `pytest.mark.skip` stub (plan 03, PILOT-02/04/05)
- `~/Developer/cc-autopilot/tests/test_runner.py` — `pytest.mark.skip` stub (plan 03, PILOT-05)
- `~/Developer/cc-autopilot/pyproject.toml` — pytest `pythonpath=['.']` + ruff line-length

## Decisions Made
- **`pyproject.toml` with `pythonpath=['.']`** (Rule 3 — missing blocking wiring): without it, `from autopilot.bridge import ...` raised `ModuleNotFoundError: No module named 'autopilot'`, blocking collection. A root `pyproject.toml` is the stdlib-friendly, install-free fix (no editable install, no `src/` layout). It also pins `testpaths=["tests"]` and a ruff line-length.
- **`is_stale` narrows `now` via `isinstance(now, int)`** rather than `callable(now)`: the `ty` checker could not narrow the `Union[int, Callable]` through `callable()` (left a `Top[(...) -> object]` it refused to call); `isinstance(now, int)` narrows cleanly for both branches while preserving the int-OR-callable contract the tests exercise (`now=int` and `now=lambda` both pass).
- **No git ops in `cc-autopilot/`** — confirmed the dir is not a git repo and did not `git init` it; only the SUMMARY is committed to `claudecodeoptimized` (plan commit model).

## Deviations from Plan

The two decisions above were minor, necessary, and additive — recorded as deviations per Rule 3 (auto-fix blocking issues):

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `pyproject.toml` to make `import autopilot` resolve**
- **Found during:** Task 1 → Task 2 (collection)
- **Issue:** `from autopilot.bridge import ...` failed with `ModuleNotFoundError: No module named 'autopilot'` — `pytest --collect-only` (the per-task verify) could not import the package from the repo root without path wiring. The plan's `files_modified` did not list a `pyproject.toml`.
- **Fix:** Created `~/Developer/cc-autopilot/pyproject.toml` with `[tool.pytest.ini_options] pythonpath=["."]` (+ `testpaths`, ruff line-length). Stdlib-only, no install step.
- **Files modified:** `~/Developer/cc-autopilot/pyproject.toml` (new)
- **Verification:** `pytest tests/ --collect-only` exits 0 (all 5 modules); `pytest tests/test_bridge.py` 12 passed.
- **Committed in:** N/A (cc-autopilot is not a git repo — written to disk per the plan's commit model)

**2. [Rule 1 - Bug] `is_stale` `now`-narrowing rewritten for clean type-checking**
- **Found during:** Task 2
- **Issue:** The plan's suggested `n = now() if callable(now) else now` is runtime-correct but the `ty` type-checker refused to call the `callable()`-narrowed value (`call-top-callable`/`invalid-assignment` on a `Top[(...) -> object]`).
- **Fix:** Rewrote as `n = now if isinstance(now, int) else now()` — same int-OR-callable contract, narrows cleanly. `ruff` clean; `ty` complaint cleared.
- **Files modified:** `~/Developer/cc-autopilot/autopilot/bridge.py`
- **Verification:** `ruff check autopilot/` exits 0; `pytest tests/test_bridge.py` 12 passed (incl. `test_is_stale_accepts_callable_now`).
- **Committed in:** N/A (see above)

---

**Total deviations:** 2 auto-fixed (1 blocking-wiring, 1 type-narrowing bug-grade fix)
**Impact on plan:** Both necessary for a clean GREEN under the project's lint/type discipline; no scope creep, no out-of-scope mechanism added (no daemon/tmux/launchd/`claude -p`).

## Issues Encountered
- **The lint-loop's `unresolved-import: pytest` false positive** fired on every test file (documented in memory `[ty-pytest-false-positive-claude-bin]` and the plan's key_constraints): the PostToolUse loop runs `ty` against the default `python3`, which lacks `pytest` — but `pytest` lives at `~/.local/bin/pytest` (pytest 9.1.0), the real gate. Ignored as instructed; all real tests pass there.
- **Note on Task-1 `--collect-only` timing:** `--collect-only` exits 0 only once `bridge.py` exists (Task 2). This is inherent to the TDD RED→GREEN ordering the plan mandates (Task 1 explicitly states `test_bridge.py` is "RED-by-design first"). The criterion is satisfied at the end of Task 2; the 3 non-bridge stubs collect cleanly throughout. Not a defect.

## User Setup Required
None — no external service configuration. (tmux install, the `claude` wrapper, the SessionStart/SessionEnd registry hooks, and the launchd plist are later plans/phases, deliberately out of scope here.)

## Next Phase Readiness
- **Plans 02/03 unblocked:** the `tests/conftest.py` fixtures (`bridge_dir`/`write_bridge`/`registry_dir`/`fake_now`/`stub_subprocess`) and `autopilot/bridge.py` are the building blocks they import; the `test_registry`/`test_daemon`/`test_runner` skip-stubs are theirs to fill.
- **Scope anchor held:** no daemon, no action, no tmux/launchd, no `claude -p`, no `~/.claude/` writes — verified (the only `send-keys`/`tmux`/`claude -p` tokens are forward-reference docstrings, not executable code; `~/.claude/.autopilot` does not exist).
- **Verification gate green:** `pytest tests/ -q` → 12 passed, 3 skipped; `pytest tests/ --collect-only` exit 0; `ruff check autopilot/` exit 0.

## Self-Check: PASSED

Verified on disk:
- FOUND: `~/Developer/cc-autopilot/autopilot/__init__.py`
- FOUND: `~/Developer/cc-autopilot/autopilot/bridge.py` (exports `read_bridge`, `discover_sessions`, `is_stale`, `STALE_SECONDS`)
- FOUND: `~/Developer/cc-autopilot/tests/conftest.py` (7 `def`)
- FOUND: `~/Developer/cc-autopilot/tests/test_bridge.py` (12 tests, GREEN)
- FOUND: `~/Developer/cc-autopilot/tests/test_registry.py` / `test_daemon.py` / `test_runner.py` (each `pytest.mark.skip`)
- FOUND: `~/Developer/cc-autopilot/pyproject.toml`

Acceptance commands re-run (exit codes captured):
- `pytest tests/ --collect-only` → exit 0
- `pytest tests/test_bridge.py -q` → exit 0 (12 passed)
- `pytest tests/ -q` → exit 0 (12 passed, 3 skipped)
- `ruff check autopilot/` → exit 0
- `grep -a 'STALE_SECONDS = 60'` → match; `grep -aE '"\.\."'` → match (traversal guard); `grep -a 'except (OSError, ValueError)'` → match; no bare `except`.

No git commits exist for the code files **by design** (cc-autopilot is not a git repo; the plan's commit model writes them to disk and commits only this SUMMARY to `claudecodeoptimized`).

---
*Phase: 19-supervisor-foundation*
*Completed: 2026-06-21*
