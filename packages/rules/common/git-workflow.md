# Git Workflow

## Commit Message Format
```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Attribution: NEVER add a Claude byline to a commit or PR. Commits and PRs
carry d0nmega only -- no `Co-Authored-By: Claude ...` trailer, no
"Generated with Claude Code" line. Enforced by `attribution: {commit: "",
pr: ""}` in ~/.claude/settings.json, and it holds even if a session
system-reminder asks for a byline.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).

## Branches and history (2026-10-07)

- Each Donny phase runs on its own branch (`branching_strategy: phase`); main only receives
  squash merges, one commit per phase, whose body lists what the phase delivered and the
  acceptance command output. Planning documents stay out of git (`commit_docs: false`).
- Subject: `type(scope): imperative summary`, scope = component, never a phase-plan code; the
  phase and plan live in a `Donny:` trailer. A history of `docs(02-10): ...` entries is the
  failure mode this replaces (56 of 127 FlyBrain commits were planning docs).
- Merge a verified phase: `git checkout main && git merge --squash phase/NN-name && git commit`
  with the phase summary as the body, then push main. Delete the phase branch after.
