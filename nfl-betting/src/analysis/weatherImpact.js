// Converts a raw weather forecast into scoring/efficiency multipliers.
// Thresholds follow widely-cited betting-market heuristics (e.g. wind >15mph
// materially suppresses passing/kicking; sub-freezing temps suppress scoring
// and grip; heavy precip suppresses both passing and ball security).

export function weatherAdjustment({ isDome, windMph = 0, tempF = 60, precipProbPct = 0 }) {
  if (isDome) {
    return { totalMultiplier: 1, passMultiplier: 1, fgMultiplier: 1, turnoverBump: 0, notes: ['Roof closed / dome — no weather impact'] };
  }

  let totalMultiplier = 1;
  let passMultiplier = 1;
  let fgMultiplier = 1;
  let turnoverBump = 0;
  const notes = [];

  if (windMph >= 20) {
    passMultiplier -= 0.12; totalMultiplier -= 0.08; fgMultiplier -= 0.15;
    notes.push(`Sustained wind ${windMph}mph: strong drag on passing and kicking, favors run-heavy game script`);
  } else if (windMph >= 15) {
    passMultiplier -= 0.06; totalMultiplier -= 0.04; fgMultiplier -= 0.08;
    notes.push(`Wind ${windMph}mph: moderate drag on passing efficiency and FG range`);
  }

  if (tempF <= 20) {
    totalMultiplier -= 0.06; turnoverBump += 0.15;
    notes.push(`Extreme cold ${tempF}F: scoring suppressed, elevated fumble risk`);
  } else if (tempF <= 32) {
    totalMultiplier -= 0.03; turnoverBump += 0.08;
    notes.push(`Freezing temps ${tempF}F: modest scoring suppression`);
  }

  if (precipProbPct >= 60) {
    passMultiplier -= 0.08; totalMultiplier -= 0.05; turnoverBump += 0.12;
    notes.push(`High precipitation chance (${precipProbPct}%): ball security and passing efficiency at risk`);
  } else if (precipProbPct >= 30) {
    passMultiplier -= 0.03; totalMultiplier -= 0.02; turnoverBump += 0.05;
    notes.push(`Moderate precipitation chance (${precipProbPct}%): slight downgrade to passing game`);
  }

  return {
    totalMultiplier: Math.max(totalMultiplier, 0.75),
    passMultiplier: Math.max(passMultiplier, 0.75),
    fgMultiplier: Math.max(fgMultiplier, 0.75),
    turnoverBump,
    notes: notes.length ? notes : ['Clean weather — no material adjustment'],
  };
}
