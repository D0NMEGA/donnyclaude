# WS-1 hooks.json registration patch

Target file: `packages/hooks/hooks.json` (orchestrator applies, per constraint
that WS-1 does not directly modify this file). Template-source update should
also be reflected in `packages/core/settings-template.json` if the orchestrator
promotes the skill-index hook to the user-level settings merge; as shipped in
this workstream, settings-template.json already carries the skills config knob
(`skills.autoInvoke`) but does not register the skill-index hook itself since
the skill-index hook is plugin-scoped via hooks.json.

## Shape verification

Read of `packages/hooks/hooks.json` confirms:

- Top-level structure is `{ "$schema": "...", "hooks": { "<event>": [...] } }`.
- Each event array contains objects of shape `{ "matcher": "...", "hooks": [...], "description": "..." }`.
- Each inner `hooks[]` entry is `{ "type": "command", "command": "...", "timeout"?: <seconds> }`.
- Existing hook scripts live under `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/` (ECC convention) or
  under `$HOME/.claude/hooks/` (DonnyClaude template convention in `settings-template.json`).
- The existing SessionStart entry uses `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js`
  to invoke `session-start.js` (see line 139 of the referenced hooks.json). We register
  alongside it as an additional, independent SessionStart entry so both fire in order.

## Add to the SessionStart array (additive, alongside existing entries)

Append the following object inside `hooks.SessionStart` (array index after the existing
`session-start.js` wrapper entry). Do not replace the existing entry.

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/skill-index.js\"",
      "timeout": 5
    }
  ],
  "description": "WS-1 skill progressive disclosure: emit a prompt-aware manifest of the top-K most relevant skills at session start, so full SKILL.md bodies load only when referenced by name."
}
```

If the orchestrator promotes this into `packages/core/settings-template.json` for the
user-scope merge (hooks there point to `$HOME/.claude/hooks/<name>.js` rather than
`${CLAUDE_PLUGIN_ROOT}`), use this equivalent shape in that template instead:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/skill-index.js\"",
      "timeout": 5
    }
  ]
}
```

## No other hooks.json changes.
