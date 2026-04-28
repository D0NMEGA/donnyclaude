---
paths:
  - "**/*.cob"
  - "**/*.cbl"
  - "**/*.cpy"
  - "**/*.CBL"
  - "**/*.COB"
  - "**/*.CPY"
---
# COBOL Hooks

> This file extends [common/hooks.md](../common/hooks.md) with COBOL-specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **cobc -fsyntax-only**: Syntax-check `.cob` and `.cbl` files after edit
- **cobfmt**: Auto-format COBOL source if cobfmt is installed

## Warnings

- Warn about `GO TO` usage — prefer `PERFORM` for structured flow
- Warn about two-arg `OPEN` without checking `FILE STATUS`
- Warn about `DISPLAY` statements left in production code — use a logging copybook instead
