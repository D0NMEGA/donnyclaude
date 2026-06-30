/**
 * Verify — Verification suite, consistency, and health validation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeReadFile, loadConfig, normalizePhaseName, escapeRegex, execGit, findPhaseInternal, getMilestoneInfo, stripShippedMilestones, extractCurrentMilestone, planningDir, planningRoot, output, error, checkAgentsInstalled } = require('./core.cjs');
const { extractFrontmatter, parseMustHavesBlock } = require('./frontmatter.cjs');
const { writeStateMd } = require('./state.cjs');

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

  if (missing.length > 0) errors.push('Missing files: ' + missing.join(', '));
  if (!commitsExist && hashes.length > 0) errors.push('Referenced commit hashes not found in git history');
  if (selfCheck === 'failed') errors.push('Self-check section indicates failure');

  const checks = {
    summary_exists: true,
    files_created: { checked: filesToCheck.length, found: filesToCheck.length - missing.length, missing },
    commits_exist: commitsExist,
    self_check: selfCheck,
  };

  const passed = missing.length === 0 && selfCheck !== 'failed';
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

    const artFullPath = path.join(cwd, artPath);
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
        addIssue('warning', 'W008', 'config.json: workflow.nyquist_validation absent (defaults to enabled but agents may skip)', 'Run /donny-health --repair to add key', true);
        if (!repairs.includes('addNyquistKey')) repairs.push('addNyquistKey');
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
            const defaults = {
              model_profile: 'balanced',
              commit_docs: true,
              search_gitignored: false,
              branching_strategy: 'none',
              phase_branch_template: 'donny/phase-{phase}-{slug}',
              milestone_branch_template: 'donny/{milestone}-{slug}',
              quick_branch_template: null,
              workflow: {
                research: true,
                plan_check: true,
                verifier: true,
                nyquist_validation: true,
              },
              parallelization: true,
              brave_search: false,
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
          case 'addNyquistKey': {
            if (fs.existsSync(configPath)) {
              try {
                const configRaw = fs.readFileSync(configPath, 'utf-8');
                const configParsed = JSON.parse(configRaw);
                if (!configParsed.workflow) configParsed.workflow = {};
                if (configParsed.workflow.nyquist_validation === undefined) {
                  configParsed.workflow.nyquist_validation = true;
                  fs.writeFileSync(configPath, JSON.stringify(configParsed, null, 2), 'utf-8');
                }
                repairActions.push({ action: repair, success: true, path: 'config.json' });
              } catch (err) {
                repairActions.push({ action: repair, success: false, error: err.message });
              }
            }
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
