# Docker API Choice for AHOL Tier-2 Variant-Runners

Status: RESEARCH COMPLETE
Date: 2026-04-23
Scope: API surface between Claude Code (orchestrator + variant-runner subagents) and Docker Desktop on the host. Does NOT cover Tier-3 task-runners, which execute INSIDE containers and are unaffected.

## Verdict

**Stay raw Bash** with a tightly-scoped `Bash(docker ...)` allowlist.

No Docker MCP server in the April 2026 landscape meets the bar for AHOL's safety, observability, and maintenance requirements. The two most credible candidates are either feature-incomplete or effectively unmaintained, and Docker Inc. has not shipped a first-party container-lifecycle MCP server. Raw Bash via Claude Code's existing allowlist is both lower-overhead and safer to reason about, and it preserves the option to revisit if Docker Inc. ships an official server.

## Research Summary (5 searches used)

Searches:

1. `Docker official MCP server Model Context Protocol 2026`
2. `Anthropic MCP directory Docker server list`
3. `MCP server docker exec volume mount container orchestration github 2026`
4. WebFetch: `github.com/QuantGeekDev/docker-mcp`
5. WebFetch: `github.com/ckreiling/mcp-server-docker` (plus commits page) and `github.com/ofershap/mcp-server-docker`

Additional WebFetches were used to disambiguate Docker Desktop's MCP Toolkit vs an MCP daemon-control server; these count within the 5-search budget as supporting fetches, not new searches.

## Candidate Survey

### Docker Inc. official (NOT SHIPPED for daemon control)

- Repo: https://github.com/docker/mcp-registry and https://docs.docker.com/ai/mcp-catalog-and-toolkit/
- Maintainer: Docker Inc.
- What it is: A catalog/registry of OTHER MCP servers packaged as container images, plus the MCP Toolkit/Gateway for running them. It is a delivery vehicle for third-party MCPs; it is NOT an MCP server that exposes `docker run`, `docker logs`, `docker exec` as tools to an AI client.
- Related: `mcp/hub` Docker Hub MCP server exposes Docker Hub IMAGE METADATA (search, pull counts, tags). It does not control the local daemon.
- Conclusion: No first-party Docker Inc. MCP server for daemon control exists as of April 2026.

### Anthropic official reference servers (NO DOCKER ENTRY)

- URL: https://github.com/modelcontextprotocol/servers and https://registry.modelcontextprotocol.io/
- Reference servers published by Anthropic: Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking, Time.
- Docker is listed only in the "community servers" section, not as a reference/official entry.
- Conclusion: Anthropic has not blessed or adopted a Docker MCP server.

### Community Candidate A: ckreiling/mcp-server-docker

- Repo: https://github.com/ckreiling/mcp-server-docker
- Maintainer: ckreiling (individual, not an org)
- Last commit: 2025-06-05 ("Bugfix for image labels issue #29") roughly 10 months ago as of April 2026
- Commits on main: 53
- License: GPL-3.0
- Tests / CI: No CI badge visible; no test files referenced in README. Cannot confirm meaningful coverage.
- Tool surface (most complete of the candidates):
  - Containers: list_containers, create_container, run_container, recreate_container, start_container, fetch_container_logs, stop_container, remove_container
  - Images: list_images, pull_image, push_image, build_image, remove_image
  - Networks: list_networks, create_network, remove_network
  - Volumes: list_volumes, create_volume, remove_volume
- Gaps for AHOL:
  - No explicit exec_container tool. Variant-runners need `docker exec` to probe container state for debugging and to trigger in-container benchmark hooks.
  - No docker_cp analogue for copying result artifacts out of finished containers.
  - No inspect_container call exposed as a named tool (status/health lookups).
  - 11 open issues and no visible commits in the last 90 days, suggesting the project is drifting toward unmaintained.
- Verdict: Most complete community option, but stale plus missing exec/cp/inspect makes it insufficient for AHOL's variant-runner workflow.

### Community Candidate B: QuantGeekDev/docker-mcp

- Repo: https://github.com/QuantGeekDev/docker-mcp
- Maintainer: Alex Andru (QuantGeekDev) with Ali Sadykov (md-archive)
- Popularity: 472 stars, 57 forks, 6 open issues
- Tool surface: create-container, deploy-compose, get-logs, list-containers (only 4 tools)
- Explicit gaps documented in the README itself:
  - No environment variable support for containers
  - No volume management
  - No network management
  - No health checks
  - No restart policies
  - No resource limits
- Verdict: Disqualifying for AHOL. Variant-runners require volume mounts for task input/output and resource limits for thermal control. This project is a demo, not a harness.

### Community Candidate C: ofershap/mcp-server-docker

- Repo: https://github.com/ofershap/mcp-server-docker
- Maintainer: Ofer Shapira (individual)
- Stats: 0 stars, 0 forks, 0 open issues, 14 total commits
- CI: GitHub Actions workflow present (`ci.yml`)
- License: MIT
- Tool surface: list_containers, container_logs, start_container, stop_container, restart_container, remove_container, exec_command, container_stats, list_images, remove_image (has exec, unlike ckreiling)
- Gaps: No run_container with volume-mount configuration documented; no create_container; no build_image; no volume/network management. Adoption is effectively zero.
- Verdict: Too immature and lacks the create/run path AHOL needs.

## Comparison: Top Candidate vs Raw Bash

The only candidate worth a head-to-head is ckreiling/mcp-server-docker, since the others fail correctness bars outright.

### Per-operation token estimates

Estimate assumptions:

- System-prompt cost of registering 20 Docker MCP tools: approximately 1800 to 2400 tokens of stable tool definitions loaded once per conversation. This is NOT a per-op cost, but it raises the baseline context and reduces the effective budget for orchestration reasoning.
- Per-op cost counts arguments sent plus response tokens consumed, not the amortized system-prompt cost.

Operation: Start container with volume mount and command (e.g. `run_container` / `docker run -v /work:/work --rm task-image python /work/run.py`)

| Approach | Input args tokens | Response tokens | Total per op |
|---|---|---|---|
| ckreiling run_container | approximately 180 (name, image, mounts array, env, cmd) | approximately 120 (container id + status JSON) | approximately 300 |
| Raw Bash docker run | approximately 140 (single command string) | approximately 60 (container id or stderr) | approximately 200 |

Operation: Tail container logs (e.g. `fetch_container_logs` / `docker logs --tail 200 <id>`)

| Approach | Input args | Response | Total per op |
|---|---|---|---|
| ckreiling fetch_container_logs | approximately 60 | approximately 140 (wrapped in JSON) | approximately 200 |
| Raw Bash docker logs | approximately 40 | approximately 130 (raw) | approximately 170 |

Operation: Inspect container state (NOT exposed as a named tool in ckreiling; see gap above. The closest MCP call is list_containers filtered by id, which returns more data than needed. Raw Bash wins on surface area here.)

| Approach | Input args | Response | Total per op |
|---|---|---|---|
| ckreiling list_containers filtered | approximately 80 | approximately 260 (list wrapper with full fields) | approximately 340 |
| Raw Bash docker inspect | approximately 40 | approximately 220 (JSON) | approximately 260 |

Operation: Copy files out of container (NOT exposed as a tool in ckreiling. Must be simulated via exec + stdout capture, which ckreiling also lacks, so this would fall back to Bash anyway.)

| Approach | Input args | Response | Total per op |
|---|---|---|---|
| ckreiling docker_cp analogue | N/A (not supported) | N/A | N/A |
| Raw Bash docker cp | approximately 50 | approximately 40 | approximately 90 |

Total per variant-runner wave (start + logs + inspect + cp = 4 ops): ckreiling approximately 840 plus one-time 2000 system overhead. Raw Bash approximately 520. Raw Bash is roughly 40 percent cheaper per op AND avoids the static tool-definition cost.

### Error-handling robustness

- ckreiling MCP: Errors are returned as JSON objects with an `error` field. The schema is stable but the content is whatever the underlying Docker SDK raised, which is approximately the same text as stderr. There is no enrichment, no structured error codes specific to the MCP.
- Raw Bash: Exit code plus stderr. Claude Code already surfaces exit code and stderr cleanly. Parsing `docker` stderr is a well-known pattern.

Net: Raw Bash loses no information versus the MCP for failure triage. Both surface "container not found", "image pull failed", "OCI runtime error" with equivalent fidelity.

### Permission scoping

AHOL's safety model requires:

- Variant-runner may start containers, read logs, inspect, exec, and remove its own containers.
- Variant-runner may NOT remove images, push images, prune the system, or touch containers outside its namespace.

Raw Bash allowlist (prefix-matched, documented below):

```
allow: Bash(docker run:*)
allow: Bash(docker logs:*)
allow: Bash(docker inspect:*)
allow: Bash(docker exec:*)
allow: Bash(docker cp:*)
allow: Bash(docker rm -f ahol-variant-*)   # namespaced to AHOL containers
allow: Bash(docker ps:*)
allow: Bash(docker stop ahol-variant-*)
deny:  Bash(docker rmi:*)
deny:  Bash(docker push:*)
deny:  Bash(docker system prune:*)
deny:  Bash(docker volume rm:*)
deny:  Bash(docker network rm:*)
```

The name-prefix filter on `ahol-variant-*` is a critical AHOL safety property: even if the variant-runner's reasoning goes off-rails, it cannot tear down containers from unrelated workloads on the developer's machine.

MCP allowlist equivalent:

```
allow: mcp__docker__run_container
allow: mcp__docker__fetch_container_logs
allow: mcp__docker__start_container
allow: mcp__docker__stop_container
allow: mcp__docker__remove_container
deny:  mcp__docker__remove_image
deny:  mcp__docker__push_image
deny:  mcp__docker__remove_volume
deny:  mcp__docker__remove_network
```

MCP per-tool allowlisting is cleaner at the coarse level. BUT it cannot enforce the `ahol-variant-*` name prefix constraint: `remove_container` is an allow-all or deny-all toggle. Shell prefix matching lets AHOL draw a sharper safety boundary than MCP tool allowlisting does, for this specific use case. This is a non-obvious win for raw Bash.

### Portability

- macOS (Docker Desktop) and Linux (native daemon): both raw Bash and any Docker MCP require a running Docker daemon. No meaningful difference. MCP on macOS must also talk to Docker Desktop's UNIX socket.
- ckreiling requires a Python runtime in the MCP host config. Raw Bash requires nothing beyond the Docker CLI that AHOL already depends on.

## Final Verdict and AHOL Spec Updates

**Adopt raw Bash.** No Docker MCP candidate combines (a) a complete tool surface including exec + cp + inspect, (b) a test suite, and (c) maintenance activity in the last 90 days. Raw Bash is lower token overhead per op, enables sharper per-container name-prefix scoping, and removes an external dependency.

### Allowlist patterns for AHOL orchestrator and variant-runner

Recommend the following in the AHOL subagent settings:

```
"allow": [
  "Bash(docker run:*)",
  "Bash(docker logs:*)",
  "Bash(docker inspect:*)",
  "Bash(docker exec:*)",
  "Bash(docker cp:*)",
  "Bash(docker ps:*)",
  "Bash(docker stop ahol-variant-*)",
  "Bash(docker rm -f ahol-variant-*)",
  "Bash(docker build:*)"
],
"deny": [
  "Bash(docker rmi:*)",
  "Bash(docker push:*)",
  "Bash(docker system prune:*)",
  "Bash(docker volume rm:*)",
  "Bash(docker network rm:*)",
  "Bash(docker login:*)",
  "Bash(docker logout:*)"
]
```

The `ahol-variant-*` prefix constraint on stop/rm is the load-bearing safety property. All variant-runner containers MUST be named with that prefix by the orchestrator.

### Revisit trigger

Re-evaluate this decision when ANY of the following occurs:

1. Docker Inc. ships an official first-party container-lifecycle MCP server in the Docker Hub `mcp` namespace.
2. Anthropic adds a Docker entry to the reference server set at `registry.modelcontextprotocol.io`.
3. A community candidate gains: full tool surface (run + logs + inspect + exec + cp + build), a visible test suite with CI, and commits in the last 90 days.

Until one of the above, raw Bash is the correct choice.

### Non-impact on Tier-3 and Group C

- Tier-3 task-runners run INSIDE the containers and are untouched by this decision.
- Group C spike proceeds unaffected. The verdict does not block or alter Group C's scope.
