// College football reference data. Unlike the NFL's fixed 32-team/8-division
// structure, FBS has 130+ teams across 10 conferences that realign every few
// years — so this intentionally covers the Power 4 conferences plus the
// programs that actually move betting markets (CFP contenders, ranked Group
// of 5 teams), not an exhaustive 130-team roster. Extend as coverage needs grow.
export const CFB_CONFERENCES = {
  SEC: ['Georgia', 'Texas', 'Alabama', 'LSU', 'Texas A&M', 'Ole Miss', 'Tennessee', 'Oklahoma', 'Florida', 'Auburn', 'Missouri', 'South Carolina'],
  'Big Ten': ['Ohio State', 'Oregon', 'Indiana', 'Penn State', 'Michigan', 'Iowa', 'USC', 'Illinois', 'Wisconsin', 'Nebraska'],
  ACC: ['Miami', 'SMU', 'Louisville', 'Clemson', 'Florida State', 'Virginia', 'Duke', 'Georgia Tech', 'Pitt'],
  'Big 12': ['Texas Tech', 'Utah', 'BYU', 'Iowa State', 'Kansas State', 'Arizona State', 'TCU', 'Colorado'],
  'Group of 5': ['Boise State', 'Memphis', 'Tulane', 'James Madison', 'Liberty', 'Army', 'Navy'],
  Independent: ['Notre Dame'],
};

export function conferenceOf(team) {
  for (const [conf, teams] of Object.entries(CFB_CONFERENCES)) {
    if (teams.includes(team)) return conf;
  }
  return undefined;
}
