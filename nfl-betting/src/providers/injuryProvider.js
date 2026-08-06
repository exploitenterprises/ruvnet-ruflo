// ESPN's public depth-chart endpoint — same base/caveats as statsProvider.js
// (unofficial, undocumented API, no key required, can change without
// notice). Unlike the roster endpoint (flat, unordered player list) or the
// league-wide /injuries feed (no depth-chart context), this is genuinely
// rank-ordered per position with each athlete's current injury designation
// attached inline — confirmed by direct inspection, not assumed from
// ESPN's docs (there aren't any). That lets injuryImpact.js assert "the
// starting QB is Out" instead of guessing at starter status from roster order.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Trims ESPN's heavy per-athlete payload (each carries ~10 self-referential
// link objects) down to what injuryImpact.js actually reads: depth order
// (array position), name, and any injury designation.
export async function fetchTeamDepthChart(espnTeamId) {
  const json = await getJson(`${BASE}/teams/${espnTeamId}/depthcharts`);
  return (json.depthchart ?? []).map((group) => ({
    name: group.name,
    positions: Object.fromEntries(Object.entries(group.positions ?? {}).map(([posKey, posData]) => [
      posKey,
      {
        athletes: (posData.athletes ?? []).map((a) => ({
          id: a.id,
          displayName: a.displayName,
          injuries: (a.injuries ?? []).map((inj) => ({
            status: inj.status,
            date: inj.date,
            note: inj.shortComment ?? null,
          })),
        })),
      },
    ])),
  }));
}
