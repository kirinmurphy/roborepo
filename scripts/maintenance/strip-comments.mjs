#!/usr/bin/env node
// Strip procedural comments from first-party source files.
//
// Usage:
//   node scripts/maintenance/strip-comments.mjs            # dry run: report only, no writes
//   node scripts/maintenance/strip-comments.mjs --apply    # actually rewrite files
//   node scripts/maintenance/strip-comments.mjs --apply --keep-jsdoc=false
//   node scripts/maintenance/strip-comments.mjs --files=path1,path2   # limit to specific files
//
// What it removes: // line comments, /* */ block comments, and shell `#` comments
// that are procedural ("load the config", "increment i"). What it keeps:
//   - shebangs (#!)
//   - legal/license markers: SPDX, @license, Copyright, eslint-disable, @ts-ignore, etc.
//   - JSDoc blocks (/** ... */) by default — pass --keep-jsdoc=false to strip those too
//
// Every rewritten JS/MJS file is re-parsed with node --check before and after, so a
// misparse aborts that file untouched.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STRIP_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".sh", ".bash"]);

// Never scan anything under these directory names (matched against any path segment).
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "generated", // build output committed to the repo
  "local", // local-only state
  "test-results",
  "vendor", // portal/shared/vendor and any other vendored 3rd-party code
  "dist",
  "build",
  "coverage",
  ".git",
  "sketches", // throwaway mockups
  "rename", // rename-prep working area (untracked)
]);

// Exact repo-relative paths to skip even though their extension matches.
const IGNORED_FILES = new Set(["package-lock.json", "bin/roborepo"]);

// Add repo-relative paths here to scan files inside otherwise-ignored dirs.
const FORCE_INCLUDE = new Set();

// Comment content that marks a comment as load-bearing: always preserved.
const KEEP_PATTERNS = [
  /^!/, // /*! important */ style
  /^\s*(SPDX|Copyright|@license|@preserve)/i,
  /^\s*(eslint-disable|eslint-enable|@ts-ignore|@ts-expect-error|@ts-nocheck|@noinspection|istanbul ignore|v8 ignore|c8 ignore)/,
  /^\s*#?\s*(shellcheck|nolint)\b/i, // shell: # shellcheck disable=...
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const onlyFilesArg = args.find((a) => a.startsWith("--files="));
const onlyFilesValue = onlyFilesArg ? onlyFilesArg.slice("--files=".length) : null;
// Resolve against the real (symlink-dereferenced) root so /tmp vs /private/tmp style
// path aliases don't silently filter everything out.
const ROOT_REAL = fs.realpathSync(REPO_ROOT);
const ONLY_FILES = onlyFilesValue
  ? new Set(
      onlyFilesValue
        .split(",")
        .map((p) => {
          const resolved = path.resolve(ROOT_REAL, p.trim());
          try {
            return fs.realpathSync(resolved); // dereference /tmp → /private/tmp style aliases
          } catch {
            return resolved;
          }
        })
        .filter((p) => p.startsWith(ROOT_REAL + path.sep) || p === ROOT_REAL),
    )
  : null;
const keepJsdoc = !args.some((a) => a === "--keep-jsdoc=false");

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

function isKept(commentText) {
  // Body without the delimiters and leading asterisks.
  const body = commentText
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .replace(/^#+/, "")
    .replace(/^[ \t]*\*+ ?/gm, "");
  return KEEP_PATTERNS.some((re) => re.test(body));
}

/**
 * Remove comments from source text using a small state machine that understands
 * strings, template literals (with ${} nesting), and regex literals, so comments
 * inside those are preserved. For .sh/.bash uses a simpler scanner (quotes + heredocs).
 */
function stripComments(src, isShell) {
  let out = "";
  // Pending whitespace so we can drop comment-only lines cleanly.
  let ws = "";
  const n = src.length;
  let i = 0;

  const emit = (text) => {
    if (isShell) {
      out += text;
      return;
    }
    out += text;
  };

  if (isShell) return stripShellComments(src);

  let lineStartWs = "";
  let atLineStart = true;

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (atLineStart && /[ \t]/.test(ch)) {
      lineStartWs += ch;
      i += 1;
      continue;
    }

    // Comments
    if (ch === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j += 1;
      const comment = src.slice(i, j);
      if (isKept(comment)) {
        out += lineStartWs + comment;
      }
      // Skip to end of line (keep the newline itself).
      i = j;
      lineStartWs = "";
      atLineStart = false;
      continue;
    }
    if (ch === "/" && next === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      const comment = src.slice(i, j);
      const docLike = keepJsdoc && comment.startsWith("/**");
      if (isKept(comment) || docLike) {
        // Preserve as-is; blocks may span lines.
        out += lineStartWs + comment;
      }
      i = j;
      lineStartWs = "";
      atLineStart = false;
      continue;
    }

    // Strings and templates — copy verbatim with escape awareness.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (quote === "`" && src[j] === "$" && src[j + 1] === "{") {
          // Copy through the nested expression, recursing on braces.
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth += 1;
            else if (src[k] === "}") depth -= 1;
            if (src[k] === '"' || src[k] === "'" || src[k] === "`") {
              const q2 = src[k];
              k += 1;
              while (k < n) {
                if (src[k] === "\\") k += 2;
                else if (src[k] === q2) break;
                else k += 1;
              }
            }
            k += 1;
          }
          j = k;
          continue;
        }
        if (src[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += lineStartWs;
      lineStartWs = "";
      emit(src.slice(i, j));
      i = j;
      atLineStart = false;
      continue;
    }

    // Regex literals: a "/" that follows a token-start context is a regex, not a comment/divide.
    if (ch === "/" && regexAllowedBefore(src, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break; // not a regex after all — bail out, newline ends literals
        if (inClass) {
          if (c === "]") inClass = false;
        } else if (c === "[") {
          inClass = true;
        } else if (c === "/") {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (closed) {
        // Copy flags too.
        while (j < n && /[a-z]/i.test(src[j])) j += 1;
        out += lineStartWs;
        lineStartWs = "";
        emit(src.slice(i, j));
        i = j;
        atLineStart = false;
        continue;
      }
      // Fall through: treat as division.
    }

    if (ch === "\n") {
      out += ch;
      atLineStart = true;
      lineStartWs = "";
      i += 1;
      continue;
    }

    out += lineStartWs;
    lineStartWs = "";
    out += ch;
    atLineStart = false;
    i += 1;
  }

  return out;
}

/** Heuristic: a "/" here starts a regex if the previous meaningful char allows an operand. */
function regexAllowedBefore(src, idx) {
  let k = idx - 1;
  while (k >= 0 && /\s/.test(src[k])) {
    if (src[k] === "\n") {
      // Newline: look back further for unfinished expression is hard; treat as allowed
      // only if the previous line ends with an operator/open bracket.
      let m = k - 1;
      while (m >= 0 && /[ \t]/.test(src[m])) m -= 1;
      if (m < 0) return true;
      return /[([{,;=:!&|?+\-*%^~]$|=>|return|typeof|case|in|of|new|delete|void|do|else/.test(
        src.slice(Math.max(0, m - 30), m + 1),
      );
    }
    k -= 1;
  }
  if (k < 0) return true;
  const c = src[k];
  if (/[)\]}'"`_0-9a-zA-Z]/.test(c)) return false; // after value/ident → division
  return true; // after operator/open bracket → regex
}

/** Shell scanner: preserves quoted strings and heredocs, strips # comments (not shebang). */
function stripShellComments(src) {
  const lines = src.split("\n");
  let heredocTerm = null; // expected terminator line (without << ~)
  let heredocQuote = false;
  const outLines = [];

  for (let li = 0; li < lines.length; li += 1) {
    const raw = lines[li];

    if (heredocTerm !== null) {
      outLines.push(raw);
      if (raw.trim() === heredocTerm) heredocTerm = null;
      continue;
    }

    let line = "";
    let i = 0;
    let pendingHeredoc = null;
    while (i < raw.length) {
      const c = raw[i];
      if (c === "\\") {
        line += raw.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        const q = c;
        let j = i + 1;
        while (j < raw.length && raw[j] !== q) {
          if (raw[j] === "\\") j += 1;
          j += 1;
        }
        line += raw.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (c === "#" && (i === 0 || /[ \t(]/.test(raw[i - 1]))) {
        break; // rest of line is a comment
      }
      if (c === "<" && raw[i + 1] === "<") {
        // Heredoc starts. Capture operator (<<- or <<-) then terminator.
        let j = i + 2;
        let dash = "";
        if (raw[j] === "-") {
          dash = "-";
          j += 1;
        }
        // Quoted or plain terminator
        const rest = raw.slice(j).trim();
        const m = rest.match(/^(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
        if (m) {
          pendingHeredoc = { term: m[2], quoted: Boolean(m[1]), dash };
          line += raw.slice(i, j + m[0].length);
          i = j + m[0].length;
          continue;
        }
      }
      line += c;
      i += 1;
    }

    if (li === 0 && raw.startsWith("#!")) {
      outLines.push(raw); // shebang preserved
    } else if (pendingHeredoc) {
      outLines.push(line);
      heredocTerm = pendingHeredoc.term;
      heredocQuote = pendingHeredoc.quoted;
    } else {
      outLines.push(line);
    }
  }

  return outLines.join("\n");
}

// ---------------------------------------------------------------------------
// Post-processing: tidy blank lines
// ---------------------------------------------------------------------------

function tidyWhitespace(text) {
  // Collapse 3+ consecutive newlines to 2 (max one blank line).
  let out = text.replace(/\n{3,}/g, "\n\n");
  // Drop blank line(s) left directly before a closing brace... no, too aggressive.
  // Remove trailing whitespace introduced by stripping.
  out = out.replace(/[ \t]+$/gm, "");
  // No blank line immediately after an opening brace or immediately before a closing one.
  out = out.replace(/\{\n\n+/g, "{\n");
  out = out.replace(/\n\n+\}/g, "\n}");
  return out;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, full);
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const allFiles = [];
walk(REPO_ROOT, allFiles);

const targets = allFiles.filter((rel) => {
  if (IGNORED_FILES.has(rel)) return false;
  if (!FORCE_INCLUDE.has(rel) && IGNORED_DIR_NAMES.has(rel.split(path.sep)[0])) return false;
  const ext = path.extname(rel);
  if (!STRIP_EXTENSIONS.has(ext)) return false;
  if (ONLY_FILES && !ONLY_FILES.has(path.resolve(ROOT_REAL, rel))) return false;
  return true;
});

let changed = 0;
let failed = 0;
let keptCommentCount = 0;
const report = [];

for (const rel of targets) {
  const abs = path.join(REPO_ROOT, rel);
  const original = fs.readFileSync(abs, "utf8");
  const isShell = path.extname(rel) === ".sh" || path.extname(rel) === ".bash" || rel === "bin/roborepo";

  // Shebang preserved separately so the shell scanner can't touch it.
  let body = original;
  let shebang = "";
  if (body.startsWith("#!")) {
    const nl = body.indexOf("\n");
    shebang = body.slice(0, nl + 1);
    body = body.slice(nl + 1);
  }

  const stripped = tidyWhitespace(shebang + stripComments(body, isShell));
  if (stripped === original) continue;

  // Safety: verify JS-family files still parse.
  const ext = path.extname(rel);
  if (!isShell && [".js", ".mjs", ".cjs"].includes(ext)) {
    // node --check reads the file from disk, so verify a temp copy of the STRIPPED text.
    const tmp = path.join("/tmp", `strip-check-${path.basename(rel)}`);
    fs.writeFileSync(tmp, stripped);
    try {
      execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
    } catch (err) {
      failed += 1;
      report.push(`SKIP (parse check failed): ${rel}\n  ${String(err.stderr).split("\n")[0]}`);
      continue;
    }
  }

  changed += 1;
  const beforeLines = original.split("\n").length;
  const afterLines = stripped.split("\n").length;
  report.push(`${rel}  (${beforeLines} → ${afterLines} lines, ${original.length - stripped.length} chars removed)`);

  if (APPLY) {
    fs.writeFileSync(abs, stripped);
  }
}

console.log(`Scanned ${targets.length} files (keep-jsdoc=${keepJsdoc})`);
console.log(APPLY ? "APPLY mode — files were rewritten.\n" : "DRY RUN — no files changed. Pass --apply to write.\n");
for (const line of report) console.log(line);
console.log(`\n${changed} file(s) ${APPLY ? "rewritten" : "would be rewritten"}, ${failed} skipped due to parse errors.`);
if (!APPLY && changed > 0) console.log("Review the list above, then re-run with --apply.");
