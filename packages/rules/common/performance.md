# Models and effort

- Use aliases, never dated ids: `opus`, `sonnet`, `haiku` track the newest model in each family.
  Set a pin (ANTHROPIC_DEFAULT_*_MODEL) only if an alias is verified to lag.
- Main agent tiers (2026-10-07): `summon` = Opus 5.5 at xhigh for every routine project session;
  `claude-ultra` = Mythos/Fable at max, reserved for judgment-heavy work (a hard discuss-phase,
  a stuck debug, an audit). Mythos is a small weekly budget; one audit day used most of it.
- Effort: the aliases set it per session and agent files set it per subagent. Never export
  CLAUDE_CODE_EFFORT_LEVEL: it overrides --effort, settings and agent effort alike (removed 2026-10-07).
- Subagents inherit the session model unless a tier is justified; pass `effort` on the Agent tool
  when a cheaper, bounded run is enough.
- On a metered plan run one bounded subagent at a time; never fan out a workflow of 16 agents at
  max effort. Clear between unrelated tasks; keep sessions short.
