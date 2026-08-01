import { matchupWinProbability, winProbToSpread } from './powerRatings.js';
import { computeSchemeTendencies, passRushMismatch } from './schemeTendencies.js';
import { weatherAdjustment } from './weatherImpact.js';

// Ratio-based unit projection: expected points a unit produces/allows relative
// to league average, in the style of a simplified opponent-adjusted efficiency
// model (same family as Football Outsiders DVOA / Pro Football Reference SRS).
function unitAdjustedPoints(offPPG, defPAPG, leagueAvgPPG) {
  const offFactor = offPPG / leagueAvgPPG;
  const defFactor = defPAPG / leagueAvgPPG;
  return leagueAvgPPG * offFactor * defFactor;
}

// Projects a single game from team season stats (home/away splits), current
// Elo power ratings, weather, and empirical scheme tendencies. This is the
// core "offense vs defense, position group vs position group, scheme vs
// scheme" matchup evaluation the strategy is built on.
export function projectGame({
  home, away, // { abbr, stats, rating }
  leagueAvg,
  weather, // raw forecast, or null/undefined for dome
  neutralSite = false,
  coachNotes = {}, // optional manual overrides keyed by team abbr, see data/coach-notes.json
}) {
  const eloWinProb = matchupWinProbability({ homeRating: home.rating, awayRating: away.rating, neutralSite });
  const eloSpread = winProbToSpread(eloWinProb); // home margin implied by Elo

  // Efficiency-based projection using home/away splits when available,
  // falling back to season-wide numbers.
  const homeOffPPG = home.stats.homePointsForPerGame ?? home.stats.pointsForPerGame;
  const awayDefPAPG = away.stats.awayPointsAgainstPerGame ?? away.stats.pointsAgainstPerGame;
  const awayOffPPG = away.stats.awayPointsForPerGame ?? away.stats.pointsForPerGame;
  const homeDefPAPG = home.stats.homePointsAgainstPerGame ?? home.stats.pointsAgainstPerGame;

  let homePointsEst = unitAdjustedPoints(homeOffPPG, awayDefPAPG, leagueAvg.pointsPerGame);
  let awayPointsEst = unitAdjustedPoints(awayOffPPG, homeDefPAPG, leagueAvg.pointsPerGame);

  // Blend the efficiency-model margin with the Elo-implied margin (ensemble
  // of two independently-derived estimates reduces variance vs either alone).
  const effMargin = homePointsEst - awayPointsEst;
  const blendedMargin = effMargin * 0.5 + eloSpread * 0.5;
  const shift = (blendedMargin - effMargin) / 2;
  homePointsEst += shift;
  awayPointsEst -= shift;

  // Pass-rush vs pass-protection scheme mismatch nudges the favored unit.
  const homeScheme = computeSchemeTendencies(home.stats, leagueAvg);
  const awayScheme = computeSchemeTendencies(away.stats, leagueAvg);
  const homePassPressure = passRushMismatch(homeScheme, awayScheme); // away pass-rush vs home pass-pro
  const awayPassPressure = passRushMismatch(awayScheme, homeScheme);
  const homePassPenalty = clamp((homePassPressure - 1) * 0.04, -0.08, 0.08);
  const awayPassPenalty = clamp((awayPassPressure - 1) * 0.04, -0.08, 0.08);
  homePointsEst *= 1 - homePassPenalty;
  awayPointsEst *= 1 - awayPassPenalty;

  // Tempo (pace) affects total scoring opportunities for both teams roughly evenly.
  const paceMultiplier = (homeScheme.paceIndex + awayScheme.paceIndex) / 2;
  homePointsEst *= paceMultiplier;
  awayPointsEst *= paceMultiplier;

  // Weather: dome/no-forecast => no adjustment.
  const wx = weather
    ? weatherAdjustment(weather)
    : weatherAdjustment({ isDome: true });
  homePointsEst *= wx.totalMultiplier;
  awayPointsEst *= wx.totalMultiplier;

  const projectedSpread = homePointsEst - awayPointsEst; // positive => home favored
  const projectedTotal = homePointsEst + awayPointsEst;

  // Final win probability blends Elo (rating-history based) with the
  // matchup-specific efficiency signal, converted via the same logistic used
  // for Elo so the two are on a comparable scale.
  const scoreBasedWinProb = 1 / (1 + Math.exp(-projectedSpread / 7)); // ~7 pts ~ 1 std dev of NFL margins
  const homeWinProb = clamp(eloWinProb * 0.55 + scoreBasedWinProb * 0.45, 0.02, 0.98);

  return {
    home: home.abbr,
    away: away.abbr,
    projectedHomeScore: round1(homePointsEst),
    projectedAwayScore: round1(awayPointsEst),
    projectedSpread: round1(projectedSpread), // home perspective; negative means home is underdog
    projectedTotal: round1(projectedTotal),
    homeWinProb: round3(homeWinProb),
    awayWinProb: round3(1 - homeWinProb),
    weatherNotes: wx.notes,
    schemeNotes: [
      ...describeSchemeEdges(home.abbr, away.abbr, homeScheme, awayScheme),
      ...manualCoachNotes(home.abbr, away.abbr, coachNotes),
    ],
  };
}

// Qualitative overrides a human has entered (e.g. a new OC installing a
// different scheme mid-season) — surfaced as notes only, since the model
// intentionally does not let free-text input move point projections.
function manualCoachNotes(homeAbbr, awayAbbr, coachNotes) {
  const notes = [];
  if (coachNotes[homeAbbr]) notes.push(`${homeAbbr} note: ${coachNotes[homeAbbr]}`);
  if (coachNotes[awayAbbr]) notes.push(`${awayAbbr} note: ${coachNotes[awayAbbr]}`);
  return notes;
}

function describeSchemeEdges(homeAbbr, awayAbbr, homeScheme, awayScheme) {
  const notes = [];
  if (homeScheme.paceIndex > 1.06 && awayScheme.paceIndex > 1.06) {
    notes.push('Both teams play at above-average tempo — lean toward the total');
  }
  if (awayScheme.pressureRateFor > 1.15 && homeScheme.pressureRateAgainst > 1.15) {
    notes.push(`${awayAbbr} pass rush vs ${homeAbbr} pass protection is a mismatch favoring the defense — expect pressure/sacks`);
  }
  if (homeScheme.pressureRateFor > 1.15 && awayScheme.pressureRateAgainst > 1.15) {
    notes.push(`${homeAbbr} pass rush vs ${awayAbbr} pass protection is a mismatch favoring the defense — expect pressure/sacks`);
  }
  if (homeScheme.aggressionIndex > 1.2 || awayScheme.aggressionIndex > 1.2) {
    notes.push('An aggressive 4th-down coach is involved — expect fewer punts in scoring range, adds variance to totals/live markets');
  }
  return notes;
}

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }
