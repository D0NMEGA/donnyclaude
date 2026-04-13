# State of the art in AI coding agent harnesses

> **Source:** Claude Web Deep Research, run before milestone v1.2 bootstrap.
> **Purpose:** Establish the evidence base for harness optimization recommendations against donnyclaude's current configuration.
> **Consumed by:** `SUMMARY.md` synthesis, `INVENTORY.md` cross-reference, milestone v1.2 requirements + roadmap.

**The harness, not the model, is the primary lever for coding agent quality in 2026.** LangChain proved this empirically: their deepagents-cli jumped from rank 30 to rank 5 on Terminal Bench 2.0 (52.8% to 66.5%) by changing only the scaffolding around GPT-5.2-Codex. Anthropic's own data shows the same model (Opus 4.5) scoring between **45.9% and 55.4% on SWE-bench Pro** depending solely on scaffold quality. revfactory's controlled experiment across 15 SE tasks demonstrated a 60% quality improvement from structured pre-configuration, with the effect scaling by complexity: +23.8 Basic, +29.6 Advanced, +36.2 Expert. donnyclaude's 122 skills, 60 slash commands, 49 subagents, 6 hooks, and 65 rule files represent one of the largest harness configurations deployed on Claude Code's native agent loop. This report evaluates that configuration against the measured state of the art, identifies specific failure thresholds, and provides prioritized recommendations split by implementation tier.

> **Note on counts:** This report was written from an earlier description of donnyclaude. The actual code-level sweep (see `INVENTORY.md`) shows 107 skills (not 122), 70 rule files (not 65), and 8 hook files / 6 implementations / 21 lifecycle entries (not 6). The qualitative analysis remains valid — the actual numbers are if anything closer to the degradation thresholds discussed below.

---

## 1. Harness primitives: how 14 coding agents implement the core five

### The agent loop convergence

Every production harness converges on the same fundamental loop: `prompt → model → tool_call? → execute → feed_result → repeat`. What differentiates them is what wraps that loop.

**Claude Code** runs a single-threaded master loop with an asynchronous dual-buffer queue enabling mid-execution user steering. Subagents are depth-limited to 1 (no recursive spawning), preserving the single-thread mental model while enabling parallelism. The loop terminates when Claude produces a text-only response. This radical simplicity is validated by benchmark performance: Claude Code's single-threaded architecture consistently outperforms multi-agent swarms on production coding tasks.

**Cursor** separates planning from execution at the model level: one model creates plans, another implements them, a pattern they call background planning. Cursor 2.0 introduced up to 8 parallel agents isolated via git worktrees. **Aider** takes a different two-model approach with Architect mode, where a thinking model (o1, Claude) proposes changes and an editing model (DeepSeek, GPT-4o) implements them, achieving 85% benchmark accuracy.

**OpenHands** (ex-OpenDevin) stands apart with an event-sourced architecture where typed events flow through a central pub/sub hub. The V1 SDK redesign introduced a stateless single-step execution model where each `step()` call processes one reasoning cycle. This enables pause/resume and deterministic replay. **SWE-agent** takes the opposite minimalist path: a classic ReAct loop operating atop a custom Agent-Computer Interface (ACI) of shell commands. mini-SWE-agent achieves over 74% on SWE-bench Verified in approximately 100 lines of Python, demonstrating that interface design matters more than framework complexity.

**Devin** is the most vertically integrated: a layered stack of Planner LLM, lightweight executor, and sandboxed workspace, all running on the Cascade harness co-designed with their SWE-1.x models via reinforcement learning. Multi-Devin delegation (March 2026) enables breaking tasks across parallel VMs managed by OtterLink.

### Tool dispatch: from structured APIs to edit formats

The harnesses split into three paradigms. Claude Code, Cursor, OpenHands, and Codex CLI use **structured tool-call APIs** with JSON Schema validation. Claude Code exposes approximately 26 built-in tools across five categories (file operations, execution, meta/orchestration, external/MCP, and query), each implementing a Zod-validated interface. Codex CLI routes through OpenAI's Responses API, achieving server-side prompt assembly with cache-preserving append-only updates.

Aider uses **edit formats as the dispatch mechanism**, a fundamentally different approach. Instead of tool calls, the LLM outputs structured text (unified diff, custom udiff, whole-file replacement) that Aider parses. The edit format is selected based on model capability. SWE-agent similarly uses string-parsed shell commands with its custom ACI, but adds a critical innovation: **linter-gated edits** that reject syntactically invalid changes before they touch disk.

goose takes the most modular approach: **zero hardcoded tools**. Everything comes from MCP extensions. The agent core has no built-in tool implementations; developer tools, browser control, todo tracking, and cross-session search are all MCP servers. This pure-MCP architecture is the most radically modular design in the landscape.

The **TodoWrite** planning primitive deserves special attention. Both Claude Code and goose implement structured task lists (ID, content, status, priority) rendered as interactive checklists and injected as system messages after tool uses. This "reminder injection" prevents goal drift during long sessions, a pattern that donnyclaude could leverage more aggressively.

### Context management: the real battleground

Context engineering is where harnesses diverge most and where the biggest performance gaps emerge. Cognition's data shows **over 60% of first-turn time spent on context retrieval**, driving their investment in SWE-grep (an RL-trained retrieval model that returns file and line ranges, not summaries).

**Aider's repo map** is the most technically novel open-source approach. It parses all source files into syntax trees via tree-sitter, extracts declarations, builds a dependency graph, and ranks symbols using PageRank-like scoring. The map dynamically adjusts its token budget based on chat state: expanding when no files are added, contracting when files are present.

**Claude Code** uses a layered approach: system prompt (~8K including tool schemas and CLAUDE.md), conversation history, tool results, and a 33K-token response buffer. Auto-compaction triggers at approximately **83.5% context usage** (configurable via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`), summarizing conversation history with 60-80% reduction. Skills are loaded on demand rather than placed in the base prompt, which is critical for donnyclaude's 122 skills. Cursor takes a similar progressive-disclosure approach where skills load only when the agent determines relevance.

**Sweep** (now acquired/deprecated as GitHub App) independently discovered that naive RAG is insufficient for code. Their iterative context refinement switched from subtractive ("name what to remove") to additive ("name what to keep") approaches, finding the additive method more reliable. Performance degraded past approximately **20K tokens** of context.

### Memory and state: markdown vs databases vs event streams

The landscape splits into three memory paradigms:

**Markdown-based**: Claude Code (CLAUDE.md), Cline (Memory Bank with 6 structured .md files), Aider (CONVENTIONS.md), goose (.goosehints). The advantage is transparency, version-control friendliness, and human readability. The disadvantage is fragility (see Section 4d).

**Database-backed**: goose (SQLite sessions with full conversation history, token usage, working directory), Plandex (versioned plans with git-like branching), Codex CLI (SQLite for agent jobs). These are more robust but less human-inspectable.

**Event-sourced**: OpenHands (the event stream IS the persistent state; no separate copies). This is the most architecturally sound approach for reproducibility and fault recovery, but adds implementation complexity.

**Plandex** offers a unique innovation: version control for AI-generated plans with branches and cumulative diff sandboxes. Changes never touch project files until explicitly applied. This sandbox-first approach provides natural safety, but the project's cloud service has wound down, suggesting the SaaS model may not be viable.

### Verification: from manual approval to deterministic enforcement

**Codex CLI** has the most sophisticated sandboxing: `sandbox-exec` with SBPL scripts on macOS, Bubblewrap with Landlock LSM on Linux, and elevated sandbox with ACL-based policies on Windows. Three modes (read-only, workspace-write, full-access) with per-category approval granularity.

**Claude Code's hooks system** is the most comprehensive lifecycle interception system, now supporting **21 lifecycle events** and **4 handler types** (command, http, prompt, agent). PreToolUse hooks can approve, deny, or modify tool inputs. PostToolUse hooks can run linters, formatters, or tests after every change. This is the enforcement layer that donnyclaude's 6 hooks tap into.

**Continue** offers a unique CI-integrated approach with **Continue Checks**: AI-powered code review running on every PR as GitHub status checks, defined as markdown files in `.continue/checks/`.

### What is novel, borrowed, and dead-end

| Harness | Novel contribution | Likely dead-end |
|---------|-------------------|-----------------|
| Claude Code | Hooks lifecycle system (21 events, 4 types); single-threaded + subagent delegation | None apparent; architecture is validated |
| Cursor | Background planning; parallel agents via worktrees; 4-tier rules | N/A (closed source) |
| Cline | Plan and Act mode separation; Memory Bank methodology | Memory Bank as prompt-only enforcement (fragile) |
| Aider | Tree-sitter repo map with PageRank; Architect/Editor 2-model split | No persistent cross-session memory; no autonomous loop |
| goose | MCP-native from ground up; Recipes; Context Revision as explicit step | No built-in sandboxing |
| OpenHands | Event-sourced state; V1 composable SDK | V0 monolithic architecture (deprecated) |
| SWE-agent | ACI design; linter-gated edits | None; minimalism is validated |
| Devin | Model-harness co-optimization via RL; SWE-grep | Proprietary moat not replicable by open-source |
| Codex CLI | Per-platform sandboxing; Responses API stateless arch | None apparent |
| Roo Code | Mode-constrained tool access (Code/Architect/Ask/Debug/Custom) | Memory Bank as community plugin vs built-in |
| Continue | System Message Tools for universal compatibility; CI Checks | Pivoting away from coding to "quality control" |
| Sweep | AST-based tree-sitter chunking; entity graph planning | Fully automated issue-to-PR without human-in-loop |
| Plandex | Plan versioning with branches; cumulative diff sandbox | Cloud service wound down; complex client-server arch |

---

## 2. Academic evidence: measured results from 2024-2026 papers

### SWE-bench: the benchmark is compromised, the data is still useful

**SWE-bench Verified is contaminated.** OpenAI confirmed every frontier model can reproduce verbatim gold patches for certain tasks. The contamination overlap is **3-6x** confirmed (arXiv: 2506.12286). OpenAI has stopped reporting Verified scores and recommends SWE-bench Pro instead.

On **SWE-bench Pro** (1,865 tasks, multi-language, Scale AI SEAL leaderboard), the landscape looks different. Claude Opus 4.5 scores **45.9% under standardized scaffold** but **50.2-55.4% with custom scaffolding**, a 4-10 point lift from better context retrieval alone. Scale AI's failure analysis of the SEAL results reveals the dominant failure modes: semantic understanding failures (**35.9%** of Opus 4.1 failures), context overflow (**35.6%** of Sonnet 4 failures), and tool-use inefficiency (**42%** of smaller model failures).

The key agent/harness systems and their measured results:

- **SWE-agent** (arXiv: 2405.15793): 12.5% on SWE-bench full with GPT-4. The ACI design innovation showed interface design matters as much as model capability.
- **Agentless** (arXiv: 2407.01489): 27.3% on SWE-bench Lite, $0.34/issue. Three-phase pipeline (localize, repair, validate) with no agent loop at all. Adopted by OpenAI, Meta, DeepSeek as architectural inspiration.
- **AutoCodeRover** (arXiv: 2404.05427): 30.7% on SWE-bench Lite. AST-based code search operating on program structure, with spectrum-based fault localization.
- **SWE-Search** (arXiv: 2410.20285, ICLR 2025): **23% relative improvement** from MCTS alone, without changing the model. Monte Carlo Tree Search with Value Agent and Discriminator Agent (multi-agent debate). Built on Moatless framework.
- **Live-SWE-agent** (arXiv: 2511.13646): 79.2% on Verified (Opus 4.5), 45.8% on Pro. Self-evolving scaffold that synthesizes custom tools during runtime.
- **WarpGrep v2** (MCP-based search subagent): consistently adds **2.1-3.7 points** on SWE-bench Pro, 15.6% cheaper, 28% faster than Claude Code's native Explore subagent.
- **RepoGraph** (arXiv: 2410.14684, ICLR 2025): Repo-level code graph improved Agentless by **+2.34 absolute points** (8.56% relative) and RAG by +2.66 absolute (99.63% relative) on SWE-bench Lite.

### Context engineering: retrieval, compaction, summarization

The foundational finding comes from Gao et al. (arXiv: 2312.10997): **over 70% of errors in LLM applications stem from incomplete, irrelevant, or poorly structured context**, not model capability.

**RAG-MCP** (arXiv: 2505.03275) provides the most directly relevant measurement for donnyclaude. RAG over tool descriptions **triples tool selection accuracy**: 43.13% vs 13.62% baseline, while cutting prompt tokens by over 50%. Beyond approximately **100 tools**, retrieval precision degrades significantly even with RAG. This is the clearest threshold number for donnyclaude's 122 skills.

The "Lost in the Middle" phenomenon remains robust: models attend unevenly to context, favoring beginning and end positions. At **32K tokens**, 11 out of 12 tested models dropped below 50% of their short-context performance (NoLiMa benchmark). Multi-Instance Processing research (arXiv: 2603.22608) found that the number of discrete items has a **stronger degradation effect than raw context length**, which directly implicates large tool registries.

### Tool use scaling: hard limits exist

The Berkeley Function-Calling Leaderboard v3 provides the most rigorous measurement: **every model performs worse when provided with more than one tool**. Even when no relevant function exists, all models occasionally call irrelevant tools.

Practitioner thresholds from Allen Chan's analysis and RAG-MCP data:
- **1-5 tools**: optimal
- **5-10 tools**: manageable with careful prompt design
- **10+ tools**: measurable inference accuracy degradation and cost increase
- **~100 tools**: sharp cliff in selection accuracy, even with RAG mitigation
- **OpenAI hard limit**: 128 tools per agent

A single Playwright MCP server (21 tools) consumes **11.7K tokens**, nearly equal to Claude Code's entire built-in tool set at 11.6K tokens. This overhead applies to every message. For donnyclaude with 122 skills, the token overhead alone could consume 50K+ tokens of context before any work begins unless skills use progressive disclosure.

### Multi-agent coordination: the evidence is mixed

**MapCoder** (arXiv: 2405.11403) shows the upside: 4-agent system achieving 93.9% on HumanEval, with 41.3-132.8% improvements over direct prompting on hard benchmarks. **AgentCoder** (arXiv: 2312.13010) shows 96.3% on HumanEval with only 3 agents (Programmer, Test Designer, Test Executor), using half the tokens of MetaGPT's 5-agent system.

But arXiv: 2505.18286 presents the critical counterpoint: a single Gemini-2.5-Pro agent solved 24/30 SE problems, **outperforming multi-agent systems in 10 cases while losing in only 1**. The paper concludes that multi-agent generally surpasses single-agent except when using models with native reasoning capabilities. **MapCoder-Lite** (arXiv: 2509.17489) demonstrated that distilling multi-agent workflows into a single 7B model doubled xCodeEval accuracy (13.2% to 28.3%) while eliminating all format failures.

The practical implication for donnyclaude's 49 subagents: multi-agent helps most for **function-level tasks with separable concerns** (test writing, code review, documentation) but can hurt for **complex SE tasks requiring coherent reasoning** when using strong models like Claude Sonnet/Opus.

### Test-time compute and verification loops

**S\*** (arXiv: 2502.14382, EMNLP 2025) is the first hybrid test-time scaling framework for code: combining parallel sampling (N=32, temperature=0.7) with up to 4 rounds of sequential debugging. A 3B model outperformed GPT-4o-mini. DeepSeek-R1-Distill-32B + S\* achieved **85.7% on LiveCodeBench**, approaching o1-high at 88.5%.

The "Thinking Longer, Not Larger" paper (arXiv: 2503.23803) showed external test-time compute for SWE agents improved pass@1 on SWE-bench Verified from **11% to 39.0%** using a 72B open-weight model with RFT + DAPO RL training.

NL2Repo-Bench (arXiv: 2512.12730) measured that model performance increases steadily as interaction limits are raised from 50 to 200 rounds, suggesting more iterations consistently help.

LangChain's harness engineering demonstrated a specific verification pattern: their **PreCompletionChecklistMiddleware** forces a verification pass before exit, which was a "major factor" in their 13.7-point benchmark improvement. Models naturally declare tasks complete without proper validation; forcing spec-based verification is among the highest-leverage harness interventions.

### Memory systems: nascent but accelerating

**Synapse** (arXiv: 2601.02744) achieves +7.2 F1 on LoCoMo benchmark (SOTA) with **95% reduction in token consumption** via brain-inspired unified episodic-semantic graph memory. **MemMachine** (arXiv: 2604.04853) achieves 0.9169 LoCoMo score with approximately 80% token reduction.

**SWE-Bench-CL** (arXiv: 2507.00014) is the first continual learning benchmark specifically for coding agents, using FAISS-backed semantic memory. This is directly relevant to the "closing loops" thesis: it measures whether agents can accumulate knowledge across sequential coding tasks without forgetting.

---

## 3. The "closing loops" thesis: evaluated against evidence

### The thesis articulated

The claim is that the moat in coding agents lies not in model intelligence but in converting every observed failure into mechanically-enforced state (hooks, rules, blocking patterns) so the harness accumulates intelligence without retraining. No specific community called "VibeCodingNights" or GitHub organization called "agent-harnesses" was discoverable in public sources. However, the thesis itself is **among the most well-validated claims in the harness engineering discipline** as of 2026, articulated independently by at least five major sources.

**Martin Fowler / Thoughtworks** describes it as "a well-built outer harness serves two goals: it increases the probability that the agent gets it right in the first place, and it provides a feedback loop that self-corrects as many issues as possible before they even reach human eyes."

**LangChain** demonstrated it empirically: **13.7-point improvement** (52.8% to 66.5% on Terminal Bench 2.0) through iterative harness optimization using trace analysis. Their method: run agent, capture traces via LangSmith, run automated Trace Analyzer to identify failure modes, codify fixes as prompt adjustments, middleware hooks, or tool changes, and repeat. They call it "boosting for agents," focusing improvement on past mistakes.

**Datadog** uses the exact phrase "closing the loop": "Production telemetry feeds back into the verification pipeline, surfacing mismatches between modeled behavior and real-world execution and allowing us to refine the harness over time."

**Blake Crosley** (blakecrosley.com) provides the most concrete practitioner evidence: 95 hooks across 6 lifecycle events, developed over 9 months. His critical insight: "The best hooks come from incidents, not planning." Each hook originated from a specific failure: the git safety hook from Claude running `git push --force origin main` when asked to "clean up git history"; the recursion guard from a budget-inheritance bug in nested subagents.

### The gap between "usually" and "always"

The most precise articulation comes from Dotzlaw Consulting: "A CLAUDE.md instruction says 'always run the linter.' The agent usually complies. A PostToolUse hook runs the linter after every file write, every single time, no exceptions. **That gap between 'usually' and 'always' is where production systems fail.**"

This maps directly to Claude Code's hook architecture. Rules are probabilistic (the model may or may not follow them). Hooks are deterministic (they execute every time, gated by matcher patterns). donnyclaude's 65 rule files represent probabilistic guidance; its 6 hooks represent deterministic enforcement. The thesis implies donnyclaude should be migrating high-value rules to hooks wherever possible.

### How specific systems implement closing loops

**Claude Code hooks** (21 lifecycle events, 4 handler types) are the most capable enforcement mechanism in the landscape. PreToolUse hooks can **modify tool inputs** since v2.0.10: intercepting JSON, modifying parameters, and letting execution proceed with corrected inputs invisibly to Claude. This enables dynamic sandboxing, security enforcement, and convention adherence. Configuration hierarchies (user-wide, project, local overrides, managed policies) support organizational layering. The fail-open strategy (crashed/timed-out hooks allow operation to continue) prevents hooks from blocking the agent entirely.

**Cursor's rules system** has evolved from the deprecated `.cursorrules` file to a structured `.cursor/rules/` directory with MDC format files supporting four rule types (Always Apply, Auto Attached via glob, Agent Requested via description, Manual) and four scope levels (Project, User, Team, Agent). The glob-scoped auto-attachment is more selective than Claude Code's rule loading.

**Cline's Memory Bank** is a prompt-engineering methodology, not a built-in feature. Six structured markdown files must be read at session start. The enforced-by-prompt approach is fragile: the LLM can skip mandatory reads. Community MCP servers (`cline-mcp-memory-bank`) provide programmatic access, which is more robust.

**Aider's conventions** are the most minimal: CONVENTIONS.md loaded as read-only with prompt caching. No hooks, no enforcement beyond prompt instruction. The repo map provides structural understanding but not behavioral enforcement.

**goose's Recipes** bundle extensions, instructions, and sub-recipes into YAML workflow definitions. Per-session agent isolation (each session gets its own Agent, ExtensionManager, ToolMonitor) prevents cross-talk. The Memory extension provides persistent context recallable across sessions.

### Evaluation of the thesis

The evidence **strongly supports** the closing-loops thesis for the current generation of models, with two important caveats:

1. **LangChain's own caveat**: "As models get more capable, some of what lives in the harness today will get absorbed into the model. Models will get better at planning, self-verification, and long horizon coherence natively. That suggests harnesses should matter less over time." This is correct but does not diminish the thesis for 2026.

2. **HumanLayer's finding on over-steering**: "Agent-generated CLAUDE.md files actually hurt performance while costing 20%+ more. Agents spent 14-22% more reasoning tokens processing instructions." And: "Lots of files too-heavily-steered the model to use specific tools, causing worse outcomes. Less (instructions) is more." This directly concerns donnyclaude: **65 rule files risk over-constraining the model**. The thesis should be amended: close loops with hooks (deterministic, zero-cost when not triggered), not rules (probabilistic, always in context, always consuming tokens).

---

## 4. Failure modes at scale

### The "100th tool call" problem

Long-horizon degradation is well-measured. TaskWeaver/LORE benchmark found **accuracy approaches zero on tasks exceeding approximately 120 steps** across GPT-4o, GPT-5, o1, and o3. The "Illusion of Diminishing Returns" paper (arXiv: 2509.09677) found that without chain-of-thought, even frontier models fail at performing 4 sequential execution steps. With thinking (R1), models can execute over 100 steps, but **models self-condition on their own errors**, causing cascading degradation that is NOT mitigated by scaling model size.

The "Beyond pass@1" framework (arXiv: 2603.29231) introduced the "Meltdown Onset Point (MOP)": a detection metric for behavioral collapse via sliding-window entropy over tool-call sequences. In SE domain testing, the Generalized Decision Score **fell from 0.90 to 0.44** over full duration range. Seven of 9 models showed negative Reliability Decay Slope.

METR's longitudinal study found the "50% success horizon" (task duration where pass@1 drops to 50%) has **doubled every 7 months from 2019-2024**, meaning models are getting better at long-horizon tasks but the fundamental degradation pattern persists.

For donnyclaude, this means subagent delegation is not optional overhead but **the primary defense against long-horizon degradation**. Each subagent resets context to zero. The parent gets signal, not noise. The cost multiplier (4-7x more tokens) is the price of coherence preservation.

### Prompt budget degradation past N rules and skills

Berkeley Function-Calling Leaderboard v3 provides the anchor: **every model performs worse with more than one tool**. donnyclaude ships 122 skills. Even with progressive disclosure (skills loaded only when relevant), the skill registry descriptions consume context.

Specific thresholds from multiple sources:
- **10+ tools exposed simultaneously**: measurable inference accuracy degradation
- **37 functions** (Berkeley's max test): clear degradation across all models
- **100+ tools**: sharp cliff even with RAG-based tool selection
- **128 tools**: OpenAI's hard limit per agent
- **32K tokens of instructions**: 11/12 models drop below 50% of short-context performance

The Multi-Instance Processing paper (arXiv: 2603.22608) found that all LLMs follow a pattern of slight performance degradation for 20-100 instances, followed by **performance collapse on larger instance counts**. The number of discrete items has a stronger degradation effect than raw context length, meaning 122 individual skill descriptions are worse than a single 122-skill-equivalent blob of text.

HumanLayer's practitioner finding is directly relevant: "We kept stuffing every instruction and tool into the system prompt, and the agent kept getting worse. Skills solve this through progressive disclosure; the agent only gets access when it decides it needs them." And: "If an MCP server duplicates functionality already available as a CLI well-represented in training data, it works better to just prompt the agent to use the CLI." This suggests donnyclaude should audit its 122 skills for overlap with Claude's training-data knowledge and aggressively prune.

### Subagent context firewall patterns

**Claude Code's pattern** is the gold standard: each subagent runs in its own fresh conversation with its own 200K-token context window. Only the final message returns to the parent. All intermediate tool calls, file reads, and search results stay inside the subagent. Configurable per-subagent: custom system prompt, specific tool restrictions, model selection (Haiku for exploration, Opus for reasoning), and permission mode. The `isolation: worktree` option gives subagents isolated git worktree copies of the repository. Multiple subagents can run concurrently.

**OpenHands** uses Docker sandbox isolation with event-sourced state for reproducibility. **goose** provides per-session agent isolation where each session gets its own Agent, ExtensionManager, and ToolMonitor with no cross-talk. **Codex CLI** supports configurable subagent depth (`agents.max_depth` defaults to 1) and concurrency (`agents.max_concurrent` defaults to 6).

The critical insight from HumanLayer: "Sub-agents are the key to maintaining coherency across many sessions. The context firewall ensures discrete tasks can run in isolated context windows so none of the intermediate noise accumulates in your parent thread." donnyclaude's 49 subagents leverage this pattern, but the effectiveness depends on how aggressively they're used for context-heavy operations.

### State corruption in markdown-based memory

Documented failure modes from Claude Code issues and practitioner reports:

- **CRLF/line-break corruption**: Edit/Write tools doubled CRLF on Windows and stripped Markdown hard line breaks (two trailing spaces). Fixed in recent releases but reveals fragility.
- **Memory persistence after deletion** (Issue #8232): "Memory persists after deleting project CLAUDE.md file, after removing all .claude directories, after complete system reboot." Described as "serious architectural issues with memory management."
- **Write loops** (Issue #198): Agent stuck trying to write a Markdown file, retrying 8 times with InputValidationError.
- **Hanging on markdown writes** (Issue #15497): Claude Code hangs indefinitely when writing to Markdown files, even at 50% context usage.
- **CJK/emoji boundary corruption**: Characters silently dropped when falling on 4KB boundaries in history.jsonl.
- **StructuredOutput schema cache bug**: Caused approximately 50% failure rate when using multiple schemas.
- **Lossy summarization**: Automatic summaries lose detail. Critical constraints and decisions disappear during compaction without warning.
- **Race conditions**: Multiple agents/sessions writing to the same markdown files produce conflicts.

For donnyclaude's markdown-based rule files and any CLAUDE.md-based memory, these failure modes are existential. The mitigation is to treat markdown state as append-only where possible, validate reads after writes, and consider migrating critical state to structured formats (JSON, SQLite) accessed via hooks rather than inline context.

### Optimal compaction thresholds

| Parameter | Value | Source |
|-----------|-------|--------|
| Claude Code default auto-compact trigger | ~83.5% of context window (~166K of 200K) | claudefa.st |
| Autocompact buffer (reserved for response) | 33K tokens (reduced from 45K) | claudefa.st |
| VS Code extension trigger | ~65% usage (35% remaining) | GitHub Issue #11819 |
| Override environment variable | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1-100, capped at ~83%) | turboai.dev |
| Claude Agent SDK default threshold | 100,000 tokens | Anthropic docs |
| Recommended proactive manual trigger | **60% context capacity** | MindStudio guide, practitioner consensus |

The critical practitioner insight from Morph LLM analysis: "By the time compaction triggers, the damage is done. The agent has already spent 15+ minutes producing degraded outputs based on noisy context. Compaction cleans up the history, but it can't undo the wrong edits." The fix is proactive compaction at 60%, combined with subagent isolation for context-heavy operations.

For donnyclaude, a PreCompact hook should be standard: backing up critical state before summarization occurs, and a SessionStart hook should inject the backup path so the user can recover from lossy compaction. The claudefa.st project demonstrates this pattern with time-stamped backups in `.claude/backups/`.

---

## 5. Competitive primitive mapping

For each harness, the one-line answer to "what can it do that donnyclaude CANNOT do today?"

| Harness | Unique capability donnyclaude lacks |
|---------|--------------------------------------|
| SWE-agent | Custom agent loop with 10 output parser variants and linter-gated edit rejection before disk write |
| Agentless | Non-interactive multi-candidate patch pipeline: generate N patches in parallel, select best via automated test execution |
| AutoCodeRover | Deep AST-level search tools (search_class, search_method) with spectrum-based fault localization from test traces |
| Moatless/SWE-Search | Full MCTS with tree-structured state branching, shadow-mode execution (in-memory file state without disk writes), and backtracking |
| OpenHands | Docker sandbox isolation per task with event-sourced state for deterministic replay and fault recovery |
| Live-SWE-agent | Runtime self-modification: synthesize, modify, and deploy new tools during execution |
| WarpGrep v2 | RL-trained search model running in its own context with 8 parallel tool calls per turn |
| Devin | Model-harness co-optimization via RL (SWE-1.x trained on Cascade); SWE-grep fast retrieval; OtterLink VM parallelization |
| Codex CLI | Per-platform sandboxed execution (Seatbelt/bwrap/Landlock) with granular per-category approval policies |
| Cursor | Background planning with model-level plan/implement separation; 8 parallel agents via worktree isolation; team-level rules |
| Aider | Tree-sitter repo map with PageRank-based symbol ranking for surgical context selection |
| Plandex | Plan versioning with git-style branches; cumulative diff sandbox (changes never touch files until applied) |
| goose | Pure MCP-native architecture with zero hardcoded tools; Context Revision as explicit architectural step |
| Continue | CI-integrated AI code review (Continue Checks) running on every PR as GitHub status checks |

### Ranked missing primitives by evidence-based impact

1. **Non-linear execution / tree search** (MCTS, branching, backtracking): SWE-Search showed **23% relative improvement** from MCTS alone, the single largest scaffolding-only improvement documented. donnyclaude cannot branch execution or backtrack to earlier decision points.

2. **Sandboxed execution environments**: Every competitive benchmark harness uses Docker containers. Enables safe test execution, clean rollback, and parallel runs. donnyclaude executes in the user's actual shell.

3. **Multi-candidate patch sampling with automated selection**: Agentless showed ~28% relative headroom from better patch selection. donnyclaude cannot generate N independent solutions and automatically select the best via test execution.

4. **Custom retrieval/RAG pipeline**: WarpGrep adds 2-3.7 points on SWE-bench Pro. AutoCodeRover's AST-level search uniquely resolved 30 instances SWE-agent couldn't. donnyclaude is limited to Claude Code's native Grep/Glob/Read. Partial workaround: MCP server for enhanced search.

5. **Custom agent loop / edit format**: donnyclaude cannot modify Claude Code's core loop, output parsing, or edit tool format. Terminal Bench 2.0 data shows Opus 4.6 in Claude Code ranks #33 but #5 in a different harness, suggesting the native loop is not optimal.

6. **Plan versioning with rollback**: Plandex's cumulative diff sandbox prevents file corruption. donnyclaude has no structured rollback beyond git.

7. **Parallel tool calls within subagents**: WarpGrep's 8 parallel tool calls per turn are faster and cheaper. Claude Code subagents execute tools sequentially.

8. **Model routing / selection**: OpenHands and Moatless route different task types to different models (cheap for search, expensive for generation). donnyclaude is locked to Claude models.

9. **IDE integration** (file watching, LSP diagnostics): SWE-agent integrates linting into its edit cycle. Cursor/Windsurf get IDE diagnostics. donnyclaude has no file watcher or LSP feed.

---

## 6. Actionable recommendations

### INCREMENTAL tier: top 10 additions to donnyclaude's existing primitives

| # | Recommendation | Evidence source | Effort (hours) | Expected impact |
|---|---------------|-----------------|-----------------|-----------------|
| 1 | **Implement progressive disclosure for skills**: Add `autoInvoke: true/false` and description-based matching so only relevant skills load into context per task. Reduce the 122-skill token overhead from always-on to on-demand. | RAG-MCP (arXiv: 2505.03275): 3x tool selection accuracy with retrieval; HumanLayer blog: "We kept stuffing every instruction and tool into the system prompt, and the agent kept getting worse" | 8-16 | High. Directly addresses the ~100-tool degradation cliff. Could save 30-50K tokens per session. |
| 2 | **Add PostToolUse verification hooks for all Write/Edit operations**: Run project-specific linter and test suite after every file change, injecting results back as context. | LangChain Terminal Bench: PreCompletionChecklistMiddleware was "major factor" in 13.7-point improvement; SWE-agent linter-gated edits; Blake Crosley's 95-hook practitioner report | 4-8 | High. Closes the "usually vs always" gap for code quality. Immediate error feedback prevents cascading mistakes. |
| 3 | **Implement PreCompact backup hook**: Before compaction, serialize critical state (current task, key decisions, file paths, test status) to `.claude/backups/` with timestamped filenames. SessionStart hook loads most recent backup. | claudefa.st PreCompact backup pattern; Morph LLM analysis: "by the time compaction triggers, the damage is done" | 4-6 | High. Prevents lossy compaction from destroying critical context. Practitioner consensus places this as the single most impactful hook. |
| 4 | **Audit and prune skill/rule overlap**: Identify skills that duplicate Claude's training-data knowledge (git operations, common CLI tools, standard library usage) and remove them. Target reducing 122 skills to 40-60 high-value, non-obvious skills. | HumanLayer: "If an MCP server duplicates functionality already available as a CLI well-represented in training data, it works better to just prompt the agent to use the CLI"; Berkeley FCL: degradation above 10 tools | 12-20 | High. Reduces context overhead, improves tool selection accuracy, reduces reasoning token waste (14-22% savings per HumanLayer data). |
| 5 | **Add a "reasoning sandwich" to long-running subagents**: Configure planning subagents with `effort: xhigh`, implementation subagents with `effort: high`, and verification subagents with `effort: xhigh`. | LangChain Terminal Bench: xhigh-only scored 53.9% (timeouts) vs reasoning sandwich at 66.5%; S\* (arXiv: 2502.14382): hybrid parallel + sequential test-time compute | 2-4 | Medium-high. Direct performance lift with minimal implementation. Balances reasoning quality against timeout risk. |
| 6 | **Implement SessionStart context injection**: Hook that runs `git branch --show-current`, `git diff --stat HEAD`, project-specific environment discovery, and recent test results, injecting them as structured additionalContext. | LangChain LocalContextMiddleware: "agents waste significant effort trying to figure out their working environment"; revfactory: structured pre-configuration +60% quality | 4-8 | Medium-high. Eliminates first-turn discovery overhead. Directly addresses Cognition's finding that 60%+ of first turns are spent on retrieval. |
| 7 | **Add a verification subagent that runs BEFORE declaring task complete**: A Stop hook that spawns a subagent to verify the work against the original specification, blocking completion if verification fails (exit code 2). | LangChain: self-verification was the single biggest contributor to their improvement; NL2Repo-Bench (arXiv: 2512.12730): more iterations consistently help; "Models naturally declare tasks complete without proper validation" | 6-10 | Medium-high. Prevents premature completion, the most common agent failure mode per LangChain's trace analysis. |
| 8 | **Migrate high-frequency rules to hooks**: Identify the 10-15 rules most critical for code quality (formatting, security, testing) and convert them from rule files (probabilistic) to PreToolUse/PostToolUse hooks (deterministic). | Blake Crosley: "Start with 3 hooks: git safety, context injection, quality gate; add more only when you have incidents that justify them"; Dotzlaw Consulting: "the gap between usually and always" | 8-16 | Medium. Reduces rule file count (improving prompt budget), increases enforcement reliability, and moves constraints from probabilistic to deterministic. |
| 9 | **Ship an MCP-based code search server**: Wrap tree-sitter AST parsing and semantic search into an MCP server that subagents can use for targeted code navigation, providing Aider-style repo map capabilities. | Aider repo map; AutoCodeRover AST search resolved 30 unique instances; RepoGraph (arXiv: 2410.14684): +2.34 absolute improvement; WarpGrep: 2-3.7 point improvement | 20-40 | Medium. Significant engineering effort but addresses the #4 ranked missing primitive. Could be an external MCP server dependency rather than built from scratch. |
| 10 | **Add proactive compaction at 60%**: Override `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` to trigger at 60% rather than 83.5%, and implement the compaction-then-clear workflow (compact, /clear, reload backup). | MindStudio guide; practitioner consensus on 60% threshold; Morph LLM: late compaction cannot undo degraded outputs | 2-4 | Medium. Trivial to implement. Prevents the 15+ minutes of degraded output that occurs between 60-83% context fill. |

### ARCHITECTURAL tier: larger structural changes worth considering

| # | Recommendation | Evidence source | Effort (hours) | Expected impact |
|---|---------------|-----------------|-----------------|-----------------|
| 1 | **Build a multi-candidate patch pipeline subagent system**: Create a "solve and select" workflow where N subagents independently generate patches for the same problem, then a verification subagent runs tests against all patches and selects the best. This simulates Agentless-style multi-candidate sampling within Claude Code's primitives. | Agentless (arXiv: 2407.01489): ~28% relative headroom from patch selection; S\* (arXiv: 2502.14382): parallel sampling + sequential debugging dramatically improves results; AIDE: 62.2% on Verified using multi-run scaling | 40-80 | Very high. The single largest quality improvement available within Claude Code's architecture. Cannot implement full MCTS, but multi-candidate sampling with test-based selection captures much of the benefit. |
| 2 | **Implement a sandboxed execution wrapper via Docker MCP server**: Ship an MCP server that provides sandboxed bash execution inside ephemeral Docker containers, with volume-mounted workspace access and automatic cleanup. Route all test execution and potentially dangerous commands through this sandbox. | OpenHands Docker sandboxing is foundational to its 53%+ results; Codex CLI per-platform sandboxing; every competitive SWE-bench submission uses container isolation | 40-60 | High. Enables safe test execution, prevents environment pollution, and unlocks parallel safe-execution patterns. The `isolation: worktree` option in Claude Code subagents provides partial git-level isolation but not process-level sandboxing. |
| 3 | **Restructure the 122-skill registry into a hierarchical, search-indexed skill graph**: Replace flat skill listing with a two-tier system: (a) a lightweight skill index loaded into every session (~2K tokens total) containing skill names, one-line descriptions, and trigger patterns; (b) full skill content loaded on-demand when the agent or user selects a skill. This mirrors RAG-MCP's approach but for internal skills rather than external tools. | RAG-MCP (arXiv: 2505.03275): 3x accuracy with retrieval; Multi-Instance Processing (arXiv: 2603.22608): number of items degrades performance faster than token count; Cursor's dynamic Skills system; Anthropic's experimental MCP tool search for progressive disclosure | 30-50 | High. Transforms the primary architectural weakness (122 always-loaded skills) into a strength (large skill library with surgical loading). Implementation could use a local MCP server or Claude Code's native skill autoInvoke mechanism. |
| 4 | **Build a trace-based harness improvement loop**: Instrument donnyclaude sessions to capture structured traces (tool calls, success/failure, token usage, time per step), then build an automated trace analyzer that identifies failure patterns and proposes new rules or hooks. This implements LangChain's "boosting for agents" methodology. | LangChain Better-Harness methodology; Meta-Harness (Stanford); Auto-Harness (DeepMind); revfactory's 15-task controlled experiment methodology | 60-100 | Very high (long-term). Transforms donnyclaude from a static configuration into a self-improving system. The trace analyzer becomes the mechanism by which the "closing loops" thesis is operationalized. Requires persistent storage (SQLite) and a periodic analysis pipeline. |
| 5 | **Explore wrapping the Claude Agent SDK for architectural primitives**: For capabilities impossible within Claude Code's native loop (custom edit formats, modified agent loop, programmatic compaction control), consider building a thin wrapper using the Claude Agent SDK that implements specific high-value patterns (retry-with-backoff for failed edits, programmatic compaction at custom thresholds, parallel subagent dispatch with shared state aggregation) while delegating primary coding to Claude Code. | Claude Agent SDK docs; Live-SWE-agent (arXiv: 2511.13646): self-evolving scaffold achieves 79.2% on Verified; Terminal Bench data showing Opus 4.6 ranks #5 in custom harnesses vs #33 in Claude Code | 80-160 | Potentially very high, but risky. Abandons Claude Code's native loop advantage (model-harness co-optimization during post-training). LangChain's data suggests the native loop is a starting point, not a ceiling. Consider as a research prototype before committing. |

---

## Conclusion: where donnyclaude's leverage actually sits

The research converges on three findings that should shape donnyclaude's development.

**First, donnyclaude's scale is simultaneously its greatest asset and greatest liability.** 122 skills is an enormous knowledge surface, but the measured tool degradation data is unambiguous: performance degrades past 10 simultaneously-exposed tools and collapses past 100. The architectural priority is not adding more skills but restructuring how existing skills are loaded, using progressive disclosure to present 5-10 relevant skills per task from a 122-skill library.

**Second, hooks are the correct primitive for the "closing loops" thesis; rules are not.** Rules consume context tokens on every turn and are probabilistically followed. Hooks execute deterministically, consume zero tokens when not triggered, and can enforce behavior that rules cannot (blocking dangerous operations, modifying tool inputs, forcing verification before completion). donnyclaude's 6 hooks should grow to 15-25 based on incident-driven development, while its 65 rule files should shrink to 20-30 essential behavioral guidelines.

**Third, the biggest achievable quality improvement within Claude Code's architecture is multi-candidate patch sampling with test-based selection.** SWE-Search's MCTS achieved 23% relative improvement, but true tree search is architecturally impossible within Claude Code's sequential loop. However, spawning N subagents to independently solve the same problem, then using a verification subagent to run tests and select the best solution, captures much of this benefit using existing primitives. Combined with the reasoning sandwich (high reasoning for planning and verification, moderate for implementation) and proactive 60% compaction, these harness-only changes represent roughly **10-15 points of recoverable performance** on benchmark-style tasks based on the LangChain and SWE-bench data.
