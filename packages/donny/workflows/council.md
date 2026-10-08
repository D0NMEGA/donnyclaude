<purpose>
Run a two-model design council for one phase before planning: Claude Code and Codex each research the phase's open questions independently (primary sources, graded), then argue over the findings for a bounded number of rounds, then record joint decisions in the phase CONTEXT.md so donny-phase-researcher and donny-planner consume them unchanged.

This replaces the interview part of /donny-discuss-phase when the gray areas are technical choices that evidence can settle. It does not replace the user: anything the two models still disagree on, or that is a taste/product call, is listed under "Needs your call" (and under --auto, Claude's recommendation is taken and marked as such).
</purpose>

<inputs>
$ARGUMENTS: phase number, flags `--auto` (no questions; take Claude's recommendation on unresolved items), `--rounds N` (default 2), `--brief <file>` (use an existing brief instead of generating one).
</inputs>

<process>

## 1. Init

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${PHASE}")
```
Stop if `phase_found` is false. Read ROADMAP.md (the phase section), REQUIREMENTS.md (requirements mapped to this phase), STATE.md, prior phases' CONTEXT.md decisions, and ~/.claude/CLAUDE.md standards. `COUNCIL_DIR = {phase_dir}/council`. If `COUNCIL_DIR/DECISIONS.md` exists, say so and stop (rerun with a new dir if the user wants a second council).

## 2. Brief

Write `COUNCIL_DIR/BRIEF.md` (max ~60 lines):
- Phase boundary (verbatim goal from ROADMAP) and the requirement ids it must satisfy.
- Fixed constraints: stack, standards from CLAUDE.md and the project CLAUDE.md, decisions already locked in prior CONTEXT.md files.
- The questions to settle: 3-6 gray areas (same analysis as discuss-phase: implementation choices with more than one defensible answer and real consequences). One line each, phrased as a decision to make.
- Output contract: sources graded A/B/C with URLs; "not verified" where unsure; options table; recommendation with confidence.

## 3. Research, both seats in parallel

Start Codex first so it runs while you research:
```
Bash(run_in_background=true): "$HOME/.claude/bin/cc-council" research "COUNCIL_DIR" "COUNCIL_DIR/BRIEF.md" -C "{project_root}"
```
Then do your own research in this thread and write `COUNCIL_DIR/CLAUDE-RESEARCH.md` with the same sections Codex is asked for (Summary, Findings, Options, Recommendation, Open questions). Use the strongest source per question:
- Library and CLI behavior: Context7 (resolve-library-id, query-docs), then the official docs page.
- Web pages, GitHub threads, Reddit, X, HN: the `browser-harness` CLI in this thread (see ~/.claude/CLAUDE.md research rules; close every tab you open). Do not hand browser-harness to a subagent; a subagent that needs a page uses the browser_* MCP tools.
- Literature: PubMed, arXiv, bioRxiv and Consensus MCP tools when the question is scientific.
- WebSearch/WebFetch only to pin a single fact.
Grade every source. Do not pad: one strong primary source beats five blog posts.

Wait for the Codex completion notification (never poll). Read `COUNCIL_DIR/CODEX-RESEARCH.md`.

## 4. Rounds (default 2)

For round r = 1..N:
1. Write `COUNCIL_DIR/claude-msg-r.md`: per question, agree / disagree with Codex, with the evidence that decides it; your updated recommendation; what you want Codex to verify or concede. Keep it under 400 words; attack claims, not style.
2. `Bash(run_in_background=true): "$HOME/.claude/bin/cc-council" reply "COUNCIL_DIR" "COUNCIL_DIR/claude-msg-r.md"` and wait for the notification.
3. Read `codex-reply-r.md`. Stop early when Codex's "Still open" is "none" and you agree with its current position.

Then `Bash(run_in_background=true): "$HOME/.claude/bin/cc-council" decide "COUNCIL_DIR"` and read `DECISIONS-CODEX.md`.

## 5. Joint decisions

Write `COUNCIL_DIR/DECISIONS.md`:
```markdown
# Phase {N} council decisions ({date})

## Agreed
- D-01: {decision}. Why: {one line}. Evidence: {source refs}. Acceptance: {command or observable behavior}.

## Needs your call
- Q-01: {question}. Claude: {position + why}. Codex: {position + why}. Recommendation: {which, one line}.

## Dissent kept on record
- {what Codex still disagrees with, verbatim short quote, and why Claude did not adopt it}

## Risks to watch
## Sources (A/B/C graded, URLs)
```
Without `--auto`: present "Needs your call" with AskUserQuestion (one question per item, recommendation first) and move the answers into Agreed. With `--auto`: adopt each recommendation, mark it `(auto: Claude's recommendation)`, and keep it listed under Needs your call for the record.

## 6. Feed the pipeline

If `{phase_dir}/{padded}-CONTEXT.md` does not exist, create it from `~/.claude/donny/templates/context.md` using the Agreed decisions as the `<decisions>` section (one `### area` per question), the dissent and risks under `<specifics>`, and a line `Council record: council/DECISIONS.md` in `<canonical_refs>`. If it exists, append a `## Council decisions ({date})` section with the same content and do not rewrite earlier decisions.

Commit when `commit_docs` is true:
```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs({padded}): council decisions" --files "{phase_dir}/council" "{phase_dir}/{padded}-CONTEXT.md"
```

## 7. Report

Five lines max: how many questions, how many agreed, what needs the user's call, where the record is, and the next command (`/donny-plan-phase {N}`; with --auto inside donny-run the runner continues by itself).
</process>

<rules>
- Evidence beats seniority: when the two seats disagree and the evidence is one-sided, the evidence wins; when it is balanced, the user decides.
- Never run Codex except through cc-council or cc-codex, always run_in_background, never poll.
- The council decides WHAT; research and planning decide HOW. Do not write plans or code here.
- Keep the whole council under ~90 minutes of wall clock; cut rounds before cutting research quality.
</rules>
