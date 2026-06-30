<purpose>
Interactive configuration of Donny workflow agents (research, plan_check, verifier), pipeline,
quality gates, output mode, git, and model profile. Updates `.planning/config.json`. Optionally
saves the result as global defaults (`~/.donny/defaults.json`) for future projects.

Settings are presented in small grouped prompts (progressive disclosure) rather than one long blast,
and every configurable key is reachable here - including `text_mode` and `discuss_mode`, which were
previously editable only by hand.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="ensure_and_load_config">
Ensure config exists and load current state:

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" config-ensure-section
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" state load)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Creates `.planning/config.json` with defaults if missing and loads current config values.
</step>

<step name="read_current">
Read current values from `.planning/config.json` (use the Read tool, not `cat`). Parse, defaulting
sensibly when a key is absent:

- `model_profile` - which model each agent uses (default `balanced`)
- `workflow.research` - spawn researcher during plan-phase (default `true`)
- `workflow.browser_research` - research agents may open a real Chrome via the Playwright MCP for JS-gated pages; `false` keeps research HTTP-only (default `true`)
- `workflow.plan_check` - spawn plan checker during plan-phase (default `true`)
- `workflow.verifier` - spawn verifier during execute-phase (default `true`)
- `workflow.max_replan_iterations` - cap on plan<->check revision rounds before `--auto` escalates to a decision checkpoint (default `2`)
- `workflow.auto_advance` - chain discuss -> plan -> execute (default `false`)
- `workflow.skip_discuss` - skip discuss in autonomous mode (default `false`)
- `workflow.discuss_mode` - `"discuss"` (full questioning) or `"assumptions"` (surface assumptions to confirm) (default `"discuss"`)
- `workflow.use_worktrees` - parallel executors run in worktree isolation (default `true`)
- `workflow.nyquist_validation` - validation research during plan-phase (default `true`)
- `workflow.ui_phase` - generate UI-SPEC.md for frontend phases (default `true`)
- `workflow.ui_safety_gate` - prompt to run /donny-ui-phase before frontend phases (default `true`)
- `workflow.ui_review` - retroactive UI visual audit (/donny-ui-review) after frontend phases (default `true`)
- `workflow.research_before_questions` - web search before question groups (default `false`)
- `workflow.text_mode` - plain-text numbered lists instead of AskUserQuestion menus; needed for remote `/rc` sessions where TUI menus do not render (default `false`)
- `git.branching_strategy` - `"none"`, `"phase"`, or `"milestone"` (default `"none"`)
- `hooks.context_warnings` - advisory messages when context fills up (default `true`)
</step>

<step name="present_settings">
Present the settings in **four small groups** (progressive disclosure). Pre-select each option to the
current value read above so the user only changes what they want. Each group is one AskUserQuestion call.

**Group 1 - Model & agents:**
```
AskUserQuestion([
  { header: "Model", question: "Which model profile for agents?", multiSelect: false, options: [
      { label: "Quality", description: "Opus everywhere except verification (highest cost)" },
      { label: "Balanced (Recommended)", description: "Opus for planning, Sonnet for research/execution/verification" },
      { label: "Budget", description: "Sonnet for writing, Haiku for research/verification (lowest cost)" },
      { label: "Inherit", description: "Use the current session model for all agents (OpenRouter, local models, runtime switching)" } ] },
  { header: "Research", question: "Spawn Plan Researcher? (researches domain before planning)", multiSelect: false, options: [
      { label: "Yes", description: "Research phase goals before planning" },
      { label: "No", description: "Skip research, plan directly" } ] },
  { header: "Plan Check", question: "Spawn Plan Checker? (verifies plans before execution)", multiSelect: false, options: [
      { label: "Yes", description: "Verify plans meet phase goals" },
      { label: "No", description: "Skip plan verification" } ] },
  { header: "Verifier", question: "Spawn Execution Verifier? (verifies phase completion)", multiSelect: false, options: [
      { label: "Yes", description: "Verify must-haves after execution" },
      { label: "No", description: "Skip post-execution verification" } ] }
])
```

**Group 2 - Pipeline:**
```
AskUserQuestion([
  { header: "Auto", question: "Auto-advance pipeline? (discuss -> plan -> execute automatically)", multiSelect: false, options: [
      { label: "No (Recommended)", description: "Manual /clear + paste between stages" },
      { label: "Yes", description: "Chain stages via Task() subagents (same isolation)" } ] },
  { header: "Skip Discuss", question: "Skip discuss-phase in autonomous mode? (use ROADMAP goals as spec)", multiSelect: false, options: [
      { label: "No (Recommended)", description: "Run smart discuss before each phase" },
      { label: "Yes", description: "Skip discuss in /donny-autonomous - chain directly to plan" } ] },
  { header: "Discuss Mode", question: "How should discuss-phase work before planning?", multiSelect: false, options: [
      { label: "Discuss (Recommended)", description: "Full questioning that captures your decisions into CONTEXT.md" },
      { label: "Assumptions", description: "Surface Claude's key assumptions for you to confirm or correct (lighter touch)" } ] },
  { header: "Worktrees", question: "Use git worktrees for parallel agent isolation?", multiSelect: false, options: [
      { label: "Yes (Recommended)", description: "Each parallel executor runs in its own worktree branch - no conflicts" },
      { label: "No", description: "Disable worktree isolation. Use where EnterWorktree is broken; agents run sequentially" } ] }
])
```

**Group 3 - Quality gates:**
```
AskUserQuestion([
  { header: "Nyquist", question: "Enable Nyquist Validation? (researches test coverage during planning)", multiSelect: false, options: [
      { label: "Yes (Recommended)", description: "Research automated test coverage; add validation requirements; block approval if tasks lack automated verify" },
      { label: "No", description: "Skip validation research. Good for rapid prototyping or no-test phases" } ] },
  { header: "UI Phase", question: "Enable UI Phase? (generates UI-SPEC.md for frontend phases)", multiSelect: false, options: [
      { label: "Yes (Recommended)", description: "Generate UI design contracts before planning frontend phases" },
      { label: "No", description: "Skip UI-SPEC generation. Good for backend-only or API phases" } ] },
  { header: "UI Gate", question: "Enable UI Safety Gate? (prompts to run /donny-ui-phase before frontend phases)", multiSelect: false, options: [
      { label: "Yes (Recommended)", description: "plan-phase asks to run /donny-ui-phase first when frontend indicators are detected" },
      { label: "No", description: "No prompt - plan-phase proceeds without a UI-SPEC check" } ] },
  { header: "Research Qs", question: "Research best practices before asking questions? (web search during init and discuss-phase)", multiSelect: false, options: [
      { label: "No (Recommended)", description: "Ask questions directly. Faster, fewer tokens" },
      { label: "Yes", description: "Search the web for best practices before each question group. More informed, more tokens" } ] }
])
```

**Group 4 - Output & git:**
```
AskUserQuestion([
  { header: "Text Mode", question: "Plain-text mode? (numbered lists instead of TUI menus)", multiSelect: false, options: [
      { label: "No (Recommended)", description: "Use AskUserQuestion menus" },
      { label: "Yes", description: "Plain-text numbered lists you answer by typing a number. Required for remote /rc sessions where TUI menus do not render" } ] },
  { header: "Branching", question: "Git branching strategy?", multiSelect: false, options: [
      { label: "None (Recommended)", description: "Commit directly to the current branch" },
      { label: "Per Phase", description: "Branch per phase (donny/phase-{N}-{name})" },
      { label: "Per Milestone", description: "Branch per milestone (donny/{version}-{name})" } ] },
  { header: "Ctx Warnings", question: "Enable context window warnings? (advisory when context fills up)", multiSelect: false, options: [
      { label: "Yes (Recommended)", description: "Warn when context usage exceeds 65%. Helps avoid losing work" },
      { label: "No", description: "Disable warnings. Allows reaching auto-compact naturally. Good for long unattended runs" } ] },
  { header: "Browser", question: "Allow browser research? (research agents open a real Chrome via the Playwright MCP for JS-gated pages)", multiSelect: false, options: [
      { label: "Yes (Recommended)", description: "Research agents may open the browser when HTTP and Context7 are not enough. Configure the Playwright MCP headless to avoid a visible window" },
      { label: "No", description: "HTTP-only research; never opens a browser" } ] }
])
```

Note: Nyquist validation depends on research output. If research is disabled, plan-phase skips the
Nyquist steps automatically (no RESEARCH.md to extract from).
</step>

<step name="update_config">
Merge the answers into existing config.json (merge, not replace):

```json
{
  ...existing_config,
  "model_profile": "quality" | "balanced" | "budget" | "inherit",
  "workflow": {
    "research": true/false,
    "browser_research": true/false,
    "plan_check": true/false,
    "verifier": true/false,
    "auto_advance": true/false,
    "nyquist_validation": true/false,
    "ui_phase": true/false,
    "ui_safety_gate": true/false,
    "text_mode": true/false,
    "research_before_questions": true/false,
    "discuss_mode": "discuss" | "assumptions",
    "skip_discuss": true/false,
    "use_worktrees": true/false
  },
  "git": {
    "branching_strategy": "none" | "phase" | "milestone",
    "quick_branch_template": <string|null>
  },
  "hooks": {
    "context_warnings": true/false,
    "workflow_guard": true/false
  }
}
```

Write the updated config to `.planning/config.json`.
</step>

<step name="save_as_defaults">
Ask whether to save these as global defaults for future projects:

```
AskUserQuestion([
  { header: "Defaults", question: "Save these as default settings for all new projects?", multiSelect: false, options: [
      { label: "Yes", description: "New projects start with these settings (saved to ~/.donny/defaults.json)" },
      { label: "No", description: "Only apply to this project" } ] }
])
```

If "Yes": `mkdir -p ~/.donny` and write `~/.donny/defaults.json` with `model_profile`,
`branching_strategy`, and the full `workflow` block (including `text_mode` and `discuss_mode`),
minus project-specific fields.
</step>

<step name="confirm">
Display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► SETTINGS UPDATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Setting              | Value |
|----------------------|-------|
| Model Profile        | {quality/balanced/budget/inherit} |
| Plan Researcher      | {On/Off} |
| Plan Checker         | {On/Off} |
| Execution Verifier   | {On/Off} |
| Auto-Advance         | {On/Off} |
| Skip Discuss         | {On/Off} |
| Discuss Mode         | {Discuss/Assumptions} |
| Worktrees            | {On/Off} |
| Nyquist Validation   | {On/Off} |
| UI Phase             | {On/Off} |
| UI Safety Gate       | {On/Off} |
| Research Before Qs   | {On/Off} |
| Text Mode            | {On/Off} |
| Git Branching        | {None/Per Phase/Per Milestone} |
| Context Warnings     | {On/Off} |
| Saved as Defaults    | {Yes/No} |

These settings apply to future /donny-plan-phase and /donny-execute-phase runs.

Quick commands:
- /donny-settings <profile> - switch model profile directly
- /donny-plan-phase --research - force research
- /donny-plan-phase --skip-research - skip research
- /donny-plan-phase --skip-verify - skip plan check
```
</step>

</process>

<success_criteria>
- [ ] Current config read (including text_mode and discuss_mode)
- [ ] User presented with all 15 settings across four grouped prompts (progressive disclosure, no single long blast)
- [ ] text_mode and discuss_mode are settable interactively and shown in the confirmation
- [ ] Config updated with model_profile, workflow, git, and hooks sections (merge, not replace)
- [ ] User offered to save as global defaults (~/.donny/defaults.json), defaults include text_mode/discuss_mode
- [ ] Changes confirmed to the user
</success_criteria>
