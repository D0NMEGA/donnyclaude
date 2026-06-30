# Browser research

donny's research agents can drive a real Chrome through the Playwright MCP
(`mcp__playwright__*`) to read JavaScript-gated or login-walled pages that plain
HTTP cannot reach. This is the subagent-safe browser path: browser-harness only
works on the main thread, so subagent researchers use the Playwright MCP instead.

## The toggle: `workflow.browser_research`

- `true` (default): research agents may open the browser when a page needs it.
  They still try HTTP, Context7, and WebFetch first and only reach for Chrome
  when those are not enough.
- `false`: research stays HTTP-only. Agents never open the browser.

Set it per project with `/donny-settings`, or directly:

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" config-set workflow.browser_research false
```

The resolved value reaches a workflow as `browser_research_enabled` and is passed
into each researcher's prompt so the agent knows whether the browser is allowed.

## Headless

Whether a visible Chrome window appears is decided by how the Playwright MCP
server is configured, not by donny. To keep it invisible, run the MCP headless
(the `@playwright/mcp` server takes a `--headless` flag). Disabling
`browser_research` is the way to avoid the browser entirely.

## The one-time notice

The first time a user reaches research in `/donny-plan-phase` with
`browser_research` on, the workflow shows a one-time notice explaining that a
real Chrome may open and offering to disable it. The acknowledgement is recorded
globally at `~/.donny/.browser-notice-ack`, so the notice appears once per user,
not once per project. Choosing "Disable" writes `workflow.browser_research:
false` to the current project's config and to `~/.donny/defaults.json` so new
projects inherit the preference.
