/**
 * Config — Planning config CRUD operations
 */

const fs = require('fs');
const path = require('path');
const { output, error, planningRoot, getDonnyHome } = require('./core.cjs');
const {
  VALID_PROFILES,
  getAgentToModelMapForProfile,
  formatAgentToModelMapAsTable,
} = require('./model-profiles.cjs');

const VALID_CONFIG_KEYS = new Set([
  'mode', 'granularity', 'parallelization', 'commit_docs', 'model_profile',
  'search_gitignored', 'brave_search', 'firecrawl', 'exa_search',
  'workflow.research', 'workflow.plan_check', 'workflow.verifier',
  'workflow.nyquist_validation', 'workflow.ui_phase', 'workflow.ui_safety_gate', 'workflow.ui_review',
  'workflow.security_enforcement', 'workflow.security_asvs_level', 'workflow.security_block_on', 'workflow.record_gate',
  'workflow.auto_advance', 'workflow.node_repair', 'workflow.node_repair_budget',
  'workflow.max_replan_iterations',
  'workflow.text_mode',
  'workflow.research_before_questions',
  'workflow.browser_research',
  'workflow.discuss_mode',
  'workflow.skip_discuss',
  'workflow._auto_chain_active',
  'workflow.use_worktrees',
  'git.branching_strategy', 'git.base_branch', 'git.phase_branch_template', 'git.milestone_branch_template', 'git.quick_branch_template',
  'planning.commit_docs', 'planning.search_gitignored',
  'workflow.subagent_timeout',
  'hooks.context_warnings',
  'project_code', 'phase_naming', 'context_window',
  // context_window: read via config-get at plan-phase.md:30 and execute-phase.md:84,
  // and in loadConfig's table at 200000. Registered so it resolves through the ladder
  // rather than exiting 1, and so a global value takes effect (D-18).
  'manager.flags.discuss', 'manager.flags.plan', 'manager.flags.execute',
  'response_language',
]);

/**
 * Check whether a config key path is valid.
 * Supports exact matches from VALID_CONFIG_KEYS plus dynamic patterns
 * like `agent_skills.<agent-type>` where the sub-key is freeform.
 */
function isValidConfigKey(keyPath) {
  if (VALID_CONFIG_KEYS.has(keyPath)) return true;
  // Allow agent_skills.<agent-type> with any agent type string
  if (/^agent_skills\.[a-zA-Z0-9_-]+$/.test(keyPath)) return true;
  return false;
}

const CONFIG_KEY_SUGGESTIONS = {
  'workflow.nyquist_validation_enabled': 'workflow.nyquist_validation',
  'agents.nyquist_validation_enabled': 'workflow.nyquist_validation',
  'nyquist.validation_enabled': 'workflow.nyquist_validation',
  'hooks.research_questions': 'workflow.research_before_questions',
  'workflow.research_questions': 'workflow.research_before_questions',
};

function validateKnownConfigKeyPath(keyPath) {
  const suggested = CONFIG_KEY_SUGGESTIONS[keyPath];
  if (suggested) {
    error(`Unknown config key: ${keyPath}. Did you mean ${suggested}?`);
  }
}

/**
 * Keys that config-get deliberately does NOT resolve through the default ladder.
 * They stay on the exit-1 path, so the workflow shell fallback keeps handling them.
 *
 *   mode, granularity        zero read sites anywhere in the engine. D-07's rule is
 *                            "match the shell literal already in use", and there is no
 *                            literal to match. A granularity default would also be
 *                            actively harmful: both config.cjs and core.cjs gate the
 *                            depth-to-granularity migration on
 *                            ('depth' in parsed && !('granularity' in parsed)), so a
 *                            default leaking into parsed would make the migration a
 *                            no-op on a project whose depth never migrated.
 *   planning.commit_docs     zero config-get read sites, and its real default is
 *                            COMPUTED, not constant: loadConfig returns false when
 *                            .planning/ is gitignored (core.cjs:330-338). Any static
 *                            literal here would be wrong on those projects. D-20.
 *   planning.search_gitignored  zero config-get read sites; exempted with its sibling
 *                            so the nested planning.* aliases behave uniformly. D-20.
 */
const RESOLVE_EXEMPT = new Set([
  'mode',
  'granularity',
  'planning.commit_docs',
  'planning.search_gitignored',
]);

/**
 * Keys the GLOBAL layer never supplies, even though they have a hardcoded default.
 *
 *   workflow._auto_chain_active  a transient internal flag /donny-plan-phase and
 *                            /donny-execute-phase set and clear to signal that an auto
 *                            chain is running, read at 7 sites. A global value of true
 *                            would make every project on the machine believe it is
 *                            permanently mid-auto-chain, which is a real foot-gun on the
 *                            unattended paths. It keeps its hardcoded default of false;
 *                            only the global layer is refused. D-19.
 *
 * Paths are one or two segments. stripGlobalExempt does not walk deeper, and nothing
 * in this set needs it.
 */
const GLOBAL_EXEMPT = new Set([
  'workflow._auto_chain_active',
]);

// D-04: a present-but-broken global defaults file warns once and resolution continues.
// One flag per message kind, so a process emits each at most once.
let warnedGlobalRead = false;
let warnedGlobalMigrate = false;

function warnOnce(flagName, message) {
  if (flagName === 'read') {
    if (warnedGlobalRead) return;
    warnedGlobalRead = true;
  } else {
    if (warnedGlobalMigrate) return;
    warnedGlobalMigrate = true;
  }
  process.stderr.write(`donny-tools: warning: ${message}\n`);
}

/**
 * Load ~/.donny/defaults.json (or $DONNY_HOME/defaults.json) as the global layer.
 *
 * Returns {} when the file is absent, unreadable, malformed, or is valid JSON that is
 * not an object. A broken optional file must never be a total engine outage across the
 * unattended paths, so this warns and continues rather than throwing (D-04). Silence was
 * the previous behavior and is exactly the invisible failure this phase exists to remove:
 * the operator edits the file, nothing happens, and there is no signal.
 *
 * Never returns a partially parsed object: JSON.parse either yields a whole value or
 * throws, and a non-object value is rejected wholesale rather than merged.
 */
function loadGlobalDefaults() {
  const file = path.join(getDonnyHome(), 'defaults.json');
  let parsed;
  try {
    if (!fs.existsSync(file)) return {};
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    warnOnce('read', `could not read global defaults at ${file}: ${err.message}. Continuing with built-in defaults.`);
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnOnce('read', `global defaults at ${file} is not a JSON object. Continuing with built-in defaults.`);
    return {};
  }

  // Drop prototype-polluting own properties before the value reaches any merge.
  // Object spread defines rather than assigns, so this is defence in depth, not the
  // only line of defence, but it costs three comparisons.
  const safe = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    safe[k] = v;
  }

  // Migrate the deprecated "depth" key to "granularity", unchanged from the behavior
  // that lived inline in buildNewProjectConfig.
  if ('depth' in safe && !('granularity' in safe)) {
    const depthToGranularity = { quick: 'coarse', standard: 'standard', comprehensive: 'fine' };
    safe.granularity = depthToGranularity[safe.depth] || safe.depth;
    delete safe.depth;
    try {
      fs.writeFileSync(file, JSON.stringify(safe, null, 2), 'utf-8');
    } catch (err) {
      // C-4: this is the SECOND swallow, distinct from D-04's target. It hid a
      // read-only or permission-denied global file failing to migrate forever, on
      // every invocation, with no signal. Same class of defect, same fix.
      warnOnce('migrate', `could not write the depth to granularity migration to ${file}: ${err.message}. The migration will be retried on the next run.`);
    }
  }

  return stripGlobalExempt(safe);
}

/** Remove every GLOBAL_EXEMPT path from a parsed global layer, without mutating it. */
function stripGlobalExempt(globalDefaults) {
  let out = globalDefaults;
  for (const dotted of GLOBAL_EXEMPT) {
    const parts = dotted.split('.');
    if (parts.length === 1) {
      if (Object.prototype.hasOwnProperty.call(out, parts[0])) {
        out = { ...out };
        delete out[parts[0]];
      }
      continue;
    }
    const [section, field] = parts;
    const sec = out[section];
    if (sec && typeof sec === 'object' && Object.prototype.hasOwnProperty.call(sec, field)) {
      const nextSection = { ...sec };
      delete nextSection[field];
      out = { ...out, [section]: nextSection };
    }
  }
  return out;
}

/**
 * Sections merged per key rather than replaced wholesale.
 *
 * git, workflow, hooks and agent_skills are the four buildNewProjectConfig already
 * spread. planning and manager are added here: VALID_CONFIG_KEYS carries
 * planning.commit_docs, planning.search_gitignored and manager.flags.*, and without
 * them a global {"planning":{"commit_docs":false}} against a project with
 * {"planning":{"sub_repos":[]}} is REPLACED, which is a direct CONFIG-02 violation.
 */
const MERGE_SECTIONS = ['git', 'workflow', 'hooks', 'agent_skills', 'planning', 'manager'];

/**
 * Merge three config layers, increasing priority: base <- global <- project.
 *
 * Per-key within the known sections, exactly the spread buildNewProjectConfig has
 * always used, rather than a generic recursive deepMerge whose array and null
 * semantics would be new and unsettled (D-02).
 *
 * Immutable: every argument is read only, and the result is a fresh object graph.
 *
 * A section absent from all three layers is NOT invented, so this function never adds
 * a key to buildNewProjectConfig's output that the old inline merge did not produce.
 */
function mergeConfigLayers(base, global, project) {
  const layers = [base || {}, global || {}, project || {}];
  const merged = { ...layers[0], ...layers[1], ...layers[2] };

  // A layer whose section is not a plain object contributes nothing. Without this,
  // a hand-edited global {"git":"oops"} would spread the STRING's character indices
  // into the merged git section, because the guard below only requires SOME layer to
  // hold an object. Unreachable through config-set, which validates, but the global
  // file is hand-edited by design and the threat model claims this merge is never
  // partial or attacker-shaped. Two tokens, so make the claim true.
  const sec = (l, name) => (l[name] && typeof l[name] === 'object' && !Array.isArray(l[name]) ? l[name] : {});

  for (const section of MERGE_SECTIONS) {
    if (!layers.some(l => l[section] && typeof l[section] === 'object')) continue;
    merged[section] = {
      ...sec(layers[0], section),
      ...sec(layers[1], section),
      ...sec(layers[2], section),
    };
    // manager.flags is one level deeper than any other section. Without this, a
    // project setting manager.flags.plan would erase a global manager.flags.discuss.
    // Guarded the same way the section itself is: a flags object absent from all three
    // layers is NOT invented, so loadConfig's `manager: {}` does not silently grow a
    // `flags` key it never had.
    if (section === 'manager' && layers.some(l => sec(l, 'manager').flags && typeof sec(l, 'manager').flags === 'object')) {
      merged.manager = {
        ...merged.manager,
        flags: {
          ...sec(sec(layers[0], 'manager'), 'flags'),
          ...sec(sec(layers[1], 'manager'), 'flags'),
          ...sec(sec(layers[2], 'manager'), 'flags'),
        },
      };
    }
  }
  return merged;
}

/**
 * The hardcoded default layer /donny-init materializes into a new project's config.json.
 *
 * A function, not a constant, because brave_search / firecrawl / exa_search are detected
 * from the environment and from $DONNY_HOME/*_api_key at call time.
 *
 * NOT the same table loadConfig uses (core.cjs:219-244). The two disagree and stay
 * divergent by D-03; unifying them entangles this side effect plus four loadConfig-only
 * keys, and nothing in CONFIG-01/02/03 requires it.
 *
 * Uses the canonical `git` namespace for branching keys (consistent with VALID_CONFIG_KEYS
 * and the settings workflow). loadConfig() handles both flat and nested formats, so this
 * is backward-compatible with existing projects that have flat keys.
 *
 * Key order is a contract: cmdConfigNewProject writes this with JSON.stringify(config,
 * null, 2), and object key order is insertion order, so reordering changes the file bytes.
 */
function hardcodedProjectDefaults() {
  const donnyHome = getDonnyHome();
  const hasBraveSearch = !!(process.env.BRAVE_API_KEY || fs.existsSync(path.join(donnyHome, 'brave_api_key')));
  const hasFirecrawl = !!(process.env.FIRECRAWL_API_KEY || fs.existsSync(path.join(donnyHome, 'firecrawl_api_key')));
  const hasExaSearch = !!(process.env.EXA_API_KEY || fs.existsSync(path.join(donnyHome, 'exa_api_key')));
  return {
    model_profile: 'balanced',
    commit_docs: true,
    parallelization: true,
    search_gitignored: false,
    brave_search: hasBraveSearch,
    firecrawl: hasFirecrawl,
    exa_search: hasExaSearch,
    git: {
      branching_strategy: 'none',
      phase_branch_template: 'donny/phase-{phase}-{slug}',
      milestone_branch_template: 'donny/{milestone}-{slug}',
      quick_branch_template: null,
    },
    workflow: {
      research: true,
      browser_research: true,
      plan_check: true,
      verifier: true,
      nyquist_validation: true,
      auto_advance: false,
      node_repair: true,
      node_repair_budget: 2,
      max_replan_iterations: 2,
      ui_phase: true,
      ui_safety_gate: true,
      ui_review: true,
      security_enforcement: true,
      security_asvs_level: 1,
      security_block_on: 'high',
      record_gate: true,
      text_mode: false,
      research_before_questions: false,
      discuss_mode: 'discuss',
      skip_discuss: false,
    },
    hooks: {
      context_warnings: true,
    },
    project_code: null,
    phase_naming: 'sequential',
    agent_skills: {},
  };
}

/**
 * The hardcoded layer for config-get's resolution ladder.
 *
 * hardcodedProjectDefaults() covers 34 leaves. This adds the eight keys that had no
 * hardcoded default anywhere in the engine, so the D-05 contract has no hole on a
 * registered key. Every value is lifted from the shell literal its read sites already
 * use, so resolving them changes no behavior; see 24-BASELINE-prechange.txt's PATH
 * B-prime-normalized column, which must stay byte-identical. The RAW B-prime column
 * changes on exactly one row, git.base_branch from "" to null, which both read sites
 * collapse with [ -z "$B" ] || [ "$B" = "null" ].
 *
 * Deliberately SEPARATE from hardcodedProjectDefaults. Adding a resolvable default here
 * must never change what /donny-init materializes into a new project's config.json,
 * which D-09 leaves untouched.
 *
 * Not covered here, and exempt on purpose: mode, granularity, planning.commit_docs and
 * planning.search_gitignored. See RESOLVE_EXEMPT above for each one's reason.
 */
function configGetDefaults() {
  const base = hardcodedProjectDefaults();
  return {
    ...base,
    // loadConfig has these two and buildNewProjectConfig does not (core.cjs:242, :364).
    context_window: 200000,
    response_language: null,
    git: {
      ...base.git,
      // NOT 'main'. Without --raw, output() prints the JSON form, so a string default
      // emits with quotes and the shipped guards at ship.md:32-36 and
      // complete-milestone.md:555-559 would pass the seven characters "main" straight
      // through to git. Both guards already test for the string null, and null prints
      // bare in both modes, so this preserves today's behavior exactly and keeps the
      // git symbolic-ref origin/HEAD autodetection reachable.
      base_branch: null,
    },
    workflow: {
      ...base.workflow,
      // 3 read sites, all || echo "true" (diagnose-issues.md:61, execute-phase.md:76, quick.md:214)
      use_worktrees: true,
      // 7 read sites, all || echo "false", one of them outside workflows/ at
      // agents/donny-executor.md:229. Also in GLOBAL_EXEMPT, so this hardcoded value is
      // the only layer that ever supplies it.
      _auto_chain_active: false,
      // loadConfig's value (core.cjs:360)
      subagent_timeout: 300000,
    },
    // sanitizeFlags (init.cjs:1097-1108) already coerces a non-string to '', so '' is a
    // no-op that keeps the regex allowlist doing the work. Do NOT give these a non-empty
    // default: manager.flags.* flows toward a shell command line.
    manager: { flags: { discuss: '', plan: '', execute: '' } },
  };
}

/**
 * Build a fully-materialized config object for a new project.
 *
 * Merges (increasing priority):
 *   1. hardcodedProjectDefaults()
 *   2. the user-level defaults at $DONNY_HOME/defaults.json, if present
 *   3. userChoices, the settings the user explicitly selected during /donny-init
 *
 * Returns a plain object. Does NOT write any files.
 *
 * The load and the merge are the shared functions the other two read paths use, so a
 * global default resolves identically whichever path asks for it (D-01).
 */
function buildNewProjectConfig(userChoices) {
  return mergeConfigLayers(hardcodedProjectDefaults(), loadGlobalDefaults(), userChoices || {});
}

/**
 * Command: create a fully-materialized .planning/config.json for a new project.
 *
 * Accepts user-chosen settings as a JSON string (the keys the user explicitly
 * configured during /donny-init). All remaining keys are filled from
 * hardcoded defaults and optional ~/.donny/defaults.json.
 *
 * Idempotent: if config.json already exists, returns { created: false }.
 */
function cmdConfigNewProject(cwd, choicesJson, raw) {
  const planningBase = planningRoot(cwd);
  const configPath = path.join(planningBase, 'config.json');

  // Idempotent: don't overwrite existing config
  if (fs.existsSync(configPath)) {
    output({ created: false, reason: 'already_exists' }, raw, 'exists');
    return;
  }

  // Parse user choices
  let userChoices = {};
  if (choicesJson && choicesJson.trim() !== '') {
    try {
      userChoices = JSON.parse(choicesJson);
    } catch (err) {
      error('Invalid JSON for config-new-project: ' + err.message);
    }
  }

  // Ensure .planning directory exists
  try {
    if (!fs.existsSync(planningBase)) {
      fs.mkdirSync(planningBase, { recursive: true });
    }
  } catch (err) {
    error('Failed to create .planning directory: ' + err.message);
  }

  const config = buildNewProjectConfig(userChoices);

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    output({ created: true, path: '.planning/config.json' }, raw, 'created');
  } catch (err) {
    error('Failed to write config.json: ' + err.message);
  }
}

/**
 * Ensures the config file exists (creates it if needed).
 *
 * Does not call `output()`, so can be used as one step in a command without triggering `exit(0)` in
 * the happy path. But note that `error()` will still `exit(1)` out of the process.
 */
function ensureConfigFile(cwd) {
  const planningBase = planningRoot(cwd);
  const configPath = path.join(planningBase, 'config.json');

  // Ensure .planning directory exists
  try {
    if (!fs.existsSync(planningBase)) {
      fs.mkdirSync(planningBase, { recursive: true });
    }
  } catch (err) {
    error('Failed to create .planning directory: ' + err.message);
  }

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    return { created: false, reason: 'already_exists' };
  }

  const config = buildNewProjectConfig({});

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { created: true, path: '.planning/config.json' };
  } catch (err) {
    error('Failed to create config.json: ' + err.message);
  }
}

/**
 * Command to ensure the config file exists (creates it if needed).
 *
 * Note that this exits the process (via `output()`) even in the happy path; use
 * `ensureConfigFile()` directly if you need to avoid this.
 */
function cmdConfigEnsureSection(cwd, raw) {
  const ensureConfigFileResult = ensureConfigFile(cwd);
  if (ensureConfigFileResult.created) {
    output(ensureConfigFileResult, raw, 'created');
  } else {
    output(ensureConfigFileResult, raw, 'exists');
  }
}

/**
 * Sets a value in the config file, allowing nested values via dot notation (e.g.,
 * "workflow.research").
 *
 * Does not call `output()`, so can be used as one step in a command without triggering `exit(0)` in
 * the happy path. But note that `error()` will still `exit(1)` out of the process.
 */
function setConfigValue(cwd, keyPath, parsedValue) {
  const configPath = path.join(planningRoot(cwd), 'config.json');

  // Load existing config or start with empty object
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    error('Failed to read config.json: ' + err.message);
  }

  // Set nested value using dot notation (e.g., "workflow.research")
  const keys = keyPath.split('.');
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  const previousValue = current[keys[keys.length - 1]]; // Capture previous value before overwriting
  current[keys[keys.length - 1]] = parsedValue;

  // Write back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { updated: true, key: keyPath, value: parsedValue, previousValue };
  } catch (err) {
    error('Failed to write config.json: ' + err.message);
  }
}

/**
 * Command to set a value in the config file, allowing nested values via dot notation (e.g.,
 * "workflow.research").
 *
 * Note that this exits the process (via `output()`) even in the happy path; use `setConfigValue()`
 * directly if you need to avoid this.
 */
function cmdConfigSet(cwd, keyPath, value, raw) {
  if (!keyPath) {
    error('Usage: config-set <key.path> <value>');
  }

  validateKnownConfigKeyPath(keyPath);

  if (!isValidConfigKey(keyPath)) {
    error(`Unknown config key: "${keyPath}". Valid keys: ${[...VALID_CONFIG_KEYS].sort().join(', ')}, agent_skills.<agent-type>`);
  }

  // Parse value (handle booleans, numbers, and JSON arrays/objects)
  let parsedValue = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(value) && value !== '') parsedValue = Number(value);
  else if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
    try { parsedValue = JSON.parse(value); } catch { /* keep as string */ }
  }

  const setConfigValueResult = setConfigValue(cwd, keyPath, parsedValue);
  output(setConfigValueResult, raw, `${keyPath}=${parsedValue}`);
}

/**
 * Which layer supplied the value at keyPath, and whether the project merely repeats
 * the global (D-08, D-11).
 *
 * Layers are probed independently rather than read off the merged result, because the
 * merged result cannot tell you which layer a value came from when two layers agree,
 * and that agreement is exactly the case D-11 exists to explain.
 *
 * Returns { source, redundant_with_global }. source is 'project', 'global', 'hardcoded'
 * or 'unset'. 'unset' is unreachable for a resolvable key, because configGetDefaults
 * covers every allowlisted key outside RESOLVE_EXEMPT, and is reported honestly rather
 * than guessed if that ever stops being true.
 */
function resolveKeySource(keyPath, hardcoded, globalLayer, project) {
  const at = (obj) => keyPath.split('.').reduce(
    (cur, k) => (cur === null || cur === undefined || typeof cur !== 'object' ? undefined : cur[k]),
    obj,
  );
  const pv = at(project);
  const gv = at(globalLayer);
  const hv = at(hardcoded);
  if (pv !== undefined) {
    return {
      source: 'project',
      redundant_with_global: gv !== undefined && JSON.stringify(gv) === JSON.stringify(pv),
    };
  }
  if (gv !== undefined) return { source: 'global', redundant_with_global: false };
  if (hv !== undefined) return { source: 'hardcoded', redundant_with_global: false };
  return { source: 'unset', redundant_with_global: false };
}

/**
 * Read a config value through the full resolution ladder.
 *
 * hardcoded defaults <- $DONNY_HOME/defaults.json <- .planning/config.json
 *
 * For a key in VALID_CONFIG_KEYS and not in RESOLVE_EXEMPT this ALWAYS prints a value,
 * so a project that has never set the key resolves the global default rather than
 * exiting 1 (D-05). The inline `|| echo "..."` fallbacks at all 43 workflow read sites
 * stay in place as a last resort: they become unreachable for a registered key but
 * still catch a crashed node, a missing binary, or a genuinely unregistered key (D-06).
 *
 * Exit 1 survives for exactly three cases:
 *   - a key absent from VALID_CONFIG_KEYS, including the unbounded agent_skills.<type>
 *     space, which isValidConfigKey accepts for config-set but which has no possible
 *     hardcoded default
 *   - a key in RESOLVE_EXEMPT (mode, granularity, planning.commit_docs,
 *     planning.search_gitignored), a documented and inert hole: nothing reads them
 *   - an unreadable or malformed .planning/config.json, which is a hard error because a
 *     project config is not optional the way the global file is
 *
 * The global layer is re-read per invocation rather than cached. Each donny-tools run is
 * a short-lived process resolving a handful of keys, and a per-process cache would make
 * DONNY_HOME unobservable to a test that switches it between assertions, for the saving
 * of one two-byte file read.
 *
 * showSource is the opt-in --source flag (D-08). It is applied AFTER the traversal and
 * after both Key not found errors, so provenance cannot make an unregistered or exempt
 * key resolvable. With it off, this function's output is byte-for-byte what the 43
 * shell $(...) capture sites have always seen, which is the whole safety story.
 */
function cmdConfigGet(cwd, keyPath, raw, showSource) {
  if (!keyPath) {
    error('Usage: config-get <key.path>');
  }

  const configPath = path.join(planningRoot(cwd), 'config.json');
  const resolvable = VALID_CONFIG_KEYS.has(keyPath) && !RESOLVE_EXEMPT.has(keyPath);

  let project = {};
  if (fs.existsSync(configPath)) {
    try {
      project = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      error('Failed to read config.json: ' + err.message);
    }
  } else if (!resolvable) {
    error('No config.json found at ' + configPath);
  }

  // Named locals so the merge and resolveKeySource read the SAME layer objects rather
  // than loading the global file twice. A non-resolvable key consults no layer but the
  // project, so its other two are empty and its provenance can only be 'project'.
  const hardcoded = resolvable ? configGetDefaults() : {};
  const globalLayer = resolvable ? loadGlobalDefaults() : {};
  const source = resolvable ? mergeConfigLayers(hardcoded, globalLayer, project) : project;

  // Traverse dot-notation path (e.g., "workflow.auto_advance")
  const keys = keyPath.split('.');
  let current = source;
  for (const key of keys) {
    if (current === undefined || current === null || typeof current !== 'object') {
      error(`Key not found: ${keyPath}`);
    }
    current = current[key];
  }

  if (current === undefined) {
    error(`Key not found: ${keyPath}`);
  }

  if (!showSource) {
    output(current, raw, String(current));
    return;
  }

  // Tab-separated in raw mode so a shell caller can cut -f1 for the value and cut -f2
  // for the layer without a JSON parser. Not a space: git.quick_branch_template and
  // manager.flags.* can hold values containing spaces (T-24-44).
  const provenance = resolveKeySource(keyPath, hardcoded, globalLayer, project);
  output(
    {
      key: keyPath,
      value: current,
      source: provenance.source,
      redundant_with_global: provenance.redundant_with_global,
    },
    raw,
    `${String(current)}\t${provenance.source}`,
  );
}

/**
 * Command to set the model profile in the config file.
 *
 * Note that this exits the process (via `output()`) even in the happy path.
 */
function cmdConfigSetModelProfile(cwd, profile, raw) {
  if (!profile) {
    error(`Usage: config-set-model-profile <${VALID_PROFILES.join('|')}>`);
  }

  const normalizedProfile = profile.toLowerCase().trim();
  if (!VALID_PROFILES.includes(normalizedProfile)) {
    error(`Invalid profile '${profile}'. Valid profiles: ${VALID_PROFILES.join(', ')}`);
  }

  // Ensure config exists (create if needed)
  ensureConfigFile(cwd);

  // Set the model profile in the config
  const { previousValue } = setConfigValue(cwd, 'model_profile', normalizedProfile, raw);
  const previousProfile = previousValue || 'balanced';

  // Build result value / message and return
  const agentToModelMap = getAgentToModelMapForProfile(normalizedProfile);
  const result = {
    updated: true,
    profile: normalizedProfile,
    previousProfile,
    agentToModelMap,
  };
  const rawValue = getCmdConfigSetModelProfileResultMessage(
    normalizedProfile,
    previousProfile,
    agentToModelMap
  );
  output(result, raw, rawValue);
}

/**
 * Returns the message to display for the result of the `config-set-model-profile` command when
 * displaying raw output.
 */
function getCmdConfigSetModelProfileResultMessage(
  normalizedProfile,
  previousProfile,
  agentToModelMap
) {
  const agentToModelTable = formatAgentToModelMapAsTable(agentToModelMap);
  const didChange = previousProfile !== normalizedProfile;
  const paragraphs = didChange
    ? [
        `✓ Model profile set to: ${normalizedProfile} (was: ${previousProfile})`,
        'Agents will now use:',
        agentToModelTable,
        'Next spawned agents will use the new profile.',
      ]
    : [
        `✓ Model profile is already set to: ${normalizedProfile}`,
        'Agents are using:',
        agentToModelTable,
      ];
  return paragraphs.join('\n\n');
}

module.exports = {
  VALID_CONFIG_KEYS,
  RESOLVE_EXEMPT,
  GLOBAL_EXEMPT,
  isValidConfigKey,
  hardcodedProjectDefaults,
  configGetDefaults,
  loadGlobalDefaults,
  mergeConfigLayers,
  buildNewProjectConfig,
  cmdConfigEnsureSection,
  cmdConfigSet,
  cmdConfigGet,
  cmdConfigSetModelProfile,
  cmdConfigNewProject,
};
