# Roadmap: claudecodeoptimized

A harness-hardening project: the "product" is the local Claude Code config (`~/.claude/`
hooks, statusline, wrappers; `~/.zshenv`; `settings.json`) running Claude Code 2.1.178 on
Opus 4.8 (macOS, bypass-permissions). The harness reached "verifiably runs at full strength
every session" (v1.0), then grew differentiators — self-improvement, an overnight `/dream`
loop, judge-panels, seamless 60% compaction (v2.0) — then hardened `/dream` from an external
deep-research audit (v2.1), then thinned onto the matured native 2026 platform / hardened the
runner / matured the instinct engine / mined Vercel Labs (v3.0), then gave `/dream` an
unattended vault-refresh mode that PROPOSES stale-note refreshes to a review branch (v4.0).
**v5.0 builds cc-autopilot — an EXTERNAL launchd-managed supervisor that reads the harness's
own live session state (the statusline context% bridge) and acts from *outside* the CC
process: it sends `/compact` at 60% on 1M Opus (the deterministic fix for the Core Value's
auto-compact clause, today only worked-around), and resumes after a usage limit at the true
reset — superseding the crude CC Continue plist.** Injection is tmux `send-keys`; the safety
boundary is the byte-stable `cco-dream` runner; the deliverable is external (`~/Developer/cc-autopilot/`).

## Milestones

- ✅ **v1.0 — Harness Floor** — Phases 1–3 (shipped 2026-06-14, 20/20 requirements, audit passed) · [archive](milestones/v1.0-ROADMAP.md) · [audit](milestones/v1.0-MILESTONE-AUDIT.md)
- ✅ **v2.0 — Differentiators** — Phases 4–8 (shipped 2026-06-16, 16/16 verified live) · [archive](milestones/v2.0-ROADMAP.md) — seamless auto-compact, OpenWolf-style token-opt+memory+observability, self-improvement, quality gates (judge-panel + green-before-done), the `/dream` overnight loop.
- ✅ **v2.1 — Deep-Research Hardening** — Phase 9 (shipped 2026-06-17, HARDEN-01..06, PASS 6/6, no regression) — `/dream` timeout/green/idempotency/lid-doc + permission-guard fail-closed/clean-block; the audit's #1 "headless hooks absent" scare empirically REFUTED on 2.1.179.
- ✅ **v3.0 — Native Convergence & Runner Hardening** — Phases 10–13 (shipped 2026-06-19, 17/17 requirements verified PASS) — thin onto native (Auto memory / Auto Dream / `/rewind` / deny rules / `/context`·`/usage`), runner-as-enforcement-boundary, new platform hook/tool surface, instinct-engine maturation, Vercel Labs mining, Pool-2 billing check.
- ✅ **v4.0 — Dream-Driven Vault Refresh** — Phases 14–18 (shipped 2026-06-21, 11/11 requirements verified PASS) · [archive](milestones/v4.0-ROADMAP.md) — `/dream` gained a vault-refresh mode: detect stale `~/vault` notes (aged / broken-orphaned / source-drift) → propose surgical refreshes to a review branch the operator merges → never auto-edit the live vault. `claudecodedocs` out of scope.
- 🚧 **v5.0 — cc-autopilot (External Supervisor)** — Phases 19–22 (in progress, started 2026-06-21) — an external launchd daemon (`~/Developer/cc-autopilot/`) that reads live per-session context% and acts via tmux `send-keys`: **60% `/compact` on 1M Opus** (the deterministic Core-Value fix) + **usage-aware resume** from the CLI's limit message + **retire CC Continue**. PILOT-01..10.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, …): Planned milestone work. Numbering is **continuous across milestones** — v5.0 continues at **Phase 19** (never restarts at 1; v4.0 ended at Phase 18).
- Decimal phases (e.g. 19.1): Urgent insertions (marked INSERTED), executed between their surrounding integers.

<details>
<summary>✅ v1.0 — Harness Floor (Phases 1–3) — SHIPPED 2026-06-14 (20/20 requirements, audit passed)</summary>

- [x] **Phase 1: Reliability & Observability** (3/3 plans) — completed 2026-06-13 — statusline, effort=`max` on every entry point, 1M-Opus auto-compact safety chain (nudge + snapshot + confirm). *(STATUS-01/02/03, EFFORT-01/02, COMPACT-01/02/03/04)*
- [x] **Phase 2: Karpathy Loop Upgrades** (3/3 plans) — completed 2026-06-13 — PostToolUse green/red lint+test loop, real permission guard (deny under bypass), durable `~/vault` memory capture. *(LOOP-01/02, GUARD-01/02, MEMORY-01/02)*
- [x] **Phase 3: Audit & Prune** (3/3 plans) — completed 2026-06-14 — backups + one-command restore, 8-key settings→binary audit, hook-registry reconciliation (orphan inert, D-06 fixed), operator-gated reversible tool-surface prune + Tool Search confirmation. *(AUDIT-01/02/03, PRUNE-01/02)*

Full details: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md).

</details>

<details>
<summary>✅ v2.0 — Differentiators (Phases 4–8) — SHIPPED 2026-06-16 (16/16 verified live)</summary>

- [x] **Phase 4: Seamless Auto-Compact at 60%** (2/2 plans) — completed 2026-06-16 — COMPACT-06 (model-visible rush eliminated, live-verified) + COMPACT-05 (native auto-compact armed, honestly re-scoped — 1M upstream-blocked #63627).
- [x] **Phase 5: Token-Opt + Cross-Session Memory + Observability** (4/4 plans) — completed 2026-06-16 — OpenWolf cluster ported clean-room: cco-file-index (CTX-01/02), cerebrum memory (RECALL-01), cco-hooks dashboard (OBS-01), cco-ledger (OBS-02).
- [x] **Phase 6: Self-Improvement (observe→instinct→evolve)** (2/2 plans) — completed 2026-06-16 — cco-instinct-observe accretion + operator-gated `/cco-evolve` promotion (EVOLVE-01/02).
- [x] **Phase 7: Quality Gates (Judge-Panel + Green-Before-Done)** (2/2 plans) — completed 2026-06-16 — `/cco-panel` (QUALITY-01/02) + cco-green-gate (FORCE-01/02).
- [x] **Phase 8: Overnight Autonomous Loop / `/dream`** (2/2 plans) — completed 2026-06-16 — bounded sleep-surviving loop, kept/discarded log, runs under the permission guard (AUTO-01/02/03; SAFETY PASS).

Full details: [`milestones/v2.0-ROADMAP.md`](milestones/v2.0-ROADMAP.md).

</details>

<details>
<summary>✅ v2.1 — Deep-Research Hardening (Phase 9) — SHIPPED 2026-06-17 (PASS 6/6, no regression)</summary>

- [x] **Phase 9: Deep-Research Hardening** (2/2 plans) — completed 2026-06-17 — always-on `/dream` wall-clock timeout, `cco-permission-guard` fails CLOSED for the catastrophe set, `/dream` green from a robust parse, crash-idempotent `/dream`, one clean guard block path, honest lid-close docs (HARDEN-01..06). The audit's #1 "headless hooks absent" finding empirically REFUTED on 2.1.179.

</details>

<details>
<summary>✅ v3.0 — Native Convergence & Runner Hardening (Phases 10–13) — SHIPPED 2026-06-19 (17/17 requirements verified PASS)</summary>

- [x] **Phase 10: Native Convergence** (4/4 plans) — completed 2026-06-18 — verify each native 2026 equivalent (Auto memory / Auto Dream / `/rewind` / deny rules / `/context`·`/usage`) against the live binary FIRST, then thin-or-retain on the evidence; reclaim the deferred-tool baseline (`disableBundledSkills` measured→reverted). *(NATIVE-01..05, SURFACE-04)*
- [x] **Phase 11: Runner Hardening & Platform Surface** (4/4 plans) — completed 2026-06-18 — the `/dream` runner is the unattended enforcement boundary (`--disallowedTools` denylist + wrapper pre-flight; hook demoted), new-platform-hook adoption (StopFailure→aborted, Setup, native worktree lock MIRROR), Pool-2 billing verified (announced-but-PAUSED). *(RUNNER-01/02, SURFACE-01/02/03, BILLING-01)*
- [x] **Phase 12: Instinct Engine Maturation** (2/2 plans) — completed 2026-06-19 — eval-gated promotion (held-out green bar, not frequency), `decay` auto-demotes never-correlated instincts, `MAX_ACTIVE=7` hard cap; metadata-only + human-gated (byte-unchanged invariant-tested). *(EVOLVE-03/04/05)*
- [x] **Phase 13: Vercel Labs Mining** (3/3 plans) — completed 2026-06-19 — main-thread `vercel-labs` sweep (309 repos) → `13-LABS-MINING.md` ledger + two clean-room ports (`agent-eval`→`cco-eval`, `ralph-loop-agent`→`cco-dream`), no source vendored. *(LABS-01/02)*

Full details: `.planning/MILESTONES.md` (v3.0 entry) + git history.

</details>

<details>
<summary>✅ v4.0 — Dream-Driven Vault Refresh (Phases 14–18) — SHIPPED 2026-06-21 (11/11 requirements verified PASS)</summary>

- [x] **Phase 14: `cco-dream` branch durability** (1/1 plans) — completed 2026-06-20 — `--branch <name>` / `--keep-branch` so kept iterations persist on a named review branch instead of being `branch -D`'d on exit (the keystone); `reconcile_orphans` spares it (live-proven + pinned). *(DREAM-01)*
- [x] **Phase 15: `cco-source-drift` detector** (1/1 plans) — completed 2026-06-20 — a NEW read-only JSON sibling of `cco-vault-audit` flagging notes drifted from a mapped source via a deterministic git signal (`commits_since` + mtime), no embeddings, zero writes. *(DETECT-02)*
- [x] **Phase 16: `cco-vault-dream` detect+select core** (2/2 plans) — completed 2026-06-21 — a NEW orchestrator composing `cco-dream` (`--surface ~/vault`) + merging the detector streams into one ranked worklist; `--detect-only` zero-write checkpoint proven write-free on the live vault. *(DREAM-02, DETECT-01, DETECT-03)*
- [x] **Phase 17: `cco-vault-dream` edit loop + review branch** (3/3 plans) — completed 2026-06-21 — the only LLM-writes-to-memory phase: source-less ⇒ flag-only (never sent to `claude -p`); diff-proposing through the LOCKED `--attempt-cmd` seam; byte-stable apply; one-per-note commits to a review branch (never auto-merged); post-proposal audit regression gate. *(PROPOSE-01/02/03/04)*
- [x] **Phase 18: `/dream-vault` command + run summary** (3/3 plans) — completed 2026-06-21 — the operator entry point (`/dream-vault` + `--folders` scope filter) + a kept/discarded ledger via the byte-unchanged `cco-dream-log` + a morning-review digest naming what changed / why / the external source per note. *(DREAM-03, REVIEW-01)*

Full details: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md).

</details>

### 🚧 v5.0 — cc-autopilot (External Supervisor) (In Progress)

**Milestone Goal:** An external launchd-managed supervisor (a new daemon, deliverable `~/Developer/cc-autopilot/`) that reads the harness's *own* live per-session state (the statusline-computed context% from the `$TMPDIR/claude-ctx-{session_id}.json` bridge) and acts on it from *outside* the CC process via tmux `send-keys` — deterministically fixing what in-process config provably cannot: **60%-context `/compact` on 1M Opus** (the Core-Value fix, today only worked-around because nothing in-process can force `/compact` and the env override misfires against the buggy 1M-window denominator) and **resume after a usage limit** at the true reset (superseding the crude CC Continue plist). Injection is tmux `send-keys` (no focus-steal, no TCC grants, no mis-routing — the osascript/Ghostty path is rejected); the safety boundary for any driven `claude -p` is the byte-stable `cco-dream` runner (`--disallowedTools` + pre-flight catastrophe check, never `--dangerously-skip-permissions`); it AUGMENTS — never replaces — the in-session compact-nudge chain + PreCompact/PostCompact snapshot (KEEP-list). Phase auto-advance (PILOT-F1) is deferred. Standing discipline: every load-bearing mechanism binary/empirically verified before relied upon.

- [x] **Phase 19: Supervisor Foundation** - launchd daemon + tmux-addressable sessions + session_id→pane map + live context-bridge reads + the cco-dream safety boundary (completed 2026-06-30)
- [x] **Phase 20: Auto-Compact at 60% (Keystone)** - send `/compact` to the owning pane at 60%, once per fill cycle, end-to-end-verified on the live binary (completed 2026-07-01)
- [x] **Phase 21: Usage-Aware Resume & CC Continue Retirement** - detect the CLI limit message, wait to the parsed reset, resume the right per-project continuation, then reversibly retire the CC Continue plist (completed 2026-07-02)
- [ ] **Phase 22: v5.0 Audit-Gap Closure — Traceability & Verification Repair** - make the formal record match delivered reality (audit 2026-07-03 `gaps_found`, zero code gaps): SUMMARY `requirements-completed` frontmatter, post-D-13/D-15 re-verification of Phases 20/21, daemon kickstart, blocking CC_TMUX operator gate, planning-git hygiene — no feature-code changes

#### Phase 19: Supervisor Foundation
**Goal**: An external launchd-managed daemon exists that can see every live CC session, address each session's tmux pane unambiguously, read that session's current context% from the on-disk bridge (never acting on stale data), and run any `claude -p` only under the `cco-dream` safety boundary — the scaffolding every later phase builds on. No compaction or resume action is taken yet.
**Depends on**: Nothing (first phase of v5.0; builds on the shipped harness)
**Requirements**: PILOT-01, PILOT-02, PILOT-03, PILOT-04, PILOT-05
**Success Criteria** (what must be TRUE):
  1. A new shell opens `claude` inside its own tmux session (each session's pane addressable by tmux pane id), and `NO_TMUX=1` cleanly bypasses this so normal interactive use is undisturbed.
  2. The supervisor runs as a launchd daemon that starts at login, stays up (`KeepAlive`), and writes an operator-tailable action log recording what it did, to which session, when, and why.
  3. With multiple concurrent CC sessions open, the supervisor correctly maps each live `session_id` to its owning tmux pane (a quick manual cross-check shows no mis-routing).
  4. The supervisor reads each session's current context% from `$TMPDIR/claude-ctx-{session_id}.json` and visibly refuses to act on a bridge file older than 60 seconds (logs "stale, skipped").
  5. Any `claude -p` the daemon invokes goes through the `cco-dream` runner boundary (`--disallowedTools` denylist + pre-flight catastrophe check, never `--dangerously-skip-permissions`), and the daemon never double-fires the same action on the same session/event (idempotent).
**Plans**: 4 plans (3 waves)
- [x] 19-01-PLAN.md — Wave 0 test scaffolding + bridge reader & 60s staleness gate (PILOT-04)
- [x] 19-02-PLAN.md — SessionStart/SessionEnd registry hooks + daemon-side session_id→pane resolver & liveness reconcile (PILOT-03)
- [x] 19-03-PLAN.md — observe-only daemon poll loop + JSONL action log + cco-dream seam & restart-surviving idempotency (PILOT-02 core, PILOT-05)
- [x] 19-04-PLAN.md — tmux claude() wrapper + com.user.ccautopilot.plist + LIVE D-11/$TMUX_PANE + cco-dream probe gate (PILOT-01, PILOT-02 lifecycle, PILOT-05 live) [autonomous: false]

#### Phase 20: Auto-Compact at 60% (Keystone)
**Goal**: The supervisor deterministically fixes the Core Value's auto-compact clause: when a session crosses 60% context it sends `/compact` to that exact session's pane via tmux `send-keys`, the session visibly compacts, and the trigger fires at most once per fill cycle — proven end-to-end against the live binary, not assumed.
**Depends on**: Phase 19
**Requirements**: PILOT-06, PILOT-07
**Success Criteria** (what must be TRUE):
  1. A session whose context crosses 60% gets `/compact` sent to its own owning pane via `send-keys`, with no window-focus stolen and no other pane touched.
  2. The 60% trigger fires at most once per fill cycle — it re-arms only after a compaction drops the session's usage back down (a session lingering above 60% is not spammed with repeated `/compact`).
  3. The `send-keys` → `/compact` round-trip is verified end-to-end on the live binary: the targeted session actually compacts (context% drops in the bridge afterward), confirming the keystone works in practice.
**Plans**: 4 plans (4 waves)
- [x] 20-01-PLAN.md — Wave 0 TDD RED: act-path test contracts + action.py/config.py skeletons (PILOT-06/07)
- [x] 20-02-PLAN.md — Wave 1: action.py send-keys /compact + fail-closed idle guard + marker dedupe, config act toggle (PILOT-06)
- [x] 20-03-PLAN.md — Wave 2: daemon act branch (arm-on-send, <45% hysteresis re-arm, observe-only default, reads act each poll) (PILOT-06/07)
- [x] 20-04-PLAN.md — Wave 3: INSTALL act-mode doc + the D-09 LIVE send-keys -> /compact operator gate (PILOT-07) [autonomous: false]

#### Phase 21: Usage-Aware Resume & CC Continue Retirement
**Goal**: The supervisor makes resume event-driven and correct: it detects a usage/rate-limit stop from the CLI's own "usage limit reached" message (format pinned empirically against the live binary, since this metered seat has no `rate_limits` blob), waits until the reset time parsed from that message, resumes the session with the correct per-project continuation, and — once that is proven — reversibly retires the old `com.user.cc_continue_once.plist` one-shot alarm it replaces.
**Depends on**: Phase 20
**Requirements**: PILOT-08, PILOT-09, PILOT-10
**Success Criteria** (what must be TRUE):
  1. When a CC session stops on a usage/rate limit, the supervisor detects it by matching the CLI's own "usage limit reached" message (the format empirically pinned to the live binary, not the absent `rate_limits` blob), and logs the detection.
  2. The supervisor waits until the reset time parsed from that message, then resumes the stopped session with the correct per-project continuation — not CC Continue's fixed-time guess + generic "continue" string.
  3. Resume targets the right session/pane (no cross-session mis-routing) and runs under the same `cco-dream` safety boundary as every other driven `claude -p`.
  4. Once PILOT-06..09 are proven on the live binary, the existing `com.user.cc_continue_once.plist` one-shot alarm is retired (resume is now event-driven), and the retirement is reversible (the old plist is preserved/disabled, not destroyed).
**Plans**: TBD

#### Phase 22: v5.0 Audit-Gap Closure — Traceability & Verification Repair
**Goal**: The v5.0 formal record matches its delivered reality: the deterministic coverage gate computes 10/10 PILOT requirements satisfied from repaired phase artifacts, the live daemon runs current code, and the one operator-answerable UAT item is closed — so the milestone re-audit passes without adding or changing any shipped feature code.
**Depends on**: Phase 21
**Requirements**: PILOT-01..10 — formal record repair ONLY; the implementations remain Phases 19/20/21 (traceability deliberately keeps each requirement mapped to its original phase; this phase repairs those phases' artifacts in place)
**Gap Closure**: Closes gaps from `.planning/v5.0-MILESTONE-AUDIT.md` (2026-07-03, `gaps_found`: 7 formal-unsatisfied + 3 partial, 0 code-delivery gaps)
**Success Criteria** (what must be TRUE):
  1. `node "$HOME/.claude/donny/bin/donny-tools.cjs" verify milestone-coverage` returns gate `passed` — all 10 PILOT requirements compute satisfied (VERIFICATION verdicts parse as passed + SUMMARY frontmatter lists each requirement + checkboxes `[x]`).
  2. The 19-\*/20-\* SUMMARYs carry `requirements-completed` per the source-plan mapping (19-01=PILOT-04, 19-02=PILOT-03, 19-03=PILOT-05, 19-04=PILOT-01/02; 20-03 or 20-04=PILOT-06/07); Phases 20/21 are re-verified/amended against the committed D-13/D-15 amendments, with the two time-driven UAT residuals (real-TUI resume, live banner pin) still honestly tracked in 21-HUMAN-UAT.md — never deleted or fabricated as passed.
  3. The live `com.user.ccautopilot` daemon has been kickstarted and runs code newer than the 2026-07-03 grace patch (process start time > daemon.py mtime); 20-HUMAN-UAT.md is annotated superseded-by-native (D-13).
  4. Blocking operator gate: the CC_TMUX default keep-or-revert decision is recorded (closes 21-HUMAN-UAT item 3).
  5. Planning-git hygiene: 21-LEDGER.jsonl tracked, `.planning/config.json` `_auto_chain_active` reset to `false`, modified planning files committed; residual ROADMAP drift corrected (Phase 21 "Plans: TBD" line, Phase 21 SC-4's superseded "PILOT-06..09" wording).
**Note**: The missing phase security audits are NOT tasks of this phase — run `/donny-audit-phase 20 --security` and `/donny-audit-phase 21 --security` alongside, before the milestone re-audit.
**Plans**: 4 plans (2 waves)

Plans:
- [ ] 22-01-PLAN.md - Phase 19 formal-record repair (VERIFICATION status + summaries requirements-completed + de-shadow)
- [ ] 22-02-PLAN.md - Phase 20 & 21 verification-vocabulary + UAT repair (honesty invariant preserved)
- [ ] 22-03-PLAN.md - REQUIREMENTS checkboxes + ROADMAP drift + daemon kickstart
- [ ] 22-04-PLAN.md - coverage-gate keystone (10/10) + git hygiene

## Progress

**Execution Order:**
Phases execute in numeric order. v1.0 phases 1–3, v2.0 phases 4–8, v2.1 phase 9, v3.0 phases 10–13, v4.0 phases 14–18 all shipped. **v5.0 phases 19–22 (this milestone):** 19 (foundation) is distinct and first; 20 (the 60% `/compact` keystone) is its own phase and the Core-Value fix; 21 (usage-aware resume + retire CC Continue) follows — PILOT-10 (retire) gated per D-13 on PILOT-08/09; 22 (audit-gap closure, added 2026-07-03) repairs the formal record so the re-audit passes. Strict dependency chain 19 → 20 → 21 → 22; no parallelism this milestone.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reliability & Observability | v1.0 | 3/3 | ✅ Complete | 2026-06-13 |
| 2. Karpathy Loop Upgrades | v1.0 | 3/3 | ✅ Complete | 2026-06-13 |
| 3. Audit & Prune | v1.0 | 3/3 | ✅ Complete | 2026-06-14 |
| 4. Seamless Auto-Compact at 60% | v2.0 | 2/2 | ✅ Complete | 2026-06-16 |
| 5. Token-Opt + Memory + Observability | v2.0 | 4/4 | ✅ Complete | 2026-06-16 |
| 6. Self-Improvement (observe→instinct→evolve) | v2.0 | 2/2 | ✅ Complete | 2026-06-16 |
| 7. Quality Gates (Judge-Panel + Green-Before-Done) | v2.0 | 2/2 | ✅ Complete | 2026-06-16 |
| 8. Overnight Autonomous Loop / `/dream` | v2.0 | 2/2 | ✅ Complete | 2026-06-16 |
| 9. Deep-Research Hardening | v2.1 | 2/2 | ✅ Complete | 2026-06-17 |
| 10. Native Convergence | v3.0 | 4/4 | ✅ Complete | 2026-06-18 |
| 11. Runner Hardening & Platform Surface | v3.0 | 4/4 | ✅ Complete | 2026-06-18 |
| 12. Instinct Engine Maturation | v3.0 | 2/2 | ✅ Complete | 2026-06-19 |
| 13. Vercel Labs Mining | v3.0 | 3/3 | ✅ Complete | 2026-06-19 |
| 14. `cco-dream` branch durability | v4.0 | 1/1 | ✅ Complete | 2026-06-20 |
| 15. `cco-source-drift` detector | v4.0 | 1/1 | ✅ Complete | 2026-06-20 |
| 16. `cco-vault-dream` detect+select core | v4.0 | 2/2 | ✅ Complete | 2026-06-21 |
| 17. `cco-vault-dream` edit loop + review branch | v4.0 | 3/3 | ✅ Complete | 2026-06-21 |
| 18. `/dream-vault` command + run summary | v4.0 | 3/3 | ✅ Complete | 2026-06-21 |
| 19. Supervisor Foundation | v5.0 | 4/4 | Complete    | 2026-06-30 |
| 20. Auto-Compact at 60% (Keystone) | v5.0 | 4/4 | Complete   | 2026-07-01 |
| 21. Usage-Aware Resume & CC Continue Retirement | v5.0 | 6/6 | Complete    | 2026-07-02 |
| 22. v5.0 Audit-Gap Closure — Traceability & Verification Repair | v5.0 | 0/4 | Pending | — |

**v1.0: 3/3 phases · 9/9 plans · 20/20 requirements — SHIPPED 2026-06-14.**
**v2.0: 5/5 phases · 12/12 plans · 16/16 requirements verified live — SHIPPED 2026-06-16.**
**v2.1: 1/1 phase · 2/2 plans · 6/6 requirements PASS — SHIPPED 2026-06-17.**
**v3.0: 4/4 phases · 13/13 plans · 17/17 requirements verified PASS — SHIPPED 2026-06-19.** (Phase 10 Native Convergence · 11 Runner Hardening & Platform Surface · 12 Instinct Engine Maturation · 13 Vercel Labs Mining; NATIVE-01..05, RUNNER-01/02, SURFACE-01..04, EVOLVE-03..05, LABS-01/02, BILLING-01 all satisfied.)
**v4.0: 5/5 phases · 10/10 plans · 11/11 requirements verified PASS — SHIPPED 2026-06-21.** (Phase 14 branch durability · 15 source-drift detector · 16 detect+select core · 17 edit loop + review branch · 18 command + run summary; DREAM-01/02/03, DETECT-01/02/03, PROPOSE-01/02/03/04, REVIEW-01 all satisfied.)
**v5.0: 3/4 phases · 14 plans complete (Phase 22 TBD) · 10/10 PILOT requirements code-shipped, 0/10 formally confirmed pending the Phase 22 record repair (audit 2026-07-03: `gaps_found`, zero code gaps) — IN PROGRESS (started 2026-06-21).** (Phase 19 Supervisor Foundation [PILOT-01..05] · 20 Auto-Compact at 60% Keystone [PILOT-06/07] · 21 Usage-Aware Resume & CC Continue Retirement [PILOT-08/09/10] · 22 Audit-Gap Closure [record repair]. PILOT-F1 phase auto-advance deferred → backlog 999.3.)

## Backlog

### Phase 999.1: Post-compact constraint re-injection (BACKLOG)

**Goal:** Pin every safety/governance constraint (Tier-1 index + promoted instincts) into a protected region and re-inject verbatim after each `/compact`, with a post-compaction integrity check. Evidence Grade A (arXiv:2606.22528 "Governance Decay" + independent replication): one summarize-and-truncate step raises policy violation 0%→30–59%; re-injection restores 0% at ~47 tokens / <0.5% overhead. Source: `research/cco-science-deliverables/decision_memo.md` #1 + vault `Reference/Claude-Science-CCO-Lit-Review`.
**Requirements:** TBD
**Plans:** 6/6 plans complete

Plans:
- [ ] TBD (promote with /donny-review-backlog when ready)

### Phase 999.2: cco-dream metric instrumentation placement audit (BACKLOG)

**Goal:** Audit whether `cco-dream`'s metric path (the `--metric` command and anything it invokes) is editable from inside the iteration worktree — the DGM "deleted the checker for a perfect score" hazard (arXiv:2505.22954). If editable, move/guard the instrumentation outside the editable surface and keep the loop's resource limits daemon-side. Partially mitigated today by the human-merged review branch. Source: `research/cco-science-deliverables/manuscript.md` §5.4 + `decision_memo.md` #3.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /donny-review-backlog when ready)

### Phase 999.3: Run-end /clear + next-command auto-advance (PILOT-F1-lite) (BACKLOG)

**Goal:** When a Donny run ends and prints its Next Up block ("`/clear` then: `/donny-<cmd>`"),
the supervisor runs it: send-keys `/clear` to the owning pane, verify the fresh prompt, then type
the stated command. Fresh-context chaining — strictly higher quality than the in-session `--auto`
chain (context bloat between stages), and something the session **cannot do to itself** (CC has no
self-/clear-then-type; the block is addressed to the human — the external pane hand is the runner).
Operator-requested 2026-07-03; promotes the deferred **PILOT-F1** (its deferral rationale — "revisit
once the supervisor core is proven" — expired with v5.0 code-complete).

**Canonical trigger fixture** (operator's live example, phase-36 project — the block is the stable
`offer_next` template across all Donny projects):
`## ▶ Next Up` … `**Execute Phase 36** — run all 4 plans` … `/clear` **then:** `/donny-execute-phase 36`

**Design sketch (mirror the proven limits pipeline):** trigger = a Stop-hook transcript parse of the
last assistant message for the Next Up block (project-agnostic, zero donny-fork edits) OR a marker
emitted by the donny `offer_next`/`auto_advance` steps themselves (deterministic; our fork) →
metadata marker `{session_id, cwd, next_command, ts}` in `~/.claude/.autopilot/nextup.d/` → daemon
ladder: act toggle + mapped pane + idle guard + pane-still-shows-the-block re-check (self-cancel à la
`resume_cancelled`) + consume-once + TTL → send `/clear` (locked literal→settle→Enter form) → verify
fresh prompt via capture-pane → send the stated command → Enter. Reuses `action.py` send form +
`BUSY_MARKERS`, the `limits.d` marker pattern, registry `%N`. Guard: whitelist the typed command to
`/donny-*` (+ `/clear`) so a hallucinated/injected block can never type arbitrary text.
**Requirements:** TBD (PILOT-F1 lineage)
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /donny-review-backlog when ready)
