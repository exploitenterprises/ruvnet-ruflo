// "Coach scheme" signal, derived empirically from observed play-calling and
// tempo rather than a hardcoded coach roster (rosters change every offseason
// and hardcoding them risks going stale/wrong within a season). Everything
// here is a ratio against the league-average team computed the same week,
// so it self-updates as data comes in.
//
// Optional qualitative overrides (e.g. "new OC installing a different scheme
// mid-season") can be layered in via data/coach-notes.json — see
// loadCoachNotes().

export function computeSchemeTendencies(teamStats, leagueAvg) {
  const paceIndex = teamStats.playsPerGame / leagueAvg.playsPerGame; // >1 = faster tempo
  const passHeaviness = (teamStats.passYardsPerGame / (teamStats.passYardsPerGame + teamStats.rushYardsPerGame))
    / (leagueAvg.passYardsPerGame / (leagueAvg.passYardsPerGame + leagueAvg.rushYardsPerGame));
  const aggressionIndex = (teamStats.fourthDownAttemptRate ?? 0) / (leagueAvg.fourthDownAttemptRate || 1) || 1;
  const pressureRateFor = teamStats.sackRate / (leagueAvg.sackRate || 1); // pass-rush scheme strength
  const pressureRateAgainst = teamStats.sackRateAllowed / (leagueAvg.sackRate || 1); // pass-pro scheme weakness
  return { paceIndex, passHeaviness, aggressionIndex, pressureRateFor, pressureRateAgainst };
}

// Scheme mismatch multiplier applied to the pass-game projection: an
// aggressive pass rush (offenseTendencies.pressureRateFor high) against a
// weak pass-pro scheme (defenseTendencies... note: pass rush is a defensive
// stat, pass protection is measured via the offense's sackRateAllowed) pushes
// sacks/turnovers up and expected passing efficiency down.
export function passRushMismatch(offenseSchemeTendencies, defenseSchemeTendencies) {
  return defenseSchemeTendencies.pressureRateFor * offenseSchemeTendencies.pressureRateAgainst;
}

export async function loadCoachNotes(path) {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
