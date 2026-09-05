/**
 * Verify — Verification suite, consistency, and health validation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeReadFile, loadConfig, normalizePhaseName, escapeRegex, execGit, findPhaseInternal, getMilestoneInfo, stripShippedMilestones, extractCurrentMilestone, planningDir, planningRoot, output, error, checkAgentsInstalled } = require('./core.cjs');
const { extractFrontmatter, parseMustHavesBlock } = require('./frontmatter.cjs');
const { writeStateMd } = require('./state.cjs');

/**
 * Run one cmdVerify* function in-process and capture the JSON it writes to fd 1.
 *
 * Why this exists: every shipped verb ends in output() (core.cjs:178-200), which writes with
 * fs.writeSync(1, data) and deliberately does NOT call process.exit(). In-process composition
 * is therefore safe, but each verb's JSON would land on the caller's own stdout. This
 * intercepts fd-1 writes for the duration of a single call and restores the original in a
 * finally, so a throwing verb can never leave fs.writeSync patched - a leaked patch would
 * silently swallow all later stdout in the process.
 *
 * Pattern source: bin/donny-tools.cjs:301-333 (the --pick interception), including its
 * handling of the '@file:' overflow payload output() writes past 50000 chars
 * (core.cjs:186-193).
 *
 * Errors are returned, not thrown: this helper backs an advisory gate (D-02), so one bad verb
 * must degrade to a recorded result rather than abort the run. Nothing is swallowed - the
 * thrown message is carried out in `error`.
 *
 * @param {Function} fn zero-arg thunk that invokes exactly one cmdVerify* function
 * @returns {{ok: true, json: object} | {ok: false, raw?: string, error?: string}}
 */
function captureVerb(fn) {
  const origWriteSync = fs.writeSync;
  const chunks = [];
  fs.writeSync = function (fd, data, ...rest) {
    if (fd === 1) { chunks.push(String(data)); return String(data).length; }
    return origWriteSync.call(fs, fd, data, ...rest);
  };
  let threw = null;
  try {
    fn();
  } catch (e) {
    threw = e;
  } finally {
    fs.writeSync = origWriteSync;
  }
  if (threw) {
    return { ok: false, raw: chunks.join(''), error: String((threw && threw.message) || threw) };
  }
  let s = chunks.join('');
  if (s.startsWith('@file:')) {
    try {
      s = fs.readFileSync(s.slice(6), 'utf-8');
    } catch (e) {
      return { ok: false, raw: s, error: 'overflow file unreadable: ' + e.message };
    }
  }
  if (s === '') return { ok: false, raw: '', error: 'verb produced no output' };
  try {
    return { ok: true, json: JSON.parse(s) };
  } catch {
    return { ok: false, raw: s, error: 'unparseable verb output' };
  }
}

/**
 * Resolve a path from a planning artifact, expanding a leading '~/' or '$HOME/'.
 *
 * Why: must_haves.artifacts paths are written by a human in a PLAN, and this project's
 * deliverables live outside the repo (for example ~/Developer/cc-autopilot/ and
 * ~/.claude/bin/). A bare path.join(cwd, '~/x') produces '<cwd>/~/x', which never exists, so
 * every out-of-repo artifact reads as missing. Measured before this fix: 51 of 54 artifact
 * checks failed across the eighteen archived v5.0 plans, purely for this reason.
 *
 * Scope is deliberately narrow (A-03): only '~/' and '$HOME/' prefixes, plus the absolute-path
 * passthrough that cmdVerifyPlanStructure, cmdVerifyReferences and cmdVerifyKeyLinks already
 * use. No shell expansion, no arbitrary environment interpolation, no '~user' resolution.
 */
function expandHomePath(cwd, p) {
  const home = process.env.HOME || os.homedir() || '';
  if (p === '~' || p === '$HOME') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  if (p.startsWith('$HOME/')) return path.join(home, p.slice(6));
  if (path.isAbsolute(p)) return p;
  return path.join(cwd, p);
}

/**
 * The thirteen verbs the record gate runs, in the order D-13/A-02 scope them: the seven
 * phase-scoped verbs first, then the six that iterate a phase's PLAN or SUMMARY files.
 *
 * Exported so the classifier, the aggregator and the tests iterate ONE list instead of each
 * keeping a private copy that can drift.
 */
const GATE_VERBS = [
  'phase-completeness', 'plan-graph', 'phase-verified', 'threats-clear', 'ui-reviewed',
  'schema-drift', 'milestone-coverage',
  'plan-structure', 'references', 'artifacts', 'key-links', 'verify-summary', 'commits',
];

/**
 * The three cmdVerifySummary error strings that are measurement artifacts, not record defects.
 *
 * This list is the reason verify-summary is the ONE verb whose errors[] is partitioned rather
 * than read whole. Measured by 23-03 across 21 SUMMARYs (the three from phase 23 plus all
 * eighteen archived v5.0 ones):
 *
 *   files_created   fails 21/21. fs.existsSync(path.join(cwd, file)) over paths lifted from
 *                   the SUMMARY's own prose, with no home expansion, so every '~/'- or
 *                   '$TMPDIR/'-prefixed path reads as missing. Same class as the unresolved
 *                   references and artifacts A-03's second half scores as warnings.
 *   commits_exist   fails 12/21. git cat-file in the CURRENT repo over a /\b[0-9a-f]{7,40}\b/
 *                   hex-word harvest. Under PROJECT.md D-21 the code commits live in
 *                   donnyclaude while the SUMMARY lives in claudecodeoptimized, so a
 *                   CORRECTLY written SUMMARY can never satisfy it. Same reasoning as the
 *                   `commits` verb's own warning rule: history can be rewritten and the
 *                   harvest picks up hex-looking noise.
 *   self_check      fails 7/21. The regex anchors on the FIRST of Self-Check|Verification|
 *                   Quality Check and then scans everything after it for /fail/i, so a
 *                   '## Verification' section above the '## Self-Check' gets judged by prose
 *                   honestly reporting failing tests.
 *
 * None of the three is fixed here: HC-5 keeps this plan's blast radius off shipped verbs, and
 * 23-03 recorded all three deliberately for /donny-review-backlog. What is decided here is
 * their SEVERITY. Scored as plain errors, verify-summary is red on every SUMMARY this project
 * has ever written, which is the ignorable-gate failure mode the phase exists to prevent;
 * scored as passes, the gate stops catching the requirements-completed drift it was built for.
 * They warn: recorded in full, never silently dropped, and never the reason a phase fails.
 *
 * The list is a named allow-list of three strings, never a "the verb was unhappy" catch-all
 * (T-23-18). Any error string not matched here stays an error, so a check added to
 * cmdVerifySummary later fails loudly instead of being swallowed.
 */
const SUMMARY_ARTIFACT_ERRORS = [
  { check: 'files_created', re: /^Missing files:/ },
  { check: 'commits_exist', re: /^Referenced commit hashes not found/ },
  { check: 'self_check', re: /^Self-check section indicates failure/ },
];

/**
 * Classify one captured verb result into a gate severity.
 *
 * Severity vocabulary (five values). D-14's intent, "reuse the verbs' own semantics rather than
 * inventing a second model", survives; its implementation does not, because the uniform
 * errors[]/warnings[] split exists in only 2 of the 13 functions (C-5). Each rule below is
 * derived from what that specific verb already returns.
 *
 *   'pass'            the verb ran and its verdict is clean
 *   'warning'         the verb ran and found something worth recording that does not fail
 *   'error'           the verb ran and found something that fails the gate
 *   'not_applicable'  the check does not apply to this phase at all (no UI review on a backend
 *                     phase; no must_haves block in a plan; schema-drift skipped)
 *   'not_yet'         the input artifact legitimately does not exist YET at this point in the
 *                     phase lifecycle. This is A-01's "not-applicable-yet": it neither fails
 *                     nor warns, and it is visibly distinct from 'pass'.
 *
 * Do not confuse per-verb 'not_yet' with the gate-level verdict 'not_run' (D-10), which means
 * the RECORDS.md file itself is absent. 'not_run' is never written into a file; it is only ever
 * inferred from absence.
 *
 * @param {string} verb one of the thirteen names in GATE_VERBS
 * @param {{ok: boolean, json?: object, raw?: string, error?: string}} captured captureVerb output
 * @param {{archived?: boolean, phaseNumber?: string, phaseDirBasename?: string, filteredRequirements?: Array}} [opts]
 * @returns {{verb: string, severity: string, detail: string, findings: string[]}}
 */
function classifyVerbResult(verb, captured, opts) {
  const o = opts || {};
  const res = (severity, detail, findings) => ({ verb, severity, detail, findings: findings || [] });
  // Findings are strings in the record, but four verbs report objects (dangling entries, wave
  // violations, cycles). Serialise rather than let String() render '[object Object]'.
  const fmt = (a) => (Array.isArray(a) ? a : []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const any = (a) => Array.isArray(a) && a.length > 0;

  // Guard, applied to all thirteen before any per-verb rule (T-23-01). captureVerb returns
  // rather than throws, so a verb that blew up arrives here as ok:false; scoring it anything
  // but an error would let a crashed check read as a clean one.
  if (!captured || captured.ok !== true) {
    const why = (captured && captured.error) || 'verb produced no parseable output';
    return { verb, severity: 'error', detail: why, findings: [why] };
  }
  const j = captured.json || {};

  switch (verb) {
    // errors[] = plans with no SUMMARY, warnings[] = SUMMARYs with no plan (verify.cjs:660).
    // The one verb D-14 cites, and one of only two whose own split is used unchanged.
    case 'phase-completeness': {
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      if (any(j.errors)) return res('error', fmt(j.errors).join('; '), fmt(j.errors));
      if (any(j.warnings)) return res('warning', fmt(j.warnings).join('; '), fmt(j.warnings));
      return res('pass', `${j.plan_count ?? 0} plan(s) and ${j.summary_count ?? 0} summary(ies), all paired`, []);
    }

    // The other verb carrying a real errors[]/warnings[] split. Measured 0 errors and 8
    // warnings across all 18 real archived plans, so error severity here is safe: it fires on
    // a missing required frontmatter field or a task with no <action>, not on cosmetics.
    case 'plan-structure': {
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      if (any(j.errors)) return res('error', fmt(j.errors).join('; '), fmt(j.errors));
      if (any(j.warnings)) return res('warning', fmt(j.warnings).join('; '), fmt(j.warnings));
      return res('pass', `${j.task_count ?? 0} task(s), no structural errors`, []);
    }

    // The one verb whose errors[] mixes real record defects with known measurement artifacts,
    // so it is the one array that is PARTITIONED rather than read whole. See
    // SUMMARY_ARTIFACT_ERRORS above for the three artifact strings, each one's measured miss
    // rate, and why this is not the uniform read the plan's table prescribed.
    case 'verify-summary': {
      const all = fmt(j.errors);
      const isArtifact = (e) => SUMMARY_ARTIFACT_ERRORS.some((a) => a.re.test(e));
      const defects = all.filter((e) => !isArtifact(e));
      const artifactual = all.filter(isArtifact);
      const named = SUMMARY_ARTIFACT_ERRORS.filter((a) => artifactual.some((e) => a.re.test(e))).map((a) => a.check);
      if (defects.length) {
        const also = artifactual.length ? ` (plus ${artifactual.length} known-artifact finding(s): ${named.join(', ')})` : '';
        // findings carries every string, including the warned ones: severity is decided by the
        // defects, but nothing the verb reported is dropped from the record.
        return res('error', defects.join('; ') + also, all);
      }
      if (artifactual.length) {
        return res('warning', `no record defect; ${artifactual.length} known-artifact finding(s): ${named.join(', ')}`, all);
      }
      return res('pass', 'requirements-completed present and every check clean', []);
    }

    // All three arrays are genuine structural breakage: a depends_on naming a plan that does
    // not exist, a dependency scheduled in the same or a later wave, or a cycle.
    case 'plan-graph': {
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      // A clean graph over zero nodes is not a pass the gate earned.
      if (fmt(j.plans).length === 0) return res('not_applicable', 'no PLAN files in the phase', []);
      const breakage = [
        ...fmt(j.cycles).map((s) => `cycle: ${s}`),
        ...fmt(j.dangling).map((s) => `dangling depends_on: ${s}`),
        ...fmt(j.wave_violations).map((s) => `wave violation: ${s}`),
      ];
      if (breakage.length) return res('error', breakage.join('; '), breakage);
      return res('pass', `${fmt(j.plans).length} plan(s), acyclic, every dependency in an earlier wave`, []);
    }

    // status 'missing' means the phase has no VERIFICATION.md yet. Under A-01 the gate runs
    // after verify_phase_goal, so on a healthy phase the file is there; when it is not, the
    // input simply has not been written yet, which is neither a pass nor a defect.
    case 'phase-verified': {
      if (j.status === 'missing') return res('not_yet', 'no VERIFICATION.md in the phase yet', []);
      if (j.verified === true) return res('pass', 'VERIFICATION.md status is "passed"', []);
      // The J1 defect, stated in the record rather than left for the reader to infer: v5.0
      // Phase 19 shipped `status: PASS` and read as unverified for a month.
      const d = `VERIFICATION.md status is "${j.status}"; the engine matches the literal lowercase "passed"`;
      return res('error', d, [d]);
    }

    // A-01: SECURITY.md is written by /donny-audit-phase, which runs AFTER execute-phase close
    // by design, so its absence at gate time is never a record defect. Both the missing-file
    // and missing-directory shapes are covered, and both are confined to a named field value.
    case 'threats-clear': {
      if (j.status === 'missing' || /No SECURITY\.md/.test(String(j.error || ''))) {
        return res('not_yet', 'no SECURITY.md yet; /donny-audit-phase writes it after close', []);
      }
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      if (j.has_register === false) {
        const d = 'SECURITY.md has no Threat Register table, so no threat can be shown closed';
        return res('error', d, [d]);
      }
      if (j.clear === false) {
        const ids = fmt(j.open_ids);
        return res('error', `${ids.length} open threat(s): ${ids.join(', ')}`, ids);
      }
      if (j.consistent === false) {
        // The A6 ENFORCING GATE pattern: the register table wins and the disagreement is
        // reported, rather than the frontmatter count being trusted or the phase failed.
        const d = `frontmatter declares threats_open: ${j.declared} but the register has ${j.threats_open}`;
        return res('warning', d, [d]);
      }
      return res('pass', 'threat register present, zero open', []);
    }

    // This verb has no boolean at all, only a status string. Measured: no archived v5.0 phase
    // has a UI-REVIEW.md, so 'missing' is the normal state for every backend phase - and unlike
    // threats-clear, nothing later in the lifecycle will write one, so it is not_applicable
    // rather than not_yet.
    case 'ui-reviewed': {
      if (j.status === 'missing') return res('not_applicable', 'no UI-REVIEW.md; not a UI phase', []);
      if (j.status === 'passed') return res('pass', 'UI review passed', []);
      const d = `UI review status is "${j.status}"`;
      return res('warning', d, [d]);
    }

    // The verb computes its own `blocking` boolean, which is a better severity signal than any
    // generic array read. It also never scans .planning/milestones/, so on an archived phase
    // "Phase directory not found" is the expected answer, not a defect.
    case 'schema-drift': {
      if (j.skipped === true) return res('not_applicable', 'schema-drift check skipped', []);
      const msg = String(j.message || '');
      if (/Phase directory not found/.test(msg)) return res('not_applicable', msg, []);
      if (j.blocking === true) return res('error', msg || 'blocking schema drift', [msg || 'blocking schema drift']);
      if (j.drift_detected === true) return res('warning', msg || 'schema drift detected', [msg || 'schema drift detected']);
      return res('pass', 'no schema drift', []);
    }

    // Scored from the ALREADY-FILTERED list filterCoverageToPhase produced (D-15), never from
    // the milestone-wide payload: the gate reports one phase's coverage, and every other
    // phase's unsatisfied requirements are not this phase's failure.
    case 'milestone-coverage': {
      const rows = Array.isArray(o.filteredRequirements) ? o.filteredRequirements : [];
      // C-9: this verb walks .planning/phases only and always reads the CURRENT
      // REQUIREMENTS.md, with no archive fallthrough, so on an archived phase the filter comes
      // back empty. That is a missing input, not a clean sheet.
      if (rows.length === 0 || j.gate === 'unknown') {
        return res('not_yet', 'no requirements mapped to this phase in the current REQUIREMENTS.md', []);
      }
      const errs = [];
      const warns = [];
      for (const r of rows) {
        if (!r) continue;
        if (r.status === 'unsatisfied' || r.orphaned === true) {
          errs.push(`${r.id}: ${r.orphaned === true ? 'orphaned (mapped to no existing phase)' : 'unsatisfied'}`);
        } else if (r.status === 'partial') {
          warns.push(`${r.id}: partial (not listed in any SUMMARY's requirements-completed)`);
        } else if (r.needs_checkbox_update === true) {
          warns.push(`${r.id}: satisfied, but its REQUIREMENTS.md checkbox is still unticked`);
        }
      }
      if (errs.length) return res('error', `${errs.length} of ${rows.length} requirement(s) not satisfied`, errs.concat(warns));
      if (warns.length) return res('warning', `${warns.length} of ${rows.length} requirement(s) need attention`, warns);
      return res('pass', `${rows.length} requirement(s) satisfied`, []);
    }

    // A-03 half 2. 353 unresolved references across the 18 real archived plans, from a backtick
    // branch that never expands '~' and from paths that moved when the milestone was archived.
    // A missing reference is worth recording and is not worth failing a phase over.
    case 'references': {
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      const missing = fmt(j.missing);
      if (missing.length) return res('warning', `${missing.length} of ${j.total ?? missing.length} reference(s) did not resolve`, missing);
      return res('pass', `${j.total ?? 0} reference(s) resolved`, []);
    }

    // A PLAN with no must_haves.artifacts block declares nothing to check; that early return is
    // the NORMAL state, not a failure. A-03 half 2 again for the paths that still miss: after
    // 23-03's expandHomePath fix the residue is files that legitimately moved at archive time.
    case 'artifacts': {
      if (j.error === 'No must_haves.artifacts found in frontmatter') {
        return res('not_applicable', 'the PLAN declares no must_haves.artifacts', []);
      }
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      if (j.all_passed === false) {
        const failed = (Array.isArray(j.artifacts) ? j.artifacts : [])
          .filter((a) => a && a.passed === false)
          .map((a) => `${a.path}: ${fmt(a.issues).join(', ')}`);
        return res('warning', `${j.passed ?? 0} of ${j.total ?? 0} artifact(s) verified`, failed);
      }
      return res('pass', `${j.total ?? 0} artifact(s) verified`, []);
    }

    // Same shape as artifacts, and the same reasoning: 47 of 47 key-link checks fail on the
    // archived plans because cmdVerifyKeyLinks joins both its reads against cwd with no
    // expansion (23-03 finding F2, deliberately left unfixed under HC-5).
    case 'key-links': {
      if (j.error === 'No must_haves.key_links found in frontmatter') {
        return res('not_applicable', 'the PLAN declares no must_haves.key_links', []);
      }
      if (j.error) return res('error', String(j.error), [String(j.error)]);
      if (j.all_verified === false) {
        const failed = (Array.isArray(j.links) ? j.links : [])
          .filter((l) => l && l.verified === false)
          .map((l) => `${l.from} -> ${l.to}: ${l.detail || 'not verified'}`);
        return res('warning', `${j.verified ?? 0} of ${j.total ?? 0} key link(s) verified`, failed);
      }
      return res('pass', `${j.total ?? 0} key link(s) verified`, []);
    }

    // git history can be rewritten, and the hashes come from a /\b[0-9a-f]{7,40}\b/ hex-word
    // harvest over prose, which picks up noise. An unresolvable hash is recorded, not failed.
    case 'commits': {
      if (j.all_valid === false) {
        const invalid = fmt(j.invalid);
        return res('warning', `${invalid.length} of ${j.total ?? invalid.length} hash(es) not in this repo's history`, invalid);
      }
      if ((j.total || 0) === 0) return res('not_applicable', 'no commit hashes to check', []);
      return res('pass', `${j.total} commit hash(es) resolved`, []);
    }

    // T-23-17: a verb added to verify.cjs in a later milestone must show up loudly rather than
    // drop out of the gate while the record still reads clean. Never 'pass', never a throw.
    default: {
      const d = 'unmapped verb: ' + verb;
      return res('error', d, [d]);
    }
  }
}
/**
 * Reduce a milestone-wide coverage payload to the requirements mapped to one phase (D-15).
 *
 * cmdVerifyMilestoneCoverage takes no phase argument at all (verify.cjs:466) and always reports
 * the whole current milestone, so D-15's per-phase view has to be a post-hoc filter on the
 * returned requirements[] array.
 *
 * Matching is on the canonical phase NUMBER, never on a substring. requirements[].phase is the
 * resolved phase DIRECTORY NAME when the phase exists on disk and the raw traceability label
 * ("Phase 25") when it does not (verify.cjs:544), so both forms are reduced through the same
 * digit extraction the verb itself uses at verify.cjs:539, then compared with canonPhaseNum.
 * Substring matching would make phase 2 match 23-record-integrity-and-the-validation-gate.
 *
 * Constraint carried from C-9: this verb walks .planning/phases only and always reads the
 * CURRENT REQUIREMENTS.md, with no archive fallthrough. On an archived phase the filter
 * therefore returns an empty array, which classifyVerbResult maps to 'not_yet' rather than to a
 * pass or a failure.
 *
 * @param {{gate?: string, requirements?: Array}} coverage the parsed milestone-coverage payload
 * @param {string} phaseArg a phase number or a phase directory name
 * @returns {Array} the subset of coverage.requirements belonging to that phase, in input order
 */
function filterCoverageToPhase(coverage, phaseArg) {
  const want = canonPhaseNum((String(phaseArg || '').match(/(\d+(?:\.\d+)?)/) || [])[1]);
  if (want === null) return [];
  const rows = (coverage && coverage.requirements) || [];
  return rows.filter((r) => {
    if (!r || !r.phase) return false;
    const got = canonPhaseNum((String(r.phase).match(/(\d+(?:\.\d+)?)/) || [])[1]);
    return got !== null && got === want;
  });
}
/**
 * Collect commit hashes from the '## Task Commits' section of each SUMMARY in a phase.
 *
 * A-02: cmdVerifyCommits takes an ARRAY OF HASHES, not a path, so it cannot be looped over
 * PLAN files the way D-13 grouped it. Restricting the harvest to the '## Task Commits'
 * section (rather than the whole document, as cmdVerifySummary does at verify.cjs:477-479)
 * keeps hex-looking prose words out of the list, which matters because an unverifiable hash
 * becomes a recorded warning that a reader then has to dismiss by hand.
 *
 * Section extraction is index-based (search + slice), not a lazy quantifier with a lookahead,
 * so there is no catastrophic-backtracking path over an operator-authored document of
 * arbitrary size (T-23-07). The result is capped, which bounds the number of `git cat-file`
 * subprocesses a crafted SUMMARY can provoke.
 *
 * @param {string} cwd project root
 * @param {string} phaseDirRel cwd-relative posix path to the phase directory
 * @param {string[]} summaryFiles SUMMARY basenames within that directory
 * @param {number} [cap=20] maximum hashes returned
 * @returns {string[]} deduplicated hashes in document order
 */
function harvestCommitHashes(cwd, phaseDirRel, summaryFiles, cap = 20) {
  const out = [];
  const seen = new Set();
  for (const s of summaryFiles || []) {
    const md = safeReadFile(path.join(cwd, phaseDirRel, s)) || '';
    const start = md.search(/##\s*Task Commits\b/i);
    if (start === -1) continue;
    const rest = md.slice(start);
    // Skip the leading '##' before looking for the next level-two heading, so the section's
    // own heading does not terminate it. '###' subheadings stay inside the section.
    const nextIdx = rest.slice(2).search(/\n##\s/);
    const section = nextIdx === -1 ? rest : rest.slice(0, nextIdx + 2);
    for (const h of (section.match(/\b[0-9a-f]{7,40}\b/g) || [])) {
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/**
 * Which scope each gate verb runs at. Exactly one entry per GATE_VERBS name.
 *
 * 'phase'   runs once for the whole phase
 * 'plan'    runs once per *-PLAN.md
 * 'summary' runs once per *-SUMMARY.md (A-02's sixth per-file verb)
 *
 * `commits` is 'phase' on purpose: A-02's correction is that it takes an array of hashes
 * harvested from every SUMMARY at once, so running it per file would re-check the same
 * history N times and multiply the git subprocesses for nothing.
 */
const GATE_VERB_SCOPE = {
  'phase-completeness': 'phase',
  'plan-graph': 'phase',
  'phase-verified': 'phase',
  'threats-clear': 'phase',
  'ui-reviewed': 'phase',
  'schema-drift': 'phase',
  'milestone-coverage': 'phase',
  'plan-structure': 'plan',
  'references': 'plan',
  'artifacts': 'plan',
  'key-links': 'plan',
  'verify-summary': 'summary',
  'commits': 'phase',
};

/** Severity ordering for the rollup, worst first. */
const GATE_SEVERITY_RANK = { error: 4, warning: 3, not_yet: 2, not_applicable: 1, pass: 0 };

/** Findings shown on a rollup row before the "and N more" tail. Research is explicit that an
 *  unreadable table is a muted gate, and a rollup row carrying 300 strings is unreadable. The
 *  full set is never lost: every string stays on its own per-invocation row in `verbs`. */
const GATE_ROLLUP_FINDINGS_CAP = 10;

/**
 * Findings kept on one per-invocation row.
 *
 * Not in the plan text; added because without it the gate can break its own contract.
 * output() diverts any payload over 50 000 chars to a temp file and writes '@file:/tmp/...'
 * instead (core.cjs:186-193), and the gate's headline promise is exactly ONE JSON document on
 * stdout. Measured 2026-09-02 on this repo: `references` alone contributes 235 findings over
 * the ten Phase 23 plans, and uncapped rows put Phase 23 at 43 959 chars with six SUMMARYs
 * still to be written. At 10 the same phase is 32 765 chars, and the four archived v5.0
 * phases are 19 090 to 24 281.
 *
 * Nothing is hidden by this: the row's detail string always states the true count ("N of M
 * reference(s) did not resolve"), and the tail entry records how many strings were elided.
 * A record row listing 235 unresolved paths is unreadable anyway, and an unreadable gate is
 * a muted gate.
 */
const GATE_ROW_FINDINGS_CAP = 10;

/** Cap one findings list, appending a tail that states how many were elided. */
function capFindings(list, cap) {
  const all = Array.isArray(list) ? list : [];
  if (all.length <= cap) return all;
  return all.slice(0, cap).concat([`... and ${all.length - cap} more`]);
}

/**
 * Run all thirteen record checkers against one phase and return a single aggregate (GATE-01).
 *
 * Pure with respect to stdout: it drives every verb through captureVerb and never calls
 * output() or error() itself, so the CLI wrapper owns the one write to fd 1. Never exits.
 *
 * The two rules that keep it alive for the whole run:
 *
 *   1. The phase is resolved ONCE, through findPhaseInternal, and the result is then
 *      containment-checked against planningRoot (T-23-06). No path is ever built by joining
 *      the caller's raw argument. findPhaseInternal already returns null for '../../etc';
 *      the containment check is the second, independent control, and it is what makes Plan
 *      06's write target safe by construction.
 *   2. A verb is NEVER invoked with an empty or undefined required argument (T-23-02).
 *      cmdVerifyCommits calls error() on an empty hash array (verify.cjs:1088) and error() is
 *      process.exit(1) (core.cjs:202-205), which would kill the gate mid-run with nothing on
 *      stdout. An empty plans, summaries or hash list means the loop does not run at all and
 *      the rollup row is not_applicable with targets: 0.
 *
 * @param {string} cwd project root, already resolved by donny-tools.cjs
 * @param {string} phaseArg phase number, id or directory name
 * @returns {object} the verify-gate aggregate, or a found:false shape
 */
function runGate(cwd, phaseArg) {
  const notFound = (why) => ({
    schema: 'verify-gate', found: false, error: why, phase: String(phaseArg || ''),
  });

  const info = findPhaseInternal(cwd, phaseArg);
  if (!info || !info.found) return notFound('Phase not found');

  // T-23-06. Both .planning/phases/ and .planning/milestones/v*-phases/ sit under
  // planningRoot, so one check covers current and archived phases alike.
  const rootAbs = path.resolve(planningRoot(cwd));
  const phaseAbs = path.resolve(cwd, info.directory);
  if (phaseAbs !== rootAbs && !phaseAbs.startsWith(rootAbs + path.sep)) {
    return notFound('Resolved phase directory escapes .planning');
  }

  // The three incompatible phase-argument conventions, computed once from one resolution
  // rather than left to each verb's own matcher (schema-drift matches on
  // entry.name.includes(), so a bare '2' would match 23-record-integrity-and-...).
  const dir = info.directory;                  // cwd-relative posix: the dir-path group
  const num = info.phase_number;               // phase-completeness resolves by number
  const base = dir.split('/').pop();           // schema-drift matches a directory basename
  const plans = Array.isArray(info.plans) ? info.plans : [];
  const summaries = Array.isArray(info.summaries) ? info.summaries : [];

  const results = [];
  const push = (verb, scope, target, fn, opts) => {
    const c = classifyVerbResult(verb, captureVerb(fn), opts);
    results.push({
      verb,
      scope,
      target: target || null,
      severity: c.severity,
      detail: c.detail,
      findings: capFindings(c.findings, GATE_ROW_FINDINGS_CAP),
    });
  };

  // --- six phase-scoped verbs -------------------------------------------------------------
  push('phase-completeness', 'phase', null, () => cmdVerifyPhaseCompleteness(cwd, num, false));
  push('plan-graph', 'phase', null, () => cmdVerifyPlanGraph(cwd, dir, false));
  push('phase-verified', 'phase', null, () => cmdVerifyPhaseVerified(cwd, dir, false));
  push('threats-clear', 'phase', null, () => cmdVerifyThreatsClear(cwd, dir, false));
  push('ui-reviewed', 'phase', null, () => cmdVerifyUiReviewed(cwd, dir, false));
  push('schema-drift', 'phase', null, () => cmdVerifySchemaDrift(cwd, base, false, false));

  // --- milestone-coverage: capture, then filter, then classify the FILTERED list (D-15) ----
  const cov = captureVerb(() => cmdVerifyMilestoneCoverage(cwd, false));
  const filtered = cov.ok ? filterCoverageToPhase(cov.json, num) : [];
  const covRow = classifyVerbResult('milestone-coverage', cov, { filteredRequirements: filtered });
  results.push({
    verb: 'milestone-coverage',
    scope: 'phase',
    target: null,
    severity: covRow.severity,
    detail: covRow.detail,
    findings: capFindings(covRow.findings, GATE_ROW_FINDINGS_CAP),
    requirements: filtered.map((r) => r && r.id).filter(Boolean),
  });

  // --- four per-PLAN verbs ----------------------------------------------------------------
  for (const p of plans) {
    const rel = dir + '/' + p;
    push('plan-structure', 'plan', p, () => cmdVerifyPlanStructure(cwd, rel, false));
    push('references', 'plan', p, () => cmdVerifyReferences(cwd, rel, false));
    push('artifacts', 'plan', p, () => cmdVerifyArtifacts(cwd, rel, false));
    push('key-links', 'plan', p, () => cmdVerifyKeyLinks(cwd, rel, false));
  }

  // --- the thirteenth verb, per SUMMARY (A-02; D-16 makes it load-bearing) -----------------
  for (const s of summaries) {
    push('verify-summary', 'summary', s, () => cmdVerifySummary(cwd, dir + '/' + s, 2, false));
  }

  // --- commits: once, and only when there is something to check (T-23-02) -----------------
  const hashes = harvestCommitHashes(cwd, dir, summaries);
  if (hashes.length === 0) {
    results.push({
      verb: 'commits',
      scope: 'phase',
      target: null,
      severity: 'not_applicable',
      detail: 'no commit hashes found under any ## Task Commits section',
      findings: [],
    });
  } else {
    push('commits', 'phase', null, () => cmdVerifyCommits(cwd, hashes, false));
  }

  // --- counts -----------------------------------------------------------------------------
  const counts = { pass: 0, warning: 0, error: 0, not_applicable: 0, not_yet: 0, total: 0 };
  for (const r of results) {
    // An unmapped severity is deliberately NOT bucketed: the five counts then fail to sum to
    // total, which the suite asserts, so it surfaces as a loud test failure rather than as a
    // quietly cleaner-looking record.
    if (Object.prototype.hasOwnProperty.call(counts, r.severity)) counts[r.severity] += 1;
    counts.total += 1;
  }

  // --- rollup: exactly one row per GATE_VERBS name, in GATE_VERBS order (T-23-21) ---------
  // Eighteen plans times five per-file verbs is ninety rows; a reader who has to scan ninety
  // rows stops reading, which is the ignorable-gate failure mode this phase exists to end.
  const rollup = GATE_VERBS.map((verb) => {
    const scope = GATE_VERB_SCOPE[verb];
    const rows = results.filter((r) => r.verb === verb);
    const c = { pass: 0, warning: 0, error: 0, not_applicable: 0, not_yet: 0 };
    for (const r of rows) {
      if (Object.prototype.hasOwnProperty.call(c, r.severity)) c[r.severity] += 1;
    }
    if (rows.length === 0) {
      const noun = scope === 'summary' ? 'SUMMARY' : 'PLAN';
      return {
        verb, scope, targets: 0, severity: 'not_applicable',
        detail: `no ${noun} files in the phase, so the check has nothing to run against`,
        counts: c, findings: [],
      };
    }
    const worst = rows.reduce((a, b) => (GATE_SEVERITY_RANK[b.severity] > GATE_SEVERITY_RANK[a.severity] ? b : a));
    const label = (r, s) => (rows.length > 1 && r.target ? `${r.target}: ${s}` : s);
    const findings = [];
    for (const r of rows) for (const f of r.findings) findings.push(label(r, f));
    return {
      verb, scope, targets: rows.length, severity: worst.severity,
      detail: label(worst, worst.detail),
      counts: c,
      findings: capFindings(findings, GATE_ROLLUP_FINDINGS_CAP),
    };
  });

  return {
    schema: 'verify-gate',
    found: true,
    phase: num,
    phase_dir: dir,
    archived: info.archived || null,
    generated_at: new Date().toISOString(),
    // Only ever 'pass' or 'fail'. The third gate state, 'not_run', means the RECORDS.md file
    // itself is absent (D-10); it is inferred by the reader from that absence and is never
    // written here.
    verdict: counts.error > 0 ? 'fail' : 'pass',
    counts,
    rollup,
    verbs: results,
  };
}

// ─── The NN-RECORDS.md artifact (RECORD-04, D-09) ────────────────────────────

/**
 * Sanitize one dynamic value before it is interpolated into a record.
 *
 * Detail and finding strings originate in operator-authored PLAN and SUMMARY markdown and
 * arrive here unchanged, so three things have to be neutralised (T-23-23):
 *
 *   newlines, because a detail carrying a line of '---' would reintroduce from inside the
 *     gate's own output the frontmatter shadowing this artifact exists to catch;
 *   pipes, because one would break the table the verdict is later re-derived from;
 *   unbounded length, because a single 40 KB finding makes the record unreadable, and an
 *     unreadable gate is a muted gate.
 *
 * Truncation happens BEFORE the pipe is escaped, so a pipe sitting on the 200-character
 * boundary can never be cut in half and leave a dangling backslash behind.
 *
 * Every dynamic value in renderRecordsMd passes through here. There is no raw interpolation.
 */
function cell(value) {
  const s = String(value === undefined || value === null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const clipped = s.length > 200 ? s.slice(0, 197) + '...' : s;
  return clipped.replace(/\|/g, '\\|');
}

/** One markdown table row from already-sanitized cells. */
function recordsRow(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * The one markdown table inside a '## <heading>' section, isolated by heading.
 *
 * Isolation is not cosmetic. A record carries three tables, and two of them have a column a
 * naive scan would mistake for a verdict: Findings has a Severity column and the Audit Trail
 * has a Verdict column (T-23-24). threatRegisterStatus documents the identical hazard for
 * SECURITY.md's two tables and solves it the same way.
 *
 * @returns {{header: string[], data: string[][]}|null} null when the section or its table is absent
 */
function recordsTable(md, headingRe) {
  const lines = String(md || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i].trim())) { start = i + 1; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i].trim())) { end = i; break; }
  }
  const rows = lines.slice(start, end).filter(l => l.trim().startsWith('|'));
  if (rows.length === 0) return null;
  const header = splitTableRow(rows[0]);
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = splitTableRow(rows[i]);
    if (!isSeparatorRow(cells)) data.push(cells);
  }
  return { header, data };
}

const RECORDS_VERB_RESULTS_RE = /^#{1,6}\s+verb results\s*$/i;
const RECORDS_TRAIL_RE = /^#{1,6}\s+record gate audit trail\s*$/i;

/** Findings rows kept before the omitted-count tail. A gate that emits 500 rows is a gate
 *  nobody reads; the full set stays on the per-invocation rows of the gate JSON. */
const RECORDS_FINDINGS_CAP = 50;

/** Kept verbatim in step with templates/RECORDS.md, so the written artifact explains its own
 *  constraints the way 21-SECURITY.md does. The heading-parity test is what pins the two. */
const RECORDS_FORMAT_NOTE = [
  'NOTE ON FORMAT: this file intentionally contains no bare `---` horizontal rules in its body.',
  'Only the two frontmatter fence lines above use `---`. The engine\'s frontmatter parser',
  '(`bin/lib/frontmatter.cjs:16-17`) treats every `---`/`---` pair in a file as a candidate',
  'frontmatter block and prefers the LAST one, so a decorative section rule would make the real',
  'frontmatter above silently unreadable. This is the same defect class the record gate exists to',
  'catch, and `templates/SECURITY.md` currently has it.',
];

const RECORDS_VERDICT_PROSE = [
  'The verdict is re-derived from the Verb Results table below on every read, never trusted from',
  'the frontmatter above (D-11, the A6 ENFORCING GATE pattern). `status` is `fail` if and only if',
  'at least one Verb Results row has Severity `error`. A hand-edited, stale or truncated',
  'frontmatter verdict is non-authoritative by construction; a disagreement is reported as',
  '`consistent: false` and the table wins.',
  '',
  'Severities: `pass` (clean), `warning` (recorded, does not fail), `error` (fails the gate),',
  '`not_applicable` (the check does not apply to this phase), `not_yet` (the input artifact',
  'legitimately does not exist at this point in the phase lifecycle). The absence of this file',
  'entirely is a sixth state, `not_run`, and never reads as a pass (D-10, GATE-02).',
];

/** How each verb's scope reads in the record. */
const RECORDS_SCOPE_LABEL = { phase: 'phase', plan: 'per-plan', summary: 'per-summary' };

/**
 * Render a gate result as NN-RECORDS.md (D-09).
 *
 * Two invariants the whole artifact rests on:
 *
 *   1. Exactly two '---' lines, the frontmatter fences. Everything dynamic goes through
 *      cell(), so no detail string can put a third one at column 0 (C-12, T-23-23).
 *   2. The frontmatter counts are derived from the same thirteen rollup rows the Verb Results
 *      table is built from, so the declared verdict and the re-derived one agree by
 *      construction and a `consistent: false` on read means a human edited the file.
 *
 * @param {object} gate a runGate result with found: true
 * @param {{runBy?: string, trail?: string[][]}} opts prior audit-trail rows to preserve (D-04)
 * @returns {string} the complete markdown document
 */
function renderRecordsMd(gate, opts) {
  const o = opts || {};
  const runBy = o.runBy || 'donny-tools verify gate';
  const trail = Array.isArray(o.trail) ? o.trail : [];

  const rollup = Array.isArray(gate && gate.rollup) ? gate.rollup : [];
  const byVerb = new Map(rollup.map(r => [r.verb, r]));
  // Built from GATE_VERBS rather than from the rollup, so the record is thirteen rows even if
  // a verb ever fails to produce one (T-23-21).
  const rows = GATE_VERBS.map(v => byVerb.get(v) || {
    verb: v, scope: GATE_VERB_SCOPE[v], targets: 0, severity: 'not_applicable',
    detail: 'the verb produced no rollup row', findings: [],
  });

  const tally = { pass: 0, warning: 0, error: 0, not_applicable: 0, not_yet: 0 };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(tally, r.severity)) tally[r.severity] += 1;
  }

  const padded = normalizePhaseName(String((gate && gate.phase) || ''));
  const base = String((gate && gate.phase_dir) || '').split('/').pop() || padded;
  const slug = base.replace(/^\d+[A-Za-z]?(?:\.\d+)*-/, '') || base || 'unknown';
  const created = new Date().toISOString().slice(0, 10);

  const out = [];
  out.push('---');
  out.push('status: ' + cell((gate && gate.verdict) || 'fail'));
  out.push('agent: donny-tools verify gate');
  out.push('phase: ' + cell(padded + '-' + slug));
  out.push('slug: ' + cell(slug));
  out.push('verbs_run: ' + rows.length);
  out.push('errors: ' + tally.error);
  out.push('warnings: ' + tally.warning);
  out.push('not_yet: ' + tally.not_yet);
  out.push('not_applicable: ' + tally.not_applicable);
  out.push('passed: ' + tally.pass);
  out.push('created: ' + created);
  out.push('---');
  out.push('');
  out.push('# Phase ' + cell(padded) + ' - Record Gate');
  out.push('');
  out.push(...RECORDS_FORMAT_NOTE);
  out.push('');
  out.push('## Verdict');
  out.push('');
  out.push(...RECORDS_VERDICT_PROSE);
  out.push('');

  out.push('## Verb Results');
  out.push('');
  out.push(recordsRow(['Verb', 'Scope', 'Targets', 'Severity', 'Detail']));
  out.push('|------|-------|---------|----------|--------|');
  for (const r of rows) {
    out.push(recordsRow([
      cell(r.verb),
      cell(RECORDS_SCOPE_LABEL[r.scope] || r.scope || 'phase'),
      cell(r.targets === undefined || r.targets === null ? 0 : r.targets),
      cell(r.severity),
      cell(r.detail),
    ]));
  }
  out.push('');

  out.push('## Findings');
  out.push('');
  out.push(recordsRow(['Verb', 'Target', 'Severity', 'Finding']));
  out.push('|------|--------|----------|---------|');
  let omitted = 0;
  let shown = 0;
  for (const v of (Array.isArray(gate && gate.verbs) ? gate.verbs : [])) {
    if (v.severity === 'pass' || v.severity === 'not_applicable') continue;
    const found = Array.isArray(v.findings) ? v.findings : [];
    if (found.length === 0) continue;
    if (shown >= RECORDS_FINDINGS_CAP) { omitted += 1; continue; }
    shown += 1;
    out.push(recordsRow([cell(v.verb), cell(v.target || ''), cell(v.severity), cell(found.join('; '))]));
  }
  if (omitted > 0) {
    out.push(recordsRow(['...', '...', '...', cell('and ' + omitted + ' more finding row(s) omitted')]));
  }
  out.push('');

  out.push('## Record Gate Audit Trail');
  out.push('');
  out.push(recordsRow(['Run Date', 'Verbs', 'Errors', 'Warnings', 'Not yet', 'N/A', 'Verdict', 'Run By']));
  out.push('|----------|-------|--------|----------|---------|-----|---------|--------|');
  // Preserved rows are re-emitted from their parsed cells WITHOUT re-sanitizing. They were
  // written by this renderer and are already clean; running cell() over them again would
  // double-escape a pipe and silently rewrite history D-04 exists to keep. A table row is one
  // line by construction, so a preserved row can never introduce a '---' at column 0.
  for (const t of trail) out.push(recordsRow(t.map(c => String(c))));
  out.push(recordsRow([
    created,
    String(rows.length),
    String(tally.error),
    String(tally.warning),
    String(tally.not_yet),
    String(tally.not_applicable),
    cell((gate && gate.verdict) || 'fail'),
    cell(runBy),
  ]));
  out.push('');
  return out.join('\n');
}

/**
 * Write (or re-write) a phase's NN-RECORDS.md, preserving its audit trail (D-04, D-09).
 *
 * The target path is built ONLY from the phase directory runGate already resolved and
 * containment-checked against planningRoot (T-23-06), plus normalizePhaseName. No component
 * comes from the caller's raw phase argument, so there is no traversal surface here at all.
 *
 * The Verb Results and Findings tables are REPLACED on every write, because the current
 * verdict must reflect the current artifacts. Only the audit trail accumulates, and a run is
 * never skipped because a passing record already exists (D-04 is explicit about that).
 *
 * @returns {string|null} the cwd-relative posix path written, or null when nothing was written
 */
function writeRecordsFile(cwd, gate, opts) {
  if (!gate || gate.found !== true) return null;
  const padded = normalizePhaseName(gate.phase);
  const phaseAbs = path.resolve(cwd, gate.phase_dir);
  const target = path.join(phaseAbs, padded + '-RECORDS.md');

  const prior = safeReadFile(target);
  const priorTable = prior ? recordsTable(prior, RECORDS_TRAIL_RE) : null;
  const trail = priorTable ? priorTable.data : [];

  fs.writeFileSync(target, renderRecordsMd(gate, { ...(opts || {}), trail }), 'utf-8');
  return path.relative(cwd, target).split(path.sep).join('/');
}

/** The five per-verb severities a Verb Results row may carry. Anything else is an error. */
const RECORDS_SEVERITIES = ['pass', 'warning', 'error', 'not_applicable', 'not_yet'];

/**
 * Re-derive a phase's record-gate verdict from its NN-RECORDS.md body table (D-11).
 *
 * This is the audit-phase A6 ENFORCING GATE pattern (workflows/audit-phase.md:138-148) applied
 * to the record gate: the frontmatter `status` the writer emitted is reported as `declared` and
 * is never trusted. The Verb Results table is authoritative, exactly as the Threat Register
 * table is authoritative over `threats_open` in threatRegisterStatus.
 *
 * Three non-pass states, all distinct and none of which may read as a pass:
 *   absent file           -> { present: false, verdict: 'not_run' }   (D-10, GATE-02)
 *   present, no table     -> { present: true, has_table: false, verdict: 'not_run' }
 *   present, table has an 'error' row -> derived 'fail'
 *
 * The 'present but unparseable equals not proven' rule is deliberate and is copied from
 * has_register: false -> treat as NOT clear (audit-phase.md:148).
 *
 * @param {string} cwd project root
 * @param {string} phaseArg phase number, id or directory name
 */
function readRecordsVerdict(cwd, phaseArg) {
  const absent = (why) => ({
    present: false,
    has_table: false,
    verdict: 'not_run',
    derived: null,
    declared: null,
    consistent: null,
    counts: { pass: 0, warning: 0, error: 0, not_applicable: 0, not_yet: 0 },
    file: null,
    detail: why + ' The record gate has not run for this phase: not_run, which is not a pass.',
  });

  // Resolution goes through findPhaseInternal and the same planningRoot containment check
  // runGate applies (T-23-06). A raw path is never accepted.
  const info = findPhaseInternal(cwd, phaseArg);
  if (!info || !info.found) return absent('Phase not found.');
  const rootAbs = path.resolve(planningRoot(cwd));
  const phaseAbs = path.resolve(cwd, info.directory);
  if (phaseAbs !== rootAbs && !phaseAbs.startsWith(rootAbs + path.sep)) {
    return absent('Resolved phase directory escapes .planning.');
  }

  // Detection by glob, matching audit-phase.md:69's *-SECURITY.md State A / State B check.
  let files = [];
  try {
    files = fs.readdirSync(phaseAbs).filter(f => /-RECORDS\.md$/i.test(f) || f === 'RECORDS.md').sort();
  } catch {
    return absent('Phase directory unreadable.');
  }
  if (files.length === 0) return absent('No *-RECORDS.md in the phase directory.');

  const rel = path.relative(cwd, path.join(phaseAbs, files[files.length - 1])).split(path.sep).join('/');
  const content = safeReadFile(path.join(phaseAbs, files[files.length - 1])) || '';
  const declaredRaw = extractFrontmatter(content).status;
  const declared = (typeof declaredRaw === 'string' && declaredRaw.trim() !== '') ? declaredRaw.trim() : null;

  const table = recordsTable(content, RECORDS_VERB_RESULTS_RE);
  const sevIdx = table ? table.header.findIndex(c => /^severity$/i.test(c)) : -1;
  if (!table || sevIdx === -1 || table.data.length === 0) {
    const why = !table
      ? 'has no ## Verb Results section'
      : (sevIdx === -1 ? 'has a ## Verb Results table with no Severity column' : 'has an empty ## Verb Results table');
    return {
      present: true,
      has_table: false,
      verdict: 'not_run',
      derived: null,
      declared,
      consistent: null,
      counts: { pass: 0, warning: 0, error: 0, not_applicable: 0, not_yet: 0 },
      file: rel,
      detail: `${rel} ${why}, so nothing was proven: not_run, which is not a pass`
        + (declared ? ` (its frontmatter declares '${declared}', which carries no authority here).` : '.'),
    };
  }

  const counts = { pass: 0, warning: 0, error: 0, not_applicable: 0, not_yet: 0 };
  const unknown = [];
  for (const cells of table.data) {
    const sev = String(cells[sevIdx] || '').trim().toLowerCase();
    if (RECORDS_SEVERITIES.includes(sev)) {
      counts[sev] += 1;
    } else {
      // An unreadable severity must never fall through to clean: it is scored as an error and
      // the row is named, so a truncated or hand-mangled cell is loud rather than silent.
      counts.error += 1;
      unknown.push(`${cells[0] || 'row'}: unrecognised severity '${cells[sevIdx] || ''}'`);
    }
  }

  const derived = counts.error > 0 ? 'fail' : 'pass';
  const consistent = declared === null ? null : declared.toLowerCase() === derived;
  const parts = [
    `${rel}: ${table.data.length} verb row(s) re-derive '${derived}'`,
    `(${counts.error} error, ${counts.warning} warning, ${counts.pass} pass,`
      + ` ${counts.not_yet} not_yet, ${counts.not_applicable} not_applicable).`,
  ];
  if (unknown.length) parts.push(`Unrecognised severities scored as errors: ${unknown.join('; ')}.`);
  if (consistent === false) {
    parts.push(`The frontmatter declares '${declared}' and disagrees; the table wins (D-11).`);
  }

  return {
    present: true,
    has_table: true,
    verdict: derived,
    derived,
    declared,
    consistent,
    counts,
    file: rel,
    detail: parts.join(' '),
  };
}

/**
 * CLI wrapper for the record gate: donny-tools.cjs verify gate <phase> [--write|--read].
 *
 * Three modes, one verb (HC-4 allows exactly one new CLI verb for this phase):
 *
 *   verify gate <phase>           runs the thirteen checkers, writes nothing
 *   verify gate <phase> --write   runs them and writes NN-RECORDS.md, adding records_file
 *   verify gate <phase> --read    runs NOTHING; re-reads the existing record (Plan 06 Task 2)
 *
 * The default stays read-only so inspection can never silently mutate the audit trail
 * (T-23-26), and every writing caller declares itself at the call site.
 *
 * The error() on a missing argument is correct and matches every sibling verb. The rule the
 * gate must never break is the reverse one: it must never PASS an empty argument to a verb.
 */
function cmdVerifyGate(cwd, phaseArg, options, raw) {
  if (!phaseArg) { error('phase required: verify gate <phase>'); }
  // --read is handled first and returns before any checker runs, so it wins over --write and
  // a read can never mutate the audit trail it is reporting on.
  if (options && options.read) {
    const rec = readRecordsVerdict(cwd, phaseArg);
    output(rec, raw, rec.verdict);
    return;
  }
  const result = runGate(cwd, phaseArg);
  let emitted = result;
  if (options && options.write && result.found) {
    const rel = writeRecordsFile(cwd, result, {});
    if (rel) emitted = { ...result, records_file: rel };
  }
  output(emitted, raw, result.found ? result.verdict : 'not_found');
}

function cmdVerifySummary(cwd, summaryPath, checkFileCount, raw) {
  if (!summaryPath) {
    error('summary-path required');
  }

  const fullPath = path.join(cwd, summaryPath);
  const checkCount = checkFileCount || 2;

  // Check 1: Summary exists
  if (!fs.existsSync(fullPath)) {
    const result = {
      passed: false,
      checks: {
        summary_exists: false,
        files_created: { checked: 0, found: 0, missing: [] },
        commits_exist: false,
        self_check: 'not_found',
        requirements_completed: null,
      },
      errors: ['SUMMARY.md not found'],
    };
    output(result, raw, 'failed');
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const errors = [];

  // Check 2: Spot-check files mentioned in summary
  const mentionedFiles = new Set();
  const patterns = [
    /`([^`]+\.[a-zA-Z]+)`/g,
    /(?:Created|Modified|Added|Updated|Edited):\s*`?([^\s`]+\.[a-zA-Z]+)`?/gi,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const filePath = m[1];
      if (filePath && !filePath.startsWith('http') && filePath.includes('/')) {
        mentionedFiles.add(filePath);
      }
    }
  }

  const filesToCheck = Array.from(mentionedFiles).slice(0, checkCount);
  const missing = [];
  for (const file of filesToCheck) {
    if (!fs.existsSync(path.join(cwd, file))) {
      missing.push(file);
    }
  }

  // Check 3: Commits exist
  const commitHashPattern = /\b[0-9a-f]{7,40}\b/g;
  const hashes = content.match(commitHashPattern) || [];
  let commitsExist = false;
  if (hashes.length > 0) {
    for (const hash of hashes.slice(0, 3)) {
      const result = execGit(cwd, ['cat-file', '-t', hash]);
      if (result.exitCode === 0 && result.stdout === 'commit') {
        commitsExist = true;
        break;
      }
    }
  }

  // Check 4: Self-check section
  let selfCheck = 'not_found';
  const selfCheckPattern = /##\s*(?:Self[- ]?Check|Verification|Quality Check)/i;
  if (selfCheckPattern.test(content)) {
    const passPattern = /(?:all\s+)?(?:pass|✓|✅|complete|succeeded)/i;
    const failPattern = /(?:fail|✗|❌|incomplete|blocked)/i;
    const checkSection = content.slice(content.search(selfCheckPattern));
    if (failPattern.test(checkSection)) {
      selfCheck = 'failed';
    } else if (passPattern.test(checkSection)) {
      selfCheck = 'passed';
    }
  }

  // --- Check 5: requirements-completed (D-16, RECORD-03) ---
  // cmdVerifyMilestoneCoverage gates requirement credit on Array.isArray(rc). Using the
  // identical predicate here makes the two checks agree by construction: anything this check
  // accepts, the coverage engine will also read.
  //
  // Three failing states, not two. Besides "missing" and "empty", a SUMMARY can carry the key
  // in a form that parses as a STRING (a trailing inline comment defeats the endsWith(']')
  // test at frontmatter.cjs:55) or can have its whole frontmatter shadowed by a body '---'
  // pair (extractFrontmatter takes the LAST block, frontmatter.cjs:16-17). Both look correct
  // to a human reader and are invisible to every checker, which is the July J2 defect.
  const fm = extractFrontmatter(content);
  const rcRaw = fm['requirements-completed'];
  const requirementsCompleted = Array.isArray(rcRaw) ? rcRaw : null;
  if (requirementsCompleted === null) {
    errors.push(rcRaw === undefined
      ? 'requirements-completed missing from SUMMARY frontmatter (or shadowed by a body --- pair)'
      : 'requirements-completed is not a YAML list (a trailing inline comment makes it parse as a string)');
  } else if (requirementsCompleted.length === 0) {
    errors.push('requirements-completed is empty');
  }

  if (missing.length > 0) errors.push('Missing files: ' + missing.join(', '));
  if (!commitsExist && hashes.length > 0) errors.push('Referenced commit hashes not found in git history');
  if (selfCheck === 'failed') errors.push('Self-check section indicates failure');

  const checks = {
    summary_exists: true,
    files_created: { checked: filesToCheck.length, found: filesToCheck.length - missing.length, missing },
    commits_exist: commitsExist,
    self_check: selfCheck,
    requirements_completed: requirementsCompleted,
  };

  const passed = missing.length === 0
    && selfCheck !== 'failed'
    && requirementsCompleted !== null
    && requirementsCompleted.length > 0;
  const result = { passed, checks, errors };
  output(result, raw, passed ? 'passed' : 'failed');
}

function cmdVerifyPlanStructure(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const fm = extractFrontmatter(content);
  const errors = [];
  const warnings = [];

  // Check required frontmatter fields
  const required = ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'must_haves'];
  for (const field of required) {
    if (fm[field] === undefined) errors.push(`Missing required frontmatter field: ${field}`);
  }

  // Parse and check task elements
  const taskPattern = /<task[^>]*>([\s\S]*?)<\/task>/g;
  const tasks = [];
  let taskMatch;
  while ((taskMatch = taskPattern.exec(content)) !== null) {
    const taskContent = taskMatch[1];
    const nameMatch = taskContent.match(/<name>([\s\S]*?)<\/name>/);
    const taskName = nameMatch ? nameMatch[1].trim() : 'unnamed';
    const hasFiles = /<files>/.test(taskContent);
    const hasAction = /<action>/.test(taskContent);
    const hasVerify = /<verify>/.test(taskContent);
    const hasDone = /<done>/.test(taskContent);

    if (!nameMatch) errors.push('Task missing <name> element');
    if (!hasAction) errors.push(`Task '${taskName}' missing <action>`);
    if (!hasVerify) warnings.push(`Task '${taskName}' missing <verify>`);
    if (!hasDone) warnings.push(`Task '${taskName}' missing <done>`);
    if (!hasFiles) warnings.push(`Task '${taskName}' missing <files>`);

    tasks.push({ name: taskName, hasFiles, hasAction, hasVerify, hasDone });
  }

  if (tasks.length === 0) warnings.push('No <task> elements found');

  // Wave/depends_on consistency
  if (fm.wave && parseInt(fm.wave) > 1 && (!fm.depends_on || (Array.isArray(fm.depends_on) && fm.depends_on.length === 0))) {
    warnings.push('Wave > 1 but depends_on is empty');
  }

  // Autonomous/checkpoint consistency
  const hasCheckpoints = /<task\s+type=["']?checkpoint/.test(content);
  if (hasCheckpoints && fm.autonomous !== 'false' && fm.autonomous !== false) {
    errors.push('Has checkpoint tasks but autonomous is not false');
  }

  output({
    valid: errors.length === 0,
    errors,
    warnings,
    task_count: tasks.length,
    tasks,
    frontmatter_fields: Object.keys(fm),
  }, raw, errors.length === 0 ? 'valid' : 'invalid');
}

// --- Plan dependency-graph validation ---
// Deterministic counterpart to the plan-checker LLM's acyclicity/wave check
// (donny-plan-checker.md:654): every depends_on resolves to a real plan, the graph is
// acyclic, and a dependency always sits in a strictly earlier wave. Pure + exported for
// unit testing; cmdVerifyPlanGraph reads a phase dir and feeds it this.
function validatePlanGraph(plans) {
  const ids = plans.map(p => p.id);
  const idSet = new Set(ids);
  const byId = new Map(plans.map(p => [p.id, p]));

  // dangling: depends_on entries with no matching plan in the phase
  const dangling = [];
  for (const p of plans) {
    const missing = (p.depends_on || []).filter(d => !idSet.has(d));
    if (missing.length) dangling.push({ plan: p.id, missing });
  }

  // wave violations: a dependency must run in a strictly earlier wave, else the
  // wave executor would schedule it in parallel with (or after) its dependent.
  const wave_violations = [];
  for (const p of plans) {
    const pw = Number(p.wave);
    for (const d of (p.depends_on || [])) {
      if (!idSet.has(d)) continue; // counted under dangling
      const dw = Number(byId.get(d).wave);
      if (!(pw > dw)) wave_violations.push({ plan: p.id, dep: d, wave: pw, dep_wave: dw });
    }
  }

  // cycles: DFS over edges that resolve, reporting unique node-sets
  const edges = new Map(plans.map(p => [p.id, (p.depends_on || []).filter(d => idSet.has(d))]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(ids.map(i => [i, WHITE]));
  const stack = [];
  const seen = new Set();
  const cycles = [];
  const visit = (u) => {
    color.set(u, GRAY); stack.push(u);
    for (const v of edges.get(u)) {
      if (color.get(v) === GRAY) {
        const cyclePath = stack.slice(stack.indexOf(v)).concat(v);
        const key = [...new Set(cyclePath)].sort().join(',');
        if (!seen.has(key)) { seen.add(key); cycles.push(cyclePath); }
      } else if (color.get(v) === WHITE) {
        visit(v);
      }
    }
    color.set(u, BLACK); stack.pop();
  };
  for (const id of ids) if (color.get(id) === WHITE) visit(id);

  return {
    valid: dangling.length === 0 && wave_violations.length === 0 && cycles.length === 0,
    plans: ids,
    dangling,
    wave_violations,
    cycles,
  };
}

function cmdVerifyPlanGraph(cwd, phaseArg, raw) {
  if (!phaseArg) { error('Usage: verify plan-graph <phase-dir|phase>'); }
  // Resolve to a phase directory: an existing dir path, else a phase id under .planning/phases.
  let dir = path.isAbsolute(phaseArg) ? phaseArg : path.join(cwd, phaseArg);
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    const phasesRoot = path.join(planningDir(cwd), 'phases');
    const match = fs.existsSync(phasesRoot)
      ? fs.readdirSync(phasesRoot).find(d => d === normalizePhaseName(phaseArg) || d.startsWith(phaseArg + '-') || d === phaseArg)
      : null;
    if (match) dir = path.join(phasesRoot, match);
  }
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    output({ error: 'Phase directory not found', phase: phaseArg }, raw);
    return;
  }
  const plans = fs.readdirSync(dir)
    .filter(f => /-PLAN\.md$/i.test(f))
    .map(f => {
      const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
      return {
        id: f.replace(/-PLAN\.md$/i, ''),
        wave: fm.wave,
        depends_on: Array.isArray(fm.depends_on) ? fm.depends_on : [],
      };
    });
  const result = validatePlanGraph(plans);
  output({ ...result, schema: 'plan-graph', phase: path.basename(dir) }, raw, result.valid ? 'valid' : 'invalid');
}

// --- Verification-status gate ---
// Deterministic counterpart to the prose "check VERIFICATION.md status" gate. A phase
// is verified ONLY when its VERIFICATION.md frontmatter status === 'passed'. ship and
// complete-milestone must block on this before an irreversible/outward action instead of
// trusting file-existence (init phase-op's has_verification) plus an LLM glance.
function phaseVerificationVerdict(fm) {
  const status = (fm && fm.status) ? String(fm.status).trim() : 'unknown';
  return { verified: status === 'passed', status };
}

function cmdVerifyPhaseVerified(cwd, phaseArg, raw) {
  if (!phaseArg) { error('Usage: verify phase-verified <phase-dir|phase>'); }
  let dir = path.isAbsolute(phaseArg) ? phaseArg : path.join(cwd, phaseArg);
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    const phasesRoot = path.join(planningDir(cwd), 'phases');
    const match = fs.existsSync(phasesRoot)
      ? fs.readdirSync(phasesRoot).find(d => d === normalizePhaseName(phaseArg) || d.startsWith(phaseArg + '-') || d === phaseArg)
      : null;
    if (match) dir = path.join(phasesRoot, match);
  }
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    output({ verified: false, status: 'missing', error: 'Phase directory not found', phase: phaseArg }, raw, 'missing');
    return;
  }
  const vfiles = fs.readdirSync(dir).filter(f => /-VERIFICATION\.md$/i.test(f)).sort();
  if (vfiles.length === 0) {
    output({ verified: false, status: 'missing', phase: path.basename(dir) }, raw, 'missing');
    return;
  }
  const fm = extractFrontmatter(safeReadFile(path.join(dir, vfiles[vfiles.length - 1])) || '');
  const v = phaseVerificationVerdict(fm);
  output({ verified: v.verified, status: v.status, score: fm.score ?? null, phase: path.basename(dir) }, raw, v.verified ? 'verified' : 'unverified');
}

// donny-ui-auditor writes an exact UI-REVIEW.md frontmatter contract and states the
// orchestrator parses it without an LLM. This surfaces status/score/baseline faithfully
// so the displayed verdict cannot drift from the file (the ui-review marker-match bug).
function uiReviewVerdict(fm) {
  const status = (fm && fm.status) ? String(fm.status).trim() : 'unknown';
  const score = (fm && fm.score != null && String(fm.score).trim() !== '') ? String(fm.score).trim() : null;
  const baseline = (fm && fm.baseline) ? String(fm.baseline).trim() : null;
  return { status, score, baseline };
}

function cmdVerifyUiReviewed(cwd, phaseArg, raw) {
  if (!phaseArg) { error('Usage: verify ui-reviewed <phase-dir|phase>'); }
  let dir = path.isAbsolute(phaseArg) ? phaseArg : path.join(cwd, phaseArg);
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    const phasesRoot = path.join(planningDir(cwd), 'phases');
    const match = fs.existsSync(phasesRoot)
      ? fs.readdirSync(phasesRoot).find(d => d === normalizePhaseName(phaseArg) || d.startsWith(phaseArg + '-') || d === phaseArg)
      : null;
    if (match) dir = path.join(phasesRoot, match);
  }
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    output({ status: 'missing', score: null, baseline: null, error: 'Phase directory not found', phase: phaseArg }, raw, 'missing');
    return;
  }
  const rfiles = fs.readdirSync(dir).filter(f => /-UI-REVIEW\.md$/i.test(f) || f === 'UI-REVIEW.md').sort();
  if (rfiles.length === 0) {
    output({ status: 'missing', score: null, baseline: null, phase: path.basename(dir) }, raw, 'missing');
    return;
  }
  const v = uiReviewVerdict(extractFrontmatter(safeReadFile(path.join(dir, rfiles[rfiles.length - 1])) || ''));
  output({ status: v.status, score: v.score, baseline: v.baseline, phase: path.basename(dir) }, raw, v.status);
}

// Split a markdown table row into trimmed cells, dropping the leading/trailing
// empties that `| a | b |` produces so header and data rows index alignedly.
function splitTableRow(line) {
  const parts = line.split('|');
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map(s => s.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
}

// Canonical phase number so "01-auth" (dir) and "Phase 1" (traceability) compare equal.
function canonPhaseNum(s) {
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

// Parse a per-phase SECURITY.md and report open threats from the Threat Register table.
// The Status column is authoritative: audit-phase's blocking gate must not trust the
// frontmatter threats_open count, which the LLM can leave stale or set to 0 by mistake.
// The Threat Register section is isolated by heading so the Security Audit Trail table
// (which also has an "Open" column) is never miscounted as open threats.
function threatRegisterStatus(md) {
  const content = String(md || '');
  const fm = extractFrontmatter(content);
  const declaredRaw = fm.threats_open;
  const declared = (declaredRaw === undefined || declaredRaw === null || declaredRaw === '')
    ? null
    : (Number.isFinite(Number(declaredRaw)) ? Number(declaredRaw) : null);

  const lines = content.split(/\r?\n/);
  const notFound = () => ({
    has_register: false, threats_open: 0, open_ids: [], declared,
    consistent: declared === null || declared === 0,
  });

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s+threat register\b/i.test(lines[i].trim())) { start = i + 1; break; }
  }
  if (start === -1) return notFound();

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i].trim())) { end = i; break; }
  }
  const rows = lines.slice(start, end).filter(l => l.trim().startsWith('|'));
  if (rows.length < 1) return notFound();

  const header = splitTableRow(rows[0]);
  const statusIdx = header.findIndex(c => /^status$/i.test(c));
  const idIdx = header.findIndex(c => /threat\s*id/i.test(c));
  if (statusIdx === -1) return notFound();

  const open_ids = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = splitTableRow(rows[i]);
    if (isSeparatorRow(cells)) continue;
    if ((cells[statusIdx] || '').trim().toLowerCase() === 'open') {
      open_ids.push(idIdx >= 0 ? (cells[idIdx] || '').trim() : `row-${i}`);
    }
  }
  return {
    has_register: true,
    threats_open: open_ids.length,
    open_ids,
    declared,
    consistent: declared === null ? true : declared === open_ids.length,
  };
}

function cmdVerifyThreatsClear(cwd, phaseArg, raw) {
  if (!phaseArg) { error('Usage: verify threats-clear <phase-dir|phase>'); }
  let dir = path.isAbsolute(phaseArg) ? phaseArg : path.join(cwd, phaseArg);
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    const phasesRoot = path.join(planningDir(cwd), 'phases');
    const match = fs.existsSync(phasesRoot)
      ? fs.readdirSync(phasesRoot).find(d => d === normalizePhaseName(phaseArg) || d.startsWith(phaseArg + '-') || d === phaseArg)
      : null;
    if (match) dir = path.join(phasesRoot, match);
  }
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    output({ clear: false, status: 'missing', error: 'Phase directory not found', phase: phaseArg }, raw, 'missing');
    return;
  }
  const sfiles = fs.readdirSync(dir).filter(f => /-SECURITY\.md$/i.test(f) || f === 'SECURITY.md').sort();
  if (sfiles.length === 0) {
    // No SECURITY.md means nothing was audited - cannot prove threats are closed, so block.
    output({ clear: false, status: 'missing', error: 'No SECURITY.md in phase', phase: path.basename(dir) }, raw, 'missing');
    return;
  }
  const s = threatRegisterStatus(safeReadFile(path.join(dir, sfiles[sfiles.length - 1])) || '');
  const clear = s.has_register && s.threats_open === 0;
  output({
    clear,
    threats_open: s.threats_open,
    open_ids: s.open_ids,
    declared: s.declared,
    consistent: s.consistent,
    has_register: s.has_register,
    phase: path.basename(dir),
  }, raw, clear ? 'clear' : 'blocked');
}

// audit-milestone 5d Status Determination Matrix, as a pure lookup. Inputs: the assigned
// phase's VERIFICATION verdict (passed | gaps_found | missing | ...) and whether the
// requirement is listed in a phase SUMMARY's requirements-completed. The REQUIREMENTS
// checkbox never changes the status - it only flags a stale checkbox (handled in aggregate).
function requirementCoverageStatus({ verification, summaryListed }) {
  const v = String(verification || 'missing').trim().toLowerCase();
  if (v === 'passed') return summaryListed ? 'satisfied' : 'partial';
  if (v === 'gaps_found' || v === 'failed') return 'unsatisfied';
  // missing / human_needed / partial / unknown: a verification gap, not a clean pass.
  return summaryListed ? 'partial' : 'unsatisfied';
}

// audit-milestone 5e FAIL gate + orphan rule. records: [{ id, phase, verification,
// summaryListed, checked, orphaned }]. An orphaned requirement (in REQUIREMENTS
// traceability but covered by no phase) is unsatisfied regardless of any verdict. Any
// unsatisfied requirement forces the milestone gate to gaps_found; partial does not.
function aggregateCoverage(records) {
  const out = (records || []).map(r => {
    const status = r.orphaned ? 'unsatisfied' : requirementCoverageStatus(r);
    return {
      id: r.id,
      phase: r.phase || null,
      status,
      orphaned: !!r.orphaned,
      needs_checkbox_update: status === 'satisfied' && r.checked === false,
    };
  });
  const counts = { satisfied: 0, partial: 0, unsatisfied: 0, orphaned: 0 };
  for (const r of out) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.orphaned) counts.orphaned++;
  }
  return { requirements: out, counts, gate: counts.unsatisfied > 0 ? 'gaps_found' : 'passed' };
}

function cmdVerifyMilestoneCoverage(cwd, raw) {
  const reqMd = safeReadFile(path.join(planningDir(cwd), 'REQUIREMENTS.md')) || '';
  const emptyCounts = { satisfied: 0, partial: 0, unsatisfied: 0, orphaned: 0 };
  if (!reqMd.trim()) {
    output({ gate: 'unknown', error: 'REQUIREMENTS.md not found or empty', counts: emptyCounts, requirements: [] }, raw, 'unknown');
    return;
  }

  const REQ_ID = /[A-Z][A-Z0-9]*-\d+/;
  const recordsById = new Map();
  const ensure = (id) => {
    if (!recordsById.has(id)) recordsById.set(id, { id, checked: null, phaseLabel: null });
    return recordsById.get(id);
  };
  const lines = reqMd.split(/\r?\n/);

  // Checkbox state from the scope lists: - [ ] **REQ-ID**: ...
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*\*\*([A-Z][A-Z0-9]*-\d+)\*\*/);
    if (m) ensure(m[2]).checked = m[1].toLowerCase() === 'x';
  }

  // Assigned phase from the ## Traceability table: | REQ-ID | Phase N | Status |
  let ts = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s+traceability\b/i.test(lines[i].trim())) { ts = i + 1; break; }
  }
  if (ts !== -1) {
    let te = lines.length;
    for (let i = ts; i < lines.length; i++) { if (/^#{1,6}\s+/.test(lines[i].trim())) { te = i; break; } }
    for (const row of lines.slice(ts, te)) {
      if (!row.trim().startsWith('|')) continue;
      const cells = splitTableRow(row);
      if (isSeparatorRow(cells)) continue;
      const idm = (cells[0] || '').match(/^([A-Z][A-Z0-9]*-\d+)$/);
      if (!idm) continue; // header / non-id row
      if (cells[1]) ensure(idm[1]).phaseLabel = cells[1];
    }
  }

  if (recordsById.size === 0) {
    output({ gate: 'unknown', error: 'No requirement IDs parsed from REQUIREMENTS.md', counts: emptyCounts, requirements: [] }, raw, 'unknown');
    return;
  }

  // Phase number -> { dir, verification verdict }, plus the global set of REQ-IDs marked
  // complete across all phase SUMMARYs (5c). Reuses phaseVerificationVerdict (the same
  // verdict ship's gate trusts) so coverage and ship agree on what "verified" means.
  const phasesRoot = path.join(planningDir(cwd), 'phases');
  const phaseMap = new Map();
  const allSummaryReqs = new Set();
  if (fs.existsSync(phasesRoot)) {
    for (const dir of fs.readdirSync(phasesRoot)) {
      const full = path.join(phasesRoot, dir);
      if (!(fs.existsSync(full) && fs.statSync(full).isDirectory())) continue;
      const num = (dir.match(/^(\d+(?:\.\d+)?)/) || [])[1] || null;
      const files = fs.readdirSync(full);
      const vfiles = files.filter(f => /-VERIFICATION\.md$/i.test(f) || f === 'VERIFICATION.md').sort();
      let verification = 'missing';
      if (vfiles.length) {
        const fm = extractFrontmatter(safeReadFile(path.join(full, vfiles[vfiles.length - 1])) || '');
        verification = phaseVerificationVerdict(fm).status;
      }
      for (const sf of files.filter(f => /-SUMMARY\.md$/i.test(f) || f === 'SUMMARY.md')) {
        const rc = extractFrontmatter(safeReadFile(path.join(full, sf)) || '')['requirements-completed'];
        if (Array.isArray(rc)) for (const x of rc) { const mm = String(x).match(REQ_ID); if (mm) allSummaryReqs.add(mm[0]); }
      }
      const key = canonPhaseNum(num);
      if (key) phaseMap.set(key, { dir, verification });
    }
  }

  // Orphan = assigned to no existing phase (structural proxy for "never verified"); the
  // assigned-phase-exists-but-no-VERIFICATION case is the matrix's `missing` row instead.
  const records = [];
  for (const r of recordsById.values()) {
    const num = r.phaseLabel ? (r.phaseLabel.match(/(\d+(?:\.\d+)?)/) || [])[1] : null;
    const entry = num ? phaseMap.get(canonPhaseNum(num)) : null;
    records.push({
      id: r.id,
      phase: entry ? entry.dir : (r.phaseLabel || null),
      verification: entry ? entry.verification : 'missing',
      summaryListed: allSummaryReqs.has(r.id),
      checked: r.checked,
      orphaned: !entry,
    });
  }
  const result = aggregateCoverage(records);
  output({ gate: result.gate, counts: result.counts, requirements: result.requirements }, raw, result.gate);
}

function cmdVerifyPhaseCompleteness(cwd, phase, raw) {
  if (!phase) { error('phase required'); }
  const phaseInfo = findPhaseInternal(cwd, phase);
  if (!phaseInfo || !phaseInfo.found) {
    output({ error: 'Phase not found', phase }, raw);
    return;
  }

  const errors = [];
  const warnings = [];
  const phaseDir = path.join(cwd, phaseInfo.directory);

  // List plans and summaries
  let files;
  try { files = fs.readdirSync(phaseDir); } catch { output({ error: 'Cannot read phase directory' }, raw); return; }

  const plans = files.filter(f => f.match(/-PLAN\.md$/i));
  const summaries = files.filter(f => f.match(/-SUMMARY\.md$/i));

  // Extract plan IDs (everything before -PLAN.md)
  const planIds = new Set(plans.map(p => p.replace(/-PLAN\.md$/i, '')));
  const summaryIds = new Set(summaries.map(s => s.replace(/-SUMMARY\.md$/i, '')));

  // Plans without summaries
  const incompletePlans = [...planIds].filter(id => !summaryIds.has(id));
  if (incompletePlans.length > 0) {
    errors.push(`Plans without summaries: ${incompletePlans.join(', ')}`);
  }

  // Summaries without plans (orphans)
  const orphanSummaries = [...summaryIds].filter(id => !planIds.has(id));
  if (orphanSummaries.length > 0) {
    warnings.push(`Summaries without plans: ${orphanSummaries.join(', ')}`);
  }

  output({
    complete: errors.length === 0,
    phase: phaseInfo.phase_number,
    plan_count: plans.length,
    summary_count: summaries.length,
    incomplete_plans: incompletePlans,
    orphan_summaries: orphanSummaries,
    errors,
    warnings,
  }, raw, errors.length === 0 ? 'complete' : 'incomplete');
}

function cmdVerifyReferences(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const found = [];
  const missing = [];

  // Find @-references: @path/to/file (must contain / to be a file path)
  const atRefs = content.match(/@([^\s\n,)]+\/[^\s\n,)]+)/g) || [];
  for (const ref of atRefs) {
    const cleanRef = ref.slice(1); // remove @
    const resolved = cleanRef.startsWith('~/')
      ? path.join(process.env.HOME || '', cleanRef.slice(2))
      : path.join(cwd, cleanRef);
    if (fs.existsSync(resolved)) {
      found.push(cleanRef);
    } else {
      missing.push(cleanRef);
    }
  }

  // Find backtick file paths that look like real paths (contain / and have extension)
  const backtickRefs = content.match(/`([^`]+\/[^`]+\.[a-zA-Z]{1,10})`/g) || [];
  for (const ref of backtickRefs) {
    const cleanRef = ref.slice(1, -1); // remove backticks
    if (cleanRef.startsWith('http') || cleanRef.includes('${') || cleanRef.includes('{{')) continue;
    if (found.includes(cleanRef) || missing.includes(cleanRef)) continue; // dedup
    const resolved = path.join(cwd, cleanRef);
    if (fs.existsSync(resolved)) {
      found.push(cleanRef);
    } else {
      missing.push(cleanRef);
    }
  }

  output({
    valid: missing.length === 0,
    found: found.length,
    missing,
    total: found.length + missing.length,
  }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyCommits(cwd, hashes, raw) {
  if (!hashes || hashes.length === 0) { error('At least one commit hash required'); }

  const valid = [];
  const invalid = [];
  for (const hash of hashes) {
    const result = execGit(cwd, ['cat-file', '-t', hash]);
    if (result.exitCode === 0 && result.stdout.trim() === 'commit') {
      valid.push(hash);
    } else {
      invalid.push(hash);
    }
  }

  output({
    all_valid: invalid.length === 0,
    valid,
    invalid,
    total: hashes.length,
  }, raw, invalid.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyArtifacts(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const artifacts = parseMustHavesBlock(content, 'artifacts');
  if (artifacts.length === 0) {
    output({ error: 'No must_haves.artifacts found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const artifact of artifacts) {
    if (typeof artifact === 'string') continue; // skip simple string items
    const artPath = artifact.path;
    if (!artPath) continue;

    const artFullPath = expandHomePath(cwd, artPath);
    const exists = fs.existsSync(artFullPath);
    const check = { path: artPath, exists, issues: [], passed: false };

    if (exists) {
      const fileContent = safeReadFile(artFullPath) || '';
      const lineCount = fileContent.split('\n').length;

      if (artifact.min_lines && lineCount < artifact.min_lines) {
        check.issues.push(`Only ${lineCount} lines, need ${artifact.min_lines}`);
      }
      if (artifact.contains && !fileContent.includes(artifact.contains)) {
        check.issues.push(`Missing pattern: ${artifact.contains}`);
      }
      if (artifact.exports) {
        const exports = Array.isArray(artifact.exports) ? artifact.exports : [artifact.exports];
        for (const exp of exports) {
          if (!fileContent.includes(exp)) check.issues.push(`Missing export: ${exp}`);
        }
      }
      check.passed = check.issues.length === 0;
    } else {
      check.issues.push('File not found');
    }

    results.push(check);
  }

  const passed = results.filter(r => r.passed).length;
  output({
    all_passed: passed === results.length,
    passed,
    total: results.length,
    artifacts: results,
  }, raw, passed === results.length ? 'valid' : 'invalid');
}

function cmdVerifyKeyLinks(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const keyLinks = parseMustHavesBlock(content, 'key_links');
  if (keyLinks.length === 0) {
    output({ error: 'No must_haves.key_links found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const link of keyLinks) {
    if (typeof link === 'string') continue;
    const check = { from: link.from, to: link.to, via: link.via || '', verified: false, detail: '' };

    const sourceContent = safeReadFile(path.join(cwd, link.from || ''));
    if (!sourceContent) {
      check.detail = 'Source file not found';
    } else if (link.pattern) {
      try {
        const regex = new RegExp(link.pattern);
        if (regex.test(sourceContent)) {
          check.verified = true;
          check.detail = 'Pattern found in source';
        } else {
          const targetContent = safeReadFile(path.join(cwd, link.to || ''));
          if (targetContent && regex.test(targetContent)) {
            check.verified = true;
            check.detail = 'Pattern found in target';
          } else {
            check.detail = `Pattern "${link.pattern}" not found in source or target`;
          }
        }
      } catch {
        check.detail = `Invalid regex pattern: ${link.pattern}`;
      }
    } else {
      // No pattern: just check source references target
      if (sourceContent.includes(link.to || '')) {
        check.verified = true;
        check.detail = 'Target referenced in source';
      } else {
        check.detail = 'Target not referenced in source';
      }
    }

    results.push(check);
  }

  const verified = results.filter(r => r.verified).length;
  output({
    all_verified: verified === results.length,
    verified,
    total: results.length,
    links: results,
  }, raw, verified === results.length ? 'valid' : 'invalid');
}

function cmdValidateConsistency(cwd, raw) {
  const roadmapPath = path.join(planningDir(cwd), 'ROADMAP.md');
  const phasesDir = path.join(planningDir(cwd), 'phases');
  const errors = [];
  const warnings = [];

  // Check for ROADMAP
  if (!fs.existsSync(roadmapPath)) {
    errors.push('ROADMAP.md not found');
    output({ passed: false, errors, warnings }, raw, 'failed');
    return;
  }

  const roadmapContentRaw = fs.readFileSync(roadmapPath, 'utf-8');
  const roadmapContent = extractCurrentMilestone(roadmapContentRaw, cwd);

  // Extract phases from ROADMAP (archived milestones already stripped)
  const roadmapPhases = new Set();
  const phasePattern = /#{2,4}\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:/gi;
  let m;
  while ((m = phasePattern.exec(roadmapContent)) !== null) {
    roadmapPhases.add(m[1]);
  }

  // Get phases on disk
  const diskPhases = new Set();
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const dir of dirs) {
      const dm = dir.match(/^(\d+[A-Z]?(?:\.\d+)*)/i);
      if (dm) diskPhases.add(dm[1]);
    }
  } catch { /* intentionally empty */ }

  // Check: phases in ROADMAP but not on disk
  for (const p of roadmapPhases) {
    if (!diskPhases.has(p) && !diskPhases.has(normalizePhaseName(p))) {
      warnings.push(`Phase ${p} in ROADMAP.md but no directory on disk`);
    }
  }

  // Check: phases on disk but not in ROADMAP
  for (const p of diskPhases) {
    const unpadded = String(parseInt(p, 10));
    if (!roadmapPhases.has(p) && !roadmapPhases.has(unpadded)) {
      warnings.push(`Phase ${p} exists on disk but not in ROADMAP.md`);
    }
  }

  // Check: sequential phase numbers (integers only, skip in custom naming mode)
  const config = loadConfig(cwd);
  if (config.phase_naming !== 'custom') {
    const integerPhases = [...diskPhases]
      .filter(p => !p.includes('.'))
      .map(p => parseInt(p, 10))
      .sort((a, b) => a - b);

    for (let i = 1; i < integerPhases.length; i++) {
      if (integerPhases[i] !== integerPhases[i - 1] + 1) {
        warnings.push(`Gap in phase numbering: ${integerPhases[i - 1]} → ${integerPhases[i]}`);
      }
    }
  }

  // Check: plan numbering within phases
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md')).sort();

      // Extract plan numbers
      const planNums = plans.map(p => {
        const pm = p.match(/-(\d{2})-PLAN\.md$/);
        return pm ? parseInt(pm[1], 10) : null;
      }).filter(n => n !== null);

      for (let i = 1; i < planNums.length; i++) {
        if (planNums[i] !== planNums[i - 1] + 1) {
          warnings.push(`Gap in plan numbering in ${dir}: plan ${planNums[i - 1]} → ${planNums[i]}`);
        }
      }

      // Check: plans without summaries (completed plans)
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md'));
      const planIds = new Set(plans.map(p => p.replace('-PLAN.md', '')));
      const summaryIds = new Set(summaries.map(s => s.replace('-SUMMARY.md', '')));

      // Summary without matching plan is suspicious
      for (const sid of summaryIds) {
        if (!planIds.has(sid)) {
          warnings.push(`Summary ${sid}-SUMMARY.md in ${dir} has no matching PLAN.md`);
        }
      }
    }
  } catch { /* intentionally empty */ }

  // Check: frontmatter in plans has required fields
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const dir of dirs) {
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md'));

      for (const plan of plans) {
        const content = fs.readFileSync(path.join(phasesDir, dir, plan), 'utf-8');
        const fm = extractFrontmatter(content);

        if (!fm.wave) {
          warnings.push(`${dir}/${plan}: missing 'wave' in frontmatter`);
        }
      }
    }
  } catch { /* intentionally empty */ }

  const passed = errors.length === 0;
  output({ passed, errors, warnings, warning_count: warnings.length }, raw, passed ? 'passed' : 'failed');
}

function cmdValidateHealth(cwd, options, raw) {
  // Guard: detect if CWD is the home directory (likely accidental)
  const resolved = path.resolve(cwd);
  if (resolved === os.homedir()) {
    output({
      status: 'error',
      errors: [{ code: 'E010', message: `CWD is home directory (${resolved}) — health check would read the wrong .planning/ directory. Run from your project root instead.`, fix: 'cd into your project directory and retry' }],
      warnings: [],
      info: [{ code: 'I010', message: `Resolved CWD: ${resolved}` }],
      repairable_count: 0,
    }, raw);
    return;
  }

  const planBase = planningDir(cwd);
  const planRoot = planningRoot(cwd);
  const projectPath = path.join(planRoot, 'PROJECT.md');
  const roadmapPath = path.join(planBase, 'ROADMAP.md');
  const statePath = path.join(planBase, 'STATE.md');
  const configPath = path.join(planRoot, 'config.json');
  const phasesDir = path.join(planBase, 'phases');

  const errors = [];
  const warnings = [];
  const info = [];
  const repairs = [];

  // Helper to add issue
  const addIssue = (severity, code, message, fix, repairable = false) => {
    const issue = { code, message, fix, repairable };
    if (severity === 'error') errors.push(issue);
    else if (severity === 'warning') warnings.push(issue);
    else info.push(issue);
  };

  // ─── Check 1: .planning/ exists ───────────────────────────────────────────
  if (!fs.existsSync(planBase)) {
    addIssue('error', 'E001', '.planning/ directory not found', 'Run /donny-init to initialize');
    output({
      status: 'broken',
      errors,
      warnings,
      info,
      repairable_count: 0,
    }, raw);
    return;
  }

  // ─── Check 2: PROJECT.md exists and has required sections ─────────────────
  if (!fs.existsSync(projectPath)) {
    addIssue('error', 'E002', 'PROJECT.md not found', 'Run /donny-init to create');
  } else {
    const content = fs.readFileSync(projectPath, 'utf-8');
    const requiredSections = ['## What This Is', '## Core Value', '## Requirements'];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        addIssue('warning', 'W001', `PROJECT.md missing section: ${section}`, 'Add section manually');
      }
    }
  }

  // ─── Check 3: ROADMAP.md exists ───────────────────────────────────────────
  if (!fs.existsSync(roadmapPath)) {
    addIssue('error', 'E003', 'ROADMAP.md not found', 'Run /donny-init to create roadmap');
  }

  // ─── Check 4: STATE.md exists and references valid phases ─────────────────
  if (!fs.existsSync(statePath)) {
    addIssue('error', 'E004', 'STATE.md not found', 'Run /donny-health --repair to regenerate', true);
    repairs.push('regenerateState');
  } else {
    const stateContent = fs.readFileSync(statePath, 'utf-8');
    // Extract phase references from STATE.md
    const phaseRefs = [...stateContent.matchAll(/[Pp]hase\s+(\d+(?:\.\d+)*)/g)].map(m => m[1]);
    // Get disk phases
    const diskPhases = new Set();
    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const m = e.name.match(/^(\d+(?:\.\d+)*)/);
          if (m) diskPhases.add(m[1]);
        }
      }
    } catch { /* intentionally empty */ }
    // Check for invalid references
    for (const ref of phaseRefs) {
      const normalizedRef = String(parseInt(ref, 10)).padStart(2, '0');
      if (!diskPhases.has(ref) && !diskPhases.has(normalizedRef) && !diskPhases.has(String(parseInt(ref, 10)))) {
        // Only warn if phases dir has any content (not just an empty project)
        if (diskPhases.size > 0) {
          addIssue(
            'warning',
            'W002',
            `STATE.md references phase ${ref}, but only phases ${[...diskPhases].sort().join(', ')} exist`,
            'Review STATE.md manually before changing it; /donny-health --repair will not overwrite an existing STATE.md for phase mismatches'
          );
        }
      }
    }
  }

  // ─── Check 5: config.json valid JSON + valid schema ───────────────────────
  if (!fs.existsSync(configPath)) {
    addIssue('warning', 'W003', 'config.json not found', 'Run /donny-health --repair to create with defaults', true);
    repairs.push('createConfig');
  } else {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Validate known fields
      const validProfiles = ['quality', 'balanced', 'budget', 'inherit'];
      if (parsed.model_profile && !validProfiles.includes(parsed.model_profile)) {
        addIssue('warning', 'W004', `config.json: invalid model_profile "${parsed.model_profile}"`, `Valid values: ${validProfiles.join(', ')}`);
      }
    } catch (err) {
      addIssue('error', 'E005', `config.json: JSON parse error - ${err.message}`, 'Run /donny-health --repair to reset to defaults', true);
      repairs.push('resetConfig');
    }
  }

  // ─── Check 5b: Nyquist validation key presence ──────────────────────────
  if (fs.existsSync(configPath)) {
    try {
      const configRaw = fs.readFileSync(configPath, 'utf-8');
      const configParsed = JSON.parse(configRaw);
      if (configParsed.workflow && configParsed.workflow.nyquist_validation === undefined) {
        // Informational, not a defect. Since Phase 24, an absent key resolves through
        // hardcoded defaults and ~/.donny/defaults.json, so absence is the correct state
        // for a project that wants the global value. The old repair wrote the key in,
        // which pinned the project against every future global default for it (D-10).
        addIssue('info', 'W008', 'config.json: workflow.nyquist_validation absent (resolves from ~/.donny/defaults.json or the built-in default of true)', 'No action needed. Set it explicitly only to override the global default.');
      }
    } catch { /* intentionally empty */ }
  }

  // ─── Check 6: Phase directory naming (NN-name format) ─────────────────────
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.match(/^\d{2}(?:\.\d+)*-[\w-]+$/)) {
        addIssue('warning', 'W005', `Phase directory "${e.name}" doesn't follow NN-name format`, 'Rename to match pattern (e.g., 01-setup)');
      }
    }
  } catch { /* intentionally empty */ }

  // ─── Check 7: Orphaned plans (PLAN without SUMMARY) ───────────────────────
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const phaseFiles = fs.readdirSync(path.join(phasesDir, e.name));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
      const summaryBases = new Set(summaries.map(s => s.replace('-SUMMARY.md', '').replace('SUMMARY.md', '')));

      for (const plan of plans) {
        const planBase = plan.replace('-PLAN.md', '').replace('PLAN.md', '');
        if (!summaryBases.has(planBase)) {
          addIssue('info', 'I001', `${e.name}/${plan} has no SUMMARY.md`, 'May be in progress');
        }
      }
    }
  } catch { /* intentionally empty */ }

  // ─── Check 7b: Nyquist VALIDATION.md consistency ────────────────────────
  try {
    const phaseEntries = fs.readdirSync(phasesDir, { withFileTypes: true });
    for (const e of phaseEntries) {
      if (!e.isDirectory()) continue;
      const phaseFiles = fs.readdirSync(path.join(phasesDir, e.name));
      const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md'));
      const hasValidation = phaseFiles.some(f => f.endsWith('-VALIDATION.md'));
      if (hasResearch && !hasValidation) {
        const researchFile = phaseFiles.find(f => f.endsWith('-RESEARCH.md'));
        const researchContent = fs.readFileSync(path.join(phasesDir, e.name, researchFile), 'utf-8');
        if (researchContent.includes('## Validation Architecture')) {
          addIssue('warning', 'W009', `Phase ${e.name}: has Validation Architecture in RESEARCH.md but no VALIDATION.md`, 'Re-run /donny-plan-phase with --research to regenerate');
        }
      }
    }
  } catch { /* intentionally empty */ }

  // ─── Check 7c: Agent installation (#1371) ──────────────────────────────────
  // Verify Donny agents are installed. Missing agents cause Task(subagent_type=...)
  // to silently fall back to general-purpose, losing specialized instructions.
  try {
    const agentStatus = checkAgentsInstalled();
    if (!agentStatus.agents_installed) {
      if (agentStatus.installed_agents.length === 0) {
        addIssue('warning', 'W010',
          `No Donny agents found in ${agentStatus.agents_dir} — Task(subagent_type="donny-*") will fall back to general-purpose`,
          'Run the Donny installer: npx donny-cc@latest');
      } else {
        addIssue('warning', 'W010',
          `Missing ${agentStatus.missing_agents.length} Donny agents: ${agentStatus.missing_agents.join(', ')} — affected workflows will fall back to general-purpose`,
          'Run the Donny installer: npx donny-cc@latest');
      }
    }
  } catch { /* intentionally empty — agent check is non-blocking */ }

  // ─── Check 8: Run existing consistency checks ─────────────────────────────
  // Inline subset of cmdValidateConsistency
  if (fs.existsSync(roadmapPath)) {
    const roadmapContentRaw = fs.readFileSync(roadmapPath, 'utf-8');
    const roadmapContent = extractCurrentMilestone(roadmapContentRaw, cwd);
    const roadmapPhases = new Set();
    const phasePattern = /#{2,4}\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:/gi;
    let m;
    while ((m = phasePattern.exec(roadmapContent)) !== null) {
      roadmapPhases.add(m[1]);
    }

    const diskPhases = new Set();
    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const dm = e.name.match(/^(\d+[A-Z]?(?:\.\d+)*)/i);
          if (dm) diskPhases.add(dm[1]);
        }
      }
    } catch { /* intentionally empty */ }

    // Phases in ROADMAP but not on disk
    for (const p of roadmapPhases) {
      const padded = String(parseInt(p, 10)).padStart(2, '0');
      if (!diskPhases.has(p) && !diskPhases.has(padded)) {
        addIssue('warning', 'W006', `Phase ${p} in ROADMAP.md but no directory on disk`, 'Create phase directory or remove from roadmap');
      }
    }

    // Phases on disk but not in ROADMAP
    for (const p of diskPhases) {
      const unpadded = String(parseInt(p, 10));
      if (!roadmapPhases.has(p) && !roadmapPhases.has(unpadded)) {
        addIssue('warning', 'W007', `Phase ${p} exists on disk but not in ROADMAP.md`, 'Add to roadmap or remove directory');
      }
    }
  }

  // ─── Check 9: STATE.md / ROADMAP.md cross-validation ─────────────────────
  if (fs.existsSync(statePath) && fs.existsSync(roadmapPath)) {
    try {
      const stateContent = fs.readFileSync(statePath, 'utf-8');
      const roadmapContentFull = fs.readFileSync(roadmapPath, 'utf-8');

      // Extract current phase from STATE.md
      const currentPhaseMatch = stateContent.match(/\*\*Current Phase:\*\*\s*(\S+)/i) ||
                                 stateContent.match(/Current Phase:\s*(\S+)/i);
      if (currentPhaseMatch) {
        const statePhase = currentPhaseMatch[1].replace(/^0+/, '');
        // Check if ROADMAP shows this phase as already complete
        const phaseCheckboxRe = new RegExp(`-\\s*\\[x\\].*Phase\\s+0*${escapeRegex(statePhase)}[:\\s]`, 'i');
        if (phaseCheckboxRe.test(roadmapContentFull)) {
          // STATE says "current" but ROADMAP says "complete" — divergence
          const stateStatus = stateContent.match(/\*\*Status:\*\*\s*(.+)/i);
          const statusVal = stateStatus ? stateStatus[1].trim().toLowerCase() : '';
          if (statusVal !== 'complete' && statusVal !== 'done') {
            addIssue('warning', 'W011',
              `STATE.md says current phase is ${statePhase} (status: ${statusVal || 'unknown'}) but ROADMAP.md shows it as [x] complete — state files may be out of sync`,
              'Run /donny:progress to re-derive current position, or manually update STATE.md');
          }
        }
      }
    } catch { /* intentionally empty — cross-validation is advisory */ }
  }

  // ─── Check 10: Config field validation ────────────────────────────────────
  if (fs.existsSync(configPath)) {
    try {
      const configRaw = fs.readFileSync(configPath, 'utf-8');
      const configParsed = JSON.parse(configRaw);

      // Validate branching_strategy
      const validStrategies = ['none', 'phase', 'milestone'];
      if (configParsed.branching_strategy && !validStrategies.includes(configParsed.branching_strategy)) {
        addIssue('warning', 'W012',
          `config.json: invalid branching_strategy "${configParsed.branching_strategy}"`,
          `Valid values: ${validStrategies.join(', ')}`);
      }

      // Validate context_window is a positive integer
      if (configParsed.context_window !== undefined) {
        const cw = configParsed.context_window;
        if (typeof cw !== 'number' || cw <= 0 || !Number.isInteger(cw)) {
          addIssue('warning', 'W013',
            `config.json: context_window should be a positive integer, got "${cw}"`,
            'Set to 200000 (default) or 1000000 (for 1M models)');
        }
      }

      // Validate branch templates have required placeholders
      if (configParsed.phase_branch_template && !configParsed.phase_branch_template.includes('{phase}')) {
        addIssue('warning', 'W014',
          'config.json: phase_branch_template missing {phase} placeholder',
          'Template must include {phase} for phase number substitution');
      }
      if (configParsed.milestone_branch_template && !configParsed.milestone_branch_template.includes('{milestone}')) {
        addIssue('warning', 'W015',
          'config.json: milestone_branch_template missing {milestone} placeholder',
          'Template must include {milestone} for version substitution');
      }
    } catch { /* parse error already caught in Check 5 */ }
  }

  // ─── Perform repairs if requested ─────────────────────────────────────────
  const repairActions = [];
  if (options.repair && repairs.length > 0) {
    for (const repair of repairs) {
      try {
        switch (repair) {
          case 'createConfig':
          case 'resetConfig': {
            // Only the keys /donny-init treats as USER CHOICES, measured from the two
            // config-new-project invocations at init.md:244 and init.md:564. Every other
            // key is an engine default, and writing one here would pin the project
            // against ~/.donny/defaults.json for that key forever (D-17, extending D-10).
            //
            // Dropped from the previous table for exactly that reason: search_gitignored,
            // branching_strategy, phase_branch_template, milestone_branch_template,
            // quick_branch_template, brave_search.
            //
            // createConfig survives at all, where addNyquistKey did not, because a project
            // with NO config.json is a different case from a project with an absent key:
            // it needs some config file to be a project. What changed is how much that
            // file claims.
            const defaults = {
              model_profile: 'balanced',
              commit_docs: true,
              parallelization: true,
              workflow: {
                research: true,
                plan_check: true,
                verifier: true,
                nyquist_validation: true,
              },
            };
            fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
            repairActions.push({ action: repair, success: true, path: 'config.json' });
            break;
          }
          case 'regenerateState': {
            // Create timestamped backup before overwriting
            if (fs.existsSync(statePath)) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
              const backupPath = `${statePath}.bak-${timestamp}`;
              fs.copyFileSync(statePath, backupPath);
              repairActions.push({ action: 'backupState', success: true, path: backupPath });
            }
            // Generate minimal STATE.md from ROADMAP.md structure
            const milestone = getMilestoneInfo(cwd);
            let stateContent = `# Session State\n\n`;
            stateContent += `## Project Reference\n\n`;
            stateContent += `See: .planning/PROJECT.md\n\n`;
            stateContent += `## Position\n\n`;
            stateContent += `**Milestone:** ${milestone.version} ${milestone.name}\n`;
            stateContent += `**Current phase:** (determining...)\n`;
            stateContent += `**Status:** Resuming\n\n`;
            stateContent += `## Session Log\n\n`;
            stateContent += `- ${new Date().toISOString().split('T')[0]}: STATE.md regenerated by /donny-health --repair\n`;
            writeStateMd(statePath, stateContent, cwd);
            repairActions.push({ action: repair, success: true, path: 'STATE.md' });
            break;
          }
        }
      } catch (err) {
        repairActions.push({ action: repair, success: false, error: err.message });
      }
    }
  }

  // ─── Determine overall status ─────────────────────────────────────────────
  let status;
  if (errors.length > 0) {
    status = 'broken';
  } else if (warnings.length > 0) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  const repairableCount = errors.filter(e => e.repairable).length +
                         warnings.filter(w => w.repairable).length;

  output({
    status,
    errors,
    warnings,
    info,
    repairable_count: repairableCount,
    repairs_performed: repairActions.length > 0 ? repairActions : undefined,
  }, raw);
}

/**
 * Validate agent installation status (#1371).
 * Returns detailed information about which agents are installed and which are missing.
 */
function cmdValidateAgents(cwd, raw) {
  const { MODEL_PROFILES } = require('./model-profiles.cjs');
  const agentStatus = checkAgentsInstalled();
  const expected = Object.keys(MODEL_PROFILES);

  output({
    agents_dir: agentStatus.agents_dir,
    agents_found: agentStatus.agents_installed,
    installed: agentStatus.installed_agents,
    missing: agentStatus.missing_agents,
    expected,
  }, raw);
}

// ─── Schema Drift Detection ──────────────────────────────────────────────────

function cmdVerifySchemaDrift(cwd, phaseArg, skipFlag, raw) {
  const { detectSchemaFiles, checkSchemaDrift } = require('./schema-detect.cjs');

  if (!phaseArg) {
    error('Usage: verify schema-drift <phase> [--skip]');
    return;
  }

  // Find phase directory
  const pDir = planningDir(cwd);
  const phasesDir = path.join(pDir, 'phases');
  if (!fs.existsSync(phasesDir)) {
    output({ drift_detected: false, blocking: false, message: 'No phases directory' }, raw);
    return;
  }

  // Find matching phase directory
  let phaseDir = null;
  const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.includes(phaseArg)) {
      phaseDir = path.join(phasesDir, entry.name);
      break;
    }
  }

  // Also try exact match
  if (!phaseDir) {
    const exact = path.join(phasesDir, phaseArg);
    if (fs.existsSync(exact)) phaseDir = exact;
  }

  if (!phaseDir) {
    output({ drift_detected: false, blocking: false, message: `Phase directory not found: ${phaseArg}` }, raw);
    return;
  }

  // Collect files_modified from all PLAN.md files in the phase
  const allFiles = [];
  const planFiles = fs.readdirSync(phaseDir).filter(f => f.endsWith('-PLAN.md'));
  for (const pf of planFiles) {
    const content = fs.readFileSync(path.join(phaseDir, pf), 'utf-8');
    // Extract files_modified from frontmatter
    const fmMatch = content.match(/files_modified:\s*\[([^\]]*)\]/);
    if (fmMatch) {
      const files = fmMatch[1].split(',').map(f => f.trim()).filter(Boolean);
      allFiles.push(...files);
    }
  }

  // Collect execution log from SUMMARY.md files
  let executionLog = '';
  const summaryFiles = fs.readdirSync(phaseDir).filter(f => f.endsWith('-SUMMARY.md'));
  for (const sf of summaryFiles) {
    executionLog += fs.readFileSync(path.join(phaseDir, sf), 'utf-8') + '\n';
  }

  // Also check git commit messages for push evidence
  const gitLog = execGit(cwd, ['log', '--oneline', '--all', '-50']);
  if (gitLog.exitCode === 0) {
    executionLog += '\n' + gitLog.stdout;
  }

  const result = checkSchemaDrift(allFiles, executionLog, { skipCheck: !!skipFlag });

  output({
    drift_detected: result.driftDetected,
    blocking: result.blocking,
    schema_files: result.schemaFiles,
    orms: result.orms,
    unpushed_orms: result.unpushedOrms,
    message: result.message,
    skipped: result.skipped || false,
  }, raw);
}

module.exports = {
  captureVerb,
  expandHomePath,
  GATE_VERBS,
  classifyVerbResult,
  filterCoverageToPhase,
  canonPhaseNum,
  harvestCommitHashes,
  runGate,
  renderRecordsMd,
  writeRecordsFile,
  readRecordsVerdict,
  cmdVerifyGate,
  splitTableRow,
  isSeparatorRow,
  cmdVerifySummary,
  cmdVerifyPlanStructure,
  validatePlanGraph,
  cmdVerifyPlanGraph,
  phaseVerificationVerdict,
  cmdVerifyPhaseVerified,
  uiReviewVerdict,
  cmdVerifyUiReviewed,
  threatRegisterStatus,
  cmdVerifyThreatsClear,
  requirementCoverageStatus,
  aggregateCoverage,
  cmdVerifyMilestoneCoverage,
  cmdVerifyPhaseCompleteness,
  cmdVerifyReferences,
  cmdVerifyCommits,
  cmdVerifyArtifacts,
  cmdVerifyKeyLinks,
  cmdValidateConsistency,
  cmdValidateHealth,
  cmdValidateAgents,
  cmdVerifySchemaDrift,
};
