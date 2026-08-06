// Sportsbook odds provider backed by The Odds API (https://the-odds-api.com).
// Requires a free-tier (or paid) API key in ODDS_API_KEY — sign up at
// the-odds-api.com, no purchase required for the free tier. Without a key,
// weeklyUpdate.js falls back to providers/mockData.js so the rest of the
// pipeline still runs end to end for review/testing.

const BASE = 'https://api.the-odds-api.com/v4';

function requireKey() {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY is not set — sign up free at https://the-odds-api.com and export it.');
  return key;
}

// Game lines: moneyline (h2h), spreads, totals, across every book the API returns.
export async function fetchGameLines({ regions = 'us', bookmakers } = {}) {
  const key = requireKey();
  const params = new URLSearchParams({
    apiKey: key,
    regions,
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american',
  });
  if (bookmakers) params.set('bookmakers', bookmakers);
  const res = await fetch(`${BASE}/sports/americanfootball_nfl/odds?${params}`);
  if (!res.ok) throw new Error(`The Odds API ${res.status} ${res.statusText}`);
  return normalizeGameLines(await res.json());
}

// Futures: pass an Odds API outright market key, e.g.
// 'americanfootball_nfl_super_bowl_winner'. Division-winner outright markets
// are not consistently offered by every book on this API; check the current
// market catalog at the-odds-api.com/sports-odds-data/sports-apis.html.
export async function fetchFutures(marketKey, { regions = 'us' } = {}) {
  const key = requireKey();
  const params = new URLSearchParams({ apiKey: key, regions, markets: 'outrights', oddsFormat: 'american' });
  const res = await fetch(`${BASE}/sports/${marketKey}/odds?${params}`);
  if (!res.ok) throw new Error(`The Odds API ${res.status} ${res.statusText}`);
  const json = await res.json();
  const event = json[0];
  const book = event?.bookmakers?.[0];
  const market = book?.markets?.find((m) => m.key === 'outrights');
  return (market?.outcomes ?? []).map((o) => ({ team: o.name, price: o.price }));
}

function normalizeGameLines(events) {
  const lines = [];
  for (const event of events) {
    const homeTeam = event.home_team;
    const awayTeam = event.away_team;
    for (const bookmaker of event.bookmakers ?? []) {
      for (const market of bookmaker.markets ?? []) {
        for (const outcome of market.outcomes ?? []) {
          lines.push(mapOutcome({ event, homeTeam, awayTeam, bookmaker, market, outcome }));
        }
      }
    }
  }
  return lines.filter(Boolean);
}

function mapOutcome({ event, homeTeam, awayTeam, bookmaker, market, outcome }) {
  // homeTeam/awayTeam (The Odds API's own full team names, e.g. "Kansas City
  // Chiefs") are carried through here deliberately: `event.id` is an Odds-API-
  // internal id that never matches ESPN's event ids (statsProvider.js's
  // fetchWeekScoreboard), so callers joining these lines to ESPN-sourced
  // projections must match on team name (via src/data/teams.js's TEAMS[abbr].name),
  // not gameId — see weeklyUpdate.js's runWithLiveData.
  const base = { gameId: event.id, homeTeam, awayTeam, book: bookmaker.title, price: outcome.price };
  if (market.key === 'h2h') {
    return { ...base, market: 'moneyline', side: outcome.name === homeTeam ? 'home' : 'away' };
  }
  if (market.key === 'spreads') {
    return { ...base, market: 'spread', side: outcome.name === homeTeam ? 'home' : 'away', points: outcome.point };
  }
  if (market.key === 'totals') {
    return { ...base, market: 'total', side: outcome.name.toLowerCase(), points: outcome.point };
  }
  return null;
}
