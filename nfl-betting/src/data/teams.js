// Team/conference/division structure. Stable year-to-year; update only if the
// league realigns. Abbreviations match ESPN's team abbreviations so provider
// responses can be joined directly against this table.
export const TEAMS = {
  BUF: { name: 'Buffalo Bills', conf: 'AFC', div: 'East' },
  MIA: { name: 'Miami Dolphins', conf: 'AFC', div: 'East' },
  NE: { name: 'New England Patriots', conf: 'AFC', div: 'East' },
  NYJ: { name: 'New York Jets', conf: 'AFC', div: 'East' },
  BAL: { name: 'Baltimore Ravens', conf: 'AFC', div: 'North' },
  CIN: { name: 'Cincinnati Bengals', conf: 'AFC', div: 'North' },
  CLE: { name: 'Cleveland Browns', conf: 'AFC', div: 'North' },
  PIT: { name: 'Pittsburgh Steelers', conf: 'AFC', div: 'North' },
  HOU: { name: 'Houston Texans', conf: 'AFC', div: 'South' },
  IND: { name: 'Indianapolis Colts', conf: 'AFC', div: 'South' },
  JAX: { name: 'Jacksonville Jaguars', conf: 'AFC', div: 'South' },
  TEN: { name: 'Tennessee Titans', conf: 'AFC', div: 'South' },
  DEN: { name: 'Denver Broncos', conf: 'AFC', div: 'West' },
  KC: { name: 'Kansas City Chiefs', conf: 'AFC', div: 'West' },
  LV: { name: 'Las Vegas Raiders', conf: 'AFC', div: 'West' },
  LAC: { name: 'Los Angeles Chargers', conf: 'AFC', div: 'West' },
  DAL: { name: 'Dallas Cowboys', conf: 'NFC', div: 'East' },
  NYG: { name: 'New York Giants', conf: 'NFC', div: 'East' },
  PHI: { name: 'Philadelphia Eagles', conf: 'NFC', div: 'East' },
  WAS: { name: 'Washington Commanders', conf: 'NFC', div: 'East' },
  CHI: { name: 'Chicago Bears', conf: 'NFC', div: 'North' },
  DET: { name: 'Detroit Lions', conf: 'NFC', div: 'North' },
  GB: { name: 'Green Bay Packers', conf: 'NFC', div: 'North' },
  MIN: { name: 'Minnesota Vikings', conf: 'NFC', div: 'North' },
  ATL: { name: 'Atlanta Falcons', conf: 'NFC', div: 'South' },
  CAR: { name: 'Carolina Panthers', conf: 'NFC', div: 'South' },
  NO: { name: 'New Orleans Saints', conf: 'NFC', div: 'South' },
  TB: { name: 'Tampa Bay Buccaneers', conf: 'NFC', div: 'South' },
  ARI: { name: 'Arizona Cardinals', conf: 'NFC', div: 'West' },
  LAR: { name: 'Los Angeles Rams', conf: 'NFC', div: 'West' },
  SF: { name: 'San Francisco 49ers', conf: 'NFC', div: 'West' },
  SEA: { name: 'Seattle Seahawks', conf: 'NFC', div: 'West' },
};

export function divisionOf(abbr) {
  const t = TEAMS[abbr];
  return t ? `${t.conf} ${t.div}` : undefined;
}

export function teamsInDivision(conf, div) {
  return Object.entries(TEAMS)
    .filter(([, t]) => t.conf === conf && t.div === div)
    .map(([abbr]) => abbr);
}

export const ALL_DIVISIONS = ['AFC East', 'AFC North', 'AFC South', 'AFC West',
  'NFC East', 'NFC North', 'NFC South', 'NFC West'];
