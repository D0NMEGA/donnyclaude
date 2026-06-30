<purpose>
Display the complete Donny command reference. Output ONLY the reference content. Do NOT add project-specific analysis, git status, next-step suggestions, or any commentary beyond the reference.
</purpose>

<reference>
# Donny command reference

Donny creates hierarchical project plans optimized for solo agentic development with Claude Code. It is a private workflow engine installed into `~/.claude/` from the donny repo.

## Quick start

1. `/donny-init` - initialize a project (questioning, optional research, requirements, roadmap)
2. `/donny-plan-phase 1` - create the plan for the first phase
3. `/donny-execute-phase 1` - execute the phase

Core loop: `/donny-init -> /donny-plan-phase -> /donny-execute-phase -> repeat`.

## Staying updated

Donny is a local fork - there is no npm self-update. Sync the install from the source repo:

```
/donny-update
```

It does a local git-tag version check against the donny repo, redeploys via the repo installer when the repo is ahead, and reapplies your local patches automatically.

---

## 1. Project setup

**`/donny-init [name]`** - start or extend a project through one unified flow. With no `.planning/PROJECT.md` it runs the new-project flow; with an existing PROJECT.md it starts a new milestone. `--milestone` forces the milestone flow; `--reset-phase-numbers` restarts numbering at Phase 1. Creates the `.planning/` artifacts (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json, optional research/).

**`/donny-map-codebase`** - map an existing codebase into `.planning/codebase/` (stack, architecture, structure, conventions, testing, integrations, concerns). Use before `/donny-init` on brownfield projects.

## 2. Phase pipeline

**`/donny-discuss-phase <n>`** - capture your vision for a phase and surface the key assumptions before planning (writes CONTEXT.md). `--auto` picks defaults, `--chain` continues into plan+execute, `--power` bulk-generates questions, `--batch[=k]` groups questions.

**`/donny-research-phase <n>`** - deep ecosystem research for niche or complex domains (writes RESEARCH.md). Usually `/donny-plan-phase` triggers research for you; use this standalone for specialized domains.

**`/donny-plan-phase <n>`** - create the detailed execution plan(s) for a phase (`XX-YY-PLAN.md`). `--prd path` locks a PRD as decisions and skips discuss; `--reviews` folds in cross-AI review feedback.

**`/donny-execute-phase <n>`** - execute all plans in a phase, grouped into waves and run in parallel within each wave. `--wave N` runs only one wave.

## 3. Roadmap & backlog

**`/donny-phase-add <description> [--after N]`** - append a new phase to the milestone, or with `--after N` insert a decimal phase (e.g. 7.1) between existing phases.

**`/donny-remove-phase <n>`** - remove a future (unstarted) phase and renumber the rest. `--dry-run` previews the renumbering first.

**`/donny-add-backlog <description>`** - park an unsequenced idea in the 999.x backlog parking lot.

**`/donny-review-backlog`** - review every backlog item and promote, keep, or remove each.

## 4. Quick tasks & routing

**`/donny-do <text>`** - route freeform natural language to the right Donny command (a dispatcher; never does the work itself).

**`/donny-quick [description]`** - handle a small, ad-hoc task. Trivial one-liners run inline (no subagents, no planning files); larger tasks spawn planner + executor under `.planning/quick/`. `--full`, `--validate`, `--discuss`, `--research` add quality steps.

**`/donny-next`** - automatically advance to the next logical step in the workflow.

**`/donny-autonomous`** - run all remaining phases autonomously (discuss -> plan -> execute per phase).

## 5. Capture

**`/donny-capture [note|todo|todos|promote] [text|area|N]`** - one capture surface. Default (free text) saves a zero-friction note; `todo` captures a structured todo (committed); `todos [area]` lists and acts on pending todos; `promote <N>` turns a note into a todo. `--global` stores notes outside any project.

**`/donny-thread [name|description]`** - create, list, or resume a lightweight cross-session context thread for work that spans sittings but is not yet a phase.

**`/donny-plant-seed [idea]`** - capture a forward-looking idea with trigger conditions; it surfaces automatically during `/donny-init` when the milestone scope matches.

## 6. Verification & review

**`/donny-verify-work [phase]`** - validate built features through conversational UAT, diagnosing failures into fix plans.

**`/donny-audit-phase [n] [--security|--validate]`** - retroactively audit a completed phase. Runs both the threat-mitigation and Nyquist-validation audits by default; the flags narrow to one.

**`/donny-audit-uat`** - cross-phase audit of all outstanding UAT and verification items; produces a prioritized human test plan.

**`/donny-add-tests <phase>`** - generate tests for a completed phase from its UAT criteria and implementation.

**`/donny-review [--phase N] [--gemini|--claude|--codex|--coderabbit|--opencode|--all]`** - cross-AI peer review of phase plans via external CLIs, written to REVIEWS.md. The phase defaults to the current phase in STATE.md.

**`/donny-analyze-dependencies`** - analyze phase dependencies and suggest `Depends on` entries for ROADMAP.md.

## 7. Milestones

**`/donny-complete-milestone <version>`** - archive a completed milestone (MILESTONES.md entry, archived details, git tag) and prepare for the next version.

**`/donny-audit-milestone [version]`** - audit milestone completion against the original intent; writes MILESTONE-AUDIT.md.

**`/donny-plan-milestone-gaps`** - turn the gaps from a milestone audit into roadmap phases.

**`/donny-milestone-summary`** - generate a project summary from milestone artifacts for onboarding and review.

**`/donny-cleanup`** - archive accumulated phase directories from completed milestones. `--dry-run` previews before moving anything.

## 8. Session & state

**`/donny-progress`** - check status and route to the next action; shows the progress bar and numeric stats inline.

**`/donny-resume-work`** - restore full context from a previous session.

**`/donny-pause-work`** - write a context handoff when pausing mid-phase.

**`/donny-session-report`** - generate a session report with token-usage estimates and a work summary.

**`/donny-debug [issue]`** - systematic debugging with state that survives `/clear`. Run with no args to resume the active session.

**`/donny-forensics`** - post-mortem investigation of a failed workflow, scoped to the current milestone.

**`/donny-health`** - diagnose `.planning/` health (orphans, platform issues) and optionally repair.

## 9. UI

**`/donny-ui-phase <n>`** - generate a UI design contract (UI-SPEC.md) that locks spacing, typography, color, and copy for a frontend phase.

**`/donny-ui-review`** - retroactive 6-pillar visual audit of implemented frontend code.

## 10. Ship & parallel work

**`/donny-ship [phase]`** - create a clean PR from a completed phase. Filters `.planning/` commits out of the PR history by default, generates the body from SUMMARY/VERIFICATION/REQUIREMENTS, and can request review. `--draft` opens a draft PR.

**`/donny-env-new`**, **`/donny-env-list`**, **`/donny-env-remove`** - create, list, and remove isolated workspaces (repo copies with their own `.planning/`) for parallel work.

**`/donny-workstreams`** - manage parallel workstreams (list, create, switch, status, complete, resume).

**`/donny-manager`** - interactive command center for driving multiple phases from one terminal.

## 11. Config & meta

**`/donny-settings [profile]`** - configure workflow toggles and the model profile. No argument runs the interactive flow; a profile name (`quality`/`balanced`/`budget`/`inherit`) switches the model profile directly.

**`/donny-profile-user [--questionnaire] [--refresh]`** - build a developer behavioral profile from session analysis (or a questionnaire) and write artifacts that personalize Claude.

**`/donny-docs-update [--verify-only|--force]`** - generate or update project documentation (README, ARCHITECTURE, API, and more), each file fact-checked against the live codebase by subagents.

**`/donny-update`** - sync the install from the local donny repo (git-tag check, no npm) and reapply local patches atomically.

**`/donny-help`** - show this reference.

---

## Files & structure

```
.planning/
├── PROJECT.md            # Project vision
├── ROADMAP.md            # Current phase breakdown
├── STATE.md              # Project memory & context
├── config.json           # Workflow toggles, model profile, gates
├── notes/                # Quick notes (/donny-capture)
├── threads/              # Cross-session context threads (/donny-thread)
├── seeds/                # Planted seeds (/donny-plant-seed)
├── todos/
│   ├── pending/          # Todos waiting to be worked on
│   └── completed/        # Todos picked up for work
├── debug/                # Active debug sessions (resolved/ when archived)
├── quick/                # Ad-hoc /donny-quick tasks
├── milestones/           # Archived roadmaps, requirements, and phase dirs
├── codebase/             # Codebase map (brownfield projects)
└── phases/
    └── 01-foundation/
        ├── 01-01-PLAN.md
        └── 01-01-SUMMARY.md
```

## Planning configuration

Set in `.planning/config.json` (see `/donny-settings`):

- `planning.commit_docs` (default `true`) - commit planning artifacts to git. Set `false` to keep `.planning/` local-only (add it to `.gitignore`).
- `planning.search_gitignored` (default `false`) - add `--no-ignore` to broad searches when `.planning/` is gitignored.

## Common workflows

Starting a project:

```
/donny-init
/clear
/donny-plan-phase 1
/clear
/donny-execute-phase 1
```

Adding urgent mid-milestone work:

```
/donny-phase-add "Critical security fix" --after 5
/donny-plan-phase 5.1
/donny-execute-phase 5.1
```

Capturing and reviewing ideas during work:

```
/donny-capture fix the modal z-index        # quick note
/donny-capture todo add auth token refresh   # structured todo
/donny-capture todos api                      # review todos in the api area
```

## Getting help

- Read `.planning/PROJECT.md` for vision and `.planning/STATE.md` for current context
- Run `/donny-progress` to see where you are and what is next
</reference>
