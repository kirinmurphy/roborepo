#!/usr/bin/env node
// Repository rename/migration engine. Driven entirely by rename/manifest.json — no name
// knowledge lives in this file, so the same tool serves any future naming change.
//
//   node rename/rename.mjs --check                                  scan only, exit 1 if work remains
//   node rename/rename.mjs --dry-run --new-lowercaseName=<new>      full plan, no writes
//   node rename/rename.mjs --apply --new-lowercaseName=<new>        write changes (git-tracked only)
//   ... --new-displayName=<new> --new-packageName=<id> --new-configDir=<dir> --new-repoUrl=<url>
//   ... --ack                                    also rewrite AMBIGUOUS sweep matches
//   ... --include-generated                      also edit excluded generated/ output
//
// Strategy:
//   1. RULES — explicit, deterministic span claims. Every rule match is CLAIMED in every scanned
//      file regardless of whether its replacement differs: claiming prevents the case-variant
//      sweep from partially renaming inside protected identifiers (npm package name, GitHub
//      URLs, schema domains). A rule whose replacement equals its match is an
//      intentionally-unchanged claim; a rule whose target identity field has no new value is a
//      pending decision (claimed, reported, left alone).
//   2. SWEEP — case-variant discovery over unclaimed spans in live files, catching organic prose
//      (README, docs, comments, portal copy, usage strings). Canonical case arrangements map to
//      the new names; anything else is AMBIGUOUS and never rewritten without --ack.
//   3. PATHS — tracked files/dirs whose paths contain a replaced token are git-mv'd (directory
//      renames collapsed from their files); symlink LINK TEXT is rewritten, never followed.
// Exclusions (git internals, vendor, historical plan docs, generated output, binaries, the
// rename/ tooling itself) are manifest-configured. Apply only touches git-tracked files.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = path.join(REPO_ROOT, "rename", "manifest.json");

// ---------- helpers ----------

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function titleCase(lower) {
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Variant regex: case-insensitive match of the base name where every "o" accepts either case —
// covers ROBOREPO / RoboRepo / Roborepo / roborepo for the default name and generalizes to any
// all-lowercase base. Non-enumerated case mixes (RoBoRePo) still match the regex but classify
// as ambiguous downstream.
export function variantRegExp(lower) {
  return new RegExp(escapeRegExp(lower).replace(/o/gi, "[oO]"), "gi");
}

// ---------- identity + manifest resolution ----------

export function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

// Parse --new-<field>=<value> argv entries into a new-identity map.
export function parseNewIdentity(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--new-([A-Za-z]\w*)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Resolve the NEW value for an identity field: explicit --new-* wins; uppercaseName derives
// from a new lowercaseName; otherwise the current value (no change); a missing required field
// is a hard error.
export function resolveNewValue(manifest, newIdentity, field) {
  if (newIdentity[field] != null) return newIdentity[field];
  if (field === "uppercaseName" && newIdentity.lowercaseName != null) return newIdentity.lowercaseName.toUpperCase();
  if (field === "displayName" && newIdentity.lowercaseName != null && manifest.identity.displayName?.current == null) {
    return titleCase(newIdentity.lowercaseName);
  }
  const current = manifest.identity[field]?.current;
  if (current == null) {
    if (manifest.identity[field]?.requiredForApply) {
      throw new Error(`identity.${field} is requiredForApply but has no current value and no --new-${field} was supplied`);
    }
    return null; // intentionally unset -> claim-only / pending decision
  }
  return current;
}

// Render {{field}} templates. `current=true` reads identity.current (for rule MATCHES);
// `current=false` prefers new values (for rule REPLACEMENTS), falling back to current.
export function renderTemplate(tpl, manifest, newIdentity, { current }) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, field) => {
    const value = current
      ? manifest.identity[field]?.current
      : (resolveNewValue(manifest, newIdentity, field) ?? manifest.identity[field]?.current);
    if (value == null) throw new Error(`manifest identity field missing: ${field} (template: ${tpl})`);
    return value;
  });
}

// Instantiate rules: {id, match, replace, claimOnly, note}. `replace` is the resolved literal
// replacement, or null when the rule is a pending decision.
export function buildRules(manifest, newIdentity = {}) {
  return manifest.rules.map((rule) => {
    const match = renderTemplate(rule.match, manifest, newIdentity, { current: true });
    const replacement = rule.claimOnly ? null : renderTemplate(rule.replace, manifest, newIdentity, { current: false });
    const pending = !rule.claimOnly && (replacement == null || replacement === match);
    return { id: rule.id, match, replacement: pending ? null : replacement, pending, note: rule.note || "" };
  });
}

// ---------- span claiming ----------

// Claim non-overlapping spans for all rule matches (longest/earliest wins; later overlapping
// matches are dropped). Claims exist to SHIELD spans from the sweep, whether or not the rule
// actually replaces them.
export function claimSpans(text, rules) {
  const spans = [];
  for (const rule of rules) {
    const re = new RegExp(escapeRegExp(rule.match), "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, rule });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const claimed = [];
  let lastEnd = -1;
  for (const span of spans) {
    if (span.start >= lastEnd) {
      claimed.push(span);
      lastEnd = span.end;
    }
  }
  return claimed;
}

// Rebuild text from ordered edit spans ({start, end, replacement}).
export function applySpanEdits(text, spans) {
  let out = "";
  let pos = 0;
  for (const span of spans) {
    out += text.slice(pos, span.start);
    out += span.replacement;
    pos = span.end;
  }
  out += text.slice(pos);
  return out;
}

// ---------- sweep classification ----------

// Classify one case-variant hit. `newLower` null means no rename is requested: every hit is
// intentionally unchanged. Returns {classification, replacement} where classification is
// "safe" | "ambiguous" | "unchanged".
export function classifyVariantHit(hit, identity, newLower, mapTitleCaseToDisplay = true) {
  const lower = identity.lowercaseName.current;
  const display = identity.displayName?.current ?? titleCase(lower);
  if (newLower == null) return { classification: "unchanged", replacement: null };
  const newDisplay = newIdentityDisplay(identity, newLower);
  if (hit === lower) return { classification: "safe", replacement: newLower };
  if (hit === display || (mapTitleCaseToDisplay && hit === titleCase(lower))) {
    return { classification: "safe", replacement: newDisplay };
  }
  if (hit === lower.toUpperCase()) return { classification: "safe", replacement: newLower.toUpperCase() };
  return { classification: "ambiguous", replacement: null };
}

function newIdentityDisplay(identity, newLower) {
  // Display-name derivation: the current display is title-case of the current lower name
  // (verified relationship in this repo), so the new display is title-case of the new lower
  // name. A future distinct display word should be supplied via --new-displayName and added
  // to identity if it becomes a real concept.
  return titleCase(newLower);
}

export function sweepSegment(segStart, segText, identity, newIdentity, { mapTitleCaseToDisplay = true } = {}) {
  const lower = identity.lowercaseName.current;
  const newLower = newIdentity.lowercaseName ?? null;
  const re = variantRegExp(lower);
  const hits = [];
  let m;
  while ((m = re.exec(segText)) !== null) {
    const { classification, replacement } = classifyVariantHit(m[0], identity, newLower, mapTitleCaseToDisplay);
    hits.push({
      start: segStart + m.index,
      end: segStart + m.index + m[0].length,
      match: m[0],
      replacement: classification === "safe" ? replacement : null,
      classification,
      rule: "sweep",
    });
  }
  return hits;
}

// ---------- file scan ----------

// Scan one file's text: claim rule spans, sweep the unclaimed segments. Returns entries:
// explicit claims (classification "explicit" when changing, "pending" or
// "intentionally-unchanged" otherwise) and sweep hits.
export function scanText(text, rules, manifest, newIdentity) {
  const claimed = claimSpans(text, rules);
  const explicit = [];
  const sweep = [];
  let cursor = 0;
  const pushSweep = (start, end) => {
    if (end > start) sweep.push(...sweepSegment(start, text.slice(start, end), manifest.identity, newIdentity, { mapTitleCaseToDisplay: manifest.sweep?.mapTitleCaseToDisplay !== false }));
  };
  for (const span of claimed) {
    pushSweep(cursor, span.start);
    if (span.rule.pending) {
      explicit.push({ start: span.start, end: span.end, match: text.slice(span.start, span.end), replacement: null, rule: span.rule.id, classification: "pending" });
    } else if (span.rule.replacement !== span.rule.match && span.rule.replacement != null) {
      explicit.push({ start: span.start, end: span.end, match: text.slice(span.start, span.end), replacement: span.rule.replacement, rule: span.rule.id, classification: "explicit" });
    } else {
      explicit.push({ start: span.start, end: span.end, match: text.slice(span.start, span.end), replacement: null, rule: span.rule.id, classification: "intentionally-unchanged" });
    }
    cursor = span.end;
  }
  pushSweep(cursor, text.length);
  return { explicit, sweep };
}

// ---------- path mapping ----------

// Map a tracked path through active rule replacements + the case-variant sweep. Returns
// { to, ambiguous } — `to` null when unchanged. Ambiguous case mixes are never auto-renamed.
export function mapTrackedPath(relPath, rules, identity, newIdentity, { mapTitleCaseToDisplay = true } = {}) {
  const lower = identity.lowercaseName.current;
  const newLower = newIdentity.lowercaseName ?? null;
  let out = relPath;
  for (const rule of rules) {
    if (rule.replacement != null && rule.replacement !== rule.match) out = out.split(rule.match).join(rule.replacement);
  }
  if (newLower) {
    const re = variantRegExp(lower);
    let ambiguous = false;
    out = out.replace(re, (hit) => {
      const { classification, replacement } = classifyVariantHit(hit, identity, newLower, mapTitleCaseToDisplay);
      if (classification === "safe") return replacement;
      ambiguous = true;
      return hit;
    });
    if (ambiguous && out === relPath) return { to: null, ambiguous: true };
    return { to: out !== relPath ? out : null, ambiguous };
  }
  return { to: out !== relPath ? out : null, ambiguous: false };
}

// Compute the git-mv plan: collapse file moves under a commonly-renamed directory into ONE
// directory rename (git mv on the dir), shallowest first, with collision protection.
export function computePathRenames(trackedPaths, rules, manifest, newIdentity, { exists = (p) => fs.existsSync(p), join = path.join } = {}) {
  const candidates = [];
  let ambiguousPaths = 0;
  for (const rel of trackedPaths) {
    const { to, ambiguous } = mapTrackedPath(rel, rules, manifest.identity, newIdentity, { mapTitleCaseToDisplay: manifest.sweep?.mapTitleCaseToDisplay !== false });
    if (ambiguous) ambiguousPaths++;
    if (to) candidates.push({ from: rel, to, depth: rel.split("/").length });
  }
  // Directory collapsing: if every candidate under some directory prefix shares one mapping,
  // replace them with a single rename of the prefix. Walk shallowest-first.
  const dirs = new Set();
  for (const c of candidates) {
    const parts = c.from.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const renames = [];
  const movedFrom = [];
  const byDepth = [...candidates].sort((a, b) => a.depth - b.depth || a.from.localeCompare(b.from));
  const consumed = new Set();
  for (const dir of [...dirs].sort((a, b) => a.split("/").length - b.split("/").length)) {
    const under = byDepth.filter((c) => !consumed.has(c.from) && c.from.startsWith(dir + "/"));
    if (under.length < 2) continue;
    const mapped = mapTrackedPath(dir, rules, manifest.identity, newIdentity, { mapTitleCaseToDisplay: manifest.sweep?.mapTitleCaseToDisplay !== false });
    if (!mapped.to) continue;
    const relOf = (p) => p.slice(dir.length + 1);
    const consistent = under.every((c) => {
      const mappedChild = mapTrackedPath(c.from, rules, manifest.identity, newIdentity, { mapTitleCaseToDisplay: manifest.sweep?.mapTitleCaseToDisplay !== false }).to;
      return mappedChild === mapped.to + "/" + relOf(c.from);
    });
    if (consistent) {
      renames.push({ from: dir, to: mapped.to, dir: true });
      movedFrom.push({ from: dir, to: mapped.to });
      for (const c of under) consumed.add(c.from);
    }
  }
  for (const c of byDepth) {
    if (consumed.has(c.from)) continue;
    const ancestor = movedFrom.find((m) => c.from.startsWith(m.from + "/"));
    if (ancestor) continue; // moves with the directory rename
    renames.push({ from: c.from, to: c.to, dir: false });
    movedFrom.push({ from: c.from, to: c.to });
  }
  // Collision check: two renames onto the same target, or a target that already exists.
  const targets = new Set();
  const safe = [];
  for (const r of renames) {
    if (targets.has(r.to) || exists(join(r.to))) {
      r.skipped = "target exists";
    } else {
      targets.add(r.to);
    }
    safe.push(r);
  }
  return { renames: safe, ambiguousPaths };
}

// ---------- exclusions ----------

export function pathExclusion(manifest, relPath, { includeGenerated = false } = {}) {
  const p = relPath.replaceAll("\\", "/");
  for (const ex of manifest.exclusions.paths) if (p.startsWith(ex)) return `path exclusion ${ex}`;
  for (const ex of manifest.exclusions.historical || []) if (p.startsWith(ex)) return `historical ${ex}`;
  if (!includeGenerated) {
    for (const ex of manifest.exclusions.generated || []) if (p.startsWith(ex)) return `generated ${ex} (regenerate, or --include-generated)`;
  }
  const ext = path.extname(p).toLowerCase();
  if ((manifest.binaryExtensions || []).includes(ext)) return `binary ${ext}`;
  return null;
}

// ---------- CLI ----------

function isMain() {
  try {
    return fs.realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function gitOut(cmdArgs) {
  return execFileSync("git", cmdArgs, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readForScan(abs) {
  try {
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) return fs.readlinkSync(abs); // scan the LINK TEXT, not the target
    return fs.readFileSync(abs, "utf8");
  } catch {
    return ""; // unreadable/binary — nothing to scan
  }
}

function run({ mode, newIdentity, ack = false, includeGenerated = false }) {
  const manifest = loadManifest();
  const rules = buildRules(manifest, newIdentity);
  const files = gitOut(["ls-files", "-z"]).split("\0").filter(Boolean);

  const plan = { files: [], excludedFiles: [] };
  const summary = { explicit: 0, sweepSafe: 0, ambiguous: 0, pending: 0, unchanged: 0 };
  for (const rel of files) {
    let stat;
    try {
      stat = fs.lstatSync(path.join(REPO_ROOT, rel));
    } catch {
      continue; // deleted in working tree
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    const excluded = pathExclusion(manifest, rel, { includeGenerated });
    if (excluded) {
      plan.excludedFiles.push({ path: rel, reason: excluded });
      continue;
    }
    const text = readForScan(path.join(REPO_ROOT, rel));
    const { explicit, sweep } = scanText(text, rules, manifest, newIdentity);
    if (!explicit.length && !sweep.length) continue;
    plan.files.push({ path: rel, explicit, sweep });
    for (const e of explicit) summary[e.classification === "explicit" ? "explicit" : e.classification === "pending" ? "pending" : "unchanged"]++;
    for (const s of sweep) summary[s.classification === "safe" ? "sweepSafe" : s.classification === "ambiguous" ? "ambiguous" : "unchanged"]++;
  }

  const { renames: pathRenames, ambiguousPaths } = computePathRenames(files.filter((rel) => !pathExclusion(manifest, rel, { includeGenerated })), rules, manifest, newIdentity);

  // Pending decisions = pending rule claims + unset identity fields the user may want to set.
  const pendingFields = Object.entries(manifest.identity)
    .filter(([field, spec]) => !spec.requiredForApply && newIdentity[field] == null)
    .map(([field]) => field);

  report({ mode, plan, summary, pathRenames, ambiguousPaths, pendingFields });

  if (mode === "check") {
    const work = summary.explicit + summary.sweepSafe + summary.ambiguous + pathRenames.filter((r) => !r.skipped).length;
    process.exit(work > 0 ? 1 : 0);
  }
  if (mode === "dry-run") process.exit(0);

  if (summary.ambiguous > 0 && !ack) {
    console.error(`\nrefusing to apply: ${summary.ambiguous} AMBIGUOUS sweep match(es). Re-run with --ack to rewrite them too.`);
    process.exit(2);
  }

  // APPLY: content edits first (old paths), then git mv.
  let written = 0;
  for (const f of plan.files) {
    const abs = path.join(REPO_ROOT, f.path);
    const text = readForScan(abs);
    const spans = [
      ...f.explicit.filter((e) => e.classification === "explicit").map((e) => ({ start: e.start, end: e.end, replacement: e.replacement })),
      ...f.sweep
        .filter((s) => s.classification === "safe" || (ack && s.classification === "ambiguous"))
        .map((s) => ({ start: s.start, end: s.end, replacement: s.replacement })),
    ]
      .filter((s) => s.replacement != null)
      .sort((a, b) => a.start - b.start);
    const next = applySpanEdits(text, spans);
    if (next === text) continue;
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      // Rewrite the LINK TEXT, never the target (harness skill-dir symlinks).
      const type = stat.isDirectory() ? "dir" : "file";
      fs.unlinkSync(abs);
      fs.symlinkSync(next, abs, type);
    } else {
      fs.writeFileSync(abs, next);
    }
    written++;
  }
  let moved = 0;
  for (const r of pathRenames) {
    if (r.skipped) continue;
    const absTo = path.join(REPO_ROOT, r.to);
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    execFileSync("git", ["mv", r.from, r.to], { cwd: REPO_ROOT });
    moved++;
  }
  // Rewrite identity.current so the manifest reflects the new state (rules re-render against
  // it on the next run). rename/manifest.json is excluded from sweeping, so this is the ONLY
  // path that updates it — done here, deliberately, not by blind text replacement.
  const manifestAbs = MANIFEST_PATH;
  const nextManifest = JSON.parse(fs.readFileSync(manifestAbs, "utf8"));
  for (const field of Object.keys(nextManifest.identity)) {
    const next = resolveNewValue(nextManifest, newIdentity, field);
    if (next != null) nextManifest.identity[field].current = next;
  }
  fs.writeFileSync(manifestAbs, JSON.stringify(nextManifest, null, 2) + "\n");
  console.log(`\napplied: ${written} file(s) edited, ${moved} path(s) renamed, manifest identity updated.`);
  console.log("next: re-run --check to verify; regenerate generated/ output in a dev checkout; review backCompat in the manifest.");
}

function report({ mode, plan, summary, pathRenames, ambiguousPaths, pendingFields }) {
  console.log(`rename plan (${mode}) — manifest: rename/manifest.json`);
  console.log(`  explicit replacements: ${summary.explicit}`);
  console.log(`  discovered sweep replacements: ${summary.sweepSafe}`);
  console.log(`  ambiguous (require --ack): ${summary.ambiguous}${ambiguousPaths ? ` (+${ambiguousPaths} ambiguous path segment(s), never auto-renamed)` : ""}`);
  console.log(`  pending decisions (claimed, unchanged): ${summary.pending}`);
  console.log(`  intentionally-unchanged claims: ${summary.unchanged}`);
  console.log(`  path renames: ${pathRenames.filter((r) => !r.skipped).length}${pathRenames.some((r) => r.skipped) ? ` (${pathRenames.filter((r) => r.skipped).length} skipped: target exists)` : ""}`);
  console.log(`  excluded files (historical/generated/binary/vendor): ${plan.excludedFiles.length}`);
  if (pendingFields.length && (summary.explicit || summary.sweepSafe || mode !== "check")) {
    console.log(`  unset identity fields (pass --new-<field>= to include): ${pendingFields.join(", ")}`);
  }
  if (mode === "check") {
    const perFile = plan.files.filter((f) => f.explicit.some((e) => e.classification !== "intentionally-unchanged") || f.sweep.some((s) => s.classification !== "unchanged"));
    console.log(`  files with pending work: ${perFile.length}`);
    return;
  }
  for (const f of plan.files) {
    const changes = [
      ...f.explicit.filter((e) => e.classification !== "intentionally-unchanged").map((e) => ({ line: lineOf(f.path, e.start), kind: e.classification, rule: e.rule, match: e.match, to: e.replacement })),
      ...f.sweep.filter((s) => s.classification !== "unchanged").map((s) => ({ line: lineOf(f.path, s.start), kind: s.classification, rule: "sweep", match: s.match, to: s.replacement })),
    ];
    if (!changes.length) continue;
    console.log(`\n${f.path}`);
    for (const c of changes.slice(0, 200)) {
      console.log(`  L${c.line} [${c.kind}${c.rule !== "sweep" ? ` ${c.rule}` : ""}] ${JSON.stringify(c.match)} -> ${JSON.stringify(c.to)}`);
    }
    if (changes.length > 200) console.log(`  ... ${changes.length - 200} more`);
  }
  if (pathRenames.length) {
    console.log("\npath renames:");
    for (const r of pathRenames) console.log(`  ${r.from} -> ${r.to}${r.dir ? " (directory)" : ""}${r.skipped ? ` [SKIPPED: ${r.skipped}]` : ""}`);
  }
}

const lineIndexCache = new Map();
function lineOf(relPath, offset) {
  if (!lineIndexCache.has(relPath)) {
    try {
      const text = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      const lines = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === "\n") lines.push(i + 1);
      lineIndexCache.set(relPath, lines);
    } catch {
      lineIndexCache.set(relPath, [0]);
    }
  }
  const lines = lineIndexCache.get(relPath);
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--") && !a.startsWith("--new-")));
  if (flags.has("--help") || flags.has("-h") || args.length === 0) {
    console.log(`usage: node rename/rename.mjs [--check|--dry-run|--apply] [--new-<field>=<value> ...] [--ack] [--include-generated]
  --check              scan only; exit 1 when renamable references remain (default)
  --dry-run            print the full plan without writing anything
  --apply              write changes to git-tracked files (git mv for path renames)
  --new-<field>=<v>    new identity value, e.g. --new-lowercaseName=newname --new-displayName="New Name"
  --ack                required to also rewrite AMBIGUOUS sweep matches during --apply
  --include-generated  include generated/ output in edits (normally excluded; regenerate instead)`);
    process.exit(args.length === 0 ? 1 : 0);
  }
  const mode = flags.has("--apply") ? "apply" : flags.has("--dry-run") ? "dry-run" : "check";
  run({
    mode,
    newIdentity: parseNewIdentity(args),
    ack: flags.has("--ack"),
    includeGenerated: flags.has("--include-generated"),
  });
}
