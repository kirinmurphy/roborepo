#!/usr/bin/env node
// Naming-surface inventory: counts every case-variant `roborepo` mention in tracked files,
// bucketed by role. Excludes docs/plans (user decision: out of rename scope).
// Usage: node scripts/test/naming-inventory.mjs [--sub]   (--sub breaks down the identifiers bucket)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAT = /roborepo/gi;
const ENV_RE = /ROBOREPO_[A-Z_]+/g;
const STR_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const FENCE = /^\s*(```|~~~)/;
const sub = process.argv.includes("--sub");

const files = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
  .split("\n").filter((f) => f && !f.startsWith("docs/plans"));

const cat = new Map();
const codeLines = []; // [file, line] for the identifiers & strings bucket
const add = (k, f, n) => { if (n) cat.set(k, (cat.get(k) ?? 0) + n); };

for (const f of files) {
  const p = path.join(REPO, f);
  let st; try { st = fs.lstatSync(p); } catch { continue; }
  const base = path.basename(f);
  let pb = base.split(/[/_\-.]/).filter((s) => s.toLowerCase() === "roborepo").length;
  if (st.isSymbolicLink()) pb += (fs.readlinkSync(p).match(PAT) ?? []).length;
  add("path: filenames/symlinks", f, pb);
  if (!st.isFile()) continue;
  let text; try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
  const ext = path.extname(f).toLowerCase();
  const lines = text.split("\n");
  if (ext === ".md") {
    let fence = false;
    for (const ln of lines) {
      if (FENCE.test(ln)) { fence = !fence; continue; }
      const n = (ln.match(PAT) ?? []).length;
      add(fence ? "md: code blocks" : "md: prose", f, n);
    }
    continue;
  }
  if (ext === ".json") {
    for (const ln of lines) {
      const n = (ln.match(PAT) ?? []).length;
      if (!n) continue;
      const isKey = /^\s*"[^"]*roborepo[^"]*"\s*:/i.test(ln);
      add(isKey ? "code: JSON keys" : "code: string values", f, n);
    }
    continue;
  }
  if ([".mjs", ".js", ".sh", ".bash", ".yml", ".yaml", ".toml", ".css", ".html", ".tsv", ".py"].includes(ext)) {
    let inBlock = false;
    for (const ln of lines) {
      const n = (ln.match(PAT) ?? []).length;
      if (!n) continue;
      const noStr = ln.replace(STR_RE, '""');
      if (ext === ".html") {
        if (inBlock || ln.includes("<!--")) {
          if (ln.includes("<!--") && !ln.includes("-->")) inBlock = true;
          if (inBlock && ln.includes("-->") && !ln.includes("<!--")) inBlock = false;
          add("code: comments", f, n); continue;
        }
        add("content: html copy", f, n); continue;
      }
      if (ext === ".css") {
        if (inBlock || ln.includes("/*")) {
          if (ln.includes("/*") && !ln.includes("*/")) inBlock = true;
          if (inBlock && ln.includes("*/") && !ln.includes("/*")) inBlock = false;
          add("code: comments", f, n); continue;
        }
        add("other", f, n); continue;
      }
      if ([".sh", ".bash", ".yml", ".yaml", ".toml", ".py"].includes(ext) && ln.trimStart().startsWith("#")) {
        add("code: comments", f, n); continue;
      }
      if (ext === ".tsv") { add("config: manifest.tsv", f, n); continue; }
      const env = (ln.match(ENV_RE) ?? []).length;
      const rest = n - env;
      if (inBlock || noStr.trimStart().startsWith("//")) {
        add("code: comments", f, n);
        if (noStr.includes("/*") && !noStr.includes("*/")) inBlock = true;
        continue;
      }
      if (noStr.includes("/*") && !noStr.includes("*/")) inBlock = true;
      if (inBlock && noStr.includes("*/") && !noStr.includes("/*")) inBlock = false;
      if (inBlock) { add("code: comments", f, n); continue; }
      if (env) add("code: env vars", f, env);
      if (rest) { add("code: identifiers & strings", f, rest); codeLines.push([f, ln.trim()]); }
    }
    continue;
  }
  add("other", f, (text.match(PAT) ?? []).length);
}

const total = [...cat.values()].reduce((a, b) => a + b, 0);
console.log(`TOTAL (excl. docs/plans): ${total}\n`);
for (const [k, n] of [...cat].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

if (sub) {
  console.log(`\n== sub-categorizing 'code: identifiers & strings' (${cat.get("code: identifiers & strings") ?? 0}) ==`);
  const SUBS = [
    ["state-dir path fragments (~/.roborepo)", /\.roborepo\b|roborepo\/|['"]\.roborepo/],
    ["CLI invocations (roborepo <cmd> / bin/roborepo)", /usage: roborepo|bin\/roborepo|`roborepo[ `]|['"]roborepo[ '"\\)]|roborepo \w+|Bash\(roborepo|commandPrefix/],
    ["npm package name", /codethings-roborepo-alpha/],
    ["GitHub URLs", /kirinmurphy\/roborepo/],
    ["product-surface filenames", /MANAGED_BY_ROBOREPO|builtin-managed|write-guard|generated-permissions|ROBOREPO_[A-Z_]/],
    ["doc filename references", /roborepo(-cli|-skills)?\.md/],
  ];
  const subs = new Map(); const unmatchedFiles = new Map(); const samples = [];
  for (const [f, line] of codeLines) {
    const hit = SUBS.find(([, rx]) => rx.test(line));
    if (hit) subs.set(hit[0], (subs.get(hit[0]) ?? 0) + 1);
    else {
      subs.set("unmatched", (subs.get("unmatched") ?? 0) + 1);
      unmatchedFiles.set(f, (unmatchedFiles.get(f) ?? 0) + 1);
      if (samples.length < 25) samples.push(`${f}: ${line.slice(0, 130)}`);
    }
  }
  for (const [k, n] of [...subs].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
  console.log("\nunmatched by file (top 12):");
  for (const [f, n] of [...unmatchedFiles].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  console.log("\nunmatched samples:");
  for (const s of samples) console.log(`  ${s}`);
}
