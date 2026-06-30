---
name: donny-review
description: "Runs cross-AI peer review of a phase's plans by invoking external AI CLIs (Gemini, Claude, Codex, CodeRabbit, OpenCode) and writes a structured REVIEWS.md with per-reviewer feedback and a consensus summary. Use to get independent review of phase plans before execution; feed results back via donny-plan-phase --reviews. The phase defaults to the current phase in STATE.md."
argument-hint: "[--phase N] [--gemini] [--claude] [--codex] [--coderabbit] [--opencode] [--all]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---


<objective>
Invoke external AI CLIs (Gemini, Claude, Codex, OpenCode) to independently review phase plans.
Produces a structured REVIEWS.md with per-reviewer feedback that can be fed back into
planning via /donny-plan-phase --reviews.

**Flow:** Detect CLIs -> Build review prompt -> Invoke each CLI -> Collect responses -> Write REVIEWS.md
</objective>

<execution_context>
@~/.claude/donny/workflows/review.md
</execution_context>

<context>
Phase number: extracted from $ARGUMENTS. **Optional** - when omitted, the workflow uses the current
phase from STATE.md.

**Flags:**
- `--gemini` - Include Gemini CLI review
- `--claude` - Include Claude CLI review (uses separate session)
- `--codex` - Include Codex CLI review
- `--coderabbit` - Include CodeRabbit review (reviews the current git diff; may take up to 5 minutes)
- `--opencode` - Include OpenCode review (uses model from user's OpenCode config)
- `--all` - Include all available CLIs
</context>

<process>
Execute the review workflow from @~/.claude/donny/workflows/review.md end-to-end.
</process>
