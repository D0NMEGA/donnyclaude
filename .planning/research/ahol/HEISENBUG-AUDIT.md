# Heisenbug audit: `.ahol/worktrees/variant-V4/.claude/` vanishes during real calibration

**Date:** 2026-04-24
**Cycle:** 7 iterations in; this audit is diagnosis-only, no code changes.
**Next cycle:** Direction A+ (re-run calibration with pre/post-clone DIAG logs already added in ahol.py) OR Direction B (pivot the gate to session-JSONL content inspection).

## Evidence summary

From `/tmp/ahol-diag-v7.log` (run with `python3 packages/ahol/runner/ahol.py --calibration-check --benchmark ahol-proxy-15 --task-limit 2 -v`):

```
01:53:57.442  install_full_donnyclaude ENTRY target=.../variant-V4 skills_dir_existed=False
01:53:57.678  bootstrap_variant after-mutation variant=V4 claude=[hooks=19 skills=105 agents=49 rules=14 commands=60]
01:53:57.680  bootstrap_variant RETURN-FRESH variant=V4 claude=[hooks=19 skills=105 agents=49 rules=14 commands=60]
                  ← 19 SECONDS GAP (git clone django subprocess blocks Python)
01:54:16.685  pre-symlink variant=V4 task=astropy target_exists=False harness_claude=MISSING
```

The only Python call that executes during the 19-second gap is `subprocess.run(["git", "clone", ...])` inside `_clone_task_repo`. `_claude_tree_summary` reports MISSING on both subsequent tasks; the V4 harness directory survives (invoke.sh + system-prompt.txt, timestamped 01:53 when bootstrap.sh ran) but the `.claude/` subtree created by `install_full_donnyclaude` at 01:53:57.678 is gone.

## What I've ruled out

- **Python `shutil.rmtree` does NOT follow symlinks.** Tested twice (same volume, cross-volume). Symlink targets survive. V0's per-task workdir cleanup does not traverse into variant-V0/.claude/.
- **No AHOL code outside `cleanup_variant` deletes `.ahol/worktrees/`.** `cleanup_variant` is only called from `bootstrap_variant` on validation failure; log confirms only one `bootstrap_variant ENTRY` for V4 and no `cleanup_variant` log.
- **Inline Python repro does NOT reproduce the wipe.** Running `bootstrap_variant(vm0)` + `bootstrap_variant(vm4)` + V0-like clone+symlink+rmtree twice + V4 clone leaves V4/.claude/ intact with skills=105. The wipe only happens in the full calibration pipeline.
- **No user-global hook contains filesystem-mutating patterns targeting `.claude/` or `.ahol/`.** Only `*.test.js` files contain `fs.rmSync`; those don't run at production-hook time.
- **git clone of a small repo does not touch unrelated `.ahol/worktrees/variant-V4/.claude/`.** Tested in isolation.

## User-global hook inventory

`~/.claude/settings.json` registered hooks:

| Event | Matcher | Command |
|-------|---------|---------|
| SessionStart | * | `gsd-check-update.js` |
| SessionStart | * | `gsd-session-state.sh` |
| PostToolUse | `Bash\|Edit\|Write\|MultiEdit\|Agent\|Task` | `gsd-context-monitor.js` |
| PostToolUse | `Write\|Edit` | `gsd-phase-boundary.sh` |
| PostToolUse | `Read` | `gsd-read-injection-scanner.js` |
| PreToolUse | `Write\|Edit` | `gsd-prompt-guard.js` |
| PreToolUse | `Write\|Edit` | `gsd-read-guard.js` |
| PreToolUse | `Write\|Edit` | `gsd-workflow-guard.js` |
| PreToolUse | `Bash` | `gsd-validate-commit.sh` |

grep for filesystem-mutating patterns (`rm -rf|rmtree|unlink|shutil|fs.rm|rimraf|deleteSync|.remove(|cleanup|wipe|normaliz`) in each hook's source: **NONE of the production hooks had hits.** Only `gsd-backup-restore.test.js` and `gsd-pre-compact-backup.test.js` contain `fs.rmSync`, and those are test files that don't run during normal tool use.

These hooks also run in the PARENT Claude Code session (mine), not in the spike's child claude processes (those suppress user-global via `--setting-sources project`). The wipe's 19-second window does not overlap with any parent-session Bash tool invocation — the background calibration is running independently, my session is idle.

## Daemons observed

- `mdbulkimport` / `mdworker` — Spotlight metadata indexing. Reads files for metadata; does not delete.
- `backupd` / `backupd-helper` — Time Machine. Copies files to backup volume; does not delete originals.
- `fseventsd` — FSEvents kernel daemon. Notifies watchers of filesystem events; does not mutate.

None of these delete user files as normal behavior.

## Candidate wipers, ranked

1. **(highest probability, but no direct evidence)** Claude Code CLI internal behavior during V0's `claude --print` subprocess runs. V0's two tasks fire claude with `--setting-sources project` pointing at V0's workdir. If there's any internal scanning/cleanup logic that walks up from the cwd or across sibling project directories and prunes stale `.claude/` trees, it could explain why the wipe correlates with the real pipeline (which runs claude subprocesses) but not the inline repro (which doesn't). Needs verification via `--debug` flag on the child claude invocation or strace-equivalent.
2. **(lower)** APFS snapshot interaction or Time Machine transparent file movement. Usually leaves originals in place; unlikely to target `.claude/` specifically.
3. **(lower)** A race between install_full_donnyclaude's shutil.copytree and some filesystem-layer listener that interprets the burst of file creation events as a temp operation and reaps it.
4. **(exotic)** A kernel-level sandbox or seatbelt profile for macOS developer tools that garbage-collects directories under `.ahol/` based on a rule I don't know about.

## Recommendation for next cycle

**Direction A+**: re-run `--calibration-check` to exercise the already-added `pre-clone`/`post-clone` AHOL-DIAG log lines. These bisect the 19-second window into "before subprocess.run(git clone)" vs "during subprocess.run(git clone)". Expected outcomes:

- **If `.claude/` is populated AT pre-clone but MISSING at post-clone:** the wipe happens during the clone subprocess. Since git itself doesn't touch `.ahol/`, this implicates a non-git actor (candidate #1 above: parent claude or child claude doing something during git's runtime).
- **If `.claude/` is already MISSING at pre-clone:** the wipe happens in the Python code between `bootstrap_variant` return and `_run_real_pipeline` entry (span setup, snapshot_session_files, snapshot_project_dirs). That is a narrow enough window to audit line-by-line.

Cost: ~45K tokens for the smoke. Acceptable within a fresh budget.

**Fallback (Direction B)**: if A+ still can't localize, pivot the calibration gate from cache_creation/cache_read to session-JSONL inspection. After claude returns, parse the session JSONL's first user message and check whether V4-distinctive skill names (e.g., `gsd-manager`, `django-patterns`) appear in the system-prompt content. Present → V4 loaded. Absent → V4 ran bare. Sidesteps Anthropic cache semantics and heisenbug wiping entirely; measures discovery directly.

## What's safe to ship regardless

`Track 1 (fail-loud)` is committed separately in this cycle: `_run_real_pipeline` now raises `RuntimeError` when `variant_harness_path/.claude/` is missing and the variant manifest has non-zero mutations. Silent-skip → loud-crash. Any future run where the wiper fires will halt immediately instead of producing invalid V4==V0 measurements.

## Resolution (2026-04-24, cycle 9)

Direction B was pursued and implemented in `packages/ahol/runner/discovery.py`. The calibration gate now inspects `~/.claude/projects/<slug>/*.jsonl` and asserts that variant-specific skill markers appear in the first user turn or `skill_listing` attachment. This measures the outcome (did Claude Code enumerate V4's skills?) rather than the state (is `.ahol/worktrees/variant-V4/.claude/` populated?), so it is immune to the Case-B wipe. The root cause of the wipe remains unidentified but is explicitly out of scope for this cycle; Track 1's fail-loud guard remains in place as a belt-and-suspenders check at the state level.
