# AI Coding Agent Harness Optimization: A Comprehensive Research Report

**Prepared for:** A solo builder pivoting from `.claude/`-layer A/B testing (AHOL on `donnyclaude`) to genuine harness optimization.
**Date:** May 8, 2026
**Goal:** Enumerate every tunable layer of an AI coding agent, survey the frontier of open and closed harness architectures, map the model+pricing landscape, and prescribe a concrete substrate choice and 4-week ablation plan.

---

## TL;DR

- **You were optimizing the wrong layer.** The `.claude/` directory (skills, agents, hooks, rules, commands) sits *above* Claude Code's closed agent loop, tool plumbing, context management, and sampling logic — and Anthropic's Quantifying Infrastructure Noise study (Feb 2026), the ETH Zurich AGENTS.md paper (Feb 2026), Stanford IRIS's Meta-Harness (Mar 2026), and Live-SWE-agent (arXiv 2511.13646) all converge on the same finding: **factual structure transfers, prose-level config doesn't.** You need a substrate where you can edit the loop itself, not just the markdown around it.
- **Fork mini-SWE-agent, not claw-code.** mini-SWE-agent is ~100 lines of auditable Python that scores >74% on SWE-bench Verified with bash-only tooling, runs on any LiteLLM-compatible model (so Kimi K2.6, GPT-OSS-120B, Nemotron 3 Super, Claude via API all work), and exposes every harness layer cleanly. claw-code is a clean-room Python+Rust rewrite of leaked Claude Code TypeScript — interesting as a *reading* artifact, but its provenance is legally fraught, it requires API-key auth (no Max OAuth), and its complexity will eat your ablation budget. OpenMythos is *model-architecture* speculation (a Recurrent-Depth Transformer for an unreleased "Claude Mythos"), not a harness, and its author has a documented track record of speculative reimplementations — ignore it for harness work.
- **Pick one model first; route later (maybe never).** RouteLLM-style dispatch saves money for high-volume serving; for a solo builder running ~hundreds of trajectories/week, the engineering cost of multi-model routing dominates the savings, and benchmark variance from infra noise alone (±6pp on Terminal-Bench, ±1.5pp on SWE-bench per Anthropic) will swamp routing gains. **Use Kimi K2.6 ($0.60/$2.50 via OpenRouter, 80.2% SWE-bench Verified, MIT-licensed) as your primary, Claude Sonnet 4.6 via Max OAuth for sanity-check baselines, and consider Opus 4.7 only when an ablation specifically needs frontier-model headroom.** That gives you ~10× cost headroom over Opus while preserving comparability with published baselines.

---

## Part 1 — The Harness Layer Taxonomy

A "harness" is the deterministic software around the model: agent loop, tool plumbing, context management, sampling, scaffolding. Anthropic's blog framing — "every component in a harness encodes an assumption about what the model can't do on its own" — is the right mental model. Below is every layer you can ablate, with mechanism, SOTA practice, isolation methodology, and published evidence.

### 1. Agent Loop / Control Flow

- **What it is:** The outermost while-loop: prompt → model → parse → tool → observation → loop. mini-SWE-agent's loop is literally ~30 lines: `while not done: msgs.append(query(model, msgs)); action = parse(msgs[-1]); obs = run(action); msgs.append(obs)`. OpenAI's "Unrolling the Codex agent loop" post (Feb 2026) describes the same structure with more layers.
- **Why it matters:** Determines termination (done-detection, step cap, error recovery), recovery semantics (does a parse failure abort or retry?), and concurrency (sync vs async vs event-sourced). OpenHands V0 used pub/sub `EventStream`; V1 SDK moved to synchronous + event-sourced state because the pub/sub model "caused all sorts of thread/async issues."
- **SOTA examples:**
  - mini-SWE-agent: linear, sync, subprocess.run per step (stateless shell — no persistent shell session).
  - SWE-agent v1: persistent shell session via SWE-ReX, more tools.
  - Claude Code (per claw-code reverse engineering): tool-call loop in TypeScript with Bun runtime, hooks at pre/post-tool-use, "KAIROS" feature-gated autonomous mode, Tamagotchi-style frustration detection.
  - OpenHands V1 SDK: nine components (event-sourced state, LLM, tools, agent, context window manager, local conversation, secret registry, security/confirmation, deployment).
- **Ablation:** Hold model/prompt/tools/budget constant; swap loops. Measure pass@1, cost, mean step count.
- **Evidence:** The Live-SWE-agent paper (Xia et al., arXiv 2511.13646) starts from "the most basic agent scaffold with only access to bash tools, and autonomously evolves its own scaffold implementation while solving" — and reaches 79.2% on SWE-bench Verified. The loop alone, given enough freedom to mutate, is load-bearing.

### 2. Action Representation

- **What it is:** How the model expresses intent. Three families: (a) tool-call JSON via the model's native function-calling API; (b) ReAct-style text (`Thought:` / `Action:` / `Observation:`) parsed by the harness; (c) bash-only — model emits a fenced bash block, harness regex-extracts and executes.
- **Why it matters:** Tool-call JSON is most reliable for trained-on-tools models (Claude, GPT-5.x), but locks you into providers that expose function-calling and adds parsing fragility for OSS models that weren't fine-tuned on the schema. Bash-only works with literally any model — mini-SWE-agent's headline claim. Trade-off: token cost, parse failure rate, and the degree to which the model's training distribution aligns with your representation.
- **SOTA:**
  - mini-SWE-agent: bash-only, regex extraction. "Does not have any tools other than bash — it doesn't even need to use the tool-calling interface of the LMs."
  - Anthropic's internal SWE-bench harness: native tool calls — `bash` + `str_replace_editor` (view/create/str_replace/insert/undo_edit). They report Sonnet 3.5 reached SOTA after "precise refinements to tool descriptions."
  - Cline / Roo Code: XML tool tags parsed from text (works around Anthropic API rate limits on tool-use messages).
  - DeepSeek V4: dedicated XML-based tool-call schema "that reduces parsing errors."
- **Ablation:** Same model, same task set, swap action representation. Measure parse-failure rate per turn and end-to-end pass rate. mini-SWE-agent v1→v2 maintained >74% on Verified using bash-only, the cleanest existence proof that representation is not the bottleneck for capable models.
- **Evidence:** Anthropic's Sonnet SWE-bench post explicitly notes "iterative refinement of tool descriptions, informed by evaluation results, dramatically improves agent performance." Effect sizes in tool-description tweaks have been shown to swing pass rates by several points.

### 3. Tool Catalog Design

- **What it is:** Which tools exist. Spectrum: zero (Agentless's pure prompting pipeline), one (mini bash), two (Anthropic's bash + str_replace_editor), many (OpenHands ~12 tools, Claude Code ~15+ including Task/Grep/Glob/Read/Write/Edit/WebFetch).
- **Why it matters:** Tools cost tokens (descriptions go in the system prompt every turn — Claude Code's tool prompt overhead is substantial) and create a choice-explosion problem. Manus calls this the "tool explosion problem" — more tools makes the agent dumber, not smarter.
- **SOTA findings:**
  - Anthropic's "Writing tools for agents" post: tools must be high-leverage, namespaced, return meaningful context, token-efficient (≤25K token cap on responses, with pagination/filtering).
  - Manus on tool overload: mask, don't remove. "If your harness is getting more complex while models improve, you are likely over-engineering."
  - HumanLayer: "If [a tool] duplicates functionality already available as a CLI well-represented in training data, it works better to just prompt the agent to use the CLI." MCPs that wrap GitHub/Docker/databases are usually inferior to letting the agent call `gh` / `docker` / `psql` directly.
- **Ablation:** Add/remove one tool at a time; measure delta in pass rate and step count. Anthropic's published case: precise edits to tool descriptions moved Sonnet 3.5 from prior SOTA to a new SOTA on Verified.

### 4. Tool Schema and Description Quality

- **What it is:** The natural-language description and JSON schema for each tool. Loaded into context every turn.
- **Why it matters:** This is essentially a *prompt* that determines tool-selection behavior. Anthropic: "even small refinements to tool descriptions can yield dramatic improvements." Cameron AI's get_expenses example (in Anthropic's blog) shows a single description rewrite cutting agent error rates by half.
- **Best practices (Anthropic):** Unambiguous parameter names (`user_id` not `user`), explicit "when to use" guidance, structured input enums for response verbosity, prompt-engineered error messages with actionable feedback (not stack traces), 25K-token truncation with helpful steering text.
- **Ablation:** A/B descriptions on a fixed task set. Use Meta-Harness's filesystem-trace approach: feed the optimizer agent the failure traces to propose better descriptions.

### 5. Observation / Tool-Result Handling

- **What it is:** What gets fed back after a tool runs. Subdimensions: truncation policy, summarization, error rephrasing, structured-vs-raw, image-or-text.
- **Why it matters:** Tool outputs are the dominant source of context bloat. Anthropic recommends a 25K-token cap on tool responses for Claude Code by default. Long bash outputs (test runs, big greps) can flood the window.
- **SOTA:**
  - Claude Code: 25K cap, `<response clipped>` marker.
  - Manus: structured summary objects (defined schema fields) once compaction hits diminishing returns; restorable compression (keep URL, drop page body) so the agent can re-fetch if needed.
  - Anthropic's tool-result-clearing primitive (in their context-engineering cookbook): native API support to drop stale tool results from context.
- **Ablation:** Vary truncation length (5K / 25K / 100K / unlimited) and rephrasing (raw stderr vs prompt-engineered "command failed because… try X" wrapper). Measure recovery rate on tasks with deliberately failing commands.

### 6. History / Context Management

- **What it is:** How the trajectory is preserved across turns. Choices: linear (mini-SWE-agent), sliding window, structured summarization (compaction), file-system-as-memory (Manus, Anthropic's long-running-agents post), event-sourcing (OpenHands V1).
- **Why it matters:** Context rot is real. Chroma's needle-in-a-haystack work + Anthropic's context-engineering blog: model accuracy drops as context fills well before the hard limit. Manus's input-to-output ratio is ~100:1 — KV cache is the dominant cost.
- **SOTA:**
  - Manus: KV-cache-optimized stable prefix; never modify past observations; file system as externalized memory ("write progress.txt, re-read on next session"). "A 10× pricing difference between cached ($0.30/M) and uncached ($3/M) input on Sonnet."
  - Anthropic's "Effective harnesses for long-running agents" (Nov 2025): two-agent pattern. Initializer agent runs once, builds `feature_list.json` and `init.sh`; Coding agent wakes per session, reads progress, picks one feature, commits, leaves a `claude-progress.txt`. Single-context-window agents fail to build large apps; this two-agent pattern works.
  - Anthropic's compaction primitive: condenses near-limit context into a high-fidelity summary; first-class API support.
  - Cognition's evolved view (April 2026, "Multi-Agents: What's Actually Working"): single-threaded writes, parallel readers; "setups where multiple agents contribute intelligence to a task while writes stay single-threaded."
- **Ablation:** Linear vs compaction vs file-system memory, fixed model. Measure pass rate and total tokens at trajectory length cap.

### 7. Action Parser / Output Extraction

- **What it is:** How the harness extracts the action from the model's output. Regex bash-fence extraction (mini), strict tool-call parsing (Anthropic native API), JSON-mode (OpenAI), XML tag parsing (Cline/Roo Code).
- **Why it matters:** Failure modes — what happens when the model emits malformed output? Retry, repair-prompt, abort. mini-SWE-agent's choice: if no parseable bash block, append a polite reminder and retry once before failing.
- **Ablation:** Inject parse failures synthetically; measure recovery rate. The Anthropic edit_anthropic tool's "old_str must match exactly one or more lines, including whitespace" is a famous source of repeated failures — the str_replace tool's recent `--range` parameter PR exists specifically because non-unique old_str strings repeatedly broke the loop.

### 8. System Prompt Design

- **What it is:** The system message. Length, structure, style, instruction "altitude."
- **Why it matters:** Anthropic's "right altitude" guidance — too prescriptive (2000-line if-else rule trees) creates brittleness; too vague ("be helpful") provides no behavioral signal. The Goldilocks zone is specific-enough-to-guide, flexible-enough-to-handle-variance.
- **Empirical evidence (load-bearing):** ETH Zurich's "Evaluating AGENTS.md" (Gloaguen et al., arXiv 2602.11988, Feb 2026): **LLM-generated context files *reduced* SWE-bench Lite success by 3% on average and increased inference costs by 20%+.** Developer-committed files improved performance only 4%. Codebase overviews (the most-recommended section!) had no measurable effect on file-localization speed. The mechanism: tool-mention spikes from 0.05/task to 2.5/task when prompted, but this manifests as counterproductive over-exploration, not adherence.
- **SOTA practice:** Short, declarative, structured (use `<instructions>`, `<tools>`, `## Output format` sections). Anthropic's published Claude Code tool prompt is hundreds of tokens, not thousands.
- **Ablation:** Vary length (50 / 200 / 1000 / 2000 lines), style (declarative vs imperative), and structure. Measure pass rate, cost, mean trajectory length.

### 9. Trajectory Length Cap / Step Budget

- **What it is:** The maximum number of model→tool turns. mini-SWE-agent default ~250. SWE-agent v1 ~100. Anthropic's internal Verified harness: "until model decides finished or 200K context exhausted."
- **Why it matters:** Cost-vs-completion tradeoff. SWE-rebench leaderboard footnote: "GLM-4.6 reaches the agent's maximum step limit (80 steps in our setup) roughly twice as often as GLM-4.5. This suggests its performance may be constrained by the step budget."
- **Ablation:** Sweep budget {25, 50, 100, 250, 500}, plot pass rate vs cost. Diminishing returns past ~100 turns for most models on Verified.

### 10. Sampling Parameters

- **What it is:** temperature, top_p, reasoning_effort/thinking_budget, max_output_tokens, presence/frequency penalties.
- **Why it matters:** Reasoning-budget is now a first-class parameter. Anthropic Claude 4.x extended thinking has explicit token budgets. OpenAI o-series and GPT-5-Codex have `reasoning_effort` (low/medium/high/xhigh). Nemotron 3 has "granular reasoning budget control at inference time."
- **SOTA:** mini-SWE-agent v2 doesn't set temperature ("uses provider default"). Anthropic recommends max_tokens at provider max for Verified runs.
- **Empirical:** GPT-5.2-Codex xhigh effort raises SWE-bench by several points but adds ~30–40% tokens vs medium. Kimi K2 Thinking sustains 200–300 tool calls without drift specifically because of its reasoning configuration.
- **Ablation:** Run the same 50 instances at temperature ∈ {0, 0.2, 0.7} and reasoning_effort ∈ {low, medium, high, xhigh}. Plot the pass-rate vs cost frontier. **This is one of the highest-leverage ablations you can run.**

### 11. Retry / Voting / Self-Consistency / Best-of-k

- **What it is:** Run the same task k times, select best by majority/judge/test-pass. Pass@k vs pass@1.
- **Why it matters:** Independent draws cover different failure modes. SWE-rebench publishes pass@5 alongside pass@1; Sonnet 4.5 has the highest pass@5 (55.1%) and uniquely solves several otherwise-unsolved instances.
- **SOTA:** Agentless generates multiple candidate patches, filters those with syntax errors / failing existing tests, then re-ranks. This is voting + verification.
- **Ablation:** k ∈ {1, 3, 5, 10}, plot pass@k. The cost/quality elbow is usually at k=3.

### 12. Verification and Rollback

- **What it is:** Does the agent test patches before submitting? Revert on failure?
- **Why it matters:** Agentless's three-phase localize → repair → validate pipeline reaches 32% on SWE-bench Lite at $0.70/issue (vs $3.34 for agent-based approaches at similar quality). Validation is cheap and load-bearing.
- **SOTA:** Anthropic's effective-harnesses post explicitly prompts the coding agent to "run tests end-to-end like a human user" via Puppeteer MCP, not just unit tests.
- **Ablation:** Compare run-tests-before-submit vs not, holding everything else constant.

### 13. Sub-Agent Orchestration Topology

- **What it is:** Single-agent, hierarchical (orchestrator + workers), peer multi-agent. Communication: shared context, summarized handoff, fully isolated.
- **Why it matters:** This is the most-debated layer. Cognition's "Don't Build Multi-Agents" (June 2025) argued parallel writers create context-isolation conflicts. Their April 2026 follow-up "Multi-Agents: What's Actually Working" walks it back partially: **"setups where multiple agents contribute intelligence to a task while writes stay single-threaded"** work; counterintuitively, "this technique works best when the coding and review agents do not share any context beforehand."
- **SOTA:** Anthropic's multi-agent research system uses orchestrator-worker for parallel information gathering, single-agent for decision-making. Manus avoids role-based divisions ("designer/engineer/PM") because those are human cognitive limitations and don't apply to LLMs.
- **Empirical caution:** for a solo builder, multi-agent is 3–10× the cost and the quality gains are often within infrastructure noise.

### 14. Memory / Persistent State

- **What it is:** Cross-session, cross-task memory. CLAUDE.md/AGENTS.md, progress files, vector stores, structured event logs.
- **Why it matters:** Long-running tasks need state that survives context-window resets.
- **SOTA:** Anthropic's `claude-progress.txt` + git history pattern; ENGRAM-style typed memory (episodic/semantic/procedural); Manus's file-system-as-memory.
- **Counter-evidence:** ETH Zurich's AGENTS.md result above — naïve persistent context can *hurt*.

### 15. Retrieval / RAG Layer

- **What it is:** Does the agent retrieve relevant code chunks proactively? How: BM25, embeddings, structural (tree-sitter), LSP-based.
- **SOTA:**
  - Aider's repo map: tree-sitter AST parsing + PageRank on the symbol-reference graph + binary-search token-budget fitting. Token-budget defaults to 1K, dynamically expands.
  - Agentless-Lite: pure RAG (top-5 file retrieval), 32.33% on SWE-bench Lite at $0.21/issue.
  - WarpGrep v2 (Morph): RL-trained search subagent in a separate context window; adds 2.1–2.2 points to every base model tested, cuts time by 28%, cost by 15%.
- **Ablation:** Tree-sitter repo map vs grep-only vs no retrieval. Aider's design wins specifically on "stay-in-IDE pair-programming" workloads where the user provides intent and Aider needs to navigate.

### 16. MCP Server Integration

- **What it is:** Model Context Protocol servers expose tools/resources/prompts to the agent.
- **When MCP helps:** Tools that *don't* exist as CLIs in the model's training set; auth-gated services (Slack, Asana, Salesforce); structured data sources where natural-language tool descriptions add value.
- **When MCP is noise:** Wrapping tools the model already knows (`gh`, `docker`, `psql`, `aws`). HumanLayer: "Just prompt the agent to use the CLI." Anthropic released experimental MCP tool-search precisely because too many connected MCP servers degrade performance via context bloat.
- **Ablation:** Disable all MCPs vs keep only the auth-gated ones.

### 17. Environment / Sandbox Layer

- **What it is:** Where the agent's code runs. Local, Docker, Podman, Singularity, ephemeral cloud container.
- **Why it matters — load-bearing finding:** Anthropic's "Quantifying Infrastructure Noise in Agentic Coding Evals" (Feb 5, 2026): **infrastructure config alone produces a 6 percentage point swing on Terminal-Bench 2.0** between strict (1×) and uncapped resource configs (p < 0.01). Infra error rates dropped from 5.8% (strict) to 0.5% (uncapped). On SWE-bench: smaller effect (+1.54 pp at 5× vs 1× RAM, 227 problems × 10 samples).
- **Mechanism:** Containers killed for exceeding allocation produce false negatives. GKE was treating per-task specs as both floor and ceiling, while Terminal-Bench's official sandbox allows temporary over-allocation.
- **Recommendation:** Run on a 3× headroom container baseline; report resource specs explicitly in any benchmark you publish; run multi-day, multi-time-of-day samples to average API-latency-driven variance.
- **For your hardware (16GB MBP 2018):** Docker sandbox is fine (Docker Desktop on macOS). SWE-MiniSandbox (arXiv preprint, March 2026) uses ~5% disk and ~25% prep time of Docker for SWE tasks via venv-only sandboxing. Worth considering if Docker-on-Mac is too slow.

### 18. Compaction / Summarization Triggers

- **What it is:** When and how to compress old context.
- **SOTA:** Anthropic's compaction primitive triggers near token-limit; Manus does compaction first, then summarization (with a structured summary schema) when compaction hits diminishing returns; trajectory recitation (rewriting the goal at the top of context periodically) keeps attention focused.
- **Ablation:** Compact-at-50% vs 75% vs 90% of context limit; summary schema vs free-form summary.

### 19. Hooks / Middleware

- **What it is:** Pre-tool-use, post-tool-use, on-error injection points. Claude Code-style architecture.
- **Why it matters:** Hooks-as-deterministic-policy (lint after every edit, run tests after `git commit`) generally help. Hooks-as-noise (notification spam, frustration detection logic) generally hurt. Anthropic's effective-harnesses post pushes mandatory `init.sh` and end-to-end smoke tests as a deterministic harness layer.
- **Your AHOL experience:** This is exactly the layer you were varying. The result that mutations had small causal effect is consistent with the ETH Zurich AGENTS.md finding: prose-level config inside an already-strong harness has marginal effects within infra-noise.

### 20. Output Guardrails / Validators

- **What it is:** Type-check, syntax-check, test-runner, lint. Block actions that fail and ask for repair.
- **SOTA:** Aider auto-lints and auto-fixes after every LLM edit; supports `--lint-cmd` and `--test-cmd`. Agentless's filter step removes patches with syntax errors before validation.
- **Ablation:** Enable/disable each validator. Aider has internal benchmark data showing search/replace block format outperformed edit-block format with "no regression" — these matter.

---

## Part 2 — The Frontier of Coding-Agent Architectures

### 2.1 Anthropic's Claude Code (per claw-code)

**On claw-code provenance:** On March 31, 2026, Chaofan Shou (security researcher) reported that Anthropic accidentally shipped a `.map` source-map file in npm package `2.1.88` — a Bun-runtime bug exposed the unobfuscated TypeScript (~512K LOC, ~1,900 files) via an Anthropic R2 bucket. GitHub disabled 8,100+ mirror repos via DMCA within hours. Sigrid Jin (instructkr) used Codex to translate to Python in hours; the resulting `claw-code` repo crossed 100K stars in ~24 hours. A Rust port followed.

**Legal/ethical/practical caveats — be direct:**
- claw-code's authors describe it as "clean-room Python rewrite" capturing "architectural patterns without copying any proprietary source." The legal status of AI-driven cross-language translation of leaked code is **unsettled**; Gergely Orosz's framing ("rewriting TypeScript in Python probably means copyright doesn't apply") is a *prediction*, not a ruling.
- The README explicitly says "Claude subscription login is not a supported auth path" — you'd burn API tokens at full retail rate.
- The codebase carries significant complexity (Tamagotchi-mode, KAIROS feature flag, frustration detection, anti-distillation tokens) that isn't load-bearing for an ablation harness.
- HN consensus per multiple linked threads: "There's nothing special about [Claude Code's] harness, it's well made that's all" and "Claude Code ranks pretty low in terminal bench."

**What's in Claude Code architecturally (worth understanding even if you don't fork it):**
- TypeScript/Bun runtime, single binary distribution.
- Tool catalog: Bash, Read, Write, Edit, Grep, Glob, Task (sub-agent dispatch), WebFetch, WebSearch, NotebookEdit, TodoWrite, plus user-installed MCP tools.
- Skills: progressive-disclosure markdown that loads on demand. Now an open standard supported by Codex/OpenCode.
- Agent loop with hooks (pre/post-tool-use, on-error, on-session-start).
- Compaction built-in via the Claude API's native compaction primitive.
- The Task tool is a sub-agent spawner — it creates a sub-agent with a fresh context window, runs to completion, returns a summary. This is the "by communicating" pattern Manus describes.
- "Undercover Mode" — strips Anthropic-internal codenames from commits.

**Recommendation:** Read claw-code as a reference. Do not fork it. If you want a Rust harness, write your own minimal one against the OpenHands V1 SDK API or the mini-SWE-agent contract.

### 2.2 OpenMythos (kyegomez) — Skip This

**What it is:** A PyTorch implementation of a *model architecture* — a Recurrent-Depth Transformer (RDT) — that the author hypothesizes is what powers an unreleased Anthropic model called "Claude Mythos." Three stages: Prelude (initial transformer) → Recurrent Block (looped up to 16× with state h_{t+1} = A·h_t + B·e + Transformer(h_t, e)) → Coda (final transformer). MoE feed-forward, switchable GQA/MLA attention. Cites Saunshi et al. (2025) for the claim that a 770M-param RDT matches a 1.3B standard transformer.

**Honest assessment:**
- **OpenMythos is not a harness.** It's a *model architecture*. It is irrelevant to your harness-optimization goals. The "RDT framework" is not a harness framework; it's a transformer variant.
- The RDT idea itself is real research (Looped Transformers / Universal Transformers / Saunshi et al.). The implementation here is one developer's first-principles guess at an unreleased model's architecture — Mythos is acknowledged by Anthropic as existing (above Opus in capability, "handled carefully due to cybersecurity risk") but no architectural details have been published. OpenMythos has *no weights*.
- kyegomez's reputation: founder of `swarms` framework. Has been publicly accused of plagiarism (Shaw of ai16z, December 2024, citing 2023 Reddit posts). Track record of speculative implementations of papers (Multi-Modal Mamba, Vision Mamba reimpls, etc.) of variable quality. Self-runs the $swarms token. **The CSS of his work is to get implementations out fast and let the community debug.** Useful for *exposure to ideas*; not a load-bearing reference.

**Recommendation:** Ignore OpenMythos for harness work. If you want to study latent-reasoning architectures separately, read Saunshi et al. (2025) directly.

### 2.3 mini-SWE-agent — Your Recommended Substrate

- **What it is:** ~100 lines of Python, by the SWE-bench/SWE-agent team (Princeton + Stanford). v2 current.
- **Architecture:** Linear conversation history; bash-only via `subprocess.run` (stateless, no persistent shell — every command is independent); LiteLLM-routed model layer (works with any provider); YAML-configurable prompts; Docker/Podman/Singularity sandbox support.
- **Performance:** >74% on SWE-bench Verified with Sonnet 4-class models. Adopted by Meta, NVIDIA, Essential AI, IBM, Anyscale.
- **What's hardcoded vs configurable:**
  - **Configurable via YAML:** system prompt, instance template, action regex, step cap, environment image, model provider/name/extra-params.
  - **Hardcoded in 100 lines:** the loop body itself, action parser regex, history append semantics. This is the *point* — easy to fork and mutate.
- **Why this is your substrate:** every harness layer is small, named, and isolated. You can swap the parser by editing 5 lines. You can swap the history strategy by editing 10. You can A/B against a published baseline by changing a YAML field.

### 2.4 OpenHands V1 SDK — The Sophisticated Alternative

- **What it is:** arXiv 2511.03690 (Nov 2025). Production-grade composable harness SDK; supersedes the V0 monolithic FastAPI+Socket.IO design.
- **Architecture:** Nine components: event-sourced state, LLM, tools, agent, context-window manager, local conversation, secret registry, security/confirmation, deployment. Stateless by default with one source of truth (event log).
- **Composability:** Two-layer — independent deployment packages (SDK, Tools, Workspace, Server), and typed component model so you can swap a tool or agent declaratively.
- **Trade-off vs mini:** Much more surface area, but actually production-ready. Has native sandboxed execution, REST/WebSocket services, multi-LLM routing, security analysis. **V0 deprecation: April 1, 2026.**
- **When to pick V1 SDK over mini:** if you eventually want a production-grade product, not a research scaffold. For *learning what to vary*, mini is faster. For *deploying a real harness for personal use across BME/web/SWE work*, OpenHands V1 SDK is better.

### 2.5 SWE-agent (the original)

The full v1 framework — persistent shell sessions via SWE-ReX, more tools, custom edit_anthropic with `str_replace`, mode for cybersecurity CTFs (EnIGMA). Most users moved to mini because the original's complexity didn't deliver enough lift, and Anthropic's own published Verified scaffold uses just Bash + str_replace_editor.

### 2.6 Aider

- Tree-sitter repo map + PageRank symbol-importance ranking is the differentiator. 41K+ stars, 5.3M+ installs.
- LiteLLM for any provider; built-in lint/test/auto-commit; "architect" mode (planner + implementer two-model workflow).
- **When Aider wins:** chat-driven, repo-aware pair programming where the human supplies intent and Aider needs structural code understanding without flooding context.

### 2.7 Cline / Roo Code / Cursor

- **Cline:** Plan/Act mode — separate model selection per mode. Apr 2026 telemetry: Sonnet 4 dominates both modes (~43% Plan, ~47% Act). Most popular cross-mode combo: Opus 4.1 → Sonnet 4 (25.3% of separated-model usage). Cline's deep-planning slash command, checkpoint/rollback, and full token/cost transparency are notable.
- **Roo Code:** Cline fork; XML-tag tool parsing (works around Anthropic tool-use rate limits).
- **Cursor:** IDE-native, "Auto" model selection (heuristic-based, opaque, mostly defaults to GPT-4.1 per community testing). Cursor 3 added cloud VMs and parallel Agent Tabs. Premium routing being gradually rolled out. **Cursor's auto-routing is widely reported as low-trust** — most pro users pin a specific model.

### 2.8 OpenAI Codex CLI / Harness

- OpenAI's "Harness engineering: leveraging Codex in an agent-first world" (Feb 13, 2026, openai.com/index/harness-engineering): documents a 5-month internal experiment building a 1M-LOC product with **zero human-written code** using Codex agents. Core insights: depth-first task decomposition; mechanical architectural enforcement (linters, pre-commit hooks); AGENTS.md as a context spec; Codex internally reviews its own PRs in a "Ralph Wiggum loop" until all reviewers are satisfied.
- "Unrolling the Codex agent loop" (Feb 2026) describes the agent-loop layer cleanly. 
- Codex CLI tops Terminal-Bench 2.0 at 82.0% per IJONIS's harness writeup; SWE-bench Verified ~78% with GPT-5.3-Codex.

### 2.9 Cognition / Devin

- "Don't Build Multi-Agents" (June 2025) — single-thread is robust.
- "Multi-Agents: What's Actually Working" (April 2026) — single-threaded *writes*, parallel intelligence contributors. Devin Review now natively iterates against Devin without shared context.

### 2.10 Agentless / Agentless-Lite

- **Agentless:** localize → repair → validate, 700-line monofile. 32% SWE-bench Lite at $0.70/issue.
- **Agentless-Lite (Feb 2025):** pure RAG + LLM repair. 32.33% Lite at $0.21/issue ($0.12 with prepared retrieval). The cheapest competitive scaffold.
- **Lesson:** Many "agent" problems are actually classification + structured-prompting problems. For a non-trivial fraction of SWE-bench tasks, no loop is needed.

### 2.11 Live-SWE-agent (arXiv 2511.13646, Nov 2025)

- **The current SOTA among open scaffolds: 79.2% on SWE-bench Verified.**
- Starts from a basic bash-only scaffold; **autonomously evolves its own scaffold implementation while solving tasks** (creates new tools on the fly, retains them as "skills").
- Critically *runtime* self-evolution — no offline training cost like DGM.
- **Implication for AHOL:** This is the legitimate version of what you were trying to do, but operating at the harness layer (tool synthesis), not the prose-config layer. It's the ceiling you should benchmark against once your substrate is up.

### 2.12 Meta-Harness (Stanford IRIS, arXiv 2603.28052, March 2026)

**This is the closest published prior art to AHOL — and it shows what was load-bearing:**
- Yoonho Lee, Roshen Nair, Qizheng Zhang (Stanford), Kangwook Lee (KRAFTON), Omar Khattab (MIT), Chelsea Finn (Stanford).
- **Meta-Harness is an outer-loop optimizer that searches over harness *code*, not config.** Uses Claude Code as the proposer agent, with filesystem access to all prior candidates' source, scores, and execution traces (up to 10M tokens per step). Compares against ACE, OpenEvolve, TTT-Discover.
- **Headline results:** On Terminal-Bench-2.0, Meta-Harness reaches 37.6%, beating Goose (35.5%), Terminus-KIRA (33.7%), mini-SWE-agent (29.8%), Terminus-2 (28.3%), and Claude Code (27.5%). On text classification, +7.7 points over the SOTA context-management system using 4× fewer context tokens. On math reasoning: +4.7 points across 5 held-out models.
- **The methodological lesson that explains your DECOMPOSE verdicts:** Meta-Harness only worked when given **filesystem access to source + traces + scores**, not when restricted to short-template feedback. AHOL's `.claude/` mutation space *was* the short-template feedback space. The harness layer is where the optimization signal lives.
- **Action item:** Read the paper end-to-end. Their evaluation gating, calibration, and filesystem-trace pattern is exactly the framework you should adopt for your real harness optimizer.

### 2.13 Self-Evolving Harnesses Beyond Live-SWE-agent

- **DGM (Darwin-Gödel Machine, Sakana AI / Zhang et al.):** archive-of-agents evolutionary search. SWE-bench 20% → 50%. Requires sandboxed offline training; not solo-builder-friendly without funding.
- **AlphaEvolve (Google DeepMind, 2025):** evolutionary coding agent for algorithmic discovery. Closed.
- **OpenEvolve (community):** open-source AlphaEvolve replica. Tractable for solo builders.
- **ShinkaEvolve (Sakana, ICLR 2026):** open-source counterpart to AlphaEvolve; novel MoE load-balancing loss in 30 generations.
- **SICA (Self-Improving Coding Agent, Bristol, ICLR 2025 workshop):** archives + self-modification; 17% → 53% on SWE-bench Verified. Code is published; tractable on an API budget.
- **HyperAgents (Meta/UBC/Oxford/NYU, March 2026):** self-improvement strategies that *transfer across domains*.
- **Solo-builder verdict:** Live-SWE-agent and SICA are the two systems you can realistically run. DGM and AlphaEvolve require offline training compute. Build your harness on a substrate that exposes the agent loop; enable Live-SWE-agent-style runtime tool synthesis as one of your ablations.

---

## Part 3 — Model Landscape (Mid-2026)

All scores are SWE-bench Verified unless noted. Note Anthropic's infra-noise warning: ±1.5pp at minimum, ±6pp on Terminal-Bench. Treat ranking deltas under 3pp as noise.

| Model | SWE-Verified | Input $/M | Output $/M | LiteLLM string | Notes |
|---|---|---|---|---|---|
| Claude Mythos Preview | 93.9% | n/a | n/a | n/a | Closed preview, no API |
| Claude Opus 4.7 | 87.6% | $5.00 | $25.00 | `anthropic/claude-opus-4-7` | New tokenizer ~5–35% more tokens vs 4.6 for same text |
| Claude Opus 4.6 | 80.8% | $5.00 | $25.00 | `anthropic/claude-opus-4-6` | 1M context at standard rates |
| GPT-5.4 (xHigh) | ~80% / 59.1% Pro | $2.50 | $15.00 | `openai/gpt-5-4` | Strong on Pro |
| Gemini 3.1 Pro | 80.6% | $2.00 | $12.00 | `google/gemini-3-1-pro` | Best $/quality |
| Claude Sonnet 4.6 | 79.6% | $3.00 | $15.00 | `anthropic/claude-sonnet-4-6` | 70% preferred over 4.5 in Claude Code; 59% over Opus 4.5 |
| Claude Sonnet 4.5 | ~77% | $3.00 | $15.00 | `anthropic/claude-sonnet-4-5-20250929` | 1M context billed 2× input/1.5× output above 200K |
| DeepSeek V4-Pro | 80.6% | $1.74 (promo $0.43) | $3.48 (promo $0.87) | `deepseek/deepseek-v4-pro` | MIT license; 1M context; 75% promo discount through May 31, 2026 |
| MiniMax M2.5 | 80.2% | $0.30 | $1.20 | `minimax/minimax-m2-5` | Open-weight; 192K context |
| Kimi K2.6 | 80.2% / 58.6% Pro | $0.60 (OR $0.75) | $2.50 (OR $3.50) | `moonshotai/kimi-k2.6` | Modified MIT; 256K context; 4000 tool-call stability over 13h sessions |
| Kimi K2.5 | 76.8% | $0.40 | $2.00 | `moonshotai/kimi-k2.5` | |
| Kimi K2 Thinking | n/a | $0.60 | $2.50 | `moonshotai/kimi-k2-thinking` | Stable through 200–300 tool calls |
| GLM-5.1 | 77.8% / 58.4% Pro | $1.00 | $1.40 | `zai/glm-5-1` | Trained on Huawei chips, not NVIDIA |
| GLM-4.6 | 73.8% | $0.60 | $2.20 | `zai/glm-4-6` | 200K context |
| Nemotron-3 Super | ~70% (29% Terminal-Hard) | Free on OpenRouter | Free on OpenRouter | `nvidia/nemotron-3-super-120b-a12b` | 120B / 12B active hybrid Mamba-Transformer; 1M context; AI Index 36 |
| GPT-OSS-120B (high) | 62.4% | varies (Groq/OpenRouter) | varies | `openai/gpt-oss-120b` | OSS, Aug 2025; AI Index 33 |
| GPT-OSS-20B | ~52% | varies | varies | `openai/gpt-oss-20b` | |
| Qwen3.6 Plus | 78.8% | $0.28 | varies | `qwen/qwen3-6-plus` | 1M context; leads Terminal-Bench 2.0 in some configs |
| Qwen3-Coder | varies | varies | varies | `qwen/qwen3-coder-480b-a35b-instruct` | |
| MiniMax M2.7 | ~78% | $0.30 | varies | `minimax/minimax-m2-7` | Self-evolving variant |
| Grok 4 Code Fast | ~58.6% (independent) / 72-75% (xAI self-report) | varies | varies | `xai/grok-4-code-fast-1` | Big harness-dependent gap |

### On the user's three named models

- **Kimi K2.6 — your primary:** 80.2% Verified at $0.60/$2.50 (Moonshot direct) or $0.60/$2.80 (OpenRouter; some providers $0.75/$3.50). 256K context. Modified MIT license. Open weights on Hugging Face (self-hosting impractical on your hardware — needs dual M3 Ultra Mac Studio at minimum). **US billing path: OpenRouter accepts standard USD credit cards; Moonshot direct now supports international cards but OpenRouter is the friction-free path.** Can also run via Vercel AI Gateway. Honest capability ceiling per HN consensus: "below Sonnet 4.0 and Opus 4.0 on capability... better than Gemini 2.5 Pro on tool calling." Strong on agentic stability over long sessions.
- **"GPT-OSS-180B-high" — likely a misremembered name:** OpenAI's public OSS releases are **gpt-oss-120b** (62.4% SWE-Verified, Aug 2025) and **gpt-oss-20b** (~52%, smaller). No 180B variant exists in OpenAI's open-weight lineup. The "high" suffix refers to `reasoning_effort=high`. **Substitute:** gpt-oss-120b at high effort is the cheap-and-capable open option you were reaching for. Available free or near-free on Groq, OpenRouter, and many hosts.
- **Nemotron 3 Super — actually solid:** 120B total / 12B active hybrid Mamba-Transformer MoE with multi-token prediction. 1M context. AI Index 36 (ahead of gpt-oss-120b at 33, behind Qwen3.5 122B-A10B at 42). Listed Terminal-Bench Hard 29%, GDPval-AA ELO 1027. Available free on OpenRouter (`nvidia/nemotron-3-super-120b-a12b:free`) and via Ollama (`nemotron-3-super`). **Caveat:** the SWE-Verified score reported in NVIDIA's blog is via OpenHands harness, not mini-swe-agent; published mini-baseline doesn't yet exist. NVIDIA also released Nemotron-3-Nano-30B-A3B (free on OpenRouter) and Nemotron-3-Nano-Omni for multimodal. Worth running as a free-tier baseline.

### Routing-Strategy Pushback (Direct)

You wanted multi-model routing across Kimi K2.6 / GPT-OSS-120B / Nemotron / Sonnet / Opus. Here is the honest case against it for your scale:

1. **RouteLLM-style routers save 40–70% with <2% quality loss on hard tasks** (Morph's published number; aligned with the original RouteLLM paper) — but only when prompt distribution is *known and stable*, and only at high request volume where the saved $/request actually compounds. For solo benchmarking at hundreds of trajectories/week, your engineering time is the binding constraint, not your token spend.
2. **The infra-noise floor is 3–6pp.** If model A is 79% and model B is 80%, your routing decisions are noise. You can't even measure routing quality reliably without 10+ paired runs per task.
3. **Cline's published telemetry:** even users with explicit Plan/Act separation default to Sonnet for both modes (~46% Act share); the Opus→Sonnet plan-then-act combo is only 25% of cross-mode usage — and Opus 4.7's tokenizer change makes that 25% more expensive than it used to be.
4. **The actual production pattern that works** (per Anthropic's "AdvisorSwarm" and Cognition's revised multi-agent post): a *cheap executor* (Sonnet/Haiku/K2.6) drives the task; a *strong advisor* (Opus/Mythos) is consulted only on hard decisions. Cap advisor calls per request. This is two models, not five, and the routing is *event-triggered* (advisor called when executor expresses uncertainty), not classifier-driven.

**Recommendation:** Pick K2.6 as your primary. Use Sonnet 4.6 via your $200 Max OAuth as a quality baseline (at $0 marginal cost on Max — though note Claude Code Max has tighter agentic-eval rate limits than the API). Reserve Opus 4.7 for the small subset of ablations where you specifically need to test whether the harness scales to a frontier model. **Skip GPT-OSS, Nemotron, GLM as primary routes for now** — they're useful as additional baselines once your substrate is stable, not as routing destinations.

---

## Part 4 — Recommended Substrate and 4-Week Plan

### Substrate Decision

**Fork mini-SWE-agent v2.** Reasons:

1. ~100 lines of Python = read it in an afternoon, mutate any layer in minutes.
2. Published baseline: >74% on Verified with Sonnet 4. You can validate your fork's correctness against this number.
3. LiteLLM-routed: any of the 11 models above swaps via a single YAML field. Including Kimi K2.6 (`moonshotai/kimi-k2.6`), Sonnet 4.6 via `anthropic/claude-sonnet-4-6`, and gpt-oss-120b via `openrouter/openai/gpt-oss-120b`.
4. SWE-bench evaluation infrastructure is built-in (`mini-extra`, sb-cli).
5. The Meta-Harness paper (your closest published prior art) tests **mini-SWE-agent as one of its baselines** — you can directly compare your numbers to theirs.
6. Avoids the legal and complexity hazard of claw-code; avoids the production-overhead cost of OpenHands V1 SDK.
7. Once your ablations are clean and you're ready to ship a personal harness, **migrate to OpenHands V1 SDK** for production use. Don't try to make mini production-grade; do try to use it as your research substrate.

### Layers to Vary First (in priority order, with expected effect-size estimates)

1. **Sampling parameters** (temperature, reasoning_effort) — 3–8pp swing per Anthropic's sonnet-ablation post and OpenAI's GPT-5-Codex effort-level reports. **Do this first; it's the cheapest, fastest, biggest ablation.**
2. **Action representation** (bash-only vs tool-call) — 0–5pp on capable models, larger on weaker ones. The Anthropic str_replace_editor design gives ~3pp over bash-only on Claude per Anthropic's published harness post.
3. **Step budget** (50/100/250/500) — bounded by problem complexity; SWE-rebench shows GLM-4.6 hits 80-step cap 2× as often as 4.5 — meaningful tail.
4. **Tool catalog** (bash only / +str_replace_editor / +grep / +glob / +tree-sitter repo map). The repo map is the highest-value addition, per Aider and WarpGrep evidence.
5. **Context management** (linear / compaction-at-75% / file-system memory pattern). Anthropic infra: ~3pp on long tasks.
6. **System prompt length and structure** — but expect ETH Zurich's null-result: minimal-but-precise wins; long prompts hurt.
7. **Hooks/guardrails** (lint after edit, run-tests-before-submit, syntax-check) — Agentless's evidence: validation steps are nearly free and net-positive.

### Hold Constant (don't vary in your first ablations)

- Sandbox config (use 3× headroom on Docker per Anthropic infra-noise; lock CPU + RAM caps and report them).
- Random seed via temperature=0 for the first ablation pass (then sweep temperature in pass 2).
- Test infrastructure: lock SWE-bench commit, evaluation harness version, model API version. Run sb-cli with explicit version pin.

### Measurement Methodology (Steal From Meta-Harness)

- **N samples per task ≥ 3** to average API-latency and stochastic decoding variance.
- **Run at multiple times of day** to average API congestion (Anthropic's anecdotal observation).
- **Report all infra parameters** (container resource specs, model temperature, model API version, harness git SHA, max_steps, sandbox kill threshold).
- **Use SWE-bench Verified for capability comparisons** but acknowledge contamination — also report on **SWE-bench Multilingual** or a held-out subset of SWE-bench-Live to control for training-set leakage.
- **Score function:** weighted utility per SICA — `U = w_score · pscore + w_cost · (1 - min(1, pcost/$10)) + w_time · (1 - min(1, ptime/300s))` with `w_score=0.5, w_cost=0.25, w_time=0.25`. This prevents pass-rate-only chasing.

### 4-Week Plan

**Week 1 — Substrate stand-up + reproduce a published baseline.**
- Fork mini-SWE-agent v2; pin the commit SHA.
- Set up sb-cli or local Docker SWE-bench runner with 3× resource headroom (per Anthropic infra-noise).
- Run mini-SWE-agent + Claude Sonnet 4.6 on SWE-bench Verified subset (50 instances, 3 samples each). Goal: reproduce within 3pp of the published mini+Sonnet number (~74%).
- Run the same setup with Kimi K2.6 via OpenRouter. Document any LiteLLM quirks.
- Set up cost/time/score logging to a local SQLite (every step, every tool call).
- **Deliverable:** baseline numbers committed to a `baselines/` directory; 95% CIs computed; cost/issue tabulated.

**Week 2 — Validate substrate + lock-in evaluation harness.**
- Run on **all 500** Verified instances with Kimi K2.6 (single config, 1 sample). Confirm published K2.6 SWE-Verified number ~80% (or be able to explain the delta).
- Run a 50-instance multilingual or held-out subset to detect overfitting.
- Produce a baseline report: K2.6 vs Sonnet 4.6 on (pass@1, $/issue, mean steps, mean tokens, mean wallclock, parse-failure rate).
- Implement and test the SICA-style utility scoring.
- Lock the harness SHA; from here on, every ablation is a *diff* from this base.
- **Deliverable:** Baseline report + locked git tag `harness-v0`.

**Week 3 — First real harness ablation: sampling + step budget.**
- Sweep `temperature ∈ {0, 0.2, 0.7}` × `reasoning_effort ∈ {low, medium, high}` (where supported) on a 100-instance subset.
- Sweep `max_steps ∈ {50, 100, 250, 500}` on the same subset.
- Plot pass-rate vs cost frontier per model (K2.6, Sonnet 4.6).
- **Pre-register** what effect size would be "real" given your sample size — pass-rate deltas under 3pp are noise, treat them as noise.
- **Deliverable:** A two-page memo with the Pareto frontier plot and a chosen "default config" backed by the data.

**Week 4 — Action representation + tool catalog.**
- Variant A (control): mini's bash-only.
- Variant B: bash + Anthropic-style str_replace_editor (port the spec from SWE-agent's `tools/edit_anthropic/config.yaml`).
- Variant C: bash + Aider-style tree-sitter repo-map injected into the system prompt at startup.
- Run each on the 100-instance subset with the Week 3 winning config. 3 samples each.
- Diagnose by parse-failure rate (representation), step count (catalog), and tokens-per-issue.
- **Deliverable:** Concrete recommendation + reproducible YAML configs for your "harness-v1" tag. This is your first real evidence of harness layer effects with proper isolation methodology — i.e., the AHOL-shaped result done right.

### Stretch Goals (After Week 4)

- Implement a Live-SWE-agent-style **runtime tool synthesis** loop on top of harness-v1. The paper's GitHub (`OpenAutoCoder/live-swe-agent`) is open.
- Re-implement **Meta-Harness's filesystem-trace-driven optimizer** (their reference repo: `stanford-iris-lab/meta-harness`) using harness-v1 as the inner harness and Sonnet 4.6 as the outer optimizer agent. Budget: 100 candidate evaluations.
- Branch the harness-v1 substrate into three task-flavored configs:
  - **Web-dev / iOS-26 Liquid Glass:** add a Puppeteer/Playwright tool, design-token MCP, screenshot-diff validator. Use Sonnet 4.6 (visual reasoning matters).
  - **SWE for internships:** harness-v1 as-is + lint/test guardrails. Kimi K2.6 primary.
  - **BCI/EEG signal-processing:** add a `scipy`/`mne` Python REPL tool, structured experiment-log skill, numerical-validator hook. This is where you actually start your domain pivot.

### Hardware Note

Your 2018 i7-8750H + 16GB MBP is fine for everything described. Local model hosting at competitive quality is not feasible (your hardware limit) but irrelevant — you're API-routing. SWE-bench Docker on macOS is workable; SWE-MiniSandbox (arXiv preprint, March 2026) is a fallback if Docker is too slow (5% disk, 25% prep time of containers; venv-only sandboxing for ~75% of SWE-bench tasks).

---

## Caveats

- **Benchmark contamination is real and large.** Claude Opus 4.5 scores 80.9% on Verified but 45.9% on SWE-bench Pro (per Scale's SEAL leaderboard with standardized scaffolding). OpenAI flagged that 59.4% of Verified's hardest unsolved problems had flawed test cases. Verified is a directional signal, not a measurement. **Always co-report on a less-contaminated benchmark** (SWE-bench Multilingual, SWE-rebench, SWE-bench Pro, or your own held-out internal eval).
- **Infra noise dominates small differences.** Anthropic's published 6pp swing on Terminal-Bench from container-resource configuration alone means treating any leaderboard delta under ~3pp as noise. Most "Model A beats Model B by 1.2pp" claims are not statistically meaningful.
- **claw-code's legal status is unsettled** and its codebase is not stable enough to base a solo research project on. Read it; don't fork it.
- **OpenMythos is not a harness** and has no relevance to your goals. The author has a track record of speculative-quality reimplementations and a financialized framework (`$swarms`); evaluate any of his work skeptically.
- **The "Claude Mythos Preview 93.9% SWE-Verified" leaderboard entry** is an Anthropic-internal preview not generally accessible. Plan around Opus 4.7 (87.6%) as the realistic frontier ceiling for solo-builder use, or Sonnet 4.6 / Kimi K2.6 (~80%) as the day-to-day ceiling.
- **AGENTS.md / CLAUDE.md skepticism is empirical.** Per ETH Zurich (Gloaguen et al., Feb 2026), context files reduced success rates by 3% on average and increased costs 20%+. **Keep your context file minimal, project-specific, and avoid auto-generating it from scratch with Claude.** This finding is a direct rebuke of the cargo-cult around `donnyclaude`-style heavily-customized layers — and is empirical confirmation of why AHOL hit a wall.
- **OpenAI's "Harness engineering" zero-human-code experiment** is real and impressive but came from a 3-person OpenAI team with internal-Codex access and a 5-month runway. The patterns (AGENTS.md, mechanical architecture enforcement, self-review loops) are reusable; the result ("ship 1M LOC with no human code") is not directly applicable to a solo undergraduate budget.
- **Multi-model routing** at solo scale is engineering overhead masquerading as cost optimization. Defer it past Week 8 unless your benchmark numbers force the issue.
- **Do not lose sight of your real goal.** You are practicing harness optimization on coding tasks because feedback loops are fast. The actual aim is BCI/EEG signal-processing agents. Once your harness-v1 ablation methodology is locked, *port the methodology* (substrate fork, layer ablation, locked config, cost/utility scoring) to a BCI domain — even with a tiny benchmark of 10 hand-curated EEG-pipeline tasks. The methodology is the asset; coding agents are the gym.

---

*Sources consulted include: Anthropic Engineering ("Effective context engineering," "Effective harnesses for long-running agents," "Writing effective tools for agents," "Quantifying infrastructure noise," Sonnet SWE-bench post, "Building agents with the Claude Agent SDK"), OpenAI ("Harness engineering: leveraging Codex," "Unrolling the Codex agent loop"), Cognition ("Don't Build Multi-Agents," "Multi-Agents: What's Actually Working"), arXiv 2511.13646 (Live-SWE-agent), arXiv 2511.03690 (OpenHands V1 SDK), arXiv 2603.28052 (Meta-Harness), arXiv 2602.11988 (Evaluating AGENTS.md), arXiv 2407.01489 (Agentless), arXiv 2505.22954 (Darwin-Gödel Machine), arXiv 2504.15228 (SICA), arXiv 2406.18665 (RouteLLM), arXiv 2508.10925 (gpt-oss model card), Manus blog ("Context Engineering for AI Agents"), Aider documentation, OpenRouter pricing pages, SWE-bench leaderboards (swebench.com, vals.ai, swe-rebench.com, BenchLM.ai, Morph), GitHub repositories for SWE-agent/mini-SWE-agent, OpenHands/software-agent-sdk, ultraworkers/claw-code, kyegomez/OpenMythos, OpenAutoCoder/live-swe-agent, stanford-iris-lab/meta-harness, NVIDIA Nemotron 3 announcements, Cybernews coverage of the Claude Code leak, Cline documentation and telemetry.*