import { matchupWinProbability, winProbToSpread, CONSTANTS as ELO_CONSTANTS } from './powerRatings.js';
import { computeSchemeTendencies, passRushMismatch } from './schemeTendencies.js';
import { weatherAdjustment } from './weatherImpact.js';
import { positionMatchupEdge } from './positionMatchup.js';
import { epaMatchupEdgePerPlay } from './teamEpa.js';
import { findStarterInjury, starterInjuryNotes, QB_OUT_POINT_PENALTY } from './injuryImpact.js';

// Typical NFL offensive plays/game — used only to convert an EPA/play edge
// into a point-equivalent margin (same fallback value schemeTendencies.js
// implicitly assumes via its playsPerGame league-average usage).
const AVG_PLAYS_PER_GAME = 64;

// The two ensembles that combine independently-derived signals into a
// single projection — set by feel when each signal was added (Elo/eff
// first, EPA folded in later), never tuned against data until
// tuneBlendWeights.js could score real backtest results against them (see
// that file / reports/backtest-weight-tuning-*.md for the search and the
// before/after: the full-model backtest found spread MAE was worse than
// Elo alone in all 4 league-seasons tested with these original weights).
//
// MARGIN_BLEND_WEIGHTS: how much the projected point margin trusts the
// efficiency-model estimate (`eff`) vs. Elo (`elo`) vs. EPA/play (`epa`)
// when EPA data is available. When it isn't, `eff`/`elo` are renormalized
// to sum to 1 (dropping `epa`'s share) rather than using a separate
// hardcoded fallback — e.g. eff:0.35/elo:0.35 renormalizes to 0.5/0.5,
// which is what the original code hardcoded for the no-EPA case, so this
// is a strictly more general version of the same behavior, not a change
// to it.
export const MARGIN_BLEND_WEIGHTS = { eff: 0.35, elo: 0.35, epa: 0.30 };
// WIN_PROB_BLEND_WEIGHTS: how much the final win probability trusts Elo's
// own win-probability estimate vs. the score-based estimate derived from
// the (already-blended) projected margin.
export const WIN_PROB_BLEND_WEIGHTS = { elo: 0.55, score: 0.45 };

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
  ngsEdges = {}, // optional Next Gen Stats position-group edges (see positionMatchup.js) —
  // { homeReceivingEdge, awayReceivingEdge, homeRushingEdge, awayRushingEdge }, each a
  // positionMatchupEdge() ratio (>1 favors the offense). Omit any/all to skip that adjustment.
  epaSplits = {}, // optional { home, away } team EPA/play splits from teamEpa.js
  // (computeTeamEpaSplits output for each team) — the strongest single per-play
  // efficiency signal available (nflfastR EPA). Omit to skip this adjustment.
  injuries = {}, // optional { home, away } depth charts from providers/injuryProvider.js
  // fetchTeamDepthChart — only a confirmed Out/Doubtful/IR starting QB moves the
  // projection (see analysis/injuryImpact.js for why only QB gets a numeric effect).
  referee = null, // optional { name, penaltyRatio } from analysis/refereeTendencies.js —
  // >1 calls more penalties than league average. Informational note only, never a
  // point/total adjustment (see refereeTendencies.js for why); also typically
  // unavailable this far ahead of kickoff since crews aren't assigned until a few
  // days out — omit unless the caller has a real, known assignment for this game.
  eloPointsPerMargin = ELO_CONSTANTS.NFL_ELO_POINTS_PER_MARGIN, // Elo-points-per-margin-point
  // scaling for winProbToSpread — defaults to the NFL constant. CFB callers (cfbEdgeBoard.js)
  // pass ELO_CONSTANTS.CFB_ELO_POINTS_PER_MARGIN: CFBD's Elo uses a much wider scale (real
  // blowout margins are far larger in CFB), confirmed by backtest — see powerRatings.js.
  marginBlendWeights = MARGIN_BLEND_WEIGHTS, // { eff, elo, epa } — see the constant above
  winProbBlendWeights = WIN_PROB_BLEND_WEIGHTS, // { elo, score } — see the constant above
}) {
  const eloWinProb = matchupWinProbability({ homeRating: home.rating, awayRating: away.rating, neutralSite });
  const eloSpread = winProbToSpread(eloWinProb, eloPointsPerMargin); // home margin implied by Elo

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
  // When real EPA/play data is available (epaSplits), fold it in as a third,
  // independently-derived estimate — EPA/play is the strongest single
  // per-play efficiency signal available, so it gets a full ensemble share
  // rather than a capped nudge like the scheme/NGS adjustments below.
  const effMargin = homePointsEst - awayPointsEst;
  const epaEdgePerPlay = epaMatchupEdgePerPlay(epaSplits.home, epaSplits.away);
  const epaImpliedSpread = epaEdgePerPlay != null ? epaEdgePerPlay * AVG_PLAYS_PER_GAME : null;
  const blendedMargin = epaImpliedSpread != null
    ? effMargin * marginBlendWeights.eff + eloSpread * marginBlendWeights.elo + epaImpliedSpread * marginBlendWeights.epa
    // No EPA data: renormalize eff/elo to sum to 1 rather than a separate
    // hardcoded fallback (with the original 0.35/0.35/0.30 weights this
    // renormalizes to exactly 0.5/0.5, so it's a strict generalization).
    : effMargin * (marginBlendWeights.eff / (marginBlendWeights.eff + marginBlendWeights.elo))
      + eloSpread * (marginBlendWeights.elo / (marginBlendWeights.eff + marginBlendWeights.elo));
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

  // Next Gen Stats position-group edge (receiving/rushing skill vs. the
  // opponent's points-allowed proxy — see positionMatchup.js for the honest
  // scope limit: no free defensive-tracking data exists, so this is a
  // one-sided offensive-strength signal, not a true two-way coverage matchup).
  // Capped the same way as the pass-rush mismatch so no single signal can
  // swing the projection more than a few points.
  const homeNgsEdge = combineNgsEdges(ngsEdges.homeReceivingEdge, ngsEdges.homeRushingEdge);
  const awayNgsEdge = combineNgsEdges(ngsEdges.awayReceivingEdge, ngsEdges.awayRushingEdge);
  homePointsEst *= 1 + clamp((homeNgsEdge - 1) * 0.06, -0.06, 0.06);
  awayPointsEst *= 1 + clamp((awayNgsEdge - 1) * 0.06, -0.06, 0.06);

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

  // Confirmed starting-QB injury: a flat point subtraction (not a
  // multiplier — see injuryImpact.js for why this is the one position that
  // gets a numeric adjustment at all) applied last so it isn't compounded
  // or diminished by the multiplicative adjustments above.
  const homeQbInjury = findStarterInjury(injuries.home, 'qb');
  const awayQbInjury = findStarterInjury(injuries.away, 'qb');
  if (homeQbInjury) homePointsEst -= QB_OUT_POINT_PENALTY;
  if (awayQbInjury) awayPointsEst -= QB_OUT_POINT_PENALTY;

  const projectedSpread = homePointsEst - awayPointsEst; // positive => home favored
  const projectedTotal = homePointsEst + awayPointsEst;

  // Final win probability blends Elo (rating-history based) with the
  // matchup-specific efficiency signal, converted via the same logistic used
  // for Elo so the two are on a comparable scale.
  const scoreBasedWinProb = 1 / (1 + Math.exp(-projectedSpread / 7)); // ~7 pts ~ 1 std dev of NFL margins
  const homeWinProb = clamp(eloWinProb * winProbBlendWeights.elo + scoreBasedWinProb * winProbBlendWeights.score, 0.02, 0.98);

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
      ...describeNgsEdges(home.abbr, away.abbr, homeNgsEdge, awayNgsEdge),
      ...describeEpaEdge(home.abbr, away.abbr, epaImpliedSpread),
      ...describeQbInjuries(home.abbr, away.abbr, homeQbInjury, awayQbInjury),
      ...starterInjuryNotes(home.abbr, injuries.home),
      ...starterInjuryNotes(away.abbr, injuries.away),
      ...describeRefereeTendency(referee),
      ...manualCoachNotes(home.abbr, away.abbr, coachNotes),
    ],
  };
}

// Averages whichever NGS edges were supplied (receiving, rushing) into one
// offense-side multiplier; missing edges (no data for that position group)
// don't drag the average toward 1, they're just excluded.
function combineNgsEdges(...edges) {
  const present = edges.filter((e) => e != null && Number.isFinite(e));
  if (present.length === 0) return 1;
  return present.reduce((s, e) => s + e, 0) / present.length;
}

// EPA-implied spread is in points (home perspective); a couple points is a
// real edge on the strongest per-play efficiency signal available.
function describeEpaEdge(homeAbbr, awayAbbr, epaImpliedSpread) {
  if (epaImpliedSpread == null) return [];
  if (epaImpliedSpread > 2) return [`${homeAbbr} grades out clearly better in per-play efficiency (EPA/play, offense and defense) than this matchup's raw numbers alone suggest`];
  if (epaImpliedSpread < -2) return [`${awayAbbr} grades out clearly better in per-play efficiency (EPA/play, offense and defense) than this matchup's raw numbers alone suggest`];
  return [];
}

// Informational only — see refereeTendencies.js for why this doesn't move
// point projections (penalty-rate effect sizes on scoring aren't
// established well enough to state a confident point value the way the
// QB-out penalty above is).
function describeRefereeTendency(referee) {
  if (!referee?.penaltyRatio) return [];
  if (referee.penaltyRatio > 1.1) return [`Referee ${referee.name}'s games run heavier on penalties than league average (${referee.penaltyRatio.toFixed(2)}x) — expect more stoppages/free plays; lean toward the total accordingly`];
  if (referee.penaltyRatio < 0.9) return [`Referee ${referee.name}'s games run lighter on penalties than league average (${referee.penaltyRatio.toFixed(2)}x) — expect a cleaner, faster-moving game; lean toward the under accordingly`];
  return [];
}

function describeQbInjuries(homeAbbr, awayAbbr, homeQbInjury, awayQbInjury) {
  const notes = [];
  if (homeQbInjury) notes.push(`${homeAbbr} starting QB ${homeQbInjury.player} is ${homeQbInjury.status.toLowerCase()}${homeQbInjury.note ? ` — ${homeQbInjury.note}` : ''} — projection docked ${QB_OUT_POINT_PENALTY} points`);
  if (awayQbInjury) notes.push(`${awayAbbr} starting QB ${awayQbInjury.player} is ${awayQbInjury.status.toLowerCase()}${awayQbInjury.note ? ` — ${awayQbInjury.note}` : ''} — projection docked ${QB_OUT_POINT_PENALTY} points`);
  return notes;
}

function describeNgsEdges(homeAbbr, awayAbbr, homeNgsEdge, awayNgsEdge) {
  const notes = [];
  if (homeNgsEdge > 1.1) notes.push(`${homeAbbr}'s skill-position tracking data (separation/YAC/rush efficiency) grades above average vs. this defense — Next Gen Stats, multi-year weighted`);
  if (awayNgsEdge > 1.1) notes.push(`${awayAbbr}'s skill-position tracking data (separation/YAC/rush efficiency) grades above average vs. this defense — Next Gen Stats, multi-year weighted`);
  return notes;
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
