# RESOLVED 2026-04-22: Baseline established on 9742c210 per Option B

The Step 0 block was resolved by user decision to accept Option B with a reframe: use 9742c210 (pure 4.7, zero subagent spawns) as the baseline and record metric 5 as 0/0 with a documented null-null reasoning rather than paper over the gap. See BASELINE.md for the measurement. This file is retained as audit trail for why 9742c210 was picked over replay and 4.6 fallback.

---

# Step 0 Blocker: No qualifying 4.7 session in the log pool

Generated: 2026-04-22T (UTC, at measurement time)
Measured against: claude-opus-4-7 (Claude Code 2.1.117) candidate pool in `/Users/donmega/.claude/projects/-Users-donmega-Desktop-donnyclaude/`
Purpose: Step 0 baseline selection. All five selection criteria were required simultaneously. No single session in the candidate pool satisfied every criterion.

## Summary of the block

Criterion 1 (session model is claude-opus-4-7) and Criterion 3 (at least one `Agent` or `Task` subagent spawn) are mutually unsatisfied in the pool. Every session that has genuine `Agent` subagent spawns ran on claude-opus-4-6. Every session that ran on claude-opus-4-7 has zero `Agent` or `Task` tool_use entries. Note: `TaskCreate` and `TaskUpdate` appear in several 4.7 and 4.6 sessions, but inspection of their input payloads (fields `subject`, `description`, `activeForm`) confirms they are task-list management operations for the local todo UI, not subagent spawns. They do not satisfy criterion 3.

No sessions have `isSidechain: true` entries either, which would be another marker of true subagent execution. This reinforces that the 4.7 sessions in this pool are all single-agent interactive runs.

## Scanned sessions (triage table)

| Session ID (short) | Date | Lines | Models observed | 4.7 asst turns | Agent spawns | TaskCreate/Update | Edit/Write ops | Last entry type | Fails which criteria |
|---|---|---|---|---|---|---|---|---|---|
| 0f727450 | Apr 8 | 37 | 4.6 only | 0 | 0 | 0 | 0 | last-prompt | C1, C2, C3, C4, C5 |
| 1a75f103 | Apr 13 | 1383 | 4.6 + synthetic | 0 | 0 | 0 | 84 | system | C1, C3, C5 |
| 3dd3b874 | Apr 12 | 305 | 4.6 only | 0 | 2 | 24 | 13 | file-history-snapshot | C1, C5 |
| 549a340d | Apr 13 | 232 | 4.6 only | 0 | 4 | 17 | 3 | assistant (with pending analysis) | C1 |
| 93f6026a | Apr 11 | 247 | 4.6 only | 0 | 1 | 0 | 11 | permission-mode | C1, C5 |
| 9742c210 | Apr 20 | 292 | 4.7 only | 76 | 0 | 7 | 1 | permission-mode | C3, C5 |
| a54c24e9 | Apr 13 | 627 | 4.6 only | 0 | 0 | 0 | 18 | system | C1, C3, C5 |
| c41bcdf6 | Apr 22 | 11 | 4.7 only | 1 | 0 | 0 | 0 | last-prompt | C2, C3, C4, C5 |
| cbe4c4ba | Apr 12 | 8 | (none; trivial) | 0 | 0 | 0 | 0 | user | C1, C2, C3, C4, C5 |
| e1bde03a | Apr 17 | 361 | 4.6 + 4.7 mixed | 38 | 0 | 0 | 1 | permission-mode | C3, C5; C1 marginal (mixed) |

Legend:
- C1 = session model is claude-opus-4-7 (majority of assistant turns)
- C2 = full phase execution (multi-step; /gsd- or equivalent orchestration)
- C3 = at least one Agent or Task subagent spawn
- C4 = at least one Edit, Write, or MultiEdit
- C5 = clean completion (final assistant-text response, no pending tool_use, no error/abort)

## Top reason for the block

Subagent-spawning activity in this log pool predates the 4.7 rollout on this machine. The 4.7 sessions (9742c210, c41bcdf6, majority of e1bde03a) are recent (Apr 17 to Apr 22) and were run as single-agent interactive `/gsd-` phases without delegating to child `Agent` tool calls. The older Apr 11 to Apr 13 sessions that did spawn `Agent` subagents all ran on 4.6.

Criterion 5 (clean completion) also fails in almost every candidate: typical last-entry types are `permission-mode`, `system`, `file-history-snapshot`, or `last-prompt` rather than an assistant-text final. This appears to be a Claude Code 2.1.x artifact where the JSONL continues to receive meta entries after the final assistant text. A relaxed reading of C5 (last assistant-text entry has no trailing pending tool_use) would pass most of these, but strict reading fails them.

## Options to unblock

1. **Replay.** Spawn a fresh Claude Code session on claude-opus-4-7 and run one representative `/gsd-` phase that is known to delegate to at least one `Agent` subagent and perform an Edit cycle. Estimated cost: one focused 15 to 25 minute session, probably 500k to 1.5M tokens depending on which phase is chosen. Upside: clean baseline on the exact model we care about. Downside: requires a fresh run before Step 1 workstream changes land.

2. **Relax criterion 1 to accept 4.6 sessions.** Pick 93f6026a or 549a340d as the baseline, note explicitly in BASELINE.md that Step 2 DELTA.md will be cross-model, and accept that the measured delta is confounded by the 4.6-to-4.7 model change in addition to the four harness workstream changes. Upside: zero additional runtime cost. Downside: confounding makes DELTA.md ambiguous: improvements could be from the harness changes or from 4.7's better tool-call hygiene, and the two cannot be separated.

3. **Pick a 4.7 session that misses criterion 3 (or 4).** Use 9742c210 (pure 4.7, 1 edit, multi-step `/gsd harness-optimization` run, 19 min wall-clock), measure the four non-subagent metrics cleanly, and mark "Orchestrator re-reads of subagent artifacts" as N/A with an explanation. Upside: real 4.7 measurement with no confounding model swap. Downside: loses one of the five target metrics; Step 2 cannot compare the subagent verification-overhead dimension unless Step 1 adds a subagent-spawning phase to the post-change replay.

## Recommendation

Pick Option 1 (replay). The Step 0 baseline exists specifically so Step 2 DELTA.md can attribute gains to the four harness workstream changes. Option 2 destroys that attribution (cross-model confound). Option 3 loses the single most important metric for a harness-optimization study, which is orchestrator verification overhead on subagent returns. A 20 minute replay on 4.7 of a known subagent-spawning phase (for example `/gsd-map-codebase` or a `/gsd-execute-phase` with at least one delegated wave) is a small investment to preserve a clean apples-to-apples baseline.

If replay is not acceptable on cost grounds, fall back to Option 3 with 9742c210 and document the missing subagent-verification metric as a known gap, not Option 2. Cross-model DELTA is worse than a missing metric because it silently confounds the entire result; a missing metric at least fails loudly.

## Caveats

- Majority-model determination used raw counts of `message.model` per assistant turn, not runtime-weighted. A session that opened on 4.7 and later continued from a cache warmed on 4.6 will show a mixed split. e1bde03a is the only mixed example in the pool (52 turns 4.6, 38 turns 4.7) and shows the classic continuation pattern: it begins in 4.6 mode and its 4.7 turns are later reopenings of the same transcript.
- The `Agent`-vs-`TaskCreate`/`TaskUpdate` disambiguation was confirmed by reading the tool_use input payload schema. `TaskCreate`/`TaskUpdate` payloads contain `subject`/`description`/`activeForm` fields which are the Claude Code to-do UI schema, not subagent-spawn parameters (which would contain `subagent_type`, `prompt`, and `description`).
- The `isSidechain` absence across all candidates is consistent with `Agent` spawns in 2.1.117 being recorded inline in the parent stream rather than as sidechains. Subagent sidecar directories exist for 3 of the 4.6 sessions (3dd3b874, 549a340d, 93f6026a) and confirm real subagent execution for those; no sidecar exists for any 4.7 session in the pool.
- Session d0bb21bc is excluded per the task spec as the currently running session.
