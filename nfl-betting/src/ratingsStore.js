import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRating, regressToMean, updateRatingsAfterGame } from './analysis/powerRatings.js';
import { TEAMS } from './data/teams.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const RATINGS_FILE = path.join(CACHE_DIR, 'ratings.json');

export async function loadRatings() {
  try {
    return JSON.parse(await readFile(RATINGS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export async function saveRatings(ratings) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(RATINGS_FILE, JSON.stringify(ratings, null, 2));
}

// Seed every team's rating from prior-season point differential, with
// regression toward the mean (new season = new rosters/schemes/injuries).
export function seedSeasonRatings(priorSeasonStatsByTeam) {
  const ratings = {};
  for (const abbr of Object.keys(TEAMS)) {
    const diff = priorSeasonStatsByTeam[abbr]?.priorSeasonPointDiffPerGame
      ?? (priorSeasonStatsByTeam[abbr]
        ? priorSeasonStatsByTeam[abbr].pointsForPerGame - priorSeasonStatsByTeam[abbr].pointsAgainstPerGame
        : 0);
    ratings[abbr] = regressToMean(seedRating(diff));
  }
  return ratings;
}

// Apply a batch of completed-game results to move ratings forward one week.
export function applyResults(ratings, completedGames) {
  const next = { ...ratings };
  for (const g of completedGames) {
    if (g.home.score == null || g.away.score == null) continue;
    const { homeRating, awayRating } = updateRatingsAfterGame({
      homeRating: next[g.home.abbr],
      awayRating: next[g.away.abbr],
      homeScore: g.home.score,
      awayScore: g.away.score,
      neutralSite: g.neutralSite,
    });
    next[g.home.abbr] = homeRating;
    next[g.away.abbr] = awayRating;
  }
  return next;
}
