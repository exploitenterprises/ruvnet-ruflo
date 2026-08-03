// nflverse (https://github.com/nflverse/nflverse-data) — the community data
// project that republishes NFL Next Gen Stats as plain downloadable files.
// No API key, no OAuth, and no undocumented NFL.com endpoint to reverse
// engineer — this is the practical way to get NGS data. Confirmed reachable
// in this environment (unlike most odds/stats dashboards, which block
// automated fetches): GitHub release assets aren't behind the same
// restrictions as scraped HTML pages.
//
// Coverage: player-season Next Gen Stats for the three tracked position
// groups — passing (QB), rushing (RB), receiving (WR/TE) — back to 2016.
// There is no free public defensive-player tracking data (separation
// allowed, coverage grades, etc.); that gap is real and stays undocumented
// rather than faked — see positionMatchup.js.

const RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats';

async function fetchGzippedCsv(filename) {
  const res = await fetch(`${RELEASE_BASE}/${filename}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`nflverse-data ${res.status} ${res.statusText} for ${filename}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const zlib = await import('node:zlib');
  const csv = zlib.gunzipSync(buf).toString('utf8');
  return parseCsv(csv);
}

// Minimal dependency-free CSV parser. Handles quoted fields (in case a
// player name or team field ever contains a comma) without pulling in a
// package for three files.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function coerceNumeric(rows, numericFields) {
  return rows.map((r) => {
    const out = { ...r };
    for (const f of numericFields) out[f] = out[f] === '' || out[f] == null ? null : Number(out[f]);
    return out;
  });
}

const RECEIVING_NUMERIC = ['season', 'week', 'avg_cushion', 'avg_separation', 'avg_intended_air_yards',
  'percent_share_of_intended_air_yards', 'receptions', 'targets', 'catch_percentage', 'yards',
  'rec_touchdowns', 'avg_yac', 'avg_expected_yac', 'avg_yac_above_expectation'];
const PASSING_NUMERIC = ['season', 'week', 'avg_time_to_throw', 'avg_completed_air_yards', 'avg_intended_air_yards',
  'avg_air_yards_differential', 'aggressiveness', 'max_completed_air_distance', 'avg_air_yards_to_sticks',
  'attempts', 'pass_yards', 'pass_touchdowns', 'interceptions', 'passer_rating', 'completions',
  'completion_percentage', 'expected_completion_percentage', 'completion_percentage_above_expectation', 'avg_air_distance', 'max_air_distance'];
const RUSHING_NUMERIC = ['season', 'week', 'efficiency', 'percent_attempts_gte_eight_defenders', 'avg_time_to_los',
  'rush_attempts', 'rush_yards', 'expected_rush_yards', 'rush_yards_over_expected', 'avg_rush_yards',
  'rush_yards_over_expected_per_att', 'rush_pct_over_expected', 'rush_touchdowns'];

export async function fetchNgsReceiving() {
  return coerceNumeric(await fetchGzippedCsv('ngs_receiving.csv.gz'), RECEIVING_NUMERIC);
}
export async function fetchNgsPassing() {
  return coerceNumeric(await fetchGzippedCsv('ngs_passing.csv.gz'), PASSING_NUMERIC);
}
export async function fetchNgsRushing() {
  return coerceNumeric(await fetchGzippedCsv('ngs_rushing.csv.gz'), RUSHING_NUMERIC);
}
