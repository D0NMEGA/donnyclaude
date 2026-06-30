---
name: donny-plan-phase
description: "Creates executable PLAN.md files for a roadmap phase, integrating research, planning, and a verification loop. Use to turn a phase, with or without prior discuss-phase context, into verified wave-grouped plans ready to execute. Flags narrow the flow: --skip-research, --gaps (close gaps from VERIFICATION.md), --reviews (replan from cross-AI feedback), --prd <file> (plan straight from a PRD), --auto to advance into execute."
argument-hint: "[phase] [--auto] [--research] [--skip-research] [--gaps] [--skip-verify] [--prd <file>] [--reviews] [--text]"
agent: donny-planner
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
  - WebFetch
  - mcp__context7__*
---

<objective>
Create executable phase prompts (PLAN.md files) for a roadmap phase with integrated research and verification.

**Default flow:** Research (if needed) -> Plan -> Verify -> Done

**Orchestrator role:** Parse arguments, validate phase, research domain (unless skipped), spawn donny-planner, verify with donny-plan-checker, iterate until pass or max iterations, present results.
</objective>

<execution_context>
@~/.claude/donny/workflows/plan-phase.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`. They are equivalent - `vscode_askquestions` is the VS Code Copilot implementation of the same interactive question API. Do not skip questioning steps because `AskUserQuestion` appears unavailable; use `vscode_askquestions` instead.
</runtime_note>

<context>
Phase number: $ARGUMENTS (optional - auto-detects next unplanned phase if omitted)

**Flags:**
- `--research` - Force re-research even if RESEARCH.md exists
- `--skip-research` - Skip research, go straight to planning
- `--gaps` - Gap closure mode (reads VERIFICATION.md, skips research)
- `--skip-verify` - Skip verification loop
- `--prd <file>` - Use a PRD/acceptance criteria file instead of discuss-phase. Parses requirements into CONTEXT.md automatically. Skips discuss-phase entirely.
- `--reviews` - Replan incorporating cross-AI review feedback from REVIEWS.md (produced by `/donny-review`)
- `--text` - Use plain-text numbered lists instead of TUI menus (required for `/rc` remote sessions)

Normalize phase input in step 2 before any directory lookups.
</context>

<process>
Execute the plan-phase workflow from @~/.claude/donny/workflows/plan-phase.md end-to-end.
Preserve all workflow gates (validation, research, planning, verification loop, routing).
</process>
