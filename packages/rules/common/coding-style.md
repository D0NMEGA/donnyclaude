# Coding Style

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

```
// Pseudocode
WRONG:  modify(original, field, value) → changes original in-place
CORRECT: update(original, field, value) → returns new copy with change
```

Rationale: Immutable data prevents hidden side effects, makes debugging easier, and enables safe concurrency.

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large modules
- Organize by feature/domain, not by type

## Simplicity (YAGNI)

Write the MINIMUM code that solves the problem in front of you NOW, not the minimum that could solve every future version of it:
- Resist premature abstraction. Rule of thumb: copy-paste twice before you abstract.
- Skip error handling for errors that genuinely cannot occur.
- Hardcode values until there is a real reason to configure them.
- The test: if the only reason something is abstracted is "in case we need to," it is over-built.

## Surgical Changes

Your diff should be as SMALL as the task allows:
- Do NOT touch what you were not asked to touch.
- Match the existing style. Do NOT reformat unrelated code (a formatter pass buries the 3 lines that matter inside 300 that do not).
- Justify every changed line by the task. If a line is there only because "while I was in there," revert it.

## Error Handling

ALWAYS handle errors comprehensively:
- Handle errors explicitly at every level
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

## Input Validation

ALWAYS validate at system boundaries:
- Validate all user input before processing
- Use schema-based validation where available
- Fail fast with clear error messages
- Never trust external data (API responses, user input, file content)

## Common Failure Modes (catch yourself, then STOP)

Recurring anti-patterns. On noticing one, the right move is to stop, not push through:
- Kitchen Sink: restructuring half the codebase while you are in there.
- Wrong Abstraction: abstracting after a single example instead of waiting until the shape is clear.
- Optimistic Path: handling the happy path and ignoring the error/500 case.
- Runaway Refactor: a fix that cascades across files until the diff is unreviewable.

## Code Quality Checklist

Before marking work complete:
- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No hardcoded values (use constants or config)
- [ ] No mutation (immutable patterns used)
- [ ] Diff is minimal: no drive-by reformatting or out-of-scope edits
- [ ] No premature abstraction (YAGNI): minimal code for the task at hand

---
The Simplicity, Surgical Changes, and Common Failure Modes sections are adapted from Andrej Karpathy's "CLAUDE.md Field Notes."
