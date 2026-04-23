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

## D3 Final Decision (post-follow-up-fetches)

Appended: 2026-04-23 UTC after fetching `platform.claude.com/docs/en/managed-agents/environments` and `platform.claude.com/docs/en/managed-agents/sessions`.

### Verdict: C - BUILD (unchanged). Keep bespoke Docker orchestration for D3.

### Blocker 1 resolution: DEFINITIVELY BLOCKED

Primary source: `platform.claude.com/docs/en/managed-agents/environments`. The Environments API accepts exactly one config `type` value: `"cloud"`. The documented configuration fields are:

- `packages`: manifest layered on Anthropic's base container. Supported package managers are `apt`, `cargo`, `gem`, `go`, `npm`, `pip`. Values are package names with optional version pins (e.g., `"pandas==2.2.0"`, `"ffmpeg"`, `"ripgrep@14.0.0"`).
- `networking`: either `unrestricted` or `limited` with `allowed_hosts`, `allow_mcp_servers`, `allow_package_managers`.
- Pre-installed runtimes are fixed by Anthropic: "Cloud containers include common runtimes out of the box" (Python, Node.js, Go, etc. per Container reference).

**No `base_image`, no `dockerfile`, no `image_ref`, no OCI registry reference, no arbitrary Docker image parameter exists anywhere in the Create Environment payload.** There is no documented way to pull `jefzda/sweap-images:astropy-11693`, `starryzhang/sweb.eval.*`, Terminal-Bench-Core per-task images, or any third-party registry image into a Managed Agents session.

AHOL's benchmark pipeline depends on per-task pinned Docker images from third-party registries (SWE-Bench Pro via jefzda, SWE-bench-Live via starryzhang, Terminal-Bench-Core v0.1.1, HAL SWE-bench Verified Mini, BigCodeBench-Hard). These images are NOT expressible as package manifests on Anthropic's base cloud container. The test harnesses, test databases, pinned compiler versions, and repo-specific environment configurations in the upstream images cannot be reconstructed via `apt` + `pip` + `npm` layering.

Blocker 1 is confirmed in the strongest form.

### Blocker 4 resolution: NOT CONFIRMED AS 4h, but no guaranteed ceiling either

Primary source: `platform.claude.com/docs/en/managed-agents/sessions`. The Sessions API reference does not mention any explicit session duration cap. There is no `max_duration_hours` parameter in Create Session. No explicit maximum appears in the Session statuses table (`idle`, `running`, `rescheduling`, `terminated`).

The Medium article's `max_duration_hours: 4` claim appears to be fabricated, outdated, or from an earlier beta iteration. It is not reproduced in current primary docs.

However, the absence of a stated cap is NOT the same as a guaranteed unlimited duration. Anthropic's overview page describes Managed Agents as best for "Long-running execution: Tasks that run for minutes or hours with multiple tool calls." This suggests hours-scale is supported but does not promise arbitrary duration. Sessions can be `archived` and `deleted`, and can enter `terminated` status on unrecoverable errors.

Blocker 4 does not hold in the specific form claimed (4h hard cap). But it cannot be relied on to resolve favorably for AHOL at arbitrary run length either. Moot regardless: blocker 1 alone is sufficient to reject.

### Why blocker 1 alone is sufficient

AHOL is fundamentally a benchmark runner. Benchmark tasks run inside benchmark-specific Docker images, each with its own repo snapshot, test harness, and pinned toolchain. The whole point of benchmark containers is that they CANNOT be reconstructed from package manifests on a generic base. SWE-bench Verified Mini, Terminal-Bench-Core, and BigCodeBench-Hard each ship prebuilt images precisely because reconstructing them at runtime is error-prone and version-drift-prone.

Managed Agents' Anthropic-curated-base + package-overlay model is architecturally oriented toward user-facing agent applications (data analysis, code assistant, research helper) where the runtime environment is the developer's choice. Benchmark runners are a different product category. Adopting Managed Agents for AHOL D3 would require either:

- Rewriting AHOL-Proxy-30, SWE-Bench Pro, and SWE-bench-Live to NOT use their upstream images (significant reduction in benchmark validity; invalidates leaderboard-comparable claims)
- Running the benchmark's Docker image INSIDE a Managed Agents container via nested virtualization (not documented as supported; likely not permitted; Anthropic's sandbox model is explicit about user code running inside a SINGLE container, not docker-in-docker)

Both options defeat the purpose. Bespoke Docker orchestration on the user's machine (or a single VPS) directly uses the upstream images at their pinned SHAs, preserving benchmark integrity.

### Build-hour impact

No change from REALITY-CHECK.md estimate. D3 stays ~20h bespoke Docker orchestration. No ~15 to 25h savings realized.

### Corrections to REALITY-CHECK.md worth noting (no D3 impact, but clarifies record)

Even though the D3 decision is unchanged, the following claims in REALITY-CHECK.md were misstated by secondary sources and should be read with caution in any future decision:

- "No trace export (Console inspect only)" is wrong. Managed Agents exposes programmatic event history via the Sessions API and SSE streaming. If a future phase of donnyclaude work benefits from Managed Agents for non-benchmark use (e.g., long-running user agents with external observability requirements), this capability matters.
- "Parallel fan-out research-preview-gated" is wrong. Independent parallel sessions are rate-limited (60 create per minute) but not gated. Only `multiagent` (parent-child orchestration) is preview.
- "4h session cap" is unconfirmed; treat as unknown rather than true.

These corrections do not reopen D3 for AHOL, but they should be remembered if Managed Agents becomes relevant to a non-benchmark AHOL use case (e.g., deploying a donnyclaude-optimized agent as a service).

### Remaining risks with bespoke Docker (unchanged from prior plan)

- Local Docker Desktop on a 2018 MBP is the spike substrate; may not reflect production conditions if AHOL graduates to a cloud VM. Low priority until spike passes.
- Registry rate limits on Docker Hub for pulling benchmark images (first pull of 30 AHOL-Proxy-30 images is bursty). Mitigation: pre-pull in bootstrap.sh, which already exists as Task 4.
- The `ahol-variant-V*-*` container naming convention from DOCKER-API-CHOICE.md assumes exclusive use of that prefix; any cross-process name collision would cause AHOL cleanup to affect unrelated containers. Mitigation: document the naming convention in the AHOL bootstrap docs so users know not to co-opt the prefix.

### No planning-artifact rework required

The BUILD verdict is the same as originally decided. `spike-results.md`, `COST-MODEL.md`, `CONTAMINATION-ANALYSIS.md`, `DOCKER-API-CHOICE.md`, `context-budgets.md`, `contracts/`, `baseline/`, and `benchmarks/README.md` all stand as written. No updates needed.

### What DOES need doing (optional, low priority)

If you want to reflect the blocker corrections in REALITY-CHECK.md for future-reader accuracy:
- Add a one-paragraph "Post-Task-9 correction" section noting blockers 3 and 5 were misstated, and blocker 4 unconfirmed, but D3 decision unchanged due to blocker 1 (~15 minutes edit).
- Optional; does not affect any downstream decision.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
