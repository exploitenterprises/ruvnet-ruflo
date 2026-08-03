// Turns the picks ledger (data/picks-ledger.json) into the record/streak
// numbers the board displays. Pure functions over an array of pick records:
// { id, category: 'game'|'prop', status: 'pending'|'win'|'loss'|'push', ... }
// Pushes and pending picks are excluded from win% (standard handicapping
// convention — a push is neither a win nor a loss) but pending picks still
// count toward "picks on the board" totals shown elsewhere.

import { americanToDecimal } from './probability.js';

export function gradeSummary(picks, category = null) {
  const scoped = category ? picks.filter((p) => p.category === category) : picks;
  const wins = scoped.filter((p) => p.status === 'win').length;
  const losses = scoped.filter((p) => p.status === 'loss').length;
  const pushes = scoped.filter((p) => p.status === 'push').length;
  const pending = scoped.filter((p) => p.status === 'pending').length;
  const decided = wins + losses;
  const winPct = decided === 0 ? null : wins / decided;
  return { wins, losses, pushes, pending, decided, winPct };
}

// Most-recent-first streak of consecutive wins or losses, ignoring pushes
// and pending picks (a push doesn't break a streak, it's just skipped).
// `picks` must be pre-sorted oldest-to-newest by settlement; we read it in
// reverse so "current" means "most recently settled."
export function currentStreak(picks) {
  const settled = picks.filter((p) => p.status === 'win' || p.status === 'loss');
  if (settled.length === 0) return { type: null, count: 0 };
  const mostRecentFirst = [...settled].reverse();
  const type = mostRecentFirst[0].status;
  let count = 0;
  for (const pick of mostRecentFirst) {
    if (pick.status !== type) break;
    count++;
  }
  return { type: type === 'win' ? 'W' : 'L', count };
}

export function longestStreak(picks, type = 'win') {
  const settled = picks.filter((p) => p.status === 'win' || p.status === 'loss');
  let longest = 0;
  let running = 0;
  for (const pick of settled) {
    if (pick.status === type) {
      running++;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }
  return longest;
}

// Season-long running unit count — a win pays units * (decimal odds - 1),
// a loss costs the full units staked, a push refunds (0 net), and pending
// picks don't count yet (the risk hasn't resolved). `pick.units` should
// already be a 1-5 conviction-scaled stake (see picksLedger.addPick); a
// pick missing `units` defaults to 1 rather than being skipped, so an old
// or hand-edited ledger entry still counts toward the total instead of
// silently vanishing from it.
export function netUnits(picks, category = null) {
  const scoped = category ? picks.filter((p) => p.category === category) : picks;
  return scoped.reduce((total, pick) => {
    const units = pick.units ?? 1;
    if (pick.status === 'win') return total + units * (americanToDecimal(pick.price) - 1);
    if (pick.status === 'loss') return total - units;
    return total; // push or pending: no change
  }, 0);
}

// Which players are currently riding a hit streak on their props (most
// recent settled prop picks per player, consecutive wins). Sorted hottest
// first. This is a "what's trending" signal, not a prediction that the
// streak continues — small samples, call it out as such in the UI copy.
export function playerStreaks(picks) {
  const propPicks = picks.filter((p) => p.category === 'prop' && p.player);
  const byPlayer = new Map();
  for (const pick of propPicks) {
    if (!byPlayer.has(pick.player)) byPlayer.set(pick.player, []);
    byPlayer.get(pick.player).push(pick);
  }

  const streaks = [];
  for (const [player, playerPicks] of byPlayer) {
    const { type, count } = currentStreak(playerPicks);
    if (type === 'W' && count > 0) {
      streaks.push({ player, streak: count, lastMarket: [...playerPicks].reverse().find((p) => p.status === 'win')?.market });
    }
  }
  return streaks.sort((a, b) => b.streak - a.streak);
}
