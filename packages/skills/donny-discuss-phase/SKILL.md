---
name: donny-discuss-phase
description: "Gathers phase implementation decisions before planning: always surfaces Claude's key assumptions for correction, then deep-dives the gray areas the user picks, and writes CONTEXT.md. Use before planning a phase to lock choices so the researcher and planner don't re-ask. --auto picks recommended defaults non-interactively; --chain continues into plan+execute; --power batches every question into a file-based UI; --text uses plain numbered lists for remote sessions."
argument-hint: "<phase> [--auto] [--chain] [--batch] [--analyze] [--text] [--power]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Task
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---


<objective>
Extract implementation decisions that downstream agents need - researcher and planner will use CONTEXT.md to know what to investigate and what choices are locked.

**How it works:**
1. Load prior context (PROJECT.md, REQUIREMENTS.md, STATE.md, prior CONTEXT.md files)
2. Scout codebase for reusable assets and patterns
3. Analyze phase - skip gray areas already decided in prior phases
4. Surface Claude's key assumptions across five areas and invite correction (always)
5. Present remaining gray areas - user selects which to discuss
6. Deep-dive each selected area until satisfied
7. Create CONTEXT.md with decisions that guide research and planning

**Output:** `{phase_num}-CONTEXT.md` - decisions clear enough that downstream agents can act without asking the user again
</objective>

<execution_context>
@~/.claude/donny/workflows/discuss-phase.md
@~/.claude/donny/workflows/discuss-phase-assumptions.md
@~/.claude/donny/workflows/discuss-phase-power.md
@~/.claude/donny/templates/context.md
</execution_context>

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`. They are equivalent - `vscode_askquestions` is the VS Code Copilot implementation of the same interactive question API.
</runtime_note>

<context>
Phase number: $ARGUMENTS (required)

Context files are resolved in-workflow using `init phase-op` and roadmap/state tool calls.
</context>

<process>
**Mode routing:**
```bash
DISCUSS_MODE=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.discuss_mode 2>/dev/null || echo "discuss")
```

If `DISCUSS_MODE` is `"assumptions"`: Read and execute @~/.claude/donny/workflows/discuss-phase-assumptions.md end-to-end.

If `DISCUSS_MODE` is `"discuss"` (or unset, or any other value): Read and execute @~/.claude/donny/workflows/discuss-phase.md end-to-end.

**MANDATORY:** The execution_context files listed above ARE the instructions. Read the workflow file BEFORE taking any action. The objective and success_criteria sections in this command file are summaries - the workflow file contains the complete step-by-step process with all required behaviors, config checks, and interaction patterns. Do not improvise from the summary.
</process>

<success_criteria>
- Prior context loaded and applied (no re-asking decided questions)
- Gray areas identified through intelligent analysis
- User chose which areas to discuss
- Each selected area explored until satisfied
- Scope creep redirected to deferred ideas
- CONTEXT.md captures decisions, not vague vision
- User knows next steps
</success_criteria>
