---
name: donny-add-backlog
description: "Adds an idea to the backlog parking lot using 999.x numbering, kept outside the active phase sequence so it accumulates context without being scheduled. Use when an idea is worth keeping but not ready to plan into the current milestone."
argument-hint: "<description>"
allowed-tools:
  - Read
  - Write
  - Bash
---


<objective>
Add a backlog item to the roadmap using 999.x numbering. Backlog items are
unsequenced ideas that aren't ready for active planning - they live outside
the normal phase sequence and accumulate context over time.
</objective>

<process>

1. **Read ROADMAP.md** to find existing backlog entries. Use the Read tool on
   `.planning/ROADMAP.md` (not `cat` - ROADMAP.md often holds non-ASCII content that
   BSD tools treat as binary).

2. **Find next backlog number:**
   ```bash
   NEXT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" phase next-decimal 999 --raw)
   ```
   If no 999.x phases exist, start at 999.1.

3. **Create the phase directory:**
   ```bash
   SLUG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" generate-slug "$ARGUMENTS" --raw)
   mkdir -p ".planning/phases/${NEXT}-${SLUG}"
   touch ".planning/phases/${NEXT}-${SLUG}/.gitkeep"
   ```

4. **Add to ROADMAP.md** under a `## Backlog` section. If the section doesn't exist, create it at the end:

   ```markdown
   ## Backlog

   ### Phase {NEXT}: {description} (BACKLOG)

   **Goal:** [Captured for future planning]
   **Requirements:** TBD
   **Plans:** 0 plans

   Plans:
   - [ ] TBD (promote with /donny-review-backlog when ready)
   ```

5. **Commit:**
   ```bash
   node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs: add backlog item ${NEXT} - ${ARGUMENTS}" --files .planning/ROADMAP.md ".planning/phases/${NEXT}-${SLUG}/.gitkeep"
   ```

6. **Report:**
   ```
   ## Backlog item added

   Phase {NEXT}: {description}
   Directory: .planning/phases/{NEXT}-{slug}/

   This item lives in the backlog parking lot.
   Use /donny-discuss-phase {NEXT} to explore it further.
   Use /donny-review-backlog to promote items to active milestone.
   ```

</process>

<notes>
- 999.x numbering keeps backlog items out of the active phase sequence
- Phase directories are created immediately, so /donny-discuss-phase and /donny-plan-phase work on them
- No `Depends on:` field - backlog items are unsequenced by definition
- Sparse numbering is fine (999.1, 999.3) - always uses next-decimal
</notes>
