#!/usr/bin/env node
// Member roles and the ranking that picks a checkout's promoted link. classifyMemberRole and the
// comparator are pure, so every check here is an instance-shaped record fed straight through them.
import assert from "node:assert/strict";
import { classifyMemberRole, createRoleComparator } from "../../modules/developer-runtime/index.mjs";

// Only the fields the classifier reads. A listener unless `docker` is given.
function probed({ port = 9000, status = 200, tls = null, title = null, contentType = null, command = "node", app = null, docker = null } = {}) {
  return { bind: { port }, status, tls, title, contentType, process: { command }, app, docker };
}
const container = (name, service, fields = {}) => probed({
  command: "com.docker.backend",
  docker: { name, composeService: service },
  ...fields,
});

// ---- Classifier branches ----
assert.equal(classifyMemberRole(probed({ status: null })), "service", "no HTTP answer is infrastructure");
assert.equal(
  classifyMemberRole(probed({ status: null, tls: "untrusted" })),
  "api",
  "an untrusted certificate still answered HTTP; it is not a socket",
);
assert.equal(classifyMemberRole(probed({ port: 54322 })), "service", "service port preset");
assert.equal(classifyMemberRole(container("menugoats-postgres-1", "postgres")), "service");
assert.equal(classifyMemberRole(probed({ port: 8025, title: "Mailpit" })), "tooling", "title preset");
assert.equal(classifyMemberRole(probed({ port: 6006 })), "tooling", "tooling port preset");
assert.equal(classifyMemberRole(probed({ port: 9001, command: "ngrok", status: 302 })), "tooling", "tooling name preset");
assert.equal(classifyMemberRole(probed({ title: "Recipes" })), "app");
assert.equal(classifyMemberRole(probed({ contentType: "text/html; charset=utf-8" })), "app", "untitled 2xx HTML shell");
assert.equal(classifyMemberRole(probed({ contentType: "application/json" })), "api");
assert.equal(classifyMemberRole(probed({ status: 404, contentType: "text/html" })), "api", "an untitled error page is not an app");
assert.equal(classifyMemberRole(probed({ status: 302, contentType: "text/html" })), "api", "only 2xx counts");
console.log("ok  classifier branches");

// ---- Name tokens ----
// Supabase CLI sets no Compose service label, so the container name is the only hint.
assert.equal(classifyMemberRole(container("supabase_db_menugoats", null)), "service");
assert.equal(classifyMemberRole(container("supabase_studio_menugoats", null, { port: 9002, title: "Studio" })), "tooling");
// Tokens match whole, never as substrings: "metabase" is not "meta".
assert.equal(classifyMemberRole(probed({ command: "metabase", title: "Metabase" })), "app");
// A user-named app is matched on its name too.
assert.equal(classifyMemberRole(probed({ app: { name: "Storybook" }, port: 9003, title: "Components" })), "tooling");
console.log("ok  name tokens match whole tokens of every name source");

// ---- Ranking ----
const member = (role, fields) => ({ role, instance: probed(fields) });
const rank = (items, repositoryName = "menugoats") => [...items].sort(createRoleComparator({ repositoryName })).map((item) => item.instance.bind.port);

assert.deepEqual(
  rank([
    member("service", { port: 1 }),
    member("api", { port: 2 }),
    member("tooling", { port: 3 }),
    member("app", { port: 4, title: "App" }),
  ]),
  [4, 3, 2, 1],
  "roles order app, tooling, api, service",
);
assert.deepEqual(
  rank([member("app", { port: 3000, contentType: "text/html" }), member("app", { port: 9000, title: "Dash" })]),
  [9000, 3000],
  "a titled app outranks an untitled one, whatever the port",
);
assert.deepEqual(
  rank([member("app", { port: 3000, title: "Dashboard" }), member("app", { port: 9000, title: "MenuGoats admin" })]),
  [9000, 3000],
  "a title naming the repository outranks a conventional port",
);
assert.deepEqual(
  rank([
    { role: "app", instance: container("shop-worker-1", "worker", { port: 9000, title: "Jobs" }) },
    { role: "app", instance: container("shop-frontend-1", "frontend", { port: 9001, title: "Shop" }) },
  ], "shop-repo"),
  [9001, 9000],
  "an app-like name outranks a conventional port",
);
assert.deepEqual(
  rank([member("app", { port: 9000, title: "A" }), member("app", { port: 5173, title: "B" })]),
  [5173, 9000],
  "a common app port outranks an unusual one",
);
assert.deepEqual(
  rank([member("app", { port: 7002, title: "B" }), member("app", { port: 7001, title: "A" })]),
  [7001, 7002],
  "lowest port breaks the final tie",
);
assert.deepEqual(
  rank([member("app", { port: 7002, title: "menugoats" }), member("app", { port: 7001, title: "Other" })], ""),
  [7001, 7002],
  "an empty repository name matches nothing",
);
console.log("ok  role order and tie-breakers");

console.log("developer-runtime member-role checks passed");
