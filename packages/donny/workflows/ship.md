<purpose>
Create a pull request from completed phase/milestone work, generate a rich PR body from planning artifacts, optionally run code review, and prepare for merge. Closes the plan -> execute -> verify -> ship loop.

By default the PR gets a clean history: commits that touch only `.planning/` are dropped and `.planning/` files are stripped from mixed commits, so reviewers see code, not Donny planning artifacts. This is built into ship - no separate branch-cleaning command. Pass `--include-planning` to ship the branch exactly as it is.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="initialize">
Parse arguments and load project state:

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse from init JSON: `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `padded_phase`, `commit_docs`.

Also load config for branching strategy:
```bash
CONFIG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" state load)
```

Extract: `branching_strategy`, `branch_name`.

Detect base branch for PRs and merges:
```bash
BASE_BRANCH=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get git.base_branch 2>/dev/null || echo "")
if [ -z "$BASE_BRANCH" ] || [ "$BASE_BRANCH" = "null" ]; then
  BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|^refs/remotes/origin/||')
  BASE_BRANCH="${BASE_BRANCH:-main}"
fi
```
</step>

<step name="preflight_checks">
Verify the work is ready to ship:

1. **Verification passed? (engine-enforced, BLOCKING gate)**
   ```bash
   node "$HOME/.claude/donny/bin/donny-tools.cjs" verify phase-verified "${phase_dir}"
   ```
   Returns `{ verified, status, score, phase }` by parsing VERIFICATION.md's `status` field, not mere file existence.
   - `verified: true` (status `passed`): proceed.
   - status `human_needed`: proceed ONLY after explicit user approval.
   - status `gaps_found` / `partial` / `failed`, or `missing`: STOP. Do not push or open a PR - the phase is not verified. Tell the user to run `/donny-verify-work` first. Continue only if the user explicitly passes `--allow-unverified`, and if so the PR body MUST report the real `status`, never "Verified".

2. **Clean working tree?**
   ```bash
   git status --short
   ```
   If uncommitted changes exist: ask user to commit or stash first.

3. **On correct branch?**
   ```bash
   CURRENT_BRANCH=$(git branch --show-current)
   ```
   If on `${BASE_BRANCH}`: warn - should be on a feature branch.
   If branching_strategy is `none`: offer to create a branch now.

4. **Remote configured?**
   ```bash
   git remote -v | head -2
   ```
   Detect `origin` remote. If no remote: error - can't create PR.

5. **`gh` CLI available?**
   ```bash
   which gh && gh auth status 2>&1
   ```
   If `gh` not found or not authenticated: provide setup instructions and exit.
</step>

<step name="clean_pr_branch">
**Default: build a clean PR history (skip with `--include-planning`).**

Reviewers should see code, not planning artifacts. The branch that gets pushed and opened as the PR is `$PUSH_BRANCH`:

```bash
PUSH_BRANCH="${CURRENT_BRANCH}"   # default: ship the branch as-is
```

**If `--include-planning` was passed:** leave `PUSH_BRANCH` as `${CURRENT_BRANCH}` and skip the rest of this step.

**Otherwise rebuild a clean history onto `${BASE_BRANCH}`:**

1. Classify the commits ahead of the base (oldest -> newest). A commit is *planning-only* when every file it touches is under `.planning/`; anything else is a *code commit* (mixed commits count as code and are included):
```bash
AHEAD=$(git rev-list --count "${BASE_BRANCH}".."${CURRENT_BRANCH}" 2>/dev/null || echo 0)
CODE_COMMITS=()
for HASH in $(git rev-list --reverse "${BASE_BRANCH}".."${CURRENT_BRANCH}"); do
  NONPLAN=$(git diff-tree --no-commit-id --name-only -r "$HASH" | grep -vc '^\.planning/')
  [ "$NONPLAN" -gt 0 ] && CODE_COMMITS+=("$HASH")
done
```
If `AHEAD` is 0, skip this step. If every commit was planning-only (`CODE_COMMITS` empty), there is no code to review - warn the user and ask whether to ship the original branch (proceed with `PUSH_BRANCH=${CURRENT_BRANCH}`) or abort.

2. Create the clean branch from the base and replay the code commits, stripping any `.planning/` files that ride along in mixed commits:
```bash
PR_BRANCH="${CURRENT_BRANCH}-pr"
git branch -D "$PR_BRANCH" 2>/dev/null || true      # rebuild fresh if it already exists
git checkout -b "$PR_BRANCH" "${BASE_BRANCH}"
SKIPPED=()
for HASH in "${CODE_COMMITS[@]}"; do
  if git cherry-pick --no-commit "$HASH" 2>/dev/null; then
    git rm -r --cached --ignore-unmatch .planning/ >/dev/null 2>&1 || true   # drop planning from mixed commits
    git commit -C "$HASH" --no-verify
  else
    : # CONFLICT - handled in step 3, do NOT leave the branch half-built
  fi
done
```

3. **Conflict resolution - in the loop, never a dead end.** Whenever a cherry-pick stops with a conflict, do NOT abandon the run. Show the conflicting commit and its conflicted paths (`git diff --name-only --diff-filter=U`) and ask via AskUserQuestion:
   - **Resolve now** - resolve the conflicts (drop `.planning/` hunks, keep the code), then `git add` the resolved code files, `git rm -r --cached --ignore-unmatch .planning/`, `git commit -C "$HASH"`, and continue with the next commit.
   - **Skip this commit** - `git cherry-pick --abort` (or `git reset --hard HEAD`), append `$HASH` to `SKIPPED`, and continue. Skipped commits are reported at the end so nothing vanishes silently.
   - **Abort clean history** - `git cherry-pick --abort`, `git checkout "${CURRENT_BRANCH}"`, `git branch -D "$PR_BRANCH"`, set `PUSH_BRANCH="${CURRENT_BRANCH}"`, and fall back to shipping the original branch (note this in the report).

4. Return to the original branch and target the clean branch for the PR:
```bash
git checkout "${CURRENT_BRANCH}"
PUSH_BRANCH="$PR_BRANCH"
```

5. Verify the clean branch carries no planning files, and report:
```bash
PLANNING_LEFT=$(git diff --name-only "${BASE_BRANCH}".."${PR_BRANCH}" | grep -c '^\.planning/' || true)
PR_COMMITS=$(git rev-list --count "${BASE_BRANCH}".."${PR_BRANCH}")
```
Report the clean branch name, `PR_COMMITS`, `PLANNING_LEFT` (should be 0), and any `SKIPPED` commits.
</step>

<step name="push_branch">
Push the PR branch to remote:

```bash
git push origin ${PUSH_BRANCH} 2>&1
```

If push fails (e.g., no upstream): set upstream:
```bash
git push --set-upstream origin ${PUSH_BRANCH} 2>&1
```

Report: "Pushed `{PUSH_BRANCH}` to origin ({commit_count} commits ahead of ${BASE_BRANCH})"
</step>

<step name="generate_pr_body">
Auto-generate a rich PR body from planning artifacts:

**1. Title:**
```
Phase {phase_number}: {phase_name}
```
Or for milestone: `Milestone {version}: {name}`

**2. Summary section:**
Read ROADMAP.md for phase goal. Read VERIFICATION.md for verification status.

```markdown
## Summary

**Phase {N}: {Name}**
**Goal:** {goal from ROADMAP.md}
**Status:** {real status from the preflight verify phase-verified gate - "Verified" ONLY when status is `passed`; otherwise the actual status, e.g. "Human verification needed" or "Gaps found". Never print "Verified" for an unverified phase.}

{One paragraph synthesized from SUMMARY.md files - what was built}
```

**3. Changes section:**
For each SUMMARY.md in the phase directory:
```markdown
## Changes

### Plan {plan_id}: {plan_name}
{one_liner from SUMMARY.md frontmatter}

**Key files:**
{key-files.created and key-files.modified from SUMMARY.md frontmatter}
```

**4. Requirements section:**
```markdown
## Requirements Addressed

{REQ-IDs from plan frontmatter, linked to REQUIREMENTS.md descriptions}
```

**5. Testing section:**
```markdown
## Verification

- {`[x]` only if status is `passed`, else `[ ]`} Automated verification: {real status from VERIFICATION.md}
- {human verification items from VERIFICATION.md, if any}
```

**6. Decisions section:**
```markdown
## Key Decisions

{Decisions from STATE.md accumulated context relevant to this phase}
```
</step>

<step name="create_pr">
Create the PR using the generated body:

```bash
gh pr create \
  --title "Phase ${PHASE_NUMBER}: ${PHASE_NAME}" \
  --body "${PR_BODY}" \
  --base ${BASE_BRANCH} \
  --head ${PUSH_BRANCH}
```

If `--draft` flag was passed: add `--draft`.

Report: "PR #{number} created: {url}"
</step>

<step name="optional_review">
Ask if user wants to trigger a code review:

```
AskUserQuestion:
  question: "PR created. Run a code review before merge?"
  options:
    - label: "Skip review"
      description: "PR is ready - merge when CI passes"
    - label: "Self-review"
      description: "I'll review the diff in the PR myself"
    - label: "Request review"
      description: "Request review from a teammate"
```

**If "Request review":**
```bash
gh pr edit ${PR_NUMBER} --add-reviewer "${REVIEWER}"
```

**If "Self-review":**
Report the PR URL and suggest: "Review the diff at {url}/files"
</step>

<step name="track_shipping">
Update STATE.md to reflect the shipping action:

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" state update "Last Activity" "$(date +%Y-%m-%d)"
node "$HOME/.claude/donny/bin/donny-tools.cjs" state update "Status" "Phase ${PHASE_NUMBER} shipped - PR #${PR_NUMBER}"
```

If `commit_docs` is true:
```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs(${padded_phase}): ship phase ${PHASE_NUMBER} - PR #${PR_NUMBER}" --files .planning/STATE.md
```
</step>

<step name="report">
```
───────────────────────────────────────────────────────────────

## ✓ Phase {X}: {Name} - Shipped

PR: #{number} ({url})
Branch: {branch} -> ${BASE_BRANCH}
Commits: {count}
Verification: {real status from the phase-verified gate - "Passed" only when status is `passed`}
Requirements: {N} REQ-IDs addressed

Next steps:
- Review/approve PR
- Merge when CI passes
- /donny-complete-milestone (if last phase in milestone)
- /donny-progress (to see what's next)

───────────────────────────────────────────────────────────────
```
</step>

</process>

<offer_next>
After shipping:

- /donny-complete-milestone - if all phases in milestone are done
- /donny-progress - see overall project state
- /donny-execute-phase {next} - continue to next phase
</offer_next>

<success_criteria>
- [ ] Preflight checks passed (verification, clean tree, branch, remote, gh)
- [ ] Clean PR history built by default (planning-only commits dropped, `.planning/` stripped from mixed commits); `--include-planning` ships the branch as-is
- [ ] Cherry-pick conflicts resolved in the loop (resolve / skip / abort) - never left half-built; skipped commits reported
- [ ] PR branch pushed to remote and used as the PR head
- [ ] PR created with rich auto-generated body
- [ ] STATE.md updated with shipping status
- [ ] User knows PR number and next steps
</success_criteria>
