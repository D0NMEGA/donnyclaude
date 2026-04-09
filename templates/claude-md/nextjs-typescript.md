# Project Agent Instructions

## Installed Tool Stack

You have the following tools installed. Use them proactively -- they are requirements, not suggestions.

### GSD (Get Shit Done) -- Workflow Engine
- `/gsd:new-project` -- Initialize project structure
- `/gsd:plan-phase N` -- Plan EVERY phase before execution
- `/gsd:execute-phase N` -- Execute with fresh subagent contexts
- `/gsd:verify-work` -- Verify after EVERY phase completion
- `/gsd:progress` -- Check status between phases
- `/gsd:quick "task"` -- Ad-hoc task with GSD guarantees

### Superpowers -- Development Methodology
- `/superpowers:brainstorming` -- BEFORE any creative or design work
- `/superpowers:writing-plans` -- BEFORE any multi-step implementation
- `/superpowers:test-driven-development` -- BEFORE writing implementation code
- `/superpowers:verification-before-completion` -- BEFORE claiming any phase is done
- `/superpowers:systematic-debugging` -- ON any bug or unexpected result
- `/superpowers:dispatching-parallel-agents` -- WHEN 2+ independent tasks exist
- `/superpowers:requesting-code-review` -- AFTER completing major features

### Everything Claude Code (ECC) -- Review & Quality
- `/everything-claude-code:plan` -- Generate implementation blueprints
- `/everything-claude-code:tdd` -- Test-driven development enforcement
- `/everything-claude-code:code-review` -- Code review via reviewer agent
- `/everything-claude-code:security-scan` -- OWASP Top 10 audit
- `/everything-claude-code:verification-loop` -- Comprehensive verification per phase

### Context7 MCP -- Live Documentation
- `mcp__context7__resolve-library-id` -- Resolve library IDs before lookup
- `mcp__context7__query-docs` -- Fetch current, version-specific API docs
- **MUST use before writing ANY code that touches external libraries**

### 21st.dev Magic MCP -- UI Components
- `mcp__21st-magic__21st_magic_component_builder` -- Generate UI components
- `mcp__21st-magic__21st_magic_component_inspiration` -- Browse component library
- `mcp__21st-magic__21st_magic_component_refiner` -- Improve existing components

### Playwright MCP -- Browser Automation
- `mcp__playwright__browser_navigate` -- Navigate to URLs
- `mcp__playwright__browser_snapshot` -- Capture page state
- Use for visual QA and verifying rendered output

## Tool Integration Protocol

**BEFORE planning any phase:**
1. Superpowers brainstorming for design decisions
2. Context7 for every library the phase touches
3. ECC plan for implementation strategy
4. 21st.dev for UI component discovery (frontend phases)

**BEFORE executing any phase:**
1. ECC tdd -- write tests FIRST
2. Context7 for exact API signatures

**DURING execution:**
1. Context7 before ANY library API call
2. 21st.dev for component generation (frontend)
3. ECC code-review after writing code

**AFTER each phase:**
1. Superpowers verification-before-completion
2. Playwright for visual verification (frontend phases)
3. ECC verification-loop
4. GSD verify-work

## Execution Rules
1. Run all phases autonomously. Do NOT pause unless genuinely ambiguous.
2. Use GSD for every phase: plan -> execute -> verify -> next.
3. Use Context7 before writing ANY library code. No exceptions.
4. TDD: write tests BEFORE implementation. Always.
5. Use 21st.dev for ALL UI components -- no plain/unstyled components.
6. Use code review on ALL code before marking a phase done.

## Project Architecture

### Frontend
- **Stack:** Next.js 15+ App Router + TypeScript + Tailwind CSS v4
- **Components:** shadcn/ui + 21st.dev Magic MCP
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Deployment:** Vercel (or Cloudflare Workers via OpenNext)

## Code Conventions

### TypeScript
- Strict mode enabled
- Prefer `interface` for object shapes, `type` for unions
- No `any` -- use `unknown` and narrow
- Server Components by default, `'use client'` only when needed
- Immutable patterns -- spread operator, no mutation

## Deployment & CI/CD

<!-- Fill in: Vercel, Cloudflare, etc. -->

## Constraints
- TypeScript strict mode
- No inline styles -- use Tailwind classes
- WCAG AA contrast ratios required
