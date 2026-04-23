"""AHOL (Autonomous Harness Optimization Loop) Python runner package.

Tier 1 (orchestrator) and Tier 2 (variant-runner) live here as Python
processes. Tier 3 (per-task invocation) shells out to packages/ahol/baseline/
invoke.sh which in turn calls claude --print inside an isolated container.

See packages/ahol/GROUP-C-SCOPE.md for full scope.
"""

__version__ = "0.1.0"
