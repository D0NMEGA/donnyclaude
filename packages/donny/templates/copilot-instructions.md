# Instructions for Donny

- Use the donny skill when the user asks for Donny or uses a `donny-*` command.
- Treat `/donny-...` or `donny-...` as command invocations and load the matching file from `.github/skills/donny-*`.
- When a command says to spawn a subagent, prefer a matching custom agent from `.github/agents`.
- Do not apply Donny workflows unless the user explicitly asks for them.
- After completing any `donny-*` command (or any deliverable it triggers: feature, bug fix, tests, docs, etc.), ALWAYS: (1) offer the user the next step by prompting via `ask_user`; repeat this feedback loop until the user explicitly indicates they are done.
