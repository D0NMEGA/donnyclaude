# Pre-repair v5.0 fixture (Phases 19 and 20)

Extracted 2026-09-02 from the claudecodeoptimized repo at commit `f328bee`
("docs(22): create phase plan"), the last commit before Phase 22 repaired the v5.0 record
drift. The repair commit is `79783d0`
("docs(22-01): fix 19-VERIFICATION status vocabulary (PASS to passed)").

All 25 files were produced by `git show f328bee:<path>` and verified byte-identical to that
commit by sha256 at extraction time.

## Why this is committed rather than reconstructed at test time

Phase 22 repaired the archive in place, so the live
`.planning/milestones/v5.0-phases/19-supervisor-foundation/` no longer carries the drift. The
gate's criterion-5 proof needs the pre-repair state, and pinning it here means the test does not
depend on that git history staying rewritable, or on the claudecodeoptimized repo being present
at all.

## What is and is not extracted

Twelve Phase 19 artifacts, eleven Phase 20 artifacts, plus `REQUIREMENTS.md` and `ROADMAP.md`.

`19-DISCUSSION-LOG.md`, `19-RESEARCH.md`, `20-DISCUSSION-LOG.md`, `20-RESEARCH.md`,
`20-HUMAN-UAT.md` and `20-LEDGER.jsonl` exist at that commit but no shipped verb reads them, so
they are skipped to keep the fixture small. There is no `20-SECURITY.md` at `f328bee` (verified
with `git ls-tree`), and that absence is itself part of the fixture: it is what makes
`threats-clear` return `status: missing` on Phase 20, which the A-01 severity maps to `not_yet`.
It was not synthesised.

## Known drift this tree carries

| ID | Defect | Verb that catches it |
|----|--------|----------------------|
| J1 | `19-VERIFICATION.md` frontmatter reads `status: PASS`; the engine compares to the literal lowercase `passed` | `verify phase-verified` |
| J2 | `19-01-SUMMARY.md` and `19-02-SUMMARY.md` carry a body `---` pair that shadows the real top frontmatter, so `extractFrontmatter` reads a body block and returns zero keys | `verify-summary` (the D-16 check) and `verify milestone-coverage` |
| J3 | `19-03-SUMMARY.md` and `19-04-SUMMARY.md` have no `requirements-completed` key at all | `verify-summary` (the D-16 check) |
| J4 | `20-VERIFICATION.md` has 12 `---` lines, so a body block shadows the real frontmatter and `status` never parses | `verify phase-verified` |
| J5 | `20-04-SUMMARY.md` carries `requirements-completed: []`, the empty case | `verify-summary` (the D-16 check) |
| J6 | there is no `20-SECURITY.md` at all in this tree | `verify threats-clear` returns `missing`, which A-01 maps to `not_yet` |

## Measurements taken at extraction

Re-measured on 2026-09-02 against the extracted tree. `tests/verify-gate.test.js` pins every
row, so a fixture that stops carrying the drift fails the suite rather than silently weakening
Plan 09's proof.

| File | Measurement | Value |
|------|-------------|-------|
| `19-VERIFICATION.md` | frontmatter `status` | `PASS` (verdict `verified: false`) |
| `19-01-SUMMARY.md` | frontmatter keys parsed | 0 (4 `---` fences) |
| `19-02-SUMMARY.md` | frontmatter keys parsed | 0 (4 `---` fences) |
| `19-03-SUMMARY.md` | frontmatter keys parsed | 9, `requirements-completed` absent |
| `19-04-SUMMARY.md` | frontmatter keys parsed | 9, `requirements-completed` absent |
| `20-VERIFICATION.md` | lines matching `^---$` | 12 |
| `20-04-SUMMARY.md` | `requirements-completed` | `[]` (empty array) |
| `20-SECURITY.md` | exists | no |

One correction against the 23-01 plan, which recorded `19-03-SUMMARY.md` as parsing to 6
frontmatter keys. The measured value is 9: `phase`, `plan`, `subsystem`, `tags`,
`dependency-graph`, `tech-stack`, `key-files`, `decisions`, `metrics`. The extraction is not in
doubt (all 25 files sha256-match `f328bee`), and no file in either the pre-repair or the
post-repair tree parses to 6 keys, so the planning-time figure was simply wrong. The load-bearing
half of that assertion, that `requirements-completed` is absent, holds exactly as recorded.
