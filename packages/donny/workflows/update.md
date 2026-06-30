<purpose>
Sync the installed Donny toolkit in `~/.claude/` with the local donny source repo, then restore any
local modifications the redeploy overwrote - in one atomic command.

This is a private fork: the npm self-update cord is cut. The version check is LOCAL and git-based
(the repo's git tag / HEAD versus what was last deployed). There is no `npm view`, no `npx`, no
network. On any redeploy the workflow ALWAYS reapplies local patches at the end (the former
reapply-patches step, folded in), so there is never a separate command or reminder.

**Critical invariant:** if a backed-up file differs from the freshly deployed file, that difference
is either a deliberate local edit (preserve it) or an upstream change (accept it). Never silently
drop a difference - when a pristine baseline cannot disambiguate, flag it as a CONFLICT for the user.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="locate_repo">
Find the donny source repo (the dogfood source of truth). The installed toolkit lives at
`$HOME/.claude/donny`; the source repo is separate and git-versioned.

```bash
CLAUDE_DIR="$HOME/.claude"
INSTALL_DIR="$CLAUDE_DIR/donny"

REPO=""
for cand in "$DONNY_REPO" "$HOME/Developer/donny" "$HOME/donny" "$HOME/src/donny" "$HOME/code/donny" "$HOME/projects/donny"; do
  if [ -n "$cand" ] && [ -f "$cand/install.mjs" ] && [ -f "$cand/engine/VERSION" ]; then
    REPO="$cand"
    break
  fi
done
echo "REPO=$REPO"
```

**If no repo found:**
```
Could not find the donny source repo.

Set DONNY_REPO to its path (the directory containing install.mjs), then run /donny-update again.
```
Exit.
</step>

<step name="version_check">
Local git-tag version check - no npm.

```bash
# Installed engine version + the git ref recorded at the last deploy.
INSTALLED_VERSION="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo "0.0.0")"
INSTALL_REF="$(cat "$INSTALL_DIR/.install-ref" 2>/dev/null || echo "")"

# Repo version: pinned engine version + git identity (tag if tagged, else short commit).
REPO_VERSION="$(cat "$REPO/engine/VERSION" 2>/dev/null || echo "0.0.0")"
REPO_DESC="$(git -C "$REPO" describe --tags --always --dirty 2>/dev/null || echo "")"
REPO_HEAD="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "")"

echo "installed: $INSTALLED_VERSION  ref=$INSTALL_REF"
echo "repo:      $REPO_VERSION  desc=$REPO_DESC  head=$REPO_HEAD"
```

Decide whether an update is available:
- If `REPO_VERSION` != `INSTALLED_VERSION` -> **available** (engine pin changed).
- Else if `INSTALL_REF` is set and `INSTALL_REF` != `REPO_HEAD` -> **available** (repo advanced since the last deploy).
- Else if `INSTALL_REF` is empty -> **baseline not recorded** - offer a redeploy to sync and record the ref (treat as available).
- Else -> **up to date**.

**If up to date:**
```
## Donny is up to date

Installed: {INSTALLED_VERSION} ({REPO_DESC})
Nothing to redeploy.
```
Exit.
</step>

<step name="show_changes_and_confirm">
Show what changed BEFORE redeploying.

```bash
if [ -n "$INSTALL_REF" ] && git -C "$REPO" cat-file -e "$INSTALL_REF" 2>/dev/null; then
  git -C "$REPO" log --oneline --no-merges "$INSTALL_REF"..HEAD
else
  git -C "$REPO" log --oneline --no-merges -15
fi
```

If `$REPO/CHANGELOG.md` exists, also show its top section. Then display the redeploy notice and ask:

```
## Donny update available

Installed: {INSTALLED_VERSION}  (ref {INSTALL_REF:-none recorded})
Repo:      {REPO_VERSION}  ({REPO_DESC})

### Commits to deploy
{git log output above}

Note: the installer redeploys these folders into ~/.claude and backs up anything it overwrites:
- donny/            (engine: workflows, bin, references)  -> ~/.claude/donny
- agents/donny-*    -> ~/.claude/agents
- skills/donny-*    -> ~/.claude/skills
- hooks/donny-*     -> ~/.claude/hooks

Backups are written next to each target as *.bak-donny-<timestamp>. Any local edits you made to the
installed copies will be reapplied after the redeploy. Files outside donny-* are never touched.
```

Use AskUserQuestion:
- Question: "Redeploy donny from the local repo?"
- Options: "Yes, redeploy now" / "No, cancel"

**If the user cancels:** Exit.
</step>

<step name="redeploy">
Run the repo installer (idempotent; it backs up anything it overwrites):

```bash
node "$REPO/install.mjs"
```

Capture the output - it lists each `*.bak-donny-<timestamp>` it created. If the install fails, show
the error and exit WITHOUT recording a new install ref.
</step>

<step name="reapply_patches">
**Always runs after a successful redeploy - atomic, no separate command.** Restore any local edits the
redeploy overwrote, using three-way merge. Scope is Claude-only (`~/.claude`); there is no multi-runtime
probing in this fork.

## 1. Find the backups from this deploy

The installer backed up each overwritten target to `<target>.bak-donny-<stamp>`. Collect the newest set:

```bash
# Newest engine snapshot from this deploy (portable; no bash-4 mapfile):
ENGINE_BAK="$(ls -d "$INSTALL_DIR".bak-donny-* 2>/dev/null | sort | tail -1)"
# Per-item agent/skill/hook snapshots from this deploy - list them and treat each as a backed-up item:
ls -d "$CLAUDE_DIR"/agents/donny-*.bak-donny-* \
      "$CLAUDE_DIR"/skills/donny-*.bak-donny-* \
      "$CLAUDE_DIR"/hooks/donny-*.bak-donny-* 2>/dev/null
```

Also honor a legacy `~/.claude/donny-local-patches/` directory (with `backup-meta.json`) if one exists
from an older flow - treat each file it lists the same way below.

**If there are no backups:** the redeploy overwrote nothing you had modified. Skip to step 3.

## 2. Three-way merge each backed-up file

For each backed-up file, compare it to the freshly deployed counterpart at the same relative path:

- **Backup == deployed** -> nothing was customized; skip.
- **Backup != deployed** -> isolate the change with a pristine baseline:
  - **Pristine baseline** = the repo's version of that file at the previously deployed commit:
    ```bash
    git -C "$REPO" show "$INSTALL_REF:{repo_relative_path}" 2>/dev/null
    ```
    (Available only when `INSTALL_REF` is set and the path existed then.)
  - **User version** = the backup copy.
  - **New version** = the freshly deployed file.

  Merge rules:
  - Changed only by the user (vs pristine) -> keep the user's version.
  - Changed only upstream (vs pristine) -> accept the new version (already in place).
  - Changed by both -> **CONFLICT**: show both, ask the user how to resolve.
  - No pristine baseline available -> present the diff and ask whether the backup held intentional edits; do NOT silently discard it.

  Write the merged result to the installed location.

When mapping a backup back to a repo-relative path: the engine snapshot maps to `engine/...`
(e.g. `~/.claude/donny/workflows/help.md` -> `engine/workflows/help.md`); an
`agents/donny-x.bak-...` maps to `agents/donny-x`; likewise for `skills/` and `hooks/`.

## 3. Report per file

```
| File | Result | Local changes preserved |
|------|--------|-------------------------|
| {path} | Merged | {summary} |
| {path} | Unchanged | (identical to deploy) |
| {path} | Conflict resolved | {choice} |
```

## 4. Offer cleanup

Ask whether to delete the `*.bak-donny-*` snapshots now that patches are reapplied, or keep them for reference.
</step>

<step name="record_ref">
Record the deployed commit so the next `/donny-update` can diff against it:

```bash
git -C "$REPO" rev-parse HEAD > "$INSTALL_DIR/.install-ref" 2>/dev/null || true
```
</step>

<step name="display_result">
```
╔═══════════════════════════════════════════════════════════╗
║  Donny redeployed: {INSTALLED_VERSION} -> {REPO_VERSION} ({REPO_DESC})
╚═══════════════════════════════════════════════════════════╝

Local patches reapplied: {merged_count} merged, {conflict_count} conflicts resolved.

Restart your runtime to pick up the new commands.
```
</step>

</process>

<success_criteria>
- [ ] Source repo located (DONNY_REPO or a known path); no npm/npx/network call anywhere
- [ ] Version decided by a local git-tag/HEAD comparison against the recorded install ref
- [ ] Up-to-date case exits cleanly; available case shows the git commit changelog before confirming
- [ ] Redeploy runs `node install.mjs` and aborts on failure without recording a new ref
- [ ] Local patches reapplied automatically and atomically after redeploy (no separate command)
- [ ] No backed-up difference silently dropped; ambiguous ones surfaced as CONFLICT
- [ ] New install ref recorded after a successful redeploy
</success_criteria>
