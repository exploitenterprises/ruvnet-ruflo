// ESPN's public depth-chart endpoint — same base/caveats as statsProvider.js
// (unofficial, undocumented API, no key required, can change without
// notice). Unlike the roster endpoint (flat, unordered player list) or the
// league-wide /injuries feed (no depth-chart context), this is genuinely
// rank-ordered per position with each athlete's current injury designation
// attached inline — confirmed by direct inspection, not assumed from
// ESPN's docs (there aren't any). That lets injuryImpact.js assert "the
// starting QB is Out" instead of guessing at starter status from roster order.

// site.api.espn.com sits behind Akamai bot detection that 403s Node's native
// fetch() regardless of headers, but a plain (default-User-Agent) curl call
// passes — same root cause and fix as statsProvider.js's getJson.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CFB_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';

// --retry-all-errors covers a raw dropped connection (curl exit 35,
// SSL_ERROR_SYSCALL), not just timeouts/5xx — see statsProvider.js's
// getJson for where this was actually observed (hundreds of sequential
// calls in a full-season backtest hit one transient reset).
async function getJson(url) {
  const { stdout } = await execFileAsync('curl', [
    '-sS', '-w', '\n%{http_code}', '--retry', '3', '--retry-all-errors', '--retry-delay', '1', url,
  ], { maxBuffer: 20 * 1024 * 1024 });
  const splitAt = stdout.lastIndexOf('\n');
  const body = stdout.slice(0, splitAt);
  const statusCode = Number(stdout.slice(splitAt + 1).trim());
  if (statusCode < 200 || statusCode >= 300) throw new Error(`ESPN API ${statusCode} for ${url}`);
  return JSON.parse(body);
}

// Trims ESPN's heavy per-athlete payload (each carries ~10 self-referential
// link objects) down to what injuryImpact.js actually reads: depth order
// (array position), name, and any injury designation. Shared by both the NFL
// and CFB depth-chart endpoints below — identical response shape confirmed
// by direct inspection (only the base URL and team-id space differ).
function mapDepthChart(json) {
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

export async function fetchTeamDepthChart(espnTeamId) {
  return mapDepthChart(await getJson(`${BASE}/teams/${espnTeamId}/depthcharts`));
}

// CFB has no equivalent of statsProvider.js's fetchTeamsIndex (this project
// has never called the CFB teams list before — CFBD is the CFB stats source
// of record). ESPN's own CFB team id space is unrelated to CFBD's, so this
// exists purely to join CFBD's school names (cfbdProvider.js's canonical
// team key throughout this project) to an ESPN numeric team id for the
// depth-chart call. Join key is `location` ("Ohio State", not "Ohio State
// Buckeyes") — confirmed live: all 136 CFBD FBS school names match an ESPN
// `location` exactly, no fuzzy matching needed. `limit=900` covers every
// division ESPN tracks (FBS is a small fraction of the ~750 total).
export async function fetchCfbTeamIdsBySchool() {
  const json = await getJson(`${CFB_BASE}/teams?limit=900`);
  const list = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return Object.fromEntries(list.map((t) => [t.team.location, t.team.id]));
}

export async function fetchCfbTeamDepthChart(espnTeamId) {
  return mapDepthChart(await getJson(`${CFB_BASE}/teams/${espnTeamId}/depthcharts`));
}
