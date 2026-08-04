import { STADIUMS } from './data/stadiums.js';
import { TEAMS } from './data/teams.js';
import { computeLeagueAverages } from './analysis/leagueAverages.js';
import { projectGame } from './analysis/matchupEngine.js';
import { findValueBets } from './analysis/valueFinder.js';
import { simulateSeason, findFuturesValue } from './analysis/futures.js';
import { loadRatings, saveRatings, seedSeasonRatings, applyResults } from './ratingsStore.js';
import { renderWeeklyMarkdown } from './report.js';
import { loadCoachNotes } from './analysis/schemeTendencies.js';
import { computeTeamEpaSplits } from './analysis/teamEpa.js';
import { buildEdgeBoard, nflMarketLine } from './analysis/edgeBoard.js';
import * as mock from './providers/mockData.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_NOTES_PATH = path.join(__dirname, '..', 'data', 'coach-notes.json');

// The Odds API's team names are full names ("Kansas City Chiefs"); ESPN
// (and this project's projections) use abbreviations ("KC"). This is the
// join key between the two — see oddsProvider.js's mapOutcome for why
// gameId can't be used across providers.
const NAME_TO_ABBR = Object.fromEntries(Object.entries(TEAMS).map(([abbr, t]) => [t.name, abbr]));

// Groups a flat lines array (mock or live) into { "AWAY@HOME": [...lines] },
// the join key used throughout this module. Live lines carry full team
// names (needs NAME_TO_ABBR); mock lines already carry gameId in this exact
// "AWAY@HOME" format (see providers/mockData.js's generateMockGameLines).
function groupLinesByGame(lines, { fromTeamNames = false } = {}) {
  const grouped = {};
  for (const line of lines) {
    let key;
    if (fromTeamNames) {
      const homeAbbr = NAME_TO_ABBR[line.homeTeam];
      const awayAbbr = NAME_TO_ABBR[line.awayTeam];
      if (!homeAbbr || !awayAbbr) continue;
      key = `${awayAbbr}@${homeAbbr}`;
    } else {
      key = line.gameId;
    }
    (grouped[key] ??= []).push(line);
  }
  return grouped;
}

// Orchestrates one weekly refresh: pull latest results/stats/schedule/weather/
// odds, roll the power ratings forward, project every game on the slate,
// scan for value against the books, and re-run the futures simulation.
// This is the single entry point the CLI calls — `source: 'mock'` runs fully
// offline/deterministic (for demos, CI, and this repo's test suite);
// `source: 'live'` wires in the real providers (needs network + ODDS_API_KEY).
export async function runWeeklyUpdate({ season, week, source = 'mock' }) {
  const generatedAt = new Date().toISOString();

  if (source === 'mock') return runWithMockData({ season, week, generatedAt });
  return runWithLiveData({ season, week, generatedAt });
}

async function runWithMockData({ season, week, generatedAt }) {
  const seasonStats = mock.generateMockSeasonStats();

  let ratings = await loadRatings();
  if (!ratings) {
    ratings = seedSeasonRatings(seasonStats);
    await saveRatings(ratings);
  }

  const slate = mock.generateMockWeekSlate(week);
  const leagueAvg = computeLeagueAverages(Object.values(seasonStats));
  const coachNotes = await loadCoachNotes(COACH_NOTES_PATH);

  const projections = slate.map((g) => projectGame({
    home: { abbr: g.home, stats: seasonStats[g.home], rating: ratings[g.home] },
    away: { abbr: g.away, stats: seasonStats[g.away], rating: ratings[g.away] },
    leagueAvg,
    weather: STADIUMS[g.home].roof === 'outdoor'
      ? { isDome: false, tempF: 45, windMph: 12, precipProbPct: 20 } // placeholder conditions in mock mode
      : { isDome: true },
    neutralSite: g.neutralSite,
    coachNotes,
  }));

  const lines = mock.generateMockGameLines(slate);
  const linesByGame = groupLinesByGame(lines);
  const valueBets = projections.flatMap((p) => findValueBets(p, linesByGame[`${p.away}@${p.home}`] ?? []));
  const marketLinesByGame = Object.fromEntries(Object.entries(linesByGame).map(([key, gameLines]) => [key, nflMarketLine(gameLines)]));
  const edgeBoard = buildEdgeBoard(projections, marketLinesByGame);

  const teamsForSim = Object.fromEntries(Object.keys(TEAMS).map((abbr) => [abbr, { rating: ratings[abbr], currentWins: 0, currentLosses: 0, currentTies: 0 }]));
  const remainingSchedule = mock.generateMockRemainingSchedule(17 - week);
  const simResults = simulateSeason({ teams: teamsForSim, remainingSchedule, iterations: 2000 });
  const divisionOdds = mock.generateMockFutures('division-winner');
  const divisionModelProbs = Object.fromEntries(Object.entries(simResults).map(([abbr, r]) => [abbr, r.divisionWinPct]));
  const futuresValue = findFuturesValue(divisionModelProbs, divisionOdds, 'division-winner');

  const markdown = renderWeeklyMarkdown({ season, week, source: 'mock (synthetic fixtures — see providers/mockData.js)', projections, valueBets, futuresValue, edgeBoard, generatedAt });
  return { season, week, source: 'mock', generatedAt, projections, valueBets, futuresValue, edgeBoard, markdown };
}

async function runWithLiveData({ season, week, generatedAt }) {
  const statsProvider = await import('./providers/statsProvider.js');
  const weatherProvider = await import('./providers/weatherProvider.js');
  const oddsProvider = await import('./providers/oddsProvider.js');

  const teamsIndex = await statsProvider.fetchTeamsIndex();
  const seasonStats = {};
  for (const t of teamsIndex) {
    const raw = await statsProvider.fetchTeamSeasonStats(season, t.id);
    seasonStats[t.abbr] = mapEspnStatsToModel(t.abbr, raw);
  }

  let ratings = await loadRatings();
  if (!ratings) {
    ratings = seedSeasonRatings(seasonStats);
  }
  if (week > 1) {
    const priorWeekResults = await statsProvider.fetchWeekScoreboard(season, week - 1);
    const completed = priorWeekResults.filter((g) => g.completed);
    ratings = applyResults(ratings, completed);
  }
  await saveRatings(ratings);

  const slate = await statsProvider.fetchWeekScoreboard(season, week);
  const leagueAvg = computeLeagueAverages(Object.values(seasonStats));
  const coachNotes = await loadCoachNotes(COACH_NOTES_PATH);

  const lines = await oddsProvider.fetchGameLines();

  // EPA/play is a value-add signal on top of the core projection, not a hard
  // dependency — if nflverse's play-by-play file isn't reachable (network
  // egress, or the season is too new for it to be published yet) or hasn't
  // recorded any plays before this week, degrade to the pre-EPA two-way
  // blend (see matchupEngine.js) rather than failing the whole weekly run.
  let epaSplitsByTeam = {};
  try {
    const nflverseProvider = await import('./providers/nflverseProvider.js');
    const pbpRows = await nflverseProvider.fetchPbp(season);
    epaSplitsByTeam = computeTeamEpaSplits(pbpRows, { throughWeek: week - 1 });
  } catch {
    epaSplitsByTeam = {};
  }
  const epaAvailable = Object.keys(epaSplitsByTeam).length > 0;

  // Starter-availability (QB injury) signal — same value-add-not-hard-dependency
  // posture as EPA above: a per-team depth-chart fetch failure degrades that
  // one team to "no injury data" (matchupEngine.js treats a missing depth
  // chart as no adjustment) rather than failing the whole weekly run.
  const injuryProvider = await import('./providers/injuryProvider.js');
  const teamIdByAbbr = Object.fromEntries(teamsIndex.map((t) => [t.abbr, t.id]));
  const depthChartCache = {};
  let injuriesAvailable = false;
  async function getDepthChart(abbr) {
    if (abbr in depthChartCache) return depthChartCache[abbr];
    let dc = null;
    try {
      const espnId = teamIdByAbbr[abbr];
      dc = espnId ? await injuryProvider.fetchTeamDepthChart(espnId) : null;
      if (dc) injuriesAvailable = true;
    } catch {
      dc = null;
    }
    depthChartCache[abbr] = dc;
    return dc;
  }

  const projections = [];
  for (const g of slate) {
    const stadium = STADIUMS[g.home.abbr];
    let weather = { isDome: true };
    if (stadium?.roof === 'outdoor') {
      try {
        const wx = await weatherProvider.fetchGameWeather({ lat: stadium.lat, lon: stadium.lon, kickoffIso: g.date });
        weather = wx;
      } catch (err) {
        weather = { isDome: false, note: `weather fetch failed: ${err.message}` };
      }
    }
    const homeDepthChart = await getDepthChart(g.home.abbr);
    const awayDepthChart = await getDepthChart(g.away.abbr);
    projections.push(projectGame({
      home: { abbr: g.home.abbr, stats: seasonStats[g.home.abbr], rating: ratings[g.home.abbr] },
      away: { abbr: g.away.abbr, stats: seasonStats[g.away.abbr], rating: ratings[g.away.abbr] },
      leagueAvg,
      weather,
      neutralSite: g.neutralSite,
      coachNotes,
      epaSplits: { home: epaSplitsByTeam[g.home.abbr], away: epaSplitsByTeam[g.away.abbr] },
      injuries: { home: homeDepthChart, away: awayDepthChart },
    }));
  }

  // NOTE: lines came from The Odds API, whose gameId is in a completely
  // different id space than ESPN's (the source of `slate`/projections) —
  // joining on gameId across the two providers silently matches nothing.
  // Join on team names instead (see NAME_TO_ABBR / groupLinesByGame above).
  const linesByGame = groupLinesByGame(lines, { fromTeamNames: true });
  const valueBets = projections.flatMap((p) => findValueBets(p, linesByGame[`${p.away}@${p.home}`] ?? []));
  const marketLinesByGame = Object.fromEntries(Object.entries(linesByGame).map(([key, gameLines]) => [key, nflMarketLine(gameLines)]));
  const edgeBoard = buildEdgeBoard(projections, marketLinesByGame);

  const teamsForSim = Object.fromEntries(Object.keys(TEAMS).map((abbr) => [abbr, { rating: ratings[abbr], currentWins: 0, currentLosses: 0, currentTies: 0 }]));
  // Live mode: the remaining schedule and current W-L records should be
  // pulled from statsProvider (full-season scoreboard fetch across weeks);
  // left as a documented extension point since it requires 18 additional
  // scoreboard calls this repo's test suite should not make on every run.
  const futuresValue = [];

  const source = `live (ESPN + The Odds API${epaAvailable ? ' + nflverse EPA' : ''}${injuriesAvailable ? ' + starter injuries' : ''})`;
  const markdown = renderWeeklyMarkdown({ season, week, source, projections, valueBets, futuresValue, edgeBoard, generatedAt });
  return { season, week, source: 'live', generatedAt, projections, valueBets, futuresValue, edgeBoard, markdown };
}

// ESPN's team-statistics field names aren't stable across categories; this is
// a best-effort mapping documented for maintainers to adjust as the schema drifts.
function mapEspnStatsToModel(abbr, raw) {
  return {
    abbr,
    gamesPlayed: raw.gamesPlayed ?? 17,
    pointsForPerGame: raw.avgPointsFor ?? raw.totalPointsPerGame ?? 21,
    pointsAgainstPerGame: raw.avgPointsAgainst ?? raw.totalPointsAgainstPerGame ?? 21,
    homePointsForPerGame: raw.avgPointsFor ?? 21,
    homePointsAgainstPerGame: raw.avgPointsAgainst ?? 21,
    awayPointsForPerGame: raw.avgPointsFor ?? 21,
    awayPointsAgainstPerGame: raw.avgPointsAgainst ?? 21,
    passYardsPerGame: raw.netPassingYardsPerGame ?? 220,
    rushYardsPerGame: raw.rushingYardsPerGame ?? 110,
    yardsPerPlay: raw.yardsPerPlay ?? 5.4,
    playsPerGame: raw.totalOffensivePlays ? raw.totalOffensivePlays / (raw.gamesPlayed ?? 17) : 64,
    thirdDownPct: raw.thirdDownConvPct ?? 39,
    redZoneTdPct: raw.redzoneTouchdownPct ?? 58,
    sackRate: raw.sacks ? (raw.sacks / (raw.gamesPlayed ?? 17)) : 2.5,
    sackRateAllowed: raw.sacksAllowed ? (raw.sacksAllowed / (raw.gamesPlayed ?? 17)) : 2.5,
    fourthDownAttemptRate: raw.fourthDownAttempts ? (raw.fourthDownAttempts / (raw.gamesPlayed ?? 17)) : 1.5,
    priorSeasonPointDiffPerGame: (raw.avgPointsFor ?? 21) - (raw.avgPointsAgainst ?? 21),
  };
}
