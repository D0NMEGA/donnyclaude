# Performance Optimization

## Model Selection Strategy

Think in tiers, not versions: point each role at the newest model in its tier
and re-check the lineup when the provider ships new models. As of 2026-07 the
lineup is the Claude 5 family (Fable 5, Sonnet 5) plus Opus 4.8 and Haiku 4.5.

- **Frontier tier (Fable 5)** - the main loop, planning, verification, and any
  judgment-heavy work.
- **Standard tier (Sonnet 5)** - the default for subagents doing real
  implementation work at lower cost.
- **Fast tier (Haiku 4.5)** - high-volume mechanical subagents: search fan-out,
  formatting, extraction, bulk edits.
- Subagents inherit the session model unless a tier override is clearly
  justified. When unsure, inherit.

## Reasoning Effort

Adaptive-reasoning models (Fable 5, Opus 4.7 and later) size their own thinking
per step; effort level is the dial, and fixed thinking budgets such as
`MAX_THINKING_TOKENS` are ignored on them.

- `effortLevel: "xhigh"` in settings.json is the recommended ceiling for hard
  coding and agentic work on Fable 5 (its built-in default is `high`).
- `max` is session-only (`/effort max`), unbounded, and prone to overthinking.
  Reach for it on a single hard problem, not as a standing default.

Version facts (flags, env vars, defaults) drift quickly: verify against the
current Claude Code docs rather than trusting a snapshot in a rules file.

## Context Window Management

Avoid the last 20% of the context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

Durable state on disk (`.planning/`, task lists) beats a longer transcript:
long-running work should survive `/clear` by design.

## Build Troubleshooting

If build fails:
1. Use **build-error-resolver** agent
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix
