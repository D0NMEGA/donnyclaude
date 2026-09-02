---
status: pass
agent: donny-tools verify gate
phase: XX-name
slug: name
verbs_run: 13
errors: 0
warnings: 0
not_yet: 0
not_applicable: 0
passed: 13
created: YYYY-MM-DD
---

# Phase XX - Record Gate

NOTE ON FORMAT: this file intentionally contains no bare `---` horizontal rules in its body.
Only the two frontmatter fence lines above use `---`. The engine's frontmatter parser
(`bin/lib/frontmatter.cjs:16-17`) treats every `---`/`---` pair in a file as a candidate
frontmatter block and prefers the LAST one, so a decorative section rule would make the real
frontmatter above silently unreadable. This is the same defect class the record gate exists to
catch, and `templates/SECURITY.md` currently has it.

## Verdict

The verdict is re-derived from the Verb Results table below on every read, never trusted from
the frontmatter above (D-11, the A6 ENFORCING GATE pattern). `status` is `fail` if and only if
at least one Verb Results row has Severity `error`. A hand-edited, stale or truncated
frontmatter verdict is non-authoritative by construction; a disagreement is reported as
`consistent: false` and the table wins.

Severities: `pass` (clean), `warning` (recorded, does not fail), `error` (fails the gate),
`not_applicable` (the check does not apply to this phase), `not_yet` (the input artifact
legitimately does not exist at this point in the phase lifecycle). The absence of this file
entirely is a sixth state, `not_run`, and never reads as a pass (D-10, GATE-02).

## Verb Results

| Verb | Scope | Targets | Severity | Detail |
|------|-------|---------|----------|--------|
| phase-completeness | phase | 1 | pass | |
| plan-graph | phase | 1 | pass | |
| phase-verified | phase | 1 | pass | |
| threats-clear | phase | 1 | pass | |
| ui-reviewed | phase | 1 | pass | |
| schema-drift | phase | 1 | pass | |
| milestone-coverage | phase | 1 | pass | |
| plan-structure | per-plan | 0 | pass | |
| references | per-plan | 0 | pass | |
| artifacts | per-plan | 0 | pass | |
| key-links | per-plan | 0 | pass | |
| verify-summary | per-summary | 0 | pass | |
| commits | phase | 1 | pass | |

## Findings

| Verb | Target | Severity | Finding |
|------|--------|----------|---------|

## Record Gate Audit Trail

| Run Date | Verbs | Errors | Warnings | Not yet | N/A | Verdict | Run By |
|----------|-------|--------|----------|---------|-----|---------|--------|
| YYYY-MM-DD | 13 | 0 | 0 | 0 | 0 | pass | donny-tools verify gate (context) |
