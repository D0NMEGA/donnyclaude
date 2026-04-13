# Phase 1: Skill Audit + Prune (RC GATE) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered and the reasoning that selected them.

**Date:** 2026-04-12
**Phase:** 01-skill-audit-prune-rc-gate
**Areas discussed:** Protected + target count, Pruning rubric formulation + application, RC release + feedback gate, Removal + rationale trail

Discussion order requested by user: #2 (Protected+target) → #1 (Rubric) → #4 (RC+gate) → #3 (Removal). Ordered this way because "answers cascade" — the scoping math had to be redone before the rubric could be applied, and the rubric outcome shapes what the RC mechanics and removal trail describe.

---

## Protected + target count

### Decision 1: Which skills are protected from pruning regardless of rubric outcome?

| Option | Description | Selected |
|--------|-------------|----------|
| Just the 60 gsd-* | Only GSD-engine skills hard-protected. Everything else through the rubric. 47 candidates. | |
| gsd-* + unique value-adds | Protect gsd-* AND a curated "donnyclaude-unique" list. ~70 protected, ~37 candidates. | ✓ (with tightening) |
| Rubric decides everything | No pre-approved protected list beyond gsd-*. Clauses (a)(b)(c) are the ONLY filter. | |

**User's choice:** Option 2 with a significant tightening. The initial draft list (humanizer, eval-harness, mcp-server-patterns, iterative-retrieval, strategic-compact, plankton-code-quality, frontend-slides, skill-stocktake, configure-ecc, continuous-learning×2) was too long and soft — "protecting almost everything non-gsd that has a non-generic name, which is the same failure mode as Option 3 in disguise."

**Tightening applied:** A skill is protected (beyond gsd-*) only if it meets one of two stricter tests:
1. **Harness meta-tooling** — operates on the donnyclaude system itself (skill-stocktake, eval-harness, configure-ecc as originally proposed).
2. **Opinionated taste claims Claude won't replicate from training** — humanizer (anti-AI-voice), strategic-compact (donnyclaude's compaction philosophy), plankton-code-quality (if opinionated — verify first).

Skills stripped from the initial protection list and sent to rubric: mcp-server-patterns, iterative-retrieval, frontend-slides (verify first), continuous-learning vs v2 (standalone pick-one decision, not protection).

**Spot-check mandate:** User flagged that plankton-code-quality, configure-ecc, and frontend-slides needed verification from their SKILL.md files before locking the protected list. Reasoning: "Two minutes of reading prevents a wrong protect/cut decision."

---

### Spot-check round 1 (plankton-code-quality, configure-ecc, frontend-slides)

- **plankton-code-quality** — Not an opinionated donnyclaude taste claim. It's an integration reference for a specific third-party tool (Plankton by @alxfazio) with tiered Haiku/Sonnet/Opus routing. Useful but fails both protection tests (not harness meta-tooling operating on donnyclaude itself; not a donnyclaude-native taste claim). **Decision: send to rubric.**
- **configure-ecc** — NOT donnyclaude infrastructure at all. Its Step 0 literally `git clone`s `https://github.com/affaan-m/everything-claude-code.git` to `/tmp`. It is an installer for a different project (ECC), cruft from origin-drift that never got cleaned up. **Decision: remove outright as cruft, not via rubric.** Separate PRUNE-LOG.md category: "installer for an unrelated project."
- **frontend-slides** — Verified opinionated. Non-Negotiables list includes *"Distinctive design: avoid generic purple-gradient, Inter-on-white, template-looking decks"* — that's a taste claim, not a knowledge claim. Encodes a specific aesthetic philosophy credited to @zarazhangrui. **Decision: keep in protected list.**

---

### User pushback and re-verification round

**User pushback:** The configure-ecc reveal ("33% surprise rate on a tiny sample") demanded re-verification of the four non-gsd skills still on the protected list — skill-stocktake, eval-harness, humanizer, strategic-compact — before locking. The asymmetry argument: wrong-protect means cruft survives indefinitely; wrong-send-to-rubric means a good skill gets one more layer of scrutiny and probably survives anyway because clauses (b) and (c) catch genuine donnyclaude-specific value. "Lean on the conservative tool."

User also proposed clause (d) for the rubric before the spot-check round, derived from the configure-ecc lesson: "the skill is actually about donnyclaude or its supported workflows, not an installer/reference for an unrelated third-party project."

### Spot-check round 2 (skill-stocktake, eval-harness, humanizer, strategic-compact)

| Skill | Verdict | Evidence |
|-------|---------|----------|
| skill-stocktake | ✅ Keep protected | Real distribution auditor. `quick-diff.sh` script, `results.json` cache, Quick Scan/Full Stocktake modes. Origin:ECC but functionally meta-tooling for any skill distribution. |
| eval-harness | ⚠️ Downgrade to rubric | Origin:ECC. Generic EDD methodology (capability evals, regression evals, pass@k). No donnyclaude-specific glue visible. Not a third-party wrapper, but not distribution-specific either. |
| humanizer | ✅ Keep protected | v2.3.0, substantial content. Specific rules: "signs of soulless writing," "how to add voice," "final anti-AI pass." Real opinionated taste, not boilerplate. |
| strategic-compact | ✅ Keep protected | Has executable `suggest-compact.js` PreToolUse hook. The **code** is non-duplicatable from training even if the philosophy isn't. |

---

### Refined protected list lock

| Option | Description | Selected |
|--------|-------------|----------|
| Lock at 64 | gsd-* (60) + skill-stocktake + humanizer + strategic-compact + frontend-slides. eval-harness downgraded. configure-ecc is cruft. | ✓ |
| Keep eval-harness protected (65) | Override the downgrade. Protect around a hypothetical rubric failure. | |
| Also downgrade skill-stocktake (63) | Strictly apply the test. | |

**User's choice:** Option 1, lock at 64. Reasoning: "your eval-harness downgrade call is correct. The skill is generic EDD methodology that Claude has from training, with no donnyclaude-specific glue. The rubric exists precisely to catch this pattern. If clause (a) wrongly cuts it, the fix is tightening clause (a)'s wording, not protecting around the rubric."

---

### Decision 2: Target count reconciliation

| Option | Description | Selected |
|--------|-------------|----------|
| Revise upstream to ~75-80 | Update PROJECT.md + REQUIREMENTS.md + ROADMAP.md + research/SUMMARY.md + tests BEFORE planning Phase 1. One small commit. | ✓ |
| Criteria-driven, revise in same PR | Apply rubric first, let count land at X, update docs as part of execution. | |
| Keep ~60, cut some gsd-* | Hard-cap at ~60, cut low-frequency gsd-* commands. | |

**User's choice:** Option 1, revise upstream first. "This is fundamentally a question about when you correct a known-stale number in the planning docs, not about whether to correct it. The number is wrong now. You know it's wrong. Every downstream decision in this phase will reference those docs."

Option 2 rejected as silent-drift failure mode: "The corrected number lives in one PR; the stale number lives in everything that referenced the docs before the PR landed. You've created a brief window where the canonical number disagrees with itself, and that window is exactly when you're making the most consequential decisions of the phase."

Option 3 rejected as backwards: "The gsd-* skills are protected for a structural reason. Cutting them to hit a number that was scoped before you understood the structure means the number is driving the architecture, which is backwards."

**User-specified commit message style** for the scoping correction:

```
docs(planning): correct v1.2 prune target from ~60 to 75-85

Original ~60 target was scoped before the gsd-* coupling
was understood. 60 of 107 skills are gsd-engine-coupled
and structurally protected. Realistic target after pruning
~25-30 training-data duplicates from 47 non-gsd candidates
is 75-85 final. Updates PROJECT.md, REQUIREMENTS.md,
ROADMAP.md, research/SUMMARY.md to match.
```

**Tightening:** User also specified that `tests/install.test.js:60` (`count >= 100`) must move to the new floor IN THE SAME COMMIT, not the prune-execution commit. "The test assertion is part of the scoping spec, not part of the prune work. Keeping them together means the test floor moves with the target band whenever either changes."

---

## Pruning rubric formulation + application

### Decision 3: How does clause (d) combine with clauses (a), (b), (c)?

| Option | Description | Selected |
|--------|-------------|----------|
| (a OR d) AND (b AND c) | Two reasons-to-prune + two preconditions. | |
| All four must be TRUE | Stricter: (a) AND (b) AND (c) AND (d). | |
| (d) as separate pre-rubric filter | Two-pass audit. Cruft filter first, then training-duplicate rubric. | ✓ |

**User's choice:** Option 3. Multi-part rationale:

1. **Option 1 quietly makes (b) and (c) preconditions for cruft removal too** — which means a cruft skill with an accidental internal reference would be blocked from removal. "Cruft should be removable on its merits regardless of accidental couplings; the coupling is itself a bug to fix, not a reason to keep the cruft."
2. **Option 1 collapses reasons into a single audit log entry.** PRUNE-LOG.md ends up with rows like "removed: failed (a OR d) AND (b) AND (c)" — uninformative.
3. **Separation matters operationally:** subagent job becomes simpler (one coherent question per pass), failure modes are debugged differently (cruft false-positive = misreading; rubric false-positive = calibration), and user-facing release notes read cleanly ("removed 1 unrelated-project installer and 22 training-data duplicates" vs. "removed 23 skills that failed our four-clause rubric").

**User tightening:** The cruft filter needs a positive test, not just "fails clause (d)":

> *"Does this skill encode workflow, opinion, integration, or knowledge that is meaningfully tied to donnyclaude's supported tools (Claude Code, MCP servers, GSD engine, the rule files for the 13 supported languages, or the agents/hooks shipped in the distribution)?"*

YES on any clause = passes filter → goes to rubric. NO on all clauses = cruft. Positive-test phrasing pushes tangential-donnyclaude-adjacent skills into the rubric (where clause (a) handles redundancy), rather than mis-categorizing them as cruft.

---

### Decision 4: Who applies the rubric to the 43 candidates?

| Option | Description | Selected |
|--------|-------------|----------|
| Audit subagent with structured verdict | Subagent reads each SKILL.md, emits PRUNE-VERDICT.json. Human reviews table. | |
| You (Donovan) manual audit | Personally open each of 43 files, apply rubric, write verdicts yourself. | |
| Hybrid: agent scores, human reviews | Subagent produces verdicts; human reviews PRUNE + UNCERTAIN only. | ✓ |

**User's choice:** Option 3, hybrid.

- **Not Option 1:** "The configure-ecc finding established that surprise rate on this codebase is ~33% on small samples. A subagent applying the rubric to 43 skills will be wrong on some non-trivial fraction of them, and you won't catch the errors unless you spot-check. Option 1 with 'human reviews and accepts/overrides' is technically a review step but it's positioned as rubber-stamping a finished table."
- **Not Option 2:** "Two hours of focused reading sounds achievable but the realistic outcome is you start strong, get pattern-fatigued around skill 15-20, and the last 20 skills get worse rationale than the first 20. Also: this is exactly the work subagents are good at."
- **Option 3 wins:** Splits labor along the right axis. Subagent does bulk reading; human reviews what matters. "Skip the KEEPs on the assumption that false-negative keeps are recoverable in v1.3. False-positive prunes are the asymmetric risk; concentrate human attention there."

**User tightenings (both became D-16 and D-18 in CONTEXT.md):**

1. **5-skill calibration pre-flight** — "Before the subagent processes all 43 candidates, have it process a held-out set of 5 skills you've already pre-judged. Compare its verdicts to yours. If it's 5/5, proceed. If it's 4/5 or worse, tighten the rubric prompt before the full pass. This is ~15 minutes of work that catches systematic misreads before they corrupt all 43 verdicts."
2. **Per-clause line citations in PRUNE-VERDICT.json** — "When you're spot-checking a PRUNE verdict, you need to verify the subagent actually read the right thing, not just trust its conclusion. Citations make spot-checks fast."

---

## RC release + feedback gate

### Decision 5: Publishing mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Lock the defaults | `npm publish --tag rc`, version 1.2.0-rc.1, GitHub pre-release linking PRUNE-LOG.md. | ✓ |
| GitHub-only isolation | Skip npm publish. GitHub pre-release tag only. | |
| Skip the RC step entirely | Ship v1.2.0 directly. No rc1, no feedback gate. | |

**User's choice:** Option 1.

- **Not Option 2:** "The dist-tag concern is overweighted. `npx donnyclaude@rc` typo risk is tiny. The GitHub-only path has its own friction: `npx donnyclaude@github:d0nmega/donnyclaude#v1.2.0-rc.1` is a 50+ character install command that nobody will type correctly. npm dist-tag is the standard mechanism for exactly this use case."
- **Not Option 3:** "You're right that a 12-user audience makes the feedback week feel theatrical if the gate's only purpose is collecting user feedback. But that's not the only thing the gate does. It also forces a one-week cooling-off period between 'we made the prune decision' and 'the prune is irrevocably shipped to stable.' That's valuable independent of feedback volume — it's the window where you spot something you missed, where a CI run on a real downstream project surfaces a regression, where rereading PRUNE-LOG.md catches a wrong rationale."

**User tightenings:**
1. **Reframe gate purpose in PROJECT.md** — current Key Decision reads "one week of user feedback before shipping the rest of v1.2." Change to "one week between rc1 publish and stable promotion, providing both external feedback collection AND internal cooling-off for self-review." This makes Option 3's critique non-applicable (gate is justified even at zero external feedback).
2. **Define concrete cooling-off obligations** — three specific tasks during the week: (a) day 4-5 PRUNE-LOG.md re-read from scratch, (b) fresh-machine install test, (c) real-workflow use of a protected-but-borderline skill. "If any of these surface a problem, gate stays closed regardless of external issues."

---

### Decision 6: Gate role given a small audience

| Option | Description | Selected |
|--------|-------------|----------|
| Self-dogfooding + rollback point | Gate is primarily self-validation. Any user feedback is a bonus. | |
| Active beta outreach | DM 3-5 specific users asking for rc1 smoke test. | |
| Dogfood primary + opportunistic outreach | Primary: self-dogfood. Secondary: accept organic signal during the week. | ✓ |

**User's choice:** Option 3.

- **Not Option 1:** "Overcorrects by treating any user feedback as a 'bonus.' That framing means if a user does file a real regression during the week, you've pre-committed to treating it as outside the gate's purpose. That's wrong — real signal is real signal regardless of whether you actively solicited it. Option 1's release-notes posture ('no please-file-issues theater') tips into the opposite kind of theater: performative humility about audience size."
- **Not Option 2:** "Active outreach creates a different problem. Now you're the founder cold-DMing your tiny user base asking for unpaid QA labor on a config distribution. That's a relationship-cost transaction. Save the social capital for v1.4 when you're shipping something genuinely riskier."

**User tightening:** Define what "opportunistic" actually rules in vs. out. Rule in: existing conversations during the week where rc1 naturally fits ("hey, I'm shipping a new version, try `npx donnyclaude@rc` if you're curious"). Rule out: cold-starting conversations specifically to ask about rc1, posting in channels you don't normally post in, scheduling explicit calls. The line is **"would I have talked to this person this week regardless of rc1?"**

---

## Removal + rationale trail

### Decision 7: Archive mechanism + documentation location

| Option | Description | Selected |
|--------|-------------|----------|
| Lock as described | packages/_archived-skills/, docs/PRUNE-LOG.md, schema + stub README + CHANGELOG.md created. | ✓ |
| Archive at repo root | _archive/skills/ at repo root, everything else same. | |
| Skip CHANGELOG.md creation | Lock archive + PRUNE-LOG.md but defer CHANGELOG.md to a future phase. | |

**User's choice:** Option 1.

- **Not Option 2:** "The cost isn't just 'one more level of nesting in restore commands' — it's that you're inventing a new top-level directory convention that nothing else in the project uses. Adding `_archive/` makes a future contributor wonder 'is this where deprecated bin scripts go too? deprecated tests?' The convention sprawls. Keeping archive co-located (`packages/_archived-skills/` next to `packages/skills/`) is locality of reference."
- **Not Option 3:** "Sounds like clean scope discipline but it's the wrong cut. The decisions that are scope-creep-y about CHANGELOG (backfill v1.0/v1.1? what format?) are exactly the ones you can avoid by creating it minimally now: one entry for v1.2.0 with a one-line summary and a link to docs/PRUNE-LOG.md. That's 4 lines of file. The scope-creep concern is hypothetical; the actual creation is trivial. If CHANGELOG.md doesn't exist, GitHub release notes become the canonical source, which means v1.2's history lives on github.com instead of in the repo. That's a small but real loss of self-containment for a CLI distribution that prides itself on local install."

**User tightenings:**
1. **Lock PRUNE-LOG.md row schema** — `name | category | clause | rationale | archive_path | restore_command | date_archived`. The `restore_command` field MUST be literal copy-pasteable (`git mv packages/_archived-skills/python-patterns packages/skills/python-patterns`), not a description. "Future-you receiving an rc1 issue saying 'I needed python-patterns' wants to grep the log, find the row, copy-paste the command. No translation step."
2. **References-checked provenance in clause (c)** — audit subagent must record what it grep'd (e.g., "checked packages/agents/, packages/hooks/, packages/commands/, packages/skills/*/SKILL.md"). "Without this, you can't tell if a wrong-prune happened because clause (c) was applied loosely or because the reference exists in a place the subagent didn't look. Provenance for the negative finding matters."

---

## Done check + final tightenings

**User's choice:** Ready for context, with two implementation details to bake in:

1. **Name the 5 calibration skills in CONTEXT.md, not at execution time.** "If the planner picks them or the audit subagent picks them, you've lost the calibration value (the subagent grading itself against skills it also chose isn't a real test)." Required mix: 2 obvious prunes (python-patterns, golang-patterns), 2 confirmed-glue keeps (needed spot-check to identify), 1 borderline (eval-harness, strong prior says PRUNE).

2. **Lock PRUNE-VERDICT.json schema shape explicitly.** "If the planner specs this implicitly, the audit subagent will improvise and you'll get an inconsistent file that's hard to spot-check programmatically."

Done-check triggered final context-writing spot-checks on mcp-server-patterns, tdd-workflow, e2e-testing, verification-loop (reading) plus grep for internal references to those 4 plus tdd-guide/e2e-runner agents. Results materially updated the rubric expectations:

- **tdd-workflow has 7 internal references** (tdd-guide agent, commands/tdd.md, commands/go-test.md, commands/cpp-test.md, commands/kotlin-test.md, rules/php/testing.md, commands/tdd.md body). Fails (a) and (b) but PASSES (c). **Confirmed KEEP via clause (c).** Becomes calibration confirmed-glue-keep #1.
- **e2e-testing has 2 internal references** (agents/e2e-runner.md, skills/frontend-slides/SKILL.md). Fails (a) and (b) but PASSES (c). **Confirmed KEEP via clause (c).** Becomes calibration confirmed-glue-keep #2.
- **mcp-server-patterns has zero internal references.** Confirmed PRUNE candidate under the rubric (fails a, b, c).
- **verification-loop has 2 references but both are from skills that are themselves in rubric scope** (plankton-code-quality, configure-ecc). Exposes the **clause (c) evaluation order-dependence gotcha**: if the subagent evaluates alphabetically, by the time it reaches `verification-loop`, `plankton-code-quality` may already be flagged for removal, changing verification-loop's clause-(c) evidence. **Fix captured as D-13 in CONTEXT.md:** clause (c) must be evaluated against the original 107-skill repo state, not the in-progress pruned state. The subagent must snapshot the reference graph BEFORE any prune decisions are applied.

This finding strengthens the rubric: clause (c) is doing exactly what it was designed to do, and the order-dependence gotcha is a real correctness concern worth explicit prompt guidance.

## Claude's Discretion

Areas where the user said "you decide" or deferred judgment to Claude:
- Exact wording of scoping-correction commit body paragraphs (subject line is locked).
- Exact floor inside 70-80 for `tests/install.test.js:60` (sized to pass with margin at either end of 75-85 band).
- Paragraph count of `packages/_archived-skills/README.md`.
- Per-skill `rationale` wording in PRUNE-LOG.md rows (audit subagent drafts; human reviews during PRUNE/UNCERTAIN review pass).

## Deferred Ideas

Ideas mentioned during discussion that were noted as out of scope for Phase 1:

- **Automated skill-index file generation** — Phase 2 (SKILLS-03).
- **Settings.json `skills.enabled[]` registry** — Phase 2 (SKILLS-04).
- **Install manifest with SHA-256 checksums** — Phase 2 (SKILLS-02).
- **Subagent return-contract enforcement** for the 29 non-gsd agents — Phase 3 (AGENTS-01). Relevant to audit subagent prompt design but not a package-level refactor.
- **`origin:` YAML tag audit as its own pass** — a dedicated pass to audit all `origin:` tags against actual content could be future activity; Phase 1 handles it implicitly through the cruft filter.
- **Backfilling CHANGELOG.md with v1.0/v1.1 entries** — Phase 1 creates CHANGELOG.md minimally; backfill is either a future docs pass or never.
