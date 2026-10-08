---
name: donny-council
description: "Two-model design council for a phase: Claude Code and Codex research the phase's open questions independently (primary sources, graded), argue for a bounded number of rounds, and record joint decisions into the phase CONTEXT.md for research and planning to consume. Use before /donny-plan-phase when the gray areas are technical choices evidence can settle."
argument-hint: "<phase> [--auto] [--rounds N] [--brief <file>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - WebSearch
  - WebFetch
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
  - mcp__plugin_bio-research_pubmed__*
  - mcp__plugin_bio-research_biorxiv__*
  - mcp__plugin_bio-research_consensus__*
disable-model-invocation: false
---

<objective>
Settle a phase's technical gray areas with evidence from two independent researchers (this session and Codex) before anything is planned, and leave the decisions where donny-phase-researcher and donny-planner already look: the phase CONTEXT.md.

**Output:** `{phase_dir}/council/` (BRIEF, both research files, TRANSCRIPT, DECISIONS) and a CONTEXT.md decisions section.
</objective>

<execution_context>
@~/.claude/donny/workflows/council.md
@~/.claude/donny/templates/context.md
</execution_context>

<context>
Phase: $ARGUMENTS
</context>

<process>
Follow ~/.claude/donny/workflows/council.md end to end. The Codex seat is `~/.claude/bin/cc-council` (research, reply, decide); run every call with run_in_background=true and wait for the completion notification.
</process>
