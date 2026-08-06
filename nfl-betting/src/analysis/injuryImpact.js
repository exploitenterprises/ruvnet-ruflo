// Starter-availability signal built from ESPN's depth-chart data
// (src/providers/injuryProvider.js fetchTeamDepthChart) — a genuinely
// rank-ordered list per position with each athlete's current injury
// designation attached, so "the starting QB is Out" is something this can
// actually assert rather than infer from roster order.
//
// Scope, stated plainly: only the QB gets a numeric point adjustment. A
// backup QB start is the one injury scenario with a broad, well-documented
// market effect size (commonly cited across betting-market analysis as
// roughly 2-3 points against the closing line, regardless of which specific
// backup is in). Every other position's real-world impact varies too much
// by player and scheme to state a single honest number — those are
// surfaced as informational notes only, same posture as matchupEngine.js's
// manualCoachNotes (never silently reweights the model).

const OUT_STATUSES = new Set(['Out', 'Doubtful', 'Injured Reserve', 'Physically Unable to Perform', 'Suspended']);

// Industry rule-of-thumb point value of a backup QB replacing an Out/
// Doubtful/IR starter — not a team- or player-specific estimate, which is
// exactly why it's applied as a flat, capped adjustment rather than
// something derived from this specific backup's stats (there usually
// aren't enough of them to trust).
export const QB_OUT_POINT_PENALTY = 3;

// Finds the depth-chart starter (rank 1 — the first athlete listed for that
// position) for `positionKey` (lowercase, e.g. 'qb', 'rb', 'wr1') across a
// team's depth chart, and reports their injury designation if it's one of
// the "not expected to play" statuses. Returns null when the starter is
// healthy, uninjured-but-listed (e.g. no injuries array at all), or the
// position isn't present in this team's depth chart groups.
export function findStarterInjury(depthChart, positionKey) {
  for (const group of depthChart ?? []) {
    const posData = group.positions?.[positionKey];
    const starter = posData?.athletes?.[0];
    if (!starter) continue;
    const injury = (starter.injuries ?? []).find((inj) => OUT_STATUSES.has(inj.status));
    if (!injury) return null;
    return { player: starter.displayName, status: injury.status, note: injury.note ?? null };
  }
  return null;
}

// The one numeric adjustment this module makes — see file header for why
// it's QB-only. Returns 0 when the depth chart is missing or the starter is
// available.
export function qbOutPenalty(depthChart) {
  return findStarterInjury(depthChart, 'qb') ? QB_OUT_POINT_PENALTY : 0;
}

// Informational-only notes for a set of skill positions — surfaced on the
// projection but never used to move point estimates (unlike QB, see above).
export function starterInjuryNotes(teamAbbr, depthChart, positionKeys = ['rb', 'wr1', 'te']) {
  const notes = [];
  for (const posKey of positionKeys) {
    const injury = findStarterInjury(depthChart, posKey);
    if (injury) {
      notes.push(`${teamAbbr} starting ${posKey.toUpperCase()} ${injury.player} is ${injury.status.toLowerCase()}${injury.note ? ` — ${injury.note}` : ''}`);
    }
  }
  return notes;
}
