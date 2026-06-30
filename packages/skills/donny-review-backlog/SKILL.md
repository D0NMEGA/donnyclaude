---
name: donny-review-backlog
description: "Reviews every 999.x backlog item one by one and promotes, keeps, or removes each. Use when clearing the backlog parking lot into the active milestone, typically before starting or planning a new milestone."
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---


<objective>
Review all 999.x backlog items and optionally promote them into the active
milestone sequence or remove stale entries.
</objective>

<process>

1. **List backlog items:**
   ```bash
   ls -d .planning/phases/999* 2>/dev/null || echo "No backlog items found"
   ```

2. **Read ROADMAP.md** and extract all 999.x phase entries. Use the Read tool on
   `.planning/ROADMAP.md` (not `cat` - it often holds non-ASCII content BSD tools treat as binary).
   Show each backlog item with its description, any accumulated context (CONTEXT.md, RESEARCH.md), and creation date.

3. **Present the list to the user** via AskUserQuestion:
   - For each backlog item, show: phase number, description, accumulated artifacts
   - Options per item: **Promote** (move to active), **Keep** (leave in backlog), **Remove** (delete)

4. **For items to PROMOTE:**
   - Allocate the next sequential phase number in the active milestone:
     ```bash
     NEW_NUM=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" phase add "${DESCRIPTION}" --raw)
     NEW_SLUG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" generate-slug "${DESCRIPTION}" --raw)
     ```
   - Rename the directory and carry accumulated artifacts with it (concrete command, not prose):
     ```bash
     git mv ".planning/phases/${OLD_DIR}" ".planning/phases/${NEW_NUM}-${NEW_SLUG}" 2>/dev/null \
       || mv ".planning/phases/${OLD_DIR}" ".planning/phases/${NEW_NUM}-${NEW_SLUG}"
     ```
   - Update ROADMAP.md: move the entry from `## Backlog` to the active phase list
   - Remove the `(BACKLOG)` marker
   - Add an appropriate `**Depends on:**` field

5. **For items to REMOVE:**
   - Delete the phase directory
   - Remove the entry from ROADMAP.md `## Backlog` section

6. **Commit changes:**
   ```bash
   node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs: review backlog - promoted N, removed M" --files .planning/ROADMAP.md
   ```

7. **Report summary:**
   ```
   ## Backlog review complete

   Promoted: {list of promoted items with new phase numbers}
   Kept: {list of items remaining in backlog}
   Removed: {list of deleted items}
   ```

</process>
