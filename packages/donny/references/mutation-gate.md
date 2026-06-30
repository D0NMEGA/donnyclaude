# Mutation gate (soft)

A passing test suite with high line coverage can still miss the behavior that matters: a test
that exercises the code without asserting on its result survives most mutations. This gate runs a
mutation check to confirm the tests actually detect regressions.

It is a SOFT gate. It reports surviving mutants as a quality signal and never hard-blocks. Mutation
tools are per-stack, slow, and often not installed, so hard-blocking an autonomous run on a missing
or flaky tool would be fragile. The gate informs; it does not stop the run.

## When to run

- Only when unit tests were generated or changed in this phase. If none changed, skip entirely.
- Mutate only the changed source files, never the whole tree. Mutation testing is slow.

## Detect a tool for the stack

- Python: `mutmut` or `cosmic-ray`
- JS/TS: `stryker` (`@stryker-mutator/core`)
- Other ecosystems, or no tool installed: skip and record "mutation testing unavailable for this
  stack" as a coverage-gap note. Do NOT block.

## Run (changed source only)

```bash
# mutmut run --paths-to-mutate "{changed source files}"
# npx stryker run --mutate "{changed source globs}"
```

## Soft gate (report, never hard-block)

- Surviving mutants are a quality signal, not a failure. Record the survivor count and a short list
  of survivors as a coverage-gap note in the phase artifacts (e.g. the SUMMARY "Issues Encountered"
  or a deferred-items note), so a human can strengthen the tests later.
- The caller may also append the result to the per-phase action ledger so an autonomous run leaves a
  trail of test-quality outcomes.
- Continue regardless of the survivor count. This gate does not gate advancement; it records.
