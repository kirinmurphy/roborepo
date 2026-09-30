// Per-turn waste ledger behind the Tokens page's "Identifiable waste" cards.
//
// Each waste source (runaway loops, redundant reads, spike excess, over-testing) nominates turns
// (captures) with a token amount. A turn is counted ONCE: if several sources nominate it, only the
// largest amount survives, attributed to that source. Category totals therefore partition the
// overall total, so the headline is an exact figure rather than an overlapping upper bound.

// Tie-break order when two sources nominate the same amount for one turn.
export const WASTE_CATEGORIES = ["loops", "reads", "spikes", "testing"];
const WEEK_MS = 7 * 86400000;

export function createWasteLedger() {
  const turns = new Map();
  return {
    add(event, category, tokens) {
      if (!event || !(tokens > 0)) return;
      const current = turns.get(event);
      const better = !current || tokens > current.tokens
        || (tokens === current.tokens && WASTE_CATEGORIES.indexOf(category) < WASTE_CATEGORIES.indexOf(current.category));
      if (better) turns.set(event, { category, tokens });
    },
    // { all, week } — each { total, categories: { loops, reads, spikes, testing } } in tokens.
    // The week window is the trailing 7 days ending at latestTs, matching the week usage card.
    summarize(latestTs) {
      const cutoff = latestTs ? new Date(Date.parse(latestTs) - WEEK_MS).toISOString() : null;
      const blank = () => ({ total: 0, categories: Object.fromEntries(WASTE_CATEGORIES.map((key) => [key, 0])) });
      const all = blank();
      const week = blank();
      for (const [event, { category, tokens }] of turns) {
        all.categories[category] += tokens;
        all.total += tokens;
        if (cutoff && event.ts >= cutoff) {
          week.categories[category] += tokens;
          week.total += tokens;
        }
      }
      return { all, week };
    },
  };
}
