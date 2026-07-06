# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)

## Permission Modes

Choose the mode deliberately and pair it with compensating controls:
- Interactive approval is the right default for exploratory work.
- Bypass/auto-accept modes are acceptable for trusted workflows only when
  guardrails exist: a `permissions.deny` list covering credential files and
  destructive commands, PreToolUse guard hooks, and a verification gate
  (lint/tests) before work is declared done.
- Whatever the mode, keep secrets unreadable: deny `.env`, `~/.ssh`,
  `~/.npmrc`, and cloud CLI config paths.

## Task Tracking Best Practices

Use the harness task-tracking tools (TodoWrite / TaskCreate, depending on
Claude Code version) to:
- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

Todo list reveals:
- Out of order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
