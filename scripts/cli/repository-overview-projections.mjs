import {
  lastSeenAtFor,
  repositoryDetailPayload,
  repositorySummary,
  resolveRegistryAlias,
} from "../../modules/repositories/index.mjs";
import { isFixtureRepository } from "../../modules/developer-runtime/snapshot.mjs";
import {
  planChangedAt,
  plansByRepository,
  runtimeByRepository,
  telemetryByRepository,
  unresolvedRuntimeActivity,
} from "./repository-overview-sources.mjs";

export function composeHomeOverview({ registry, runtimeState, plansState, telemetryState, now = new Date() }) {
  const runtimeById = runtimeByRepository(runtimeState.data, registry);
  const planCoverage = plansByRepository(plansState.data, now, registry);
  const telemetryById = telemetryByRepository(telemetryState.data, registry);
  const repositories = Object.values(registry.repositories || {})
    .filter((record) => record.visibility !== "hidden" && resolveRegistryAlias(registry, record.id) === record.id)
    .map((record) => repositoryOverview(record, {
      runtimeState,
      workspace: runtimeById.get(record.id) || null,
      plansState,
      plans: planCoverage.get(record.id) || null,
      telemetryState,
      telemetry: telemetryById[record.id] || null,
    }));

  return {
    updatedAt: newestTimestamp([runtimeState.updatedAt, plansState.updatedAt, telemetryState.updatedAt]) || now.toISOString(),
    repositories: sortRepositories(repositories),
    unresolvedActivity: unresolvedRuntimeActivity(runtimeState, registry),
  };
}

export function composeRepositoryDetail(record, homeOverview) {
  const overview = homeOverview.repositories.find((repository) => repository.repositoryId === record.id);
  if (!overview) return null;
  return { ...overview, identity: repositoryDetailPayload(record) };
}

export function runtimeDomainState(snapshot) {
  if (!snapshot) return unavailableState("Runtime data is unavailable");
  const failed = snapshot.refresh?.state === "failed";
  return {
    status: failed ? "stale" : "available",
    updatedAt: snapshot.generatedAt || null,
    data: snapshot,
    ...(failed ? { message: snapshot.refresh?.error || "Runtime refresh failed" } : {}),
  };
}

export function plansDomainState(snapshot) {
  if (!snapshot) return unavailableState("Plans data is unavailable");
  const partial = snapshot.truncated || (snapshot.errors || []).length > 0;
  return {
    status: partial ? "partial" : "available",
    updatedAt: newestTimestamp((snapshot.plans || []).map((record) => planChangedAt(record.plan))),
    data: snapshot,
    ...(partial ? { message: "Plans coverage is incomplete" } : {}),
  };
}

export function telemetryDomainState(projection) {
  if (!projection) return unavailableState("Tokens data is unavailable");
  return { status: projection.status || "available", updatedAt: projection.updatedAt || null, data: projection };
}

export function unavailableState(message) {
  return { status: "unavailable", updatedAt: null, data: null, message };
}

function repositoryOverview(record, context) {
  const workspace = context.workspace;
  const lifecycle = workspace?.lifecycle || { state: "idle", reason: "Runtime has not observed this repository yet" };
  const association = associatePlans(workspace, context.plans);
  const runtime = perRepositoryEnvelope(context.runtimeState, association.workspace || { lifecycle, checkouts: [] });
  const git = perRepositoryEnvelope(context.runtimeState, workspace ? gitSummary(workspace) : { checkouts: [], warnings: [] });
  const plans = association.plans
    ? perRepositoryEnvelope(context.plansState, association.plans)
    : unavailableEnvelope("Plans has not scanned this repository");
  const tokens = perRepositoryEnvelope(context.telemetryState, context.telemetry || { sessionCount: 0, warningCount: 0, highestSeverity: null, recent: [] });
  return {
    ...repositorySummary(record),
    fixture: isFixtureRepository(record.id),
    lifecycle,
    lastSeenAt: workspace?.lastSeenAt || lastSeenAtFor(record),
    domains: {
      runtime,
      git,
      plans,
      tokens,
      agents: unavailableEnvelope("Repository-scoped agent configuration is not available yet"),
    },
  };
}

// Joins active plans to the linked worktrees implementing them, by exact `worktree` name only.
// Lossless by construction: a plan attaches to at most one checkout as `checkout.plan`, and every
// active plan that does not attach stays in `plans.additionalActive`. A name claimed by two active
// plans, or exposed by two Runtime worktrees, attaches nothing — picking one would assert a
// relationship the evidence does not support. Counts and `recent` are untouched; grouping is
// presentation, not lifecycle. Without plan data the checkouts are returned as they were.
function associatePlans(workspace, plans) {
  if (!plans) return { workspace, plans };
  const activePlans = plans.active || [];
  // Main checkouts never carry a worktreeName (see projectWorkspace), so the name alone gates a match.
  const named = (workspace?.checkouts || []).filter((checkout) => checkout.worktreeName);
  if (!named.length || !activePlans.some((plan) => plan.worktree)) {
    return { workspace, plans: { ...plans, additionalActive: activePlans } };
  }

  const tally = (values) => values.reduce((counts, value) => counts.set(value, (counts.get(value) || 0) + 1), new Map());
  const worktreeNames = tally(named.map((checkout) => checkout.worktreeName));
  const claims = tally(activePlans.map((plan) => plan.worktree).filter(Boolean));
  const attachable = new Map(activePlans
    .filter((plan) => claims.get(plan.worktree) === 1 && worktreeNames.get(plan.worktree) === 1)
    .map((plan) => [plan.worktree, plan]));

  const checkouts = workspace.checkouts.map((checkout) => {
    const plan = checkout.worktreeName && attachable.get(checkout.worktreeName);
    return plan ? { ...checkout, plan } : checkout;
  });
  return {
    workspace: { ...workspace, checkouts },
    plans: { ...plans, additionalActive: activePlans.filter((plan) => attachable.get(plan.worktree) !== plan) },
  };
}

function gitSummary(workspace) {
  const warnings = [];
  for (const checkout of workspace.checkouts) {
    if (checkout.git?.dirty) warnings.push(`${checkout.name} has uncommitted changes`);
    if ((checkout.git?.behind || 0) > 0) warnings.push(`${checkout.name} is behind ${checkout.git.behind}`);
    if ((checkout.git?.baseBehind || 0) > 0) warnings.push(`${checkout.name} has drifted ${checkout.git.baseBehind} commits from ${checkout.git.baseBranch}`);
  }
  return { checkouts: workspace.checkouts.map(({ primaryEntrypoint, ...checkout }) => checkout), warnings };
}

function perRepositoryEnvelope(state, data) {
  if (!state || state.status === "unavailable") return unavailableEnvelope(state?.message || "Domain unavailable");
  return { status: state.status, updatedAt: state.updatedAt || null, data, ...(state.message ? { message: state.message } : {}) };
}

function unavailableEnvelope(message) {
  return { status: "unavailable", updatedAt: null, data: null, message };
}

// Pinned first, then running before idle/stale, and within each of those real repositories before
// dev fixtures: pinned → active → active fixtures → idle → idle fixtures. Pins lead the whole list
// (unlike Runtime, which pins within each group) since Home has no other way to keep an idle
// favorite in view.
function sortRepositories(repositories) {
  const rank = { active: 0, idle: 1, stale: 2 };
  const group = (repository) => {
    if (repository.pinned) return 0;
    const running = repository.lifecycle.state === "active";
    return (running ? 1 : 3) + (repository.fixture ? 1 : 0);
  };
  return repositories.sort((a, b) => {
    const grouped = group(a) - group(b);
    if (grouped !== 0) return grouped;
    const lifecycle = (rank[a.lifecycle.state] ?? 3) - (rank[b.lifecycle.state] ?? 3);
    if (lifecycle !== 0) return lifecycle;
    if (a.lifecycle.state === "idle") {
      const recency = (Date.parse(b.lastSeenAt || 0) || 0) - (Date.parse(a.lastSeenAt || 0) || 0);
      if (recency !== 0) return recency;
    }
    return a.displayName.localeCompare(b.displayName) || a.repositoryId.localeCompare(b.repositoryId);
  });
}

function newestTimestamp(values) {
  return values.filter(Boolean).reduce((latest, value) => !latest || Date.parse(value) > Date.parse(latest) ? value : latest, null);
}
