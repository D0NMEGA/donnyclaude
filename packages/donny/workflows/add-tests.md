<purpose>
Generate unit and E2E tests for a completed phase based on its SUMMARY.md, CONTEXT.md, and implementation. Classifies each changed file into TDD (unit), E2E (browser), or Skip categories, presents a test plan for user approval, then generates tests following RED-GREEN conventions.

Users currently hand-craft `/donny-quick` prompts for test generation after each phase. This workflow standardizes the process with proper classification, quality gates, and gap reporting.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_arguments">
Parse `$ARGUMENTS` for:
- Phase number (integer, decimal, or letter-suffix) -> store as `$PHASE_ARG`
- Remaining text after phase number -> store as `$EXTRA_INSTRUCTIONS` (optional)

Example: `/donny-add-tests 12 focus on edge cases` -> `$PHASE_ARG=12`, `$EXTRA_INSTRUCTIONS="focus on edge cases"`

If no phase argument provided:

```
ERROR: Phase number required
Usage: /donny-add-tests <phase> [additional instructions]
Example: /donny-add-tests 12
Example: /donny-add-tests 12 focus on edge cases in the pricing module
```

Exit.
</step>

<step name="init_context">
Load phase operation context:

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract from init JSON: `phase_dir`, `phase_number`, `phase_name`.

Verify the phase directory exists. If not:
```
ERROR: Phase directory not found for phase ${PHASE_ARG}
Ensure the phase exists in .planning/phases/
```
Exit.

Read the phase artifacts (in order of priority):
1. `${phase_dir}/*-SUMMARY.md` - what was implemented, files changed
2. `${phase_dir}/CONTEXT.md` - acceptance criteria, decisions
3. `${phase_dir}/*-VERIFICATION.md` - user-verified scenarios (if UAT was done)

If no SUMMARY.md exists:
```
ERROR: No SUMMARY.md found for phase ${PHASE_ARG}
This command works on completed phases. Run /donny-execute-phase first.
```
Exit.

Present banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► ADD TESTS - Phase ${phase_number}: ${phase_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

<step name="analyze_implementation">
Extract the list of files modified by the phase from SUMMARY.md ("Files Changed" or equivalent section).

For each file, classify into one of three categories:

| Category | Criteria | Test Type |
|----------|----------|-----------|
| **TDD** | Pure functions where `expect(fn(input)).toBe(output)` is writable | Unit tests |
| **E2E** | UI behavior verifiable by browser automation | Playwright/E2E tests |
| **Skip** | Not meaningfully testable or already covered | None |

**TDD classification - apply when:**
- Business logic: calculations, pricing, tax rules, validation
- Data transformations: mapping, filtering, aggregation, formatting
- Parsers: CSV, JSON, XML, custom format parsing
- Validators: input validation, schema validation, business rules
- State machines: status transitions, workflow steps
- Utilities: string manipulation, date handling, number formatting

**E2E classification - apply when:**
- Keyboard shortcuts: key bindings, modifier keys, chord sequences
- Navigation: page transitions, routing, breadcrumbs, back/forward
- Form interactions: submit, validation errors, field focus, autocomplete
- Selection: row selection, multi-select, shift-click ranges
- Drag and drop: reordering, moving between containers
- Modal dialogs: open, close, confirm, cancel
- Data grids: sorting, filtering, inline editing, column resize

**Skip classification - apply when:**
- UI layout/styling: CSS classes, visual appearance, responsive breakpoints
- Configuration: config files, environment variables, feature flags
- Glue code: dependency injection setup, middleware registration, routing tables
- Migrations: database migrations, schema changes
- Simple CRUD: basic create/read/update/delete with no business logic
- Type definitions: records, DTOs, interfaces with no logic

Read each file to verify classification. Don't classify based on filename alone.
</step>

<step name="present_classification">
Present the classification to the user for confirmation before proceeding:

```
AskUserQuestion(
  header: "Test Classification",
  question: |
    ## Files classified for testing

    ### TDD (Unit Tests) - {N} files
    {list of files with brief reason}

    ### E2E (Browser Tests) - {M} files
    {list of files with brief reason}

    ### Skip - {K} files
    {list of files with brief reason}

    {if $EXTRA_INSTRUCTIONS: "Additional instructions: ${EXTRA_INSTRUCTIONS}"}

    How would you like to proceed?
  options:
    - "Approve and generate test plan"
    - "Adjust classification (I'll specify changes)"
    - "Cancel"
)
```

If user selects "Adjust classification": apply their changes and re-present.
If user selects "Cancel": exit gracefully.
</step>

<step name="discover_test_structure">
Before generating the test plan, discover the project's existing test structure:

```bash
# Find existing test directories
find . -type d -name "*test*" -o -name "*spec*" -o -name "*__tests__*" 2>/dev/null | head -20
# Find existing test files for convention matching
find . -type f \( -name "*.test.*" -o -name "*.spec.*" -o -name "*Tests.fs" -o -name "*Test.fs" \) 2>/dev/null | head -20
# Check for test runners
ls package.json *.sln 2>/dev/null || true
```

Identify:
- Test directory structure (where unit tests live, where E2E tests live)
- Naming conventions (`.test.ts`, `.spec.ts`, `*Tests.fs`, etc.)
- Test runner commands (how to execute unit tests, how to execute E2E tests)
- Test framework (xUnit, NUnit, Jest, Playwright, etc.)

If test structure is ambiguous, ask the user:
```
AskUserQuestion(
  header: "Test Structure",
  question: "I found multiple test locations. Where should I create tests?",
  options: [list discovered locations]
)
```
</step>

<step name="generate_test_plan">
For each approved file, create a detailed test plan.

**For TDD files**, plan tests following RED-GREEN-REFACTOR:
1. Identify testable functions/methods in the file
2. For each function: list input scenarios, expected outputs, edge cases
3. Note: since code already exists, tests may pass immediately - that's OK, but verify they test the RIGHT behavior

**For E2E files**, plan tests following RED-GREEN gates:
1. Identify user scenarios from CONTEXT.md/VERIFICATION.md
2. For each scenario: describe the user action, expected outcome, assertions
3. Note: RED gate means confirming the test would fail if the feature were broken

Present the complete test plan:

```
AskUserQuestion(
  header: "Test Plan",
  question: |
    ## Test Generation Plan

    ### Unit Tests ({N} tests across {M} files)
    {for each file: test file path, list of test cases}

    ### E2E Tests ({P} tests across {Q} files)
    {for each file: test file path, list of test scenarios}

    ### Test Commands
    - Unit: {discovered test command}
    - E2E: {discovered e2e command}

    Ready to generate?
  options:
    - "Generate all"
    - "Cherry-pick (I'll specify which)"
    - "Adjust plan"
)
```

If "Cherry-pick": ask user which tests to include.
If "Adjust plan": apply changes and re-present.
</step>

<step name="execute_tdd_generation">
For each approved TDD test:

1. **Create test file** following discovered project conventions (directory, naming, imports)

2. **Write test** with clear arrange/act/assert structure:
   ```
   // Arrange - set up inputs and expected outputs
   // Act - call the function under test
   // Assert - verify the output matches expectations
   ```

3. **Run the test**:
   ```bash
   {discovered test command}
   ```

4. **Evaluate result:**
   - **Test passes**: Good - the implementation satisfies the test. Verify the test checks meaningful behavior (not just that it compiles).
   - **Test fails with assertion error**: This may be a genuine bug discovered by the test. Flag it:
     ```
     ⚠️ Potential bug found: {test name}
     Expected: {expected}
     Actual: {actual}
     File: {implementation file}
     ```
     Do NOT fix the implementation - this is a test-generation command, not a fix command. Record the finding.
   - **Test fails with error (import, syntax, etc.)**: This is a test error. Fix the test and re-run.
</step>

<step name="execute_e2e_generation">
For each approved E2E test:

1. **Check for existing tests** covering the same scenario:
   ```bash
   grep -r "{scenario keyword}" {e2e test directory} 2>/dev/null || true
   ```
   If found, extend rather than duplicate.

2. **Create test file** targeting the user scenario from CONTEXT.md/VERIFICATION.md

3. **Run the E2E test**:
   ```bash
   {discovered e2e command}
   ```

4. **Evaluate result:**
   - **GREEN (passes)**: Record success
   - **RED (fails)**: Determine if it's a test issue or a genuine application bug. Flag bugs:
     ```
     ⚠️ E2E failure: {test name}
     Scenario: {description}
     Error: {error message}
     ```
   - **Cannot run**: Report blocker. Do NOT mark as complete.
     ```
     🛑 E2E blocker: {reason tests cannot run}
     ```

**No-skip rule:** If E2E tests cannot execute (missing dependencies, environment issues), report the blocker and mark the test as incomplete. Never mark success without actually running the test.
</step>

<step name="mutation_gate">
Run a mutation check on the newly generated **unit** tests to confirm they actually detect regressions. High line coverage can still survive most mutations - a documented blind spot of generate-then-run test flows, where a test passes without asserting on the behavior that matters.

1. **Detect a mutation tool for the stack** (skip this step entirely if no unit tests were generated):
   - Python: `mutmut` or `cosmic-ray`
   - JS/TS: `stryker` (`@stryker-mutator/core`)
   - Other ecosystems: if no mutation tool is installed or available, skip the gate and record "mutation testing unavailable for this stack" as a coverage-gap note. Do NOT block.

2. **Scope to the changed source files and their generated tests** (not the whole suite - keep it fast):
   ```bash
   # Invocation varies by project, e.g.:
   # mutmut run --paths-to-mutate "{changed source files}"
   # npx stryker run --mutate "{changed source globs}"
   ```

3. **Compute the kill rate** = killed / (total - equivalent/timeout mutants). Report it.

4. **Soft gate (report, do not hard-block):**
   - Kill rate >= 70%: pass.
   - Kill rate < 70%: do NOT block the commit. List each surviving mutant (file, line, what mutated and survived) under "Coverage Gaps" so the user can strengthen assertions.

Surviving mutants are reported as gaps, never as test failures. The commit still proceeds; the kill rate is recorded in the summary so quality is visible.
</step>

<step name="summary_and_commit">
Create a test coverage report and present to user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► TEST GENERATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Results

| Category | Generated | Passing | Failing | Blocked |
|----------|-----------|---------|---------|---------|
| Unit     | {N}       | {n1}    | {n2}    | {n3}    |
| E2E      | {M}       | {m1}    | {m2}    | {m3}    |

**Mutation kill rate (unit tests):** {kill_rate}% ({killed}/{total} mutants) - pass >= 70%; any surviving mutants are listed under Coverage Gaps. Omit this line if mutation testing was unavailable for the stack.

## Files Created/Modified
{list of test files with paths}

## Coverage Gaps
{areas that couldn't be tested and why}

## Bugs Discovered
{any assertion failures that indicate implementation bugs}
```

Record test generation in project state:
```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" state-snapshot
```

If there are passing tests to commit:

```bash
git add {test files}
git commit -m "test(phase-${phase_number}): add unit and E2E tests from add-tests command"
```

Present next steps:

```
---

## ▶ Next Up

{if bugs discovered:}
**Fix discovered bugs:** `/donny-quick fix the {N} test failures discovered in phase ${phase_number}`

{if blocked tests:}
**Resolve test blockers:** {description of what's needed}

{otherwise:}
**All tests passing!** Phase ${phase_number} is fully tested.

---

**Also available:**
- `/donny-add-tests {next_phase}` - test another phase
- `/donny-verify-work {phase_number}` - run UAT verification

---
```
</step>

</process>

<success_criteria>
- [ ] Phase artifacts loaded (SUMMARY.md, CONTEXT.md, optionally VERIFICATION.md)
- [ ] All changed files classified into TDD/E2E/Skip categories
- [ ] Classification presented to user and approved
- [ ] Project test structure discovered (directories, conventions, runners)
- [ ] Test plan presented to user and approved
- [ ] TDD tests generated with arrange/act/assert structure
- [ ] E2E tests generated targeting user scenarios
- [ ] All tests executed - no untested tests marked as passing
- [ ] Mutation check run on generated unit tests (or recorded as unavailable); kill rate reported and surviving mutants flagged as coverage gaps
- [ ] Bugs discovered by tests flagged (not fixed)
- [ ] Test files committed with proper message
- [ ] Coverage gaps documented
- [ ] Next steps presented to user
</success_criteria>
