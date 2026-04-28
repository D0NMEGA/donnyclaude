# Transcripts Index

**Parked:** 2026-04-12, ahead of v1.2 Phase 1 planning
**Status:** Durable research artifacts, deliberately deferred to v1.3+ unless spot-check surfaces a Phase 1 blocker
**Audit trail purpose:** "We knew about these and consciously deferred them." Future-you (or v1.3 planning) reads this index and decides which transcripts warrant full reads at that point.

**Do not feed to the planner subagent.** The planner decomposes CONTEXT.md into atomic tasks; adding 18 transcripts dilutes signal and risks the exact planner-drift failure mode we're trying to prevent.

---

## Batch 1 — 14 transcripts (all successfully extracted)

| # | File | Title | Uploader | Duration | Lang | Size | Relevance (one-sentence guess) |
|---|------|-------|----------|----------|------|------|-------------------------------|
| 1 | `batch1/nBH07G-zayk__...txt` | Anthropic Just Killed All Your Agent Harnesses | AI LABS | 14m02s | en | 17KB | **HIGH — directly speaks to Phase 1 prune thesis.** Opens by citing Anthropic's own harness-ablation experiment finding most components are "dead weight" with Opus 4.6. Spot-check candidate. |
| 2 | `batch1/kJPvfoLtFFY__...txt` | wtf is Harness Engineer & why is it important | AI Jason | 15m16s | en | 18KB | HIGH — definitional piece on the harness-engineer role; may challenge v1.2's framing of "configuration distribution ON TOP of Claude Code loop" as the only path. |
| 3 | `batch1/qMnClynCAmM__...txt` | The Next Evolution of AI Coding Is Harnesses — Here's How to Build Them | Cole Medin | 30m47s | en | 34KB | HIGH — longest batch-1 harness tutorial; likely architectural-tier content, probably v1.3+ material (custom wrapper is explicitly out of scope for v1.2). |
| 4 | `batch1/Wfz-gdWcItM__...txt` | 【放置OK】Claude Codeハーネス設計で自律開発するハーネスエンジニアリング入門！ | Shin Coding Tutorial | 25m15s | **ja** | 41KB | HIGH — Japanese-language harness-engineering intro, explicitly "Hands-off Claude Code harness design for autonomous dev." User-flagged spot-check candidate. |
| 5 | `batch1/38t5UBCa4OI__...txt` | Every Claude Code Workflow Explained (& When to Use Each) | Simon Scrapes | 17m49s | en | 21KB | MEDIUM — workflow taxonomy; may surface which of donnyclaude's 60 commands are actually high-frequency vs dead code (Phase 1 pruning signal). |
| 6 | `batch1/lGWFlpffWk4__...txt` | Stop Using Claude Code the Normal Way | Leon van Zyl | 28m18s | en | 28KB | MEDIUM — non-default usage patterns; possible hook/skill insights for Phase 4. |
| 7 | `batch1/xmB2oHoEKes__...txt` | How to Turn Claude Code into a Full Engineering Team (Agent Harnesses Explained) | Ai Verdict | 6m48s | en | 8KB | MEDIUM — multi-agent team patterns; tangential to Phase 3 subagent return contracts. |
| 8 | `batch1/8dqqa0dLpGU__...txt` | Use Claude Code in auto-pilot (SAFELY!) | Ian Nuttall | 7m32s | en | 7KB | MEDIUM — auto-pilot safety patterns; potentially relevant to Phase 5 Stop-verification hook. |
| 9 | `batch1/27Y44JYXZJ8__...txt` | I Tested Claude's New Managed Agents... What You Need To Know | Nate Herk \| AI Automation | 16m32s | en | 22KB | MEDIUM — Anthropic-hosted managed agents; may inform Phase 3 return-contract framing (cloud vs local subagents). |
| 10 | `batch1/eaNA2oOXoUg__...txt` | Auto Claude: AI Coding on Steroids! Claude Code Running Autonomous For Hours! | WorldofAI | 13m19s | en | 14KB | LOW-MEDIUM — promo of André Mikalsen's Auto Claude harness (competitor reference); out of v1.2 scope, potential v1.3 reference material. |
| 11 | `batch1/ytn0aXK2gzE__...txt` | Auto Claude is HERE… Upgrade your Claude Code Workflow | AI LABS | 10m44s | en | 13KB | LOW-MEDIUM — second Auto Claude promo; likely overlaps #10/#12. |
| 12 | `batch1/s9nt8xaXFdg__...txt` | AI Coding on steroids! Auto Claude (Free & Opensource) | André Mikalsen | 19m28s | en | 18KB | LOW-MEDIUM — Auto Claude creator's own walkthrough; competitor architecture reference for v1.3 arch-tier decisions. |
| 13 | `batch1/Mnvk9gK4e9A__...txt` | Pi's Advantage Over Claude Code Is Insane | Eric Michaud | 13m04s | en | 16KB | LOW — competitor comparison (Pi vs Claude Code); unlikely to inform v1.2 scope. |
| 14 | `batch1/XWp4k9K6oK8__...txt` | Anthropic Released A New Way To "Vibe Code" | AI LABS | 4m40s | en | 6KB | LOW — short promo clip, likely marketing signal over substance. |

---

## Batch 2 — 1 extracted, 3 missing (livestream ASR not yet available)

| # | File | Title | Uploader | Duration | Lang | Size | Relevance (one-sentence guess) |
|---|------|-------|----------|----------|------|------|-------------------------------|
| 15 | `batch2/nwjjN624HG0__...txt` | BMAD Method into Auto Claude 🔥 | André Mikalsen | 4h53m14s | en | 111KB | HIGH (but long) — 5-hour livestream integrating the BMAD context-engineering framework with Auto Claude; rich architectural content, almost certainly v1.3+ material. Too long for Phase 1 spot-check. |

**Missing (requested but not yet available on YouTube):**

| # | Video ID | Title | Uploader | Duration | Status |
|---|----------|-------|----------|----------|--------|
| 16 | `UHSy4klsFCw` | Auto Claude - AI Coding on steroids | André Mikalsen | 1h08m10s | No captions — livestream, YouTube ASR not yet run |
| 17 | `3nPOaePP4Kk` | Auto Claude - Improving our AI Coding system 🔥 | André Mikalsen | 5h03m47s | No captions — livestream, YouTube ASR not yet run |
| 18 | `v8C3N3AXv5o` | Auto Claude - Vibe coding at the next level | André Mikalsen | 5h10m16s | No captions — livestream, YouTube ASR not yet run |

See `batch2/README-MISSING.txt` for recovery options (wait for YouTube ASR, or run local Whisper).

---

## Defer Decision Log

**2026-04-12:** 18 transcripts requested to inform v1.2 harness-optimization thinking. 15 successfully extracted, 3 blocked by absent YouTube ASR on recent livestreams. Decision: park all available transcripts here as durable artifacts and defer full reads to v1.3+ unless a targeted spot-check surfaces a Phase 1 (skill-prune RC gate) blocker.

**Spot-checks performed before /clear:**
- `Wfz-gdWcItM` (Japanese harness engineering intro) — see section below
- `nBH07G-zayk` (Anthropic killed your harnesses) — see section below

**Outcome:** [filled in after spot-checks]

---

## Spot-check Findings (2026-04-12)

### `nBH07G-zayk` — "Anthropic Just Killed All Your Agent Harnesses" (AI LABS, 14m02s)

**Source:** This video recaps a recent Anthropic blog post on their own harness-ablation experiment. It is a secondary source; the primary is the Anthropic post itself (not read here).

**Core claims with bearing on v1.2:**

1. **Directionally aligned with Phase 1 (prune thesis).** Anthropic removed harness components one by one and found that with Opus 4.6, most are "dead weight." Every component encodes an assumption about what the model can't do on its own; those assumptions go stale as models improve. This is the same thesis driving SKILLS-01.
2. **Claim: Opus 4.5+ no longer exhibits "context anxiety."** Context resets, detailed external task breakdowns, and compaction mitigations are described as no longer necessary for Opus 4.5+ sessions. Explicitly says this IS still needed for Sonnet and Haiku users.
3. **Claim: Micro-sharded planning (BMAD, spec-kit) now HURTS Opus 4.6.** "If the planner tried to specify micro technical details up front, a single error would cascade through every level of implementation." Recommends high-level, product-level planning instead.
4. **Claim: Separate evaluator from generator is still correct and universal.** GSD already does this; no change needed.
5. **Direct critique of GSD's verifier:** "GSD uses a verifier subagent... it uses a pass and fail mechanism, not a scored implementation." The Anthropic pattern uses a graded rubric (quality, originality, craft, functionality).
6. **Recommendation: "Take the best parts of Anthropic's framework and combine them with GSD."**

**Phase 1 blocker assessment:** NONE. Phase 1 is a skill prune targeting 75-85 high-value skills with per-skill rationale; the transcript reinforces rather than invalidates that goal.

**Optional Phase 1 sharpening — CONSIDERED AND DEFERRED 2026-04-12:**
- The audit subagent prompt in `01-02-PLAN.md` could add one criterion: *"Does this skill encode an assumption about what Opus 4.6 cannot do on its own? If yes, it is prune-eligible for the same reason as duplicate-of-training-knowledge."*
- **Deferred to v1.3 rubric revision, not folded into Phase 1.** Reasons: (1) overlaps heavily with existing rubric clause (a) "duplicates training-data knowledge" — the criteria are near-tautological, so adding it now risks inconsistent verdict language across PRUNE-LOG.md entries, not meaningfully more-pruned skills; (2) Phase 1 planner was mid-revision (iteration 1/3, ~400k tokens burned) at the moment this was considered, and hot-patching an artifact the planner is actively revising against is a worse failure mode than a marginal rubric improvement; (3) the discipline of "never modify locked planning artifacts while a planning agent is running" is a stronger rule than "fold in small refinements when they surface." This entry exists so future-you (or v1.3 Claude) asking "why didn't we fold this in" finds the answer in the artifact, not lost to context.

**v1.3+ seeds captured (do not expand v1.2 scope):**
- **Upgrade GSD verifier from pass/fail → graded rubric** (quality, originality, craft, functionality scoring) — architectural-tier, belongs in v1.3+.
- **Planner agent language refinement** — shift GSD planner prompts away from micro-technical-detail sharding toward product-level planning. Orthogonal to v1.2 return-contracts work (Phase 3), but related. Belongs in v1.3+.
- **Phase 4 (HOOKS-02/03) framing clarification** — PreCompact backup + SessionStart restore are primarily valuable for Sonnet/Haiku users; Opus 4.5+ users may see them as overhead. NOT a blocker for Phase 4 (the feature still ships), but the success criteria wording should acknowledge the model-tier dependency. Defer to Phase 4 discussion/planning — NOT a v1.2 rescoping.

### `Wfz-gdWcItM` — 【放置OK】ハーネスエンジニアリング入門 (Shin Coding Tutorial, 25m15s, Japanese)

**Translated summary (my read of the ja transcript):** This is a Japanese-language hands-on tutorial that *implements* the same Anthropic blog pattern (Planner → Generator → Evaluator) using Claude Code's native subagent system. The tutorial:

- Uses `claude-code` native `/agents` command to create 3 subagents (Planner, Generator, Evaluator), all on the Opus model
- Uses Playwright MCP attached to the Evaluator for "eyes" (UI verification via real browser)
- Uses CLAUDE.md as the orchestrator that tells the parent Claude Code session how to route work between the three subagents
- Uses `--dangerously-skip-permissions` (bypass mode) for autonomous operation
- Demonstrates on a "travel planner" sample web app
- Explicitly validates that Claude Code's built-in "claude-code-guide skill auto-fires" to teach users how to make subagents and skills — this is the `claude-code-guide` skill donnyclaude distributes, and the Japanese creator is using it as evidence that Claude Code's native ecosystem is self-teaching.
- Ends with a plug for the creator's paid "Claude Code Academy" course (promotional, not scope-relevant).

**Phase 1 blocker assessment:** NONE. The tutorial validates donnyclaude's architectural envelope — "configuration distribution sitting on top of Claude Code's native agent loop with Playwright MCP and CLAUDE.md orchestration" is exactly the pattern demonstrated. The `claude-code-guide` skill mention is a small positive data point for keeping it during Phase 1 prune (community evidence of value).

**v1.3+ seeds captured:**
- **Planner / Generator / Evaluator subagent triad** as an official donnyclaude-shipped pattern — could ship as a skill or command in v1.3+ rather than leaving every user to reinvent the Anthropic-blog pattern. Orthogonal to v1.2. Candidate for backlog.

---

## Defer Decision — locked 2026-04-12

**Outcome:** Spot-checks surfaced **no Phase 1 blocker**. 14 transcripts remain unread; they are durable, indexed, and deferred to v1.3+. The two findings that *could* influence Phase 1 — the audit-subagent prompt refinement, and the "Opus 4.5+ context anxiety" framing for HOOKS-02/03 — are explicitly **not** scope changes; they are optional prompt-level refinements the user can fold in before `/gsd-plan-phase 1` spawns, or defer.

**v1.3+ backlog seeds captured here** (do not act on without explicit milestone advancement):
1. Upgrade GSD verifier from pass/fail to graded-rubric evaluator with quality/originality/craft/functionality scoring.
2. Refine GSD planner prompts to favor product-level planning over micro-sharded technical breakdown (Opus-tier-aware).
3. Acknowledge HOOKS-02/03 (PreCompact backup + SessionStart restore) are primarily Sonnet/Haiku-tier value-adds; Opus 4.5+ users see diminishing returns (framing note for Phase 4 planning, not a rescoping).
4. Ship a donnyclaude-native Planner/Generator/Evaluator subagent triad following the Anthropic blog pattern, so users don't reinvent it.

**Proceed with:** `/clear` → `/gsd-plan-phase 1` as originally planned.
