// Line-movement tracking — how much a game's market spread/total has moved
// since this pipeline first saw it, computed from snapshots this project
// takes of its own real market-line pulls over time (persisted by
// src/lineHistoryStore.js). This is a genuinely different kind of signal
// from everything else in analysis/: it doesn't need any new data source,
// just remembering what we already fetch each run.
//
// Why self-collected, not a paid feed: two realistic free sources for
// "betting market signals" were checked directly against this
// environment's network and ruled out, not assumed —
// - Public bet-percentage / sharp-vs-public-money splits (Action Network,
//   Covers consensus): both blocked at the network level here, the same
//   pattern already documented for the CFB scouting sites in
//   nfl-betting/board/README.md — not an API-key paywall, a reachability wall.
// - The Odds API's own historical-odds endpoint (which would give real
//   point-in-time line history without self-collection): confirmed
//   reachable (401 on a bad key, not blocked) but gated behind a paid plan
//   per their docs — a cost gate, not a technical one, and out of scope to
//   assume the user wants to pay for.
// So: track it ourselves, for free, going forward. The real limitation this
// creates, stated plainly — there's no "line movement since Tuesday" on the
// very first run for a game; movement only exists once this pipeline has
// actually observed that game more than once.

// Appends a new snapshot only if the line actually changed (or there's no
// prior snapshot) — a repeated identical read shouldn't pad the history
// with no-op timestamps, same posture as picksLedger.upsertPick's no-op guard.
export function recordSnapshot(history, gameKey, line, at = new Date().toISOString()) {
  const existing = history[gameKey] ?? [];
  const last = existing[existing.length - 1];
  if (last && last.spread === line.spread && last.total === line.total) return history;
  return { ...history, [gameKey]: [...existing, { at, spread: line.spread ?? null, total: line.total ?? null }] };
}

// Earliest-vs-latest snapshot for a game — "open" here means "first time
// this pipeline observed it," not the sportsbook's true opening line if
// that predates when we started tracking. Returns null if we don't have at
// least two snapshots yet (nothing to measure movement against).
export function computeMovement(history, gameKey) {
  const snapshots = history[gameKey];
  if (!snapshots || snapshots.length < 2) return null;
  const open = snapshots[0];
  const current = snapshots[snapshots.length - 1];
  return {
    openSpread: open.spread,
    currentSpread: current.spread,
    spreadMove: open.spread != null && current.spread != null ? round1(current.spread - open.spread) : null,
    openTotal: open.total,
    currentTotal: current.total,
    totalMove: open.total != null && current.total != null ? round1(current.total - open.total) : null,
    snapshotCount: snapshots.length,
    firstSeenAt: open.at,
    lastSeenAt: current.at,
  };
}

// A half-point of total movement or more is a real, worth-mentioning
// signal; smaller than that is normal noise from book-to-book vig
// fluctuation and not worth surfacing as "the market moved."
const NOTABLE_MOVE = 0.5;

export function describeMovement(gameKey, movement) {
  if (!movement) return [];
  const notes = [];
  if (movement.spreadMove != null && Math.abs(movement.spreadMove) >= NOTABLE_MOVE) {
    const dir = movement.spreadMove > 0 ? 'toward the home side' : 'toward the away side';
    notes.push(`${gameKey}: spread has moved ${Math.abs(movement.spreadMove)} pts ${dir} since first tracked (${movement.openSpread} → ${movement.currentSpread})`);
  }
  if (movement.totalMove != null && Math.abs(movement.totalMove) >= NOTABLE_MOVE) {
    const dir = movement.totalMove > 0 ? 'up' : 'down';
    notes.push(`${gameKey}: total has moved ${dir} ${Math.abs(movement.totalMove)} pts since first tracked (${movement.openTotal} → ${movement.currentTotal})`);
  }
  return notes;
}

function round1(v) { return Math.round(v * 10) / 10; }
