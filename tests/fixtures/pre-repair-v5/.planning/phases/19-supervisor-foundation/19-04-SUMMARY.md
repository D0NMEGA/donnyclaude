---
phase: 19-supervisor-foundation
plan: 04
subsystem: cc-autopilot
tags: [supervisor, launchd, tmux, wrapper, observe-only, cco-dream, D-11, PILOT-01, PILOT-02, PILOT-05]
dependency-graph:
  requires:
    - "19-01 (bridge.py: resolve_tmpdir / read_bridge / discover_sessions)"
    - "19-02 (registry.py + ~/.claude/hooks/cco-autopilot-register.js: $TMUX_PANE -> per-session %N registry)"
    - "19-03 (daemon.py observe-only loop + runner.self_test_argv: the cco-dream seam)"
    - "~/.claude/bin/cco-dream (byte-stable safety boundary, md5 d8055242bffbee5cb3ea557340c6a444)"
    - "tmux 3.6b (Homebrew, /opt/homebrew/bin/tmux)"
  provides:
    - "~/.zshrc claude() wrapper: CC_TMUX=1 -> tmux session-per-claude (pane addressable by %N); NO_TMUX/$TMUX bypass; --effort max preserved"
    - "autopilot/__main__.py: the `python -m autopilot` entry point (loop) + `--self-test` cco-dream seam probe"
    - "~/Library/LaunchAgents/com.user.ccautopilot.plist: RunAtLoad + KeepAlive + ThrottleInterval + absolute sparse-env PATH (loaded & running)"
    - "~/Developer/cc-autopilot/INSTALL.md: the setup + Task-3 live-verification record (D-11 outcome, reversibility)"
  affects:
    - "Phase 20 (PILOT-06/07): flips observe-only -> act; the /compact send-keys trigger targets the %N pane this phase proved is captured"
    - "Phase 21 (PILOT-08): resume-from-limit; retires the com.user.cc_continue_once one-shot (untouched here)"
tech-stack:
  added:
    - "tmux 3.6b (Homebrew) — the one-time prereq for addressable panes (PILOT-01/D-11)"
  patterns:
    - "extend-not-clobber: the existing --effort max wrapper was composed with the tmux behavior, not replaced (.bak-19-04-*)"
    - "tmux OPT-IN (CC_TMUX=1): default is a bare in-terminal launch; cc-autopilot opts in when it needs a %N pane (D-04/D-08 — preserves scrollback)"
    - "launchd RunAtLoad + KeepAlive + ThrottleInterval: start-at-login, auto-restart, crash-loop-capped; sparse-env hardened with an explicit absolute PATH"
    - "argv-list subprocess only (never shell=True); NO bare except (__main__.py)"
key-files:
  created:
    - "~/Developer/cc-autopilot/autopilot/__main__.py (122 lines)"
    - "~/Library/LaunchAgents/com.user.ccautopilot.plist (plutil-OK)"
    - "~/Developer/cc-autopilot/INSTALL.md (setup + Task-3 verification record)"
    - ".planning/phases/19-supervisor-foundation/19-04-SUMMARY.md (this file)"
  modified:
    - "~/.zshrc (claude()/_claude_effort wrapper extended for CC_TMUX tmux; backup ~/.zshrc.bak-19-04-1782082089)"
    - ".planning/phases/19-supervisor-foundation/19-VALIDATION.md (19-04 status rows -> discharged)"
decisions:
  - "tmux is OPT-IN via CC_TMUX=1 (NOT the default launch) — wrapping every interactive launch in tmux disables scrollback + shows a persistent status bar (D-04/D-08). cc-autopilot sets CC_TMUX=1 when it needs an addressable pane. Corrected a stale INSTALL.md line that still described tmux as the default."
  - "The --self-test seam probe runs against a THROWAWAY git surface (mktemp + git init + empty commit), because cc-autopilot/ is not a git repo and cco-dream requires a git --surface. This yields a clean exit 0 (the prior non-git attempt exited 2 at cco-dream's pre-flight)."
  - "Skip-flag invariant is scoped to the PRODUCTION package (autopilot/*.py = clean). The plan's broad `grep -aR ... ~/Developer/cc-autopilot/` false-fails because it matches only INSTALL.md's documented check + tests/test_runner.py NEGATIVE assertions + .pyc — same scoping 19-03 established. Flagged so the auditor uses the scoped grep."
  - "Four Task-3 checks need an interactive TTY (live claude-in-tmux real-pane, bypass feel, >=2-session no-swap, live >=60% would_compact). Their MECHANISMS were each discharged here with evidence; the operator approved the interactive residuals on that basis rather than re-running them inline."
metrics:
  duration: "resumed 2026-06-30 (T1/T2 built 2026-06-21)"
  completed: "2026-06-30"
  tasks: 3
  files-created: 4
  files-modified: 2
---

# Phase 19 Plan 04: OS-Integration Veneer + Live-Verification Gate Summary

The OS-integration veneer that turns the unit-proven daemon (plans 01-03) into a running, launchd-managed, **observe-only** supervisor driven by the live harness, and discharges the chief Phase-19 risk (D-11: `$TMUX_PANE` inheritance, unprovable until tmux was installed). The daemon is loaded and running; it logs `would_compact` decisions and takes **no** action. Acting is the flag Phase 20 introduces.

## What Was Built

- **`~/.zshrc` `claude()` wrapper (extended, not clobbered).** The existing `--effort max` wrapper (`_claude_effort`) was composed with a tmux session-per-launch that is **opt-in via `CC_TMUX=1`**: default and every bypass branch (`CC_TMUX` unset, `NO_TMUX=1`, or already inside `$TMUX`) run `command claude --effort max "$@"` bare; with `CC_TMUX=1` it runs `NO_TMUX=1 tmux new-session -s "cc-<cwd>-<rand>" "claude …"` so the inner re-entry takes the bypass branch and runs `command claude --effort max` *inside* the pane. Backup of record: `~/.zshrc.bak-19-04-1782082089`.
- **`autopilot/__main__.py` (122 lines).** The `python -m autopilot` entry point the LaunchAgent runs: bare → `daemon.main(interval, tmpdir=bridge.resolve_tmpdir())` (the observe-only loop; `resolve_tmpdir` is env-independent so a sparse launchd env still finds the bridge); `--self-test` → `runner.self_test_argv(surface)` `subprocess.run` (argv list, OSError-guarded, no bare except). `--interval`/`--surface` overrides via argparse.
- **`com.user.ccautopilot.plist` (plutil-OK, loaded & running).** Distinct `Label = com.user.ccautopilot`; absolute `/opt/homebrew/bin/python3 -m autopilot`; `RunAtLoad`+`KeepAlive`+`ThrottleInterval=10`; `Standard{Out,Error}Path` for crash capture; `EnvironmentVariables.PATH` an explicit absolute string (`/opt/homebrew/bin:/Users/d0nmega/.claude/bin:/usr/bin:/bin:/usr/sbin:/sbin`) + explicit `HOME`. The one-shot `com.user.cc_continue_once.plist` is untouched.
- **`INSTALL.md`.** Setup, the pinned `tmux -V`, the D-11 outcome, load/unload, and full reversibility — rewritten this session into a verification record (each Task-3 check marked DISCHARGED with evidence or carrying an honest operator residual).

## Task 3 — Live Verification Record (verified 2026-06-30)

| Check | Requirement | Result | Evidence |
|-------|-------------|--------|----------|
| **D-11 `$TMUX_PANE`** | PILOT-01/03 | **DISCHARGED — native inheritance, no fallback** | node child in a tmux pane saw `TMUX_PANE=%0`; the real `cco-autopilot-register.js` hook run inside tmux wrote `"pane":"%0"` |
| **PILOT-02 KeepAlive** | PILOT-02 | **DISCHARGED** | loaded + `state=running`; killed pid 1249 → launchd relaunched pid 19771 in ~1s (ThrottleInterval-bounded, not a hot loop); logs kept writing; `daemon.err` clean |
| **PILOT-05 cco-dream seam** | PILOT-05 | **DISCHARGED** | `--self-test --surface <throwaway-git>` → live `cco-dream …--dry-run` **exit 0**; NO `claude -p`, NO commit, no skip flag |
| **PILOT-01 wrapper branches** | PILOT-01 | **DISCHARGED** | all 4 branches correct + `--effort max` preserved (real `~/.zshrc` functions, stubbed leaves) |
| **Observe-only anchor** | PILOT-02 | **DISCHARGED (structural+live)** | hundreds of live polls, all `unmapped`/`stale_skip`, zero `would_compact`-action, zero keystrokes |

**Operator-approved residuals** (interactive TTY; mechanism proven above, operator confirmed on that basis): live `CC_TMUX=1 claude` → real registry pane; `NO_TMUX=1`/`$TMUX` bypass feel; ≥2-session no-swap; a live ≥60% session logging one `would_compact` without action.

## How to Verify

```bash
# wrapper: tmux opt-in + bypass + effort preserved
grep -aE 'NO_TMUX|\$TMUX|CC_TMUX' ~/.zshrc && grep -a 'tmux new-session' ~/.zshrc && grep -a 'effort max' ~/.zshrc
# entry point parses; daemon loaded & running
python3 -c "import ast; ast.parse(open('$HOME/Developer/cc-autopilot/autopilot/__main__.py').read()); print('PARSE-OK')"
launchctl print gui/$UID/com.user.ccautopilot | grep -E 'state|pid'
# plist valid; one-shot untouched
plutil -lint ~/Library/LaunchAgents/com.user.ccautopilot.plist
# the live cco-dream seam (throwaway git surface -> exit 0)
SURF=$(mktemp -d); git -C "$SURF" init -q; git -C "$SURF" -c user.email=a@b.c -c user.name=cc commit --allow-empty -q -m init
PYTHONPATH="$HOME/Developer/cc-autopilot" python3 -m autopilot --self-test --surface "$SURF"; rm -rf "$SURF"
# production-package skip-flag invariant (the broad grep false-fails on docs + negative tests)
grep -aRn 'dangerously-skip-permissions' ~/Developer/cc-autopilot/autopilot/ --include='*.py'   # (empty)
```

### Observed results

| Gate | Result |
|------|--------|
| `tmux -V` | `tmux 3.6b` |
| `ast.parse(__main__.py)` | `PARSE-OK` |
| `plutil -lint …ccautopilot.plist` | `OK` |
| `launchctl print …ccautopilot` | `state = running`, pid 19771 (after the kill→relaunch test) |
| D-11 node child + real hook | `TMUX_PANE=%0` / registry `"pane":"%0"` (native inheritance) |
| `--self-test --surface <git>` | cco-dream `--dry-run` **exit 0** (worktree created+torn down, inline green) |
| `grep skip-flag/shell=True autopilot/` | (empty) |
| `grep send-keys autopilot/` | (empty — observe-only) |
| `grep 'except:' __main__.py` | (empty — no bare except) |

## Hard Invariants Held

1. **OBSERVE-ONLY (D-12):** the running daemon logged hundreds of poll decisions, all `unmapped`/`stale_skip`, ZERO `would_compact`-with-action, ZERO `send-keys`. No `send-keys` token in `autopilot/`.
2. **cco-dream BYTE-UNCHANGED (D-16):** md5 `d8055242bffbee5cb3ea557340c6a444` (composed by subprocess, never forked); the `--self-test` only ran it `--dry-run`.
3. **NO skip-permissions / NO shell=True:** absent from `autopilot/*.py` (scoped grep empty; the broad grep matches only docs + negative tests).
4. **D-11 DISCHARGED native:** `$TMUX_PANE` inherits to a node child and to the real SessionStart hook (`%0`) — the chief Phase-19 risk closed with no fallback.
5. **REVERSIBLE:** `~/.zshrc.bak-19-04-*`; the plist is a new file (`launchctl bootout` + delete); INSTALL.md documents unload + restore.

## Threat Model Coverage

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-19-14 sparse-env tool resolution | mitigate | plist explicit absolute PATH + absolute ProgramArguments/HOME; daemon healthy; self-test resolved cco-dream via absolute `CCO_DREAM` |
| T-19-15 live `--self-test` claude -p EoP | mitigate | probe built only via `runner.self_test_argv` → `cco-dream --dry-run`; no skip flag (scoped grep empty); exit 0 |
| T-19-16 wrapper tmux string injection | accept (low) | operator's own shell function/args; pane addressed by `%N` not name — documented |
| T-19-17 launchd crash-loop DoS | mitigate | `ThrottleInterval=10` caps relaunch; Standard*Path capture; KeepAlive relaunch verified bounded (~1s, single, not a hot loop) |
| T-19-18 observe-only repudiation | mitigate | live JSONL proves decisions logged WITHOUT keystrokes — empirically demonstrated, not assumed |

## Deviations from Plan

- **tmux is opt-in (`CC_TMUX=1`), not the default** — already the case from T1 (D-04/D-08, to preserve interactive scrollback). The plan's example wrapper showed tmux as default; the live wrapper is opt-in. Recorded; INSTALL.md prose corrected to match.
- **`--self-test` surface** — the plan defaults the probe to cc-autopilot's own root "which is a git checkout"; it is **not** a git repo, so the probe was run against a throwaway `git init` surface for a clean exit 0 (the non-git surface exits 2 at cco-dream's pre-flight — expected, the seam still reached cco-dream).
- **Four Task-3 checks are operator-approved, not inline-rerun** — they require an interactive TTY; their mechanisms were discharged here with evidence and the operator approved on that basis.

## Notes for Phase 20 / 21

- **Phase 20 act path:** the `/compact` keystroke targets the `%N` pane D-11 proved is captured. Empirically confirm `tmux send-keys … '/compact' Enter` actually compacts the live binary (context% drops in the bridge) before declaring the keystone done — that is the Phase-20 verification gate.
- **Security:** `security_enforcement` is on and no `19-SECURITY.md` exists yet → run `/donny-secure-phase 19` (auditor verifies T-19-14..18 mitigations in code) before advancing.
- **No git commit for cc-autopilot code** (not a git repo); only `.planning/` SUMMARY/VALIDATION is committed to claudecodeoptimized. `~/.zshrc` reversible via `.bak-19-04-1782082089`.

## Self-Check: PASSED

- All created files exist (`__main__.py` parses, plist plutil-OK, INSTALL.md records the D-11 outcome + reversibility).
- Daemon loaded & running under launchd; KeepAlive relaunch verified; observe-only (zero actions) demonstrated live.
- D-11 discharged native; cco-dream seam exit 0; production-package invariants empty; no bare except.
- The four interactive residuals were presented at the blocking gate and operator-approved.
