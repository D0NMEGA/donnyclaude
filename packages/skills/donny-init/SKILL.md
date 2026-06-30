---
name: donny-init
description: "Initialize Donny planning for a project: bootstrap a brand-new project (deep questioning, optional research, requirements, roadmap) or start the next milestone on an existing one. Auto-detects greenfield vs. brownfield from .planning/PROJECT.md presence. Use when starting a project from scratch, kicking off a new milestone or version cycle, or running the first Donny setup in a repo. The --milestone flag forces milestone mode; --auto runs the greenfield flow unattended from an idea document."
argument-hint: "[milestone name] [--milestone] [--auto] [--reset-phase-numbers] [--ws <name>]"
allowed-tools:
  - Read
  - Bash
  - Write
  - Task
  - AskUserQuestion
---

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`. They are equivalent - `vscode_askquestions` is the VS Code Copilot implementation of the same interactive question API.
</runtime_note>

<objective>
Initialize a project through one unified entry point. The workflow auto-selects between two flows:

- **New project (greenfield)** - no `.planning/PROJECT.md`. Runs questioning -> research (optional) -> requirements -> roadmap.
- **New milestone (brownfield)** - `.planning/PROJECT.md` exists. Loads history, gathers next-milestone goals, updates PROJECT.md/STATE.md, then requirements -> roadmap.

**Routing:** `--milestone` forces the milestone flow; otherwise the presence of `.planning/PROJECT.md` selects brownfield, its absence selects greenfield.

**Creates / updates:**
- `.planning/PROJECT.md` - project context (created greenfield, updated per milestone)
- `.planning/config.json` - workflow preferences (greenfield)
- `.planning/research/` - domain research (optional)
- `.planning/REQUIREMENTS.md` - scoped requirements
- `.planning/ROADMAP.md` - phase structure
- `.planning/STATE.md` - project memory

**After this command:** Run `/donny-discuss-phase [N]` (or `/donny-plan-phase [N]`) to start execution.
</objective>

<context>
**Flags:**
- `--milestone` - Force the new-milestone flow even if detection is ambiguous.
- `--auto` - Greenfield only. Skip interactive questioning; expects an idea document via `@file.md` or pasted text.
- `--reset-phase-numbers` - Milestone flow only. Restart roadmap phase numbering at 1 instead of continuing.
- Optional first argument: milestone name (milestone flow; prompts if omitted).

Project and milestone context files are resolved inside the workflow (`init new-project` / `init new-milestone`).
</context>

<execution_context>
@~/.claude/donny/workflows/init.md
@~/.claude/donny/references/questioning.md
@~/.claude/donny/references/ui-brand.md
@~/.claude/donny/templates/project.md
@~/.claude/donny/templates/requirements.md
</execution_context>

<process>
Execute the init workflow from @~/.claude/donny/workflows/init.md end-to-end.
First run the routing step (Section 0) to pick the flow, then run only that flow's steps.
Preserve all workflow gates (validation, questioning, research, requirements, roadmap approval, commits, routing).
</process>
