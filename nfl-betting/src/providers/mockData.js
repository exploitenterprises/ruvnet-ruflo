// Synthetic offline fixtures — NOT real statistics. These exist purely so the
// pipeline (`npm run update -- --source mock`) and the test suite can run
// deterministically with no network access and no API keys. Every number
// here is procedurally generated from a seeded PRNG, not sourced from any
// real season. Swap to providers/statsProvider.js + oddsProvider.js +
// weatherProvider.js for real data.
import { TEAMS } from '../data/teams.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h;
}

export function generateMockSeasonStats() {
  const stats = {};
  for (const abbr of Object.keys(TEAMS)) {
    const rand = mulberry32(hashSeed(abbr + '-season'));
    const pointsForPerGame = 17 + rand() * 12; // 17-29
    const pointsAgainstPerGame = 17 + rand() * 12;
    const homeBoost = 1 + rand() * 0.08;
    const awayPenalty = 1 - rand() * 0.08;
    stats[abbr] = {
      abbr,
      gamesPlayed: 17,
      pointsForPerGame: round1(pointsForPerGame),
      pointsAgainstPerGame: round1(pointsAgainstPerGame),
      homePointsForPerGame: round1(pointsForPerGame * homeBoost),
      homePointsAgainstPerGame: round1(pointsAgainstPerGame * awayPenalty),
      awayPointsForPerGame: round1(pointsForPerGame * awayPenalty),
      awayPointsAgainstPerGame: round1(pointsAgainstPerGame * homeBoost),
      passYardsPerGame: round1(200 + rand() * 90),
      rushYardsPerGame: round1(90 + rand() * 60),
      yardsPerPlay: round1(4.8 + rand() * 1.6),
      playsPerGame: round1(60 + rand() * 8),
      thirdDownPct: round1(33 + rand() * 12),
      redZoneTdPct: round1(50 + rand() * 20),
      sackRate: round1(5 + rand() * 4),
      sackRateAllowed: round1(5 + rand() * 4),
      fourthDownAttemptRate: round1(1 + rand() * 2.5),
      priorSeasonPointDiffPerGame: round1((pointsForPerGame - pointsAgainstPerGame)),
    };
  }
  return stats;
}

export function generateMockWeekSlate(week = 1) {
  const abbrs = Object.keys(TEAMS);
  const rand = mulberry32(hashSeed('slate-' + week));
  const shuffled = [...abbrs].sort(() => rand() - 0.5);
  const games = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    games.push({ home: shuffled[i], away: shuffled[i + 1], neutralSite: false });
  }
  return games;
}

export function generateMockRemainingSchedule(weeksRemaining = 17) {
  const games = [];
  for (let w = 1; w <= weeksRemaining; w++) games.push(...generateMockWeekSlate(1000 + w));
  return games;
}

// Deliberately includes a couple of off-consensus prices so the value finder
// demo has something to surface.
export function generateMockGameLines(games) {
  const lines = [];
  for (const [i, g] of games.entries()) {
    const rand = mulberry32(hashSeed('lines-' + g.home + g.away));
    const spread = round1((rand() - 0.5) * 10);
    const total = round1(41 + rand() * 8);
    const homePrice = spread <= 0 ? -110 - Math.round(Math.abs(spread) * 8) : -110 + Math.round(spread * 8);
    const awayPrice = -220 - homePrice;
    const skew = i === 0 ? 25 : 0; // inject a mispricing on the first game for demo purposes
    for (const book of ['DraftKings', 'FanDuel', 'BetMGM']) {
      lines.push({ book, gameId: `${g.away}@${g.home}`, market: 'moneyline', side: 'home', price: homePrice + (book === 'BetMGM' ? skew : 0) });
      lines.push({ book, gameId: `${g.away}@${g.home}`, market: 'moneyline', side: 'away', price: awayPrice });
      lines.push({ book, gameId: `${g.away}@${g.home}`, market: 'spread', side: 'home', price: -110, points: -spread });
      lines.push({ book, gameId: `${g.away}@${g.home}`, market: 'spread', side: 'away', price: -110, points: spread });
      lines.push({ book, gameId: `${g.away}@${g.home}`, market: 'total', side: 'over', price: -110, points: total });
      lines.push({ book, gameId: `${g.away}@${g.home}`, market: 'total', side: 'under', price: -110, points: total });
    }
  }
  return lines;
}

export function generateMockFutures(marketLabel = 'division-winner') {
  const rand = mulberry32(hashSeed('futures-' + marketLabel));
  return Object.keys(TEAMS).map((team) => ({ team, price: Math.round(300 + rand() * 3000) }));
}

function round1(v) { return Math.round(v * 10) / 10; }
