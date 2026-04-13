# Archived Skills

These are skills archived during the v1.2 prune pass. They are **NOT** installed by `npx donnyclaude` — the install path in `bin/donnyclaude.js` copies from `packages/skills/` only, so anything in this directory is invisible at install time. They are also not counted by `tests/install.test.js`.

For the per-skill rationale of why each archive happened, see [`docs/PRUNE-LOG.md`](../../docs/PRUNE-LOG.md). Every row in that file includes a copy-pasteable `restore_command` that moves the archived skill back to `packages/skills/` — no translation required if you need a removed skill back.
