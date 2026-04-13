# Phase 1: Skill Audit + Prune (RC GATE) - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Prune `packages/skills/` from 107 skills to a 75-85 target band of high-value skills. Ship the pruned set as `v1.2.0-rc1` via `npm dist-tag rc`, run a one-week feedback-plus-cooling-off window, then promote to stable `v1.2.0`. This is the RC gate for the rest of v1.2 — Phase 2 cannot begin until the gate resolves.

Scope anchor: SKILLS-01 only. SKILLS-02/03/04 (install manifest, skill index, enable/disable) are Phase 2. AGENTS-01 is Phase 3. HOOKS-01/02/03/04 are Phases 4-5.

**Target math (corrected from original ~60):** 64 protected + X survivors of 43 rubric candidates = 75-85 final. The "~60" figure in the original REQUIREMENTS.md/ROADMAP.md was scoped before the gsd-* coupling was understood; one of Phase 1's first tasks is a doc-correction commit to fix this upstream of planning.

</domain>

<decisions>
## Implementation Decisions

### Scoping correction (before planning Phase 1)

- **D-01:** Land a pre-plan scoping-correction commit with subject `docs(planning): correct v1.2 prune target from ~60 to 75-85` and a multi-line reasoning body explaining that the original ~60 figure was scoped before the gsd-* coupling was understood. This commit updates all stale numbers in one atomic change so no downstream decision in Phase 1 is made against the old target.
- **D-02:** Files updated by the scoping-correction commit: `.planning/PROJECT.md` (Active section + Key Decisions table row on gating), `.planning/REQUIREMENTS.md` (SKILLS-01 body + Verification line), `.planning/ROADMAP.md` (Phase 1 description + Phase 1 Goal + Success Criteria #1), `.planning/research/SUMMARY.md` (Top 6 priorities #4 text), `tests/install.test.js:60` (`assert.ok(count >= 100, ...)` → `assert.ok(count >= 70, ...)` — the floor, not the target, sized so either end of the 75-85 band passes with margin).
- **D-03:** Reframe the gate purpose in PROJECT.md Key Decisions at the same time. Current text says "one week of user feedback before shipping the rest of v1.2." Replace with: "one week between rc1 publish and stable promotion, providing both external feedback collection AND internal cooling-off for self-review." This makes the gate defensible at zero external feedback and frames what happens during the week as real work, not calendar-time-passing.

### Protected list (64 skills, locked)

- **D-04:** The protected set comprises 60 gsd-* skills plus 4 narrowly-selected non-gsd skills that passed a two-test protection filter:
  - **Test A — Harness meta-tooling:** operates on the donnyclaude distribution itself (not just Claude Code sessions generally, and not on user code).
  - **Test B — Opinionated taste claims Claude won't replicate from training data:** encodes a specific aesthetic, philosophical, or implementation choice that isn't inferrable from general knowledge.
- **D-05:** The 4 non-gsd protected skills and their verification evidence:
  - **`skill-stocktake`** — Test A. Audits `~/.claude/skills/` via `quick-diff.sh` script with a `results.json` cache; Quick Scan and Full Stocktake modes. Origin: ECC, but functionally a distribution auditor for any skill ecosystem. Executable meta-tooling survives strictest read of the test.
  - **`humanizer`** — Test B. v2.3.0, substantive anti-AI-voice taste encoding. "Signs of soulless writing," "how to add voice," specific rules and rewriting passes. Not two-sentence boilerplate.
  - **`strategic-compact`** — Test B + executable substance. Has `suggest-compact.js` PreToolUse hook that tracks tool calls and nudges manual `/compact` at configurable thresholds (default 50 calls). Origin: ECC, but the executable code is non-duplicatable from training.
  - **`frontend-slides`** — Test B. Opinionated aesthetic taste claim ("distinctive design: avoid generic purple-gradient, Inter-on-white, template-looking decks"). Zero-deps, viewport-fit, visual-exploration-over-abstract-questionnaires philosophy credited to @zarazhangrui.
- **D-06:** The 60 gsd-* skills are protected on structural grounds (tight coupling to the GSD workflow engine that ships as part of donnyclaude). Cutting any of them breaks the workflow commands users actually run. No further evaluation needed per-skill.
- **D-07:** Skills downgraded from the initial protection candidate list to rubric scope after verification: `eval-harness` (origin:ECC, generic EDD methodology, no donnyclaude-specific glue visible in the SKILL.md), `plankton-code-quality` (third-party tool integration reference, not donnyclaude meta-tooling or taste claim), `mcp-server-patterns` (generic MCP SDK reference, no donnyclaude-specific glue confirmed in spot-check), `iterative-retrieval` (generic technique). These will go through the two-pass audit like the other 39 candidates.

### Cruft removals (separate from rubric)

- **D-08:** `configure-ecc` is removed as cruft, not via the rubric. Evidence: its Step 0 `git clone`s `https://github.com/affaan-m/everything-claude-code.git` into `/tmp` — it is an installer for a different project (ECC), not donnyclaude infrastructure. The scoping "clause (d)" cruft filter is the correct mechanism, not the (a)/(b)/(c) training-duplicate rubric.
- **D-09:** The `continuous-learning` vs `continuous-learning-v2` pair is resolved as a standalone "pick one, delete the other" micro-decision at audit execution time. The audit subagent reads both files, identifies which is the successor (usually v2 unless v1 retains features v2 dropped), and records the loser in PRUNE-LOG.md under a `version-superseded` sub-category of cruft removals.

### Pruning rubric — two-pass audit structure

- **D-10:** The audit runs in two sequential passes, not as a single four-clause evaluation. This matters for simpler subagent prompting, separable failure-mode debugging, and clean user-facing PRUNE-LOG categorization.
- **D-11:** **Pass 1 — Cruft filter (positive test):** For each candidate, ask *"Does this skill encode workflow, opinion, integration, or knowledge that is meaningfully tied to donnyclaude's supported tools (Claude Code, MCP servers, GSD engine, the rule files for the 13 supported languages, or the agents/hooks shipped in the distribution)?"* YES on any clause = passes the cruft filter and advances to Pass 2. NO on all clauses = cruft removal, logged in the "Cruft removals" section of PRUNE-LOG.md with category `origin-drift` or `unrelated-project-installer` or `deprecated-upstream-tool` as appropriate.
- **D-12:** **Pass 2 — Training-duplicate rubric (all three must be TRUE to prune):**
  - **(a) Duplicates training-data knowledge** for a popular language/framework the model has extensive coverage of. Language-pattern skills (`python-patterns`, `golang-patterns`, `rust-patterns`, `kotlin-patterns`, `laravel-patterns`, `django-patterns`, `springboot-patterns`, `java-coding-standards`, `cpp-coding-standards`) are the primary target of this clause. Borderline skills (`ai-regression-testing`, `mcp-server-patterns`, `iterative-retrieval`) need careful read.
  - **(b) No donnyclaude-specific glue** — the SKILL.md body does not reference donnyclaude-native agents, hooks, commands, rule files, MCP server conventions, or the GSD engine in a way that would break if the skill were removed.
  - **(c) No internal references** — nothing else in donnyclaude's distribution references this skill by name. Grep across `packages/agents/`, `packages/hooks/`, `packages/commands/`, `packages/skills/*/SKILL.md`, and `packages/rules/`.
- **D-13:** **Clause (c) evaluation order-dependence gotcha:** Clause (c) MUST be evaluated against the **original 107-skill repo state**, not the in-progress pruned state. If the audit subagent processes skills alphabetically and flags `plankton-code-quality` for removal before reaching `verification-loop`, the reference from plankton → verification-loop disappears from the referrer set, and verification-loop's clause-(c) evidence changes mid-audit. The subagent must snapshot the reference graph BEFORE any prune decisions are applied, then evaluate all candidates against the frozen snapshot. This is a concrete prompt requirement for the audit subagent — not a nice-to-have.
- **D-14:** **Already-verified clause-(c) keeps (from context-writing spot-checks):** `tdd-workflow` has 7 references (tdd-guide agent, tdd/go-test/cpp-test/kotlin-test commands, php/testing rule, commands/tdd.md body) — **confirmed KEEP via clause (c)** despite failing (a) and (b). `e2e-testing` has 2 references (e2e-runner agent, frontend-slides skill) — **confirmed KEEP via clause (c)** despite failing (a) and (b). These results demonstrate the rubric working as designed: clause (c) protects skills that ARE generic methodology but ARE wired into donnyclaude's internal structure.

### Rubric application — hybrid human-subagent with calibration

- **D-15:** The audit is executed by a subagent that reads each candidate SKILL.md, evaluates the two passes, and emits structured `PRUNE-VERDICT.json`. The human (Donovan) reviews every PRUNE and every UNCERTAIN verdict; KEEP verdicts are skimmed but not individually audited. Rationale: false-positive prunes are the asymmetric-risk direction (user-facing, harder to reverse even with `git mv`); false-negative keeps are recoverable in v1.3 with no user impact.
- **D-16:** **5-skill calibration pre-flight (mandatory before full 43-candidate pass):** The audit subagent first processes a pinned held-out set of 5 pre-judged skills. Human compares verdicts to expectations. **5/5 agreement = proceed to full pass. 4/5 or worse = tighten the rubric prompt, then re-run calibration before the full pass.** The calibration skills are:
  - **Obvious prune #1:** `python-patterns` — pure Python idioms (PEP 8, type hints, comprehensions). Fails (a), (b), (c) — no internal references found via grep. Expected verdict: PRUNE.
  - **Obvious prune #2:** `golang-patterns` — generic Go idioms. Same pattern as python-patterns. Expected verdict: PRUNE.
  - **Confirmed-glue keep #1:** `tdd-workflow` — fails (a) (generic TDD) and (b) (no donnyclaude-native references in SKILL.md body), but passes (c) due to 7 internal references from tdd-guide agent, tdd/go-test/cpp-test/kotlin-test commands, php/testing rule, and commands/tdd.md. Expected verdict: KEEP (on clause-c grounds, with lines_cited pointing at the referrers in the provenance field).
  - **Confirmed-glue keep #2:** `e2e-testing` — fails (a) (generic Playwright) and (b) (no donnyclaude-native references in SKILL.md body), but passes (c) due to 2 internal references from e2e-runner agent and frontend-slides skill. Expected verdict: KEEP (on clause-c grounds).
  - **Borderline #1:** `eval-harness` — origin:ECC, generic EDD methodology (capability evals, regression evals, pass@k), no donnyclaude-specific glue visible in first 50 lines, no confirmed internal references from spot-check. Expected verdict: PRUNE. If the subagent KEEPs it, that's calibration drift worth investigating before the full pass.
- **D-17:** **Why this specific mix:** Each of the 5 skills stresses a different rubric pathway. python-patterns and golang-patterns test the language-pattern failure mode. tdd-workflow tests whether the subagent correctly applies clause (c) to protect glue-wired generic skills. e2e-testing tests the same with fewer referrers (2 vs 7). eval-harness tests the borderline case where the prior is PRUNE but the subagent could plausibly go either way. If any of these 5 gets the wrong verdict, the subagent is not ready for the 38 unseen candidates.
- **D-18:** **PRUNE-VERDICT.json schema (locked shape):**
  ```json
  {
    "version": "1.0",
    "rubric_version": "v1.2-phase1",
    "generated_at": "ISO-8601",
    "reference_snapshot_sha": "<git sha of repo state when clause-c grep was run>",
    "calibration_results": {
      "pinned_skills": ["python-patterns", "golang-patterns", "tdd-workflow", "e2e-testing", "eval-harness"],
      "expected_verdicts": { "python-patterns": "PRUNE", "golang-patterns": "PRUNE", "tdd-workflow": "KEEP", "e2e-testing": "KEEP", "eval-harness": "PRUNE" },
      "actual_verdicts": { "...": "..." },
      "agreement_count": 5,
      "proceed": true
    },
    "verdicts": [
      {
        "skill": "python-patterns",
        "category": "candidate",
        "verdict": "PRUNE",
        "clauses": {
          "a": { "verdict": "FAIL", "evidence": "Lines 12-45 enumerate standard Python idioms (dict/list comprehensions, decorators, context managers) all covered extensively in training data", "lines_cited": [12, 45] },
          "b": { "verdict": "FAIL", "evidence": "No references to packages/agents/, packages/hooks/, or donnyclaude conventions; pure language reference", "lines_cited": [] },
          "c": { "verdict": "FAIL", "evidence": "grep for 'python-patterns' returned 0 matches in referrer set", "checked_paths": ["packages/agents/", "packages/hooks/", "packages/commands/", "packages/skills/*/SKILL.md", "packages/rules/"], "referrer_lines": [] }
        },
        "recommendation": "PRUNE",
        "rationale": "Pure language reference, no donnyclaude glue, no internal references. Training-duplicate."
      }
    ]
  }
  ```
  Every verdict row MUST include per-clause `verdict` + `evidence` + `lines_cited`, and clause (c) MUST include `checked_paths` for provenance. The `reference_snapshot_sha` at the top lets a spot-checker re-run the grep against the same repo state to verify.

### RC1 publishing + feedback-plus-cooling-off gate

- **D-19:** **Publishing mechanics:** `npm publish --tag rc` with version `1.2.0-rc.1`. Result: `npx donnyclaude` continues to install the current stable (1.1.x); `npx donnyclaude@rc` opts into 1.2.0-rc.1. After the gate resolves, promote via `npm dist-tag add donnyclaude@1.2.0 latest` which becomes version 1.2.0 stable. GitHub pre-release tag `v1.2.0-rc.1` pointing at the commit, with release notes linking `docs/PRUNE-LOG.md` as the canonical rationale document.
- **D-20:** **Feedback gate criterion:** Any GitHub issue labeled `prune-regression` during the gate window blocks promotion. Donovan (project owner) calls the gate passed after the calendar week elapses with zero labeled issues. Gate start timestamp = npm publish moment of 1.2.0-rc.1. Week = 7 × 24 hours, not "next Monday."
- **D-21:** **Cooling-off obligations during the gate week (not calendar-time-passing):** The week is real work, not waiting. Three concrete obligations:
  - **(a) Day 4-5 PRUNE-LOG.md re-read from scratch.** Not day 1 — distance is the point. Read every row as if you'd never seen it and check whether each rationale still holds. If any row surfaces as wrong, the gate stays closed regardless of external issues.
  - **(b) Fresh-machine install test.** Install `npx donnyclaude@rc` on a machine (or a fresh container) that has no existing `~/.claude/` customizations. Run through a typical donnyclaude session — new project scaffold, trigger a GSD command, verify the pruned skill set behaves as expected. Any install-path or runtime regression surfaces here.
  - **(c) Real-workflow use of a borderline survivor.** Pick one protected-but-borderline skill (`strategic-compact`, `humanizer`, `frontend-slides`, or whichever borderline kept skill the rubric produced) and use it in a real workflow during the week. This catches "we protected it but it's actually broken" bugs that the audit-level review can't.
  - If ANY of (a), (b), or (c) surfaces a problem, the gate stays closed regardless of whether external issues were filed.
- **D-22:** **Gate posture — dogfood primary + opportunistic external signal:** Donovan's own use of rc1 during the week is the primary gate mechanism. External feedback is accepted if it arrives naturally but not actively solicited. **"Opportunistic" is strictly scoped:** rc1 can be mentioned in conversations that would have happened regardless ("hey, I'm shipping a new version, try `npx donnyclaude@rc` if you're curious"). It explicitly EXCLUDES: cold outreach to specific users, posting in channels Donovan doesn't normally post in, and scheduling explicit calls about rc1. The line is "would I have talked to this person this week regardless of rc1?" Release notes are matter-of-fact about the dist-tag; no "please try it and report back" language.

### Removal mechanism + documentation trail

- **D-23:** **Archive target: `packages/_archived-skills/{skill-name}/`.** Rationale: co-located with `packages/skills/` (locality of reference — future contributor looking for a missing skill checks the sibling `_archived-skills/` first), outside `packages/skills/` so `cpSync` install path in `bin/donnyclaude.js:154-176` never picks it up, and outside the dir that `tests/install.test.js:60` counts. Leading underscore + `_archived-` prefix signals not-shipped loudly enough that a top-level `_archive/` convention isn't needed.
- **D-24:** **Removal is `git mv`, not `git rm`.** Matches the rc1-gate philosophy of "reversible if feedback surfaces a need" — if rc1 feedback says "I needed python-patterns," recovery is a one-command `git mv packages/_archived-skills/python-patterns packages/skills/python-patterns` with no history rewrite. `git rm` is irreversible-feeling even when it isn't.
- **D-25:** **Rationale lives in `docs/PRUNE-LOG.md`**, not commit messages. The repo already has an empty `docs/` directory; PRUNE-LOG.md populates it. Two top-level sections: `## Cruft removals` (configure-ecc, continuous-learning loser, any origin-drift surprises) and `## Training-duplicate removals` (language-pattern skills and anything else the rubric prunes). Each section is a markdown table, grep-able by skill name.
- **D-26:** **PRUNE-LOG.md row schema (locked):** `| name | category | clause | rationale | archive_path | restore_command | date_archived |` where:
  - **name:** skill directory name (e.g., `python-patterns`)
  - **category:** `cruft:origin-drift` | `cruft:unrelated-project-installer` | `cruft:version-superseded` | `training-duplicate:language-pattern` | `training-duplicate:framework-reference` | `training-duplicate:generic-methodology`
  - **clause:** which rubric clause triggered (`(d) positive test failed` for cruft; `(a) AND (b) AND (c)` for training-duplicate)
  - **rationale:** 1-2 sentence human-readable explanation (e.g., *"Pure Python idioms covered in training data; no donnyclaude-native references; zero internal references"*)
  - **archive_path:** `packages/_archived-skills/python-patterns/`
  - **restore_command:** literal copy-pasteable shell command — **`git mv packages/_archived-skills/python-patterns packages/skills/python-patterns`** — NOT a description, NOT a variable-substituted template. Future-you receiving a "I needed X" issue greps this field and copy-pastes the command with zero translation.
  - **date_archived:** ISO date (e.g., `2026-04-15`)
- **D-27:** **Stub `packages/_archived-skills/README.md`:** Two paragraphs. First paragraph explains "these are skills archived during the v1.2 prune pass; they are NOT installed by `npx donnyclaude` and NOT counted by `tests/install.test.js`." Second paragraph points to `docs/PRUNE-LOG.md` as the canonical rationale document, with a note that restore commands are in the `restore_command` column of that file.
- **D-28:** **CHANGELOG.md created minimally during this phase.** Not deferred. One entry for v1.2.0 with a one-line summary and a link to `docs/PRUNE-LOG.md`. Earlier releases marked with a one-line note: *"Releases before v1.2.0 predate this changelog; see `git log --oneline` for history."* Rationale: rc1 release notes will reference something as the canonical changelog — without CHANGELOG.md, that something is github.com, which means v1.2's history lives outside the repo. Unacceptable for a CLI distribution that prides itself on self-containment. The backfill scope creep (Keep-a-Changelog format? v1.0/v1.1 entries?) is avoided by writing 4-5 lines total.

### Claude's Discretion

- Exact wording of the scoping-correction commit body paragraphs (the subject line format is locked in D-01).
- Which specific number inside 70-80 the `tests/install.test.js:60` floor gets set to (sized to pass with margin at either end of the 75-85 band).
- The exact text of `docs/PRUNE-LOG.md` section introductions — just the schema and section labels are locked.
- Whether `packages/_archived-skills/README.md` is 2 paragraphs vs 3 vs 4.
- Per-skill `rationale` wording in PRUNE-LOG.md rows — the audit subagent drafts, human reviews during the PRUNE/UNCERTAIN review pass.

### Folded Todos

None. No todos from `.planning/STATE.md#Todos` matched Phase 1 scope for folding; the only existing todo ("Plan Phase 1 via `/gsd-plan-phase 1`") is this phase's next step, not scope to fold.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project + milestone scoping

- `.planning/PROJECT.md` — Core Value, v1.2 scope, Key Decisions, Constraints (architectural envelope, backwards-compat, distribution model). The scoping-correction commit (D-01 through D-03) updates this file; PLAN.md must reflect the post-correction state.
- `.planning/REQUIREMENTS.md` §SKILLS-01 — the requirement being satisfied by Phase 1, including *Touches* and *Verification* fields. Also updated by the scoping correction.
- `.planning/ROADMAP.md` §"Phase 1: Skill Audit + Prune (RC GATE)" — the fixed phase boundary. Success Criteria #1 is the target count which gets updated by the scoping correction.

### Foundational research (read-only, inform rubric calibration)

- `.planning/research/SUMMARY.md` — Top 6 incremental priorities synthesis; priority #4 is the prune. This file is also updated by the scoping correction.
- `.planning/research/INVENTORY.md` §1 "Actual inventory" — the 107-skill count is anchored here. §6 "Notable gaps" frames why the prune matters. §7 "Quick-win candidates" #4 sketches the install manifest but Phase 1 focuses only on the prune itself.
- `.planning/research/DEEP-RESEARCH.md` §"Tool-count degradation is real and measurable" — RAG-MCP arXiv:2505.03275 + Berkeley FCL v3 citations grounding the prune's value. HumanLayer 14-22% reasoning-token savings from fewer rules/skills.

### Install path + packaging (touched by Phase 1 execution)

- `bin/donnyclaude.js:154-176` — `cpSync(packages/skills, ~/.claude/skills, { recursive: true, force: true })`. Phase 1 does not modify this file — the prune flows through automatically once directories are `git mv`'d out of `packages/skills/`.
- `tests/install.test.js:60` — the `count >= 100` assertion that becomes `count >= 70` (or similar floor) in the scoping-correction commit. NOT in the prune-execution commit.
- `README.md` — 5+ locations hardcode "107 skills" (shield badge at line 2, body paragraph at line 12, feature table at line 49, install output at line 130, directory layout at line 229). Phase 1 execution updates these to reflect the final count after the audit lands.
- `packages/skills/` — the 107 directories being pruned. Each skill is a single `SKILL.md` file (plus optional `config.json` like `continuous-learning/config.json`) inside a named subdirectory.

### Reference graph for clause (c) evaluation

The audit subagent's clause-(c) grep MUST check all of these paths against the reference snapshot (D-13):

- `packages/agents/` — the 49 subagent files. Known referrers from spot-check: `tdd-guide.md` → `tdd-workflow`; `e2e-runner.md` → `e2e-testing`.
- `packages/hooks/` — 6 JS hook implementations + `hooks.json`.
- `packages/commands/` — 60 slash command files. Known referrers from spot-check: `tdd.md`, `go-test.md`, `cpp-test.md`, `kotlin-test.md` → `tdd-workflow`.
- `packages/rules/` — 70 rule files across 14 language directories. Known referrers from spot-check: `php/testing.md` → `tdd-workflow`; `common/` rules may reference skill names.
- `packages/skills/*/SKILL.md` — cross-references between skills. Known referrers from spot-check: `frontend-slides` → `e2e-testing`; `strategic-compact` → `tdd-workflow`; `plankton-code-quality` → `verification-loop`.

### Protected skill verification reads (already completed during context)

- `packages/skills/skill-stocktake/SKILL.md` — verified as distribution auditor (Quick Scan/Full Stocktake modes, `quick-diff.sh`, `results.json` cache).
- `packages/skills/humanizer/SKILL.md` — verified as v2.3.0 substantive taste encoding.
- `packages/skills/strategic-compact/SKILL.md` — verified as executable `suggest-compact.js` PreToolUse hook + compaction philosophy.
- `packages/skills/frontend-slides/SKILL.md` — verified as opinionated aesthetic taste claim.
- `packages/skills/configure-ecc/SKILL.md` — verified as cruft (installs unrelated ECC project).
- `packages/skills/plankton-code-quality/SKILL.md` — verified as third-party tool integration, downgraded to rubric.
- `packages/skills/eval-harness/SKILL.md` — verified as generic EDD methodology, downgraded to rubric.
- `packages/skills/mcp-server-patterns/SKILL.md` — verified as generic MCP SDK reference, downgraded to rubric (also used as calibration borderline-or-prune-expectation reference).
- `packages/skills/python-patterns/SKILL.md` — used as calibration-prune anchor.
- `packages/skills/tdd-workflow/SKILL.md` — used as calibration clause-(c)-keep anchor (7 internal references confirmed).
- `packages/skills/e2e-testing/SKILL.md` — used as calibration clause-(c)-keep anchor (2 internal references confirmed).
- `packages/skills/verification-loop/SKILL.md` — verified as generic build/lint verification; referrers present but themselves pendingprune decisions (order-dependence gotcha D-13).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets

- **`cpSync` install pattern in `bin/donnyclaude.js:155`:** `cpSync(src, dest, { recursive: true, force: true })` — the prune works "for free" with this install mechanism. Any directory removed from `packages/skills/` and placed outside the copy source root is automatically excluded from fresh installs on the next `npx donnyclaude` invocation. No install-logic changes needed for Phase 1.
- **Test harness in `tests/install.test.js`:** Already has `countDirItems(join(ROOT, 'packages', 'skills'))` helper at line 59. The assertion at line 60 is the only count-dependent assertion; updating the floor is a 1-line change. Adjacent assertions (agent count, template file existence, MCP server validation) are untouched by the prune.
- **`packages/skills/{name}/SKILL.md` format:** YAML frontmatter (`name`, `description`, `origin`, optional `version`, optional `allowed-tools`, optional `argument-hint`) plus markdown body. No `autoInvoke`, no manifest, no index — the prune is purely "directory present or absent."
- **`gsd-tools commit` helper:** `node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs commit "<message>" --files ...` handles atomic commits with file lists. Phase 1 execution will use this for both the scoping-correction commit and the prune-execution commit so they're distinct atomic units.

### Established patterns

- **Settings-template merge pattern in `bin/donnyclaude.js:194-227`:** The existing install logic merges `settings.json` rather than clobbering, backs up to `.bak` before any write, and preserves user permissions. Phase 1 does NOT touch `settings-template.json` (that's Phase 2 SKILLS-04), so this pattern is informational context only.
- **`origin:` YAML frontmatter tag:** 5+ skills spot-checked carry `origin: ECC`. This tag is a historical-artifact marker (where the skill came from originally), not an active-ownership marker. It is NOT grounds for automatic removal, but it IS grounds for stricter scrutiny during the cruft filter pass — `configure-ecc` demonstrated that `origin:ECC` can hide actual project-installer cruft. The audit subagent should flag `origin:ECC` skills for extra attention without auto-pruning them.
- **Skill naming conventions:** 60 of 107 skills use `gsd-` prefix indicating GSD-engine coupling. Language-pattern skills use `{lang}-patterns` naming. Testing skills split between `{lang}-testing` and `{lang}-tdd`. Verification skills use `{lang}-verification` (though only 4 exist). The prefix itself is a weak signal — useful for grouping, not for pruning decisions.

### Integration points

- **Scoping-correction commit interacts with:** `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/research/SUMMARY.md`, `tests/install.test.js`. This is ONE atomic commit covering all five files with a unified reasoning body. If any of the five touches fails (e.g., test syntax error), the whole commit aborts and the problem gets fixed before landing.
- **Audit subagent spawn happens from Phase 1 PLAN.md execution,** not from this CONTEXT.md. The subagent prompt is authored by the planner/executor reading this context file; the subagent itself is spawned during `gsd-execute-phase 1` or equivalent. This CONTEXT.md is the input to that prompt, not the prompt itself.
- **PRUNE-VERDICT.json → PRUNE-LOG.md transformation:** The audit produces `PRUNE-VERDICT.json` (machine-parseable, per-clause evidence). The human review pass (spot-check PRUNE + UNCERTAIN verdicts) produces the final list of skills to prune. Only then is `docs/PRUNE-LOG.md` written, with rows generated from the subset of PRUNE-VERDICT.json entries that survived human review. PRUNE-VERDICT.json is retained in `.planning/phases/01-skill-audit-prune-rc-gate/` as the audit trail; PRUNE-LOG.md is the user-facing document.
- **`git mv` commits:** All `git mv` operations happen in a SINGLE prune-execution commit, not per-skill commits. Rationale: users of `git log` will see the prune as one atomic change, not 30+ near-identical commits. The PRUNE-LOG.md write lives in the same commit. Commit message: `feat(skills): prune N training duplicates + 1 cruft removal to v1.2 target band`.

</code_context>

<specifics>
## Specific Ideas

- **"~33% surprise rate on spot-checks"** was the trigger for re-verifying the protected list after `configure-ecc` turned out to be cruft. Carry this prior into the full audit pass: whenever a skill looks obvious from its name alone, spend the extra 30 seconds reading the SKILL.md. Names are weak signals in this codebase.
- **"Cooling-off week is real work, not calendar-time-passing"** — the three obligations in D-21 are non-negotiable. The gate's internal-review function is as important as its external-feedback function (and more dependable for a small audience).
- **"Cruft and training-duplicate removals are orthogonal reasons"** — the two-pass audit structure exists specifically so PRUNE-LOG.md can segment them cleanly, enabling release notes like *"removed 1 unrelated-project installer and 22 training-data duplicates"* instead of *"removed 23 skills that failed our four-clause rubric."*
- **"Restore command is literal, not templated"** — D-26 is emphatic about this. If future-you receives an issue saying "I needed python-patterns," the time between "I should check PRUNE-LOG.md" and "skill is restored" must be measured in seconds, not minutes of mental translation.
- **"Clause (c) against frozen snapshot, not in-progress state"** — D-13 is the single most subtle correctness requirement in this context. It needs to be in the audit subagent's prompt verbatim, not paraphrased.

</specifics>

<deferred>
## Deferred Ideas

- **Automated skill-index file generation** — the `packages/hooks/skill-index.js` idea from INVENTORY.md §7 is Phase 2 (SKILLS-03), not Phase 1. Surfaced during discussion; redirected.
- **Settings.json `skills.enabled[]` / `skills.disabled[]` registry** — Phase 2 (SKILLS-04). Surfaced and redirected.
- **Install manifest with SHA-256 checksums** — Phase 2 (SKILLS-02). Surfaced and redirected.
- **Subagent return-contract enforcement on the non-gsd 29 agents** — Phase 3 (AGENTS-01). Relevant because the audit subagent's prompt should already use a structured return contract, but that's a prompt-level concern, not a package-level refactor.
- **`tests/install.test.js` floor sizing revisit** — after the audit produces a final count, the floor may need tightening. Deferred to whoever writes the prune-execution commit; D-02 sets it at ~70 as a forecasted safe floor.
- **Backfilling CHANGELOG.md with v1.0/v1.1 entries** — explicitly deferred per D-28. Phase 1 creates CHANGELOG.md with a single v1.2.0 entry; v1.0/v1.1 backfill is either a future docs pass or never.
- **`origin:` YAML tag audit as its own pass** — the `origin:ECC` pattern hid cruft once (`configure-ecc`). A dedicated pass to audit all `origin:` tags against their actual content could be its own future activity, but Phase 1 handles it implicitly through the cruft filter's positive test.

### Reviewed Todos (not folded)

None. The only item in `.planning/STATE.md#Todos` is "Plan Phase 1 via `/gsd-plan-phase 1`" which is the next step after this CONTEXT.md is written, not scope to fold.

</deferred>

---

*Phase: 01-skill-audit-prune-rc-gate*
*Context gathered: 2026-04-12*
