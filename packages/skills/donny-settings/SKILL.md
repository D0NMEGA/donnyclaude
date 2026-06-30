---
name: donny-settings
description: "Configures Donny workflow toggles and the model profile. With no argument, runs the interactive settings flow (agents, pipeline, quality gates, git, model, and the text_mode/discuss_mode options); with a profile name, switches the model profile directly. Use to tune which agents run, the model tier, branching, and other workflow options."
argument-hint: "[quality|balanced|budget|inherit]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---


<objective>
Configure Donny's workflow toggles and model profile, written to `.planning/config.json`.

Two paths, chosen by $ARGUMENTS:
- **Fast path** - when $ARGUMENTS is a profile name (`quality`, `balanced`, `budget`, or `inherit`),
  switch the model profile directly and show the tool output verbatim. This is the former
  `set-profile` alias, folded in.
- **Interactive path** - when $ARGUMENTS is empty, run the full settings workflow (grouped,
  progressive-disclosure prompts covering agents, pipeline, quality gates, git, context, model,
  and the text_mode / discuss_mode options).
</objective>

<execution_context>
@~/.claude/donny/workflows/settings.md
</execution_context>

<process>
Branch on $ARGUMENTS:

**If $ARGUMENTS is exactly one of `quality` / `balanced` / `budget` / `inherit`** (fast path), run
this with the Bash tool and show its output verbatim, with no extra commentary, then stop:

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" config-set-model-profile $ARGUMENTS --raw
```

**Otherwise** (no argument, or anything that is not a valid profile name), follow the settings
workflow from `@~/.claude/donny/workflows/settings.md` end-to-end. If an argument was given but is
not a valid profile, note that and fall through to the interactive flow.

Do not pre-execute the Bash command on the interactive path - only the fast path runs it.
</process>
