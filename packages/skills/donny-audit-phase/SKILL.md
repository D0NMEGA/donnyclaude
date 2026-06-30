---
name: donny-audit-phase
description: "Retroactively audits a completed phase for security (threat mitigations from the PLAN.md threat model are implemented) and validation (Nyquist test coverage of the phase's requirements). Use after a phase is executed to confirm threats are closed and requirements are tested; runs both audits by default. --security or --validate narrows to one. Open threats block phase advancement."
argument-hint: "[phase] [--security|--validate]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

<objective>
Audit a completed phase across two dimensions, updating SECURITY.md and/or VALIDATION.md:

- **Security** - verify every threat in the PLAN.md threat model is mitigated (or accepted/transferred and documented). Open threats block advancement.
- **Validation** - audit Nyquist coverage: map requirements to tests, fill gaps, mark manual-only what can't be automated.

Default runs BOTH. `--security` / `--validate` narrows to one. Each dimension has its own config gate (`workflow.security_enforcement`, `workflow.nyquist_validation`).

Output: updated `{phase}-SECURITY.md` and/or `{phase}-VALIDATION.md` (plus generated tests).
</objective>

<execution_context>
@~/.claude/donny/workflows/audit-phase.md
</execution_context>

<context>
Phase: $ARGUMENTS - optional phase number, defaults to last completed phase. Optional scope flag:
- `--security` - security audit only
- `--validate` - validation audit only
- (none) or `--all` - both
</context>

<process>
Execute @~/.claude/donny/workflows/audit-phase.md end-to-end.
Preserve all workflow gates: scope resolution, per-dimension config gates, the shared phase-executed gate, both auditor spawns, the SECURITY.md filename guard, and the open-threats advancement block.
</process>
