import { matchupWinProbability } from './powerRatings.js';
import { removeVigMultiWay, edgePercent } from './probability.js';
import { TEAMS } from '../data/teams.js';

// Monte Carlo season simulation: division winners, playoff field, conference
// champions, and Super Bowl champion, all derived from current Elo ratings
// plus the remaining schedule. This is the same family of approach public
// models (538's NFL forecast, ESPN FPI) use for futures pricing — simulate
// the season many times and count outcomes, rather than hand-picking winners.
//
// Simplifications, clearly called out: tiebreakers (head-to-head, strength of
// victory, etc.) are NOT modeled — ties in the standings are broken randomly.
// Playoff seeding/reseeding follows the modern 7-team format (4 division
// winners + 3 wildcards) but does not model bye-week rest effects.
export function simulateSeason({ teams, remainingSchedule, iterations = 10000, rng = Math.random }) {
  const abbrs = Object.keys(teams);
  const tally = Object.fromEntries(abbrs.map((a) => [a, {
    divisionWins: 0, playoffBerths: 0, conferenceWins: 0, superBowlWins: 0,
  }]));

  for (let i = 0; i < iterations; i++) {
    const records = simulateOneSeason(teams, remainingSchedule, rng);
    const divisionWinners = pickDivisionWinners(records, rng);
    for (const abbr of Object.values(divisionWinners)) tally[abbr].divisionWins++;

    const playoffField = { AFC: buildPlayoffField('AFC', records, divisionWinners, rng), NFC: buildPlayoffField('NFC', records, divisionWinners, rng) };
    for (const conf of ['AFC', 'NFC']) for (const abbr of playoffField[conf]) tally[abbr].playoffBerths++;

    const afcChamp = simulateBracket(playoffField.AFC, teams, rng);
    const nfcChamp = simulateBracket(playoffField.NFC, teams, rng);
    tally[afcChamp].conferenceWins++;
    tally[nfcChamp].conferenceWins++;

    const sbWinner = simulateGame(afcChamp, nfcChamp, teams, rng, true);
    tally[sbWinner].superBowlWins++;
  }

  const out = {};
  for (const abbr of abbrs) {
    out[abbr] = {
      divisionWinPct: tally[abbr].divisionWins / iterations,
      playoffPct: tally[abbr].playoffBerths / iterations,
      conferenceWinPct: tally[abbr].conferenceWins / iterations,
      superBowlWinPct: tally[abbr].superBowlWins / iterations,
    };
  }
  return out;
}

function simulateGame(homeAbbr, awayAbbr, teams, rng, neutralSite = false) {
  const p = matchupWinProbability({ homeRating: teams[homeAbbr].rating, awayRating: teams[awayAbbr].rating, neutralSite });
  return rng() < p ? homeAbbr : awayAbbr;
}

function simulateOneSeason(teams, remainingSchedule, rng) {
  const records = {};
  for (const [abbr, t] of Object.entries(teams)) {
    records[abbr] = { wins: t.currentWins ?? 0, losses: t.currentLosses ?? 0, ties: t.currentTies ?? 0 };
  }
  for (const game of remainingSchedule) {
    const winner = simulateGame(game.home, game.away, teams, rng, game.neutralSite);
    const loser = winner === game.home ? game.away : game.home;
    records[winner].wins++;
    records[loser].losses++;
  }
  return records;
}

function winPct(r) { return (r.wins + 0.5 * r.ties) / Math.max(1, r.wins + r.losses + r.ties); }

function pickDivisionWinners(records, rng) {
  const winners = {};
  const divisions = groupTeamsByDivision();
  for (const [divKey, abbrs] of divisions) {
    winners[divKey] = topByRecord(abbrs, records, rng)[0];
  }
  return winners;
}

function buildPlayoffField(conf, records, divisionWinners, rng) {
  const divKeys = [...groupTeamsByDivisionForConf(conf).keys()];
  const champs = divKeys.map((k) => divisionWinners[k]);
  const rest = Object.entries(TEAMS)
    .filter(([abbr, t]) => t.conf === conf && !champs.includes(abbr))
    .map(([abbr]) => abbr);
  const wildcards = topByRecord(rest, records, rng).slice(0, 3);
  // Seed 1-4 = division winners by record, 5-7 = wildcards by record.
  const seeded = [...topByRecord(champs, records, rng), ...wildcards];
  return seeded;
}

function topByRecord(abbrs, records, rng) {
  return [...abbrs].sort((a, b) => {
    const diff = winPct(records[b]) - winPct(records[a]);
    if (diff !== 0) return diff;
    return rng() - 0.5; // unresolved tie -> random (tiebreakers not modeled)
  });
}

// Standard bracket: 1-seed byes, 2v7, 3v6, 4v5, higher seed hosts each round.
function simulateBracket(seeds, teams, rng) {
  const [s1, s2, s3, s4, s5, s6, s7] = seeds;
  const r1 = [
    simulateGame(s2, s7, teams, rng),
    simulateGame(s3, s6, teams, rng),
    simulateGame(s4, s5, teams, rng),
  ];
  const bySeed = (a, b) => seeds.indexOf(a) - seeds.indexOf(b);
  const semis = [s1, ...r1].sort(bySeed);
  const semiWinners = [
    simulateGame(semis[0], semis[3], teams, rng),
    simulateGame(semis[1], semis[2], teams, rng),
  ].sort(bySeed);
  return simulateGame(semiWinners[0], semiWinners[1], teams, rng);
}

function groupTeamsByDivision() {
  const map = new Map();
  for (const [abbr, t] of Object.entries(TEAMS)) {
    const key = `${t.conf} ${t.div}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(abbr);
  }
  return map;
}

function groupTeamsByDivisionForConf(conf) {
  const map = new Map();
  for (const [abbr, t] of Object.entries(TEAMS)) {
    if (t.conf !== conf) continue;
    const key = `${t.conf} ${t.div}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(abbr);
  }
  return map;
}

// Compare simulated probabilities to a futures market snapshot.
// `marketOdds`: array of { team, price } all quoted for the same market
// (e.g. every team's division-winner price) — used to remove vig collectively.
export function findFuturesValue(modelProbsByTeam, marketOdds, marketLabel) {
  const prices = marketOdds.map((m) => m.price);
  const { probs: fairProbs } = removeVigMultiWay(prices);
  return marketOdds
    .map((m, i) => {
      const modelProb = modelProbsByTeam[m.team];
      if (modelProb == null) return null;
      return {
        market: marketLabel,
        team: m.team,
        price: m.price,
        modelProb: round3(modelProb),
        marketFairProb: round3(fairProbs[i]),
        edgePct: round2(edgePercent(modelProb, m.price)),
      };
    })
    .filter((r) => r && r.edgePct >= 3)
    .sort((a, b) => b.edgePct - a.edgePct);
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
