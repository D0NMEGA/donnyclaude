/**
 * Mapping of Donny agent to model for each profile.
 *
 * Should be in sync with the profiles table in `donny/references/model-profiles.md`. But
 * possibly worth making this the single source of truth at some point, and removing the markdown
 * reference table in favor of programmatically determining the model to use for an agent (which
 * would be faster, use fewer tokens, and be less error-prone).
 */
const MODEL_PROFILES = {
  'donny-planner': { quality: 'opus', balanced: 'opus', budget: 'sonnet' },
  'donny-roadmapper': { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'donny-executor': { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'donny-phase-researcher': { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'donny-project-researcher': { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'donny-research-synthesizer': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-debugger': { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'donny-codebase-mapper': { quality: 'sonnet', balanced: 'haiku', budget: 'haiku' },
  'donny-verifier': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-plan-checker': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-integration-checker': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-nyquist-auditor': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-ui-researcher': { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'donny-ui-checker': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-ui-auditor': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-doc-writer': { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'donny-doc-verifier': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-discuss-researcher': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-security-auditor': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'donny-user-profiler': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
};
const VALID_PROFILES = Object.keys(MODEL_PROFILES['donny-planner']);

/**
 * Formats the agent-to-model mapping as a human-readable table (in string format).
 *
 * @param {Object<string, string>} agentToModelMap - A mapping from agent to model
 * @returns {string} A formatted table string
 */
function formatAgentToModelMapAsTable(agentToModelMap) {
  const agentWidth = Math.max('Agent'.length, ...Object.keys(agentToModelMap).map((a) => a.length));
  const modelWidth = Math.max(
    'Model'.length,
    ...Object.values(agentToModelMap).map((m) => m.length)
  );
  const sep = '─'.repeat(agentWidth + 2) + '┼' + '─'.repeat(modelWidth + 2);
  const header = ' ' + 'Agent'.padEnd(agentWidth) + ' │ ' + 'Model'.padEnd(modelWidth);
  let agentToModelTable = header + '\n' + sep + '\n';
  for (const [agent, model] of Object.entries(agentToModelMap)) {
    agentToModelTable += ' ' + agent.padEnd(agentWidth) + ' │ ' + model.padEnd(modelWidth) + '\n';
  }
  return agentToModelTable;
}

/**
 * Returns a mapping from agent to model for the given model profile.
 *
 * @param {string} normalizedProfile - The normalized (lowercase and trimmed) profile name
 * @returns {Object<string, string>} A mapping from agent to model for the given profile
 */
function getAgentToModelMapForProfile(normalizedProfile) {
  const agentToModelMap = {};
  for (const [agent, profileToModelMap] of Object.entries(MODEL_PROFILES)) {
    agentToModelMap[agent] = profileToModelMap[normalizedProfile];
  }
  return agentToModelMap;
}

module.exports = {
  MODEL_PROFILES,
  VALID_PROFILES,
  formatAgentToModelMapAsTable,
  getAgentToModelMapForProfile,
};
