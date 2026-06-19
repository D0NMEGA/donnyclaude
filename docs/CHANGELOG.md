# Changelog

All notable changes to donnyclaude are recorded here. Releases before v1.2.0 predate this changelog; see `git log --oneline` for history.

## [2.0.0] - 2026-06-19

The `cco-*` substrate — a generation of harness work done on macOS (Claude Code 2.1.x, Opus) — lands in the package via three new install component types (`bin/`, `cco-memory/`, `statusline.py`) plus the hooks/skills/commands that drive them.

### Added
- **`cco-*` CLI tools** (`~/.claude/bin/`): `cco-dream` (bounded, sleep-surviving overnight autonomous loop on a git-worktree surface), `cco-eval` (declarative structured-eval CLI), `cco-vault-audit` (agent-runnable Obsidian-vault hygiene — orphans/broken-links/frontmatter, curated-vs-journal aware), `cco-ledger`/`cco-hooks`/`cco-anatomy-scan` (cost + hook observability).
- **`cco-*` hooks** (13, all fail-open): `cco-permission-guard` (catastrophe denylist), `cco-green-gate` (test/lint loop), the `cco-compact-nudge` + `cco-precompact-snapshot` + `cco-postcompact` 1M-context safety chain, `cco-cerebrum-recall/check` (cross-session memory), `cco-instinct-observe`, `cco-file-index`, `cco-vault-capture`, `cco-vault-audit-nudge`.
- **Statusline** (`statusline.py`) — at-a-glance harness state.
- **`cco-memory/`** substrate: `cco-instinct.py` (eval-gated, self-pruning, hard-capped instinct engine — metadata-only + human-gated), `cco-eval.py`, pricing table.
- **`web-research` skill** + commands `cco-panel` (cost-gated judge panel), `cco-evolve` (operator-gated instinct→skill promotion), `dream`.
- **Settings template** registers the cco-* hooks + statusline and ships safe `permissions.deny` defaults (secrets + catastrophe commands), `defaultMode: acceptEdits`.
- **`donnyclaude install`** subcommand — install/refresh tools without launching the wizard (headless/CI/reinstall).

### Notes
- Safe by default: `acceptEdits` (never `bypassPermissions`); every cco-* hook fails open and no-ops without its optional deps (e.g. an Obsidian vault at `~/vault`).
- Companion research tools `browser-harness` + the `scrapers` toolkit are separate installs (real Chrome + Python); the bundled `web-research` skill documents how to wire them.

## [1.2.0] - 2026-04-13

### Removed
- **configure-ecc** — installer for an unrelated project (`everything-claude-code`). Its Step 0 `git clone`s a different repo into `/tmp`. Archived to `packages/_archived-skills/`.
- **continuous-learning** — version-superseded duplicate of `continuous-learning-v2` (v2.1.0 is a strict superset with 100% reliable hook observation, atomic instincts with confidence scoring, project scoping, and six commands). Archived to `packages/_archived-skills/`.

Skill count: 107 → 105.

### Deferred
- The broader training-duplicate prune originally scoped for v1.2 (20-30 language-pattern and methodology skills) is deferred to v1.3 pending rubric redesign. The initial rubric's calibration pre-flight surfaced that clause (c) cannot reliably distinguish training-duplicate skills from catalog cross-links in the current distribution — every candidate skill has the same bare-pointer referrer pattern as the skills the plan explicitly protected (tdd-workflow, e2e-testing). See [`docs/PRUNE-LOG.md`](PRUNE-LOG.md) and `.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md#Corrections` for the full analysis. Partial audit artifacts preserved at `.planning/research/v1.3-seeds/` as v1.3 research inputs.

See [`docs/PRUNE-LOG.md`](PRUNE-LOG.md) for per-skill rationale and restore commands.
