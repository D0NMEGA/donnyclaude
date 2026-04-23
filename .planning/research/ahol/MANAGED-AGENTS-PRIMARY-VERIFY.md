# Managed Agents Primary-Source Re-Verification

Generated: 2026-04-23 UTC
Purpose: Task 9 (Group C gate). Re-fetch Anthropic Managed Agents primary documentation directly and verify all 5 hard blockers from Task 1 REALITY-CHECK.md. If any blocker was misstated in secondary sources, reopen the D3 build-vs-adopt decision before Group C spike execution.
Primary sources consulted:
- `https://platform.claude.com/docs/en/managed-agents/overview` (official platform docs, fetched 2026-04-23)
- `https://platform.claude.com/docs/en/release-notes/overview` (official release notes, fetched 2026-04-23)
- `https://www.anthropic.com/engineering/managed-agents` (Anthropic engineering blog, fetched 2026-04-23)
Hard constraint: no em dashes anywhere.

## Headline finding

**3 of 5 blockers from REALITY-CHECK.md were misstated or unconfirmed by primary sources. The D3 build-vs-adopt decision must be reopened before Group C spike execution.**

The original reject-Managed-Agents verdict was based on two secondary-source writeups (unite.ai launch coverage and a Medium fine-print article). Primary documentation contradicts the "no trace export" and "research-preview-gated parallel fan-out" claims outright, and complicates the "no Docker-in-session" claim. The "4h session cap" claim is not confirmed by primary sources. Only the "no scheduled execution" claim survives re-verification.

## Per-blocker verdicts

### Blocker 1: No Docker-in-session

**Original claim (REALITY-CHECK.md):** "Anthropic coverage refers to Anthropic-managed isolation of Claude's generated code, not user-supplied containers... Managed Agents does not document a way to pull or run [user-supplied benchmark] images inside a session."

**Primary-source finding:** Managed Agents has an explicit **Environments API**: "Configure a cloud container with pre-installed packages (Python, Node.js, Go, etc.), network access rules, and mounted files" (platform docs overview, "Core concepts" section). This contradicts the blanket "no Docker-in-session" framing.

**Resolution status:** **MISSTATED** in original REALITY-CHECK, but incompletely refuted. The Environments API configures containers, but the primary overview does not confirm whether users can supply arbitrary Docker IMAGES (e.g., `jefzda/sweap-images:astropy-11693`) versus only configuring an Anthropic-managed base container with user package installs and mounts. This is the load-bearing distinction for AHOL D3 adoption:

- If Managed Agents supports arbitrary user-supplied Docker images -> D3 adoption is architecturally viable for SWE-Bench Pro and AHOL-Proxy-30 tasks (which require per-task pinned images)
- If Managed Agents only supports package-configured templates -> D3 adoption is still ruled out for benchmark use (can't load per-task test harness containers)

**Follow-up required before D3 decision:** Fetch `https://platform.claude.com/docs/en/managed-agents/environments` (Environments API reference) and confirm. Budget: 1 additional WebFetch call. Not done in this verification pass to keep Task 9 bounded.

### Blocker 2: No scheduled execution

**Original claim:** "Fine-print article explicitly contrasts Managed Agents with Cabinet ('scheduled cron jobs run recurring tasks 24/7') and notes Managed Agents is on-demand only. D5 calendar scheduler still required."

**Primary-source finding:** The platform overview describes session lifecycle as "Start a session" / "Launch a session" via API call. No cron, schedule, or trigger primitive appears in the "How it works" steps or the "Rate limits" table. The engineering blog discusses only event-driven and on-demand patterns. Scheduled execution is not mentioned in any primary source examined.

**Resolution status:** **CONFIRMED.** D5 calendar scheduler still required. This blocker is load-bearing for AHOL's cadence model (5-hour Claude Max reset windows) and is unaffected by the Managed Agents re-verification.

### Blocker 3: No trace export (Console inspect only)

**Original claim:** "AHOL's architecture writes task results to a local SQLite for aggregation across 240 task-runners. Inspect-only via Console is incompatible: the orchestrator needs machine-readable return-contract JSON, not a human-readable console UI."

**Primary-source finding:** Managed Agents streams session activity via Server-Sent Events at `GET /v1/sessions/{id}/stream`. Per the platform overview: "Send user messages as events. Claude autonomously executes tools and streams back results via server-sent events (SSE). **Event history is persisted server-side and can be fetched in full.**" (emphasis added). This is programmatic, machine-readable access to full event history, not Console-inspect-only.

**Resolution status:** **MISSTATED.** Secondary Medium article's claim "Session tracing ... inspect every tool call. No mention of exporting traces for external analysis" was wrong or out-of-date. Primary docs confirm programmatic full-history retrieval.

Implication for AHOL: Managed Agents event-history API is actually COMPATIBLE with AHOL's SQLite aggregation model. Task-runner subagents could fetch session event history post-completion and write structured rows to the local SQLite, rather than writing during execution. This would be an architectural change but not a blocker.

### Blocker 4: 4-hour session cap

**Original claim:** "Max session duration: 4 hours (per the fine-print article, `max_duration_hours: 4` appears in sample code)."

**Primary-source finding:** The platform overview does not state a session duration cap. It describes Managed Agents as "Best for: Long-running tasks and asynchronous work" and "Tasks that run for minutes or hours". No explicit maximum appears on the overview page.

**Resolution status:** **NOT CONFIRMED.** The Medium article's `max_duration_hours: 4` could be (a) a default value rather than a ceiling, (b) a per-user configurable parameter, (c) an out-of-date constraint from an earlier beta, or (d) a constraint documented in the Sessions API reference not fetched in this pass.

**Follow-up required before D3 decision:** Fetch `https://platform.claude.com/docs/en/managed-agents/sessions` (Sessions API reference) and confirm. Budget: 1 additional WebFetch call. Not done in this verification pass.

### Blocker 5: Parallel fan-out research-preview-gated

**Original claim:** "Multi-agent coordination requires separate access and is research preview. AHOL needs 8 variant-runners in parallel, plus 30 task-runners per variant. The restricted-access model is not suitable for this fan-out pattern."

**Primary-source finding:** The platform overview explicitly identifies which features are research-preview-gated: "Certain features (outcomes, multiagent, and memory) are in research preview. Request access to try them." **The gated feature is `multiagent`** (defined elsewhere as "agents spawn and direct other agents", i.e., parent-child orchestration). This is NOT the same as running N independent sessions in parallel.

Running N independent sessions in parallel is governed only by rate limits: "Create endpoints (agents, sessions, environments, etc.): 60 requests per minute". AHOL's 8 parallel variant-runners plus 240 task-runners spread over a dev-round timescale fits comfortably within 60-create-per-minute.

**Resolution status:** **MISSTATED.** Secondary sources conflated `multiagent` (parent-child orchestration, gated) with "parallel fan-out" (independent concurrent sessions, not gated). AHOL needs the latter, which is not gated.

## Reopened D3 decision: should Managed Agents be adopted after all?

Per user instruction: "If any blocker was misstated in secondary sources, reopen the D3 build-vs-adopt decision before continuing."

The question is no longer a clean BUILD vs ADOPT. With blockers 3 and 5 removed and blocker 1 complicated, the adopt case becomes:

**Arguments for adopting Managed Agents for D3:**
- Eliminates bespoke Docker orchestration (`~`20h build saved per REALITY-CHECK)
- SSE streaming + full event history retrieval compatible with AHOL's SQLite aggregation (blocker 3 resolution)
- Parallel session fan-out within rate limits is not gated (blocker 5 resolution)
- Managed sandboxing, credential handling, state management come for free
- Consistent cost model ($0.08/session-hour + tokens) vs self-hosted Docker compute time

**Arguments against adopting Managed Agents for D3:**
- Blocker 2 (no scheduled execution) is confirmed; D5 still needed
- Blocker 4 (4-hour session cap) is not confirmed but if true would be tight for 30-task AHOL-Proxy-30 runs at V4-like token cost
- Blocker 1 (Docker image) is incompletely refuted; if Environments API only supports package-configured base templates rather than arbitrary user-supplied SWE-bench Docker images, adoption is architecturally blocked for benchmark use
- Third-party dependency for a load-bearing AHOL component (tied to Anthropic's roadmap and pricing)
- Public beta status: Anthropic's overview page notes "Behaviors may be refined between releases to improve outputs" (implicit API stability risk)

**Recommended next action:** Before committing to reopen or close the D3 decision, complete two more focused WebFetch calls:

1. `https://platform.claude.com/docs/en/managed-agents/environments` to determine whether the Environments API supports arbitrary user-supplied Docker images (resolves blocker 1).
2. `https://platform.claude.com/docs/en/managed-agents/sessions` to determine the maximum session duration (resolves blocker 4).

If both resolve favorably (arbitrary Docker images supported, no hard 4h cap), D3 should switch to ADOPT Managed Agents with D5 scheduler kept as-is. If either resolves unfavorably, D3 stays BUILD bespoke Docker as originally decided.

Budget for the two follow-up fetches: under 30 minutes, under 100K tokens.

## Other primary-source facts worth capturing

- **Launch date confirmed:** April 8, 2026 (release notes dated entry).
- **Beta header confirmed:** `managed-agents-2026-04-01`.
- **Public beta status confirmed.** Anthropic does not specify GA target.
- **Pricing not confirmed in primary overview.** The $0.08/session-hour claim from secondary sources is plausible and not contradicted, but was not found on the fetched overview page. Full pricing page at `https://docs.anthropic.com/en/docs/about-claude/pricing` should be checked if pricing becomes a decision input.
- **Tool surface:** Bash, File operations (Read, Write, Edit, Glob, Grep), Web search and fetch, MCP servers. Native built-ins. Consistent with Claude Code CLI tool surface, not a reduced subset.
- **Research-preview-gated features:** outcomes, multiagent, memory. None of these are load-bearing for V0 vs V4 AHOL spike.
- **Rate limits:** 60 create per minute, 600 read per minute. Organization-level spend limits and tier-based limits also apply.
- **Branding constraint:** "Not permitted: Claude Code or Claude Code Agent, Claude Cowork or Claude Cowork Agent." donnyclaude's positioning as a Claude Code distribution is unaffected by Managed Agents branding rules.

## Audit trail

Primary-source cites included inline above. All fetched 2026-04-23 within the Task 9 budget (under 30 minutes, under 50K tokens consumed so far).

## Recommended disposition

1. **Do NOT commit this document under a subject that implies all 5 blockers confirmed.** The commit subject must accurately reflect that 3 of 5 were misstated and D3 is reopened.
2. **Do NOT proceed to Group C spike execution until the two follow-up fetches (Environments API, Sessions API) resolve blockers 1 and 4.** The 4-hour cap and arbitrary-Docker-image questions are independently load-bearing for D3 adoption.
3. **Surface the finding to user.** User explicitly gated Group C on Task 9 outcome. A "MISSTATED, D3 REOPENED" verdict triggers the surface-and-pause branch of user's instruction.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
