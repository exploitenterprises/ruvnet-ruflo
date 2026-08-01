// League-average baselines computed from whatever team stats were actually
// fetched this week, rather than hardcoded — scoring environment shifts
// year to year (rule changes, weather trends, etc.) so the baseline must
// float with the data.
export function computeLeagueAverages(teamStatsList) {
  const n = teamStatsList.length;
  if (n === 0) throw new Error('computeLeagueAverages requires at least one team');
  const sum = (key) => teamStatsList.reduce((acc, t) => acc + (t[key] ?? 0), 0);
  return {
    pointsPerGame: sum('pointsForPerGame') / n,
    yardsPerPlay: sum('yardsPerPlay') / n,
    passYardsPerGame: sum('passYardsPerGame') / n,
    rushYardsPerGame: sum('rushYardsPerGame') / n,
    playsPerGame: sum('playsPerGame') / n,
    thirdDownPct: sum('thirdDownPct') / n,
    redZoneTdPct: sum('redZoneTdPct') / n,
    sackRate: sum('sackRate') / n,
  };
}
