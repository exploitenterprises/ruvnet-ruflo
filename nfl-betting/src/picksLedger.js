import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(__dirname, '..', 'data', 'picks-ledger.json');

export async function loadLedger() {
  const raw = await readFile(LEDGER_PATH, 'utf8');
  return JSON.parse(raw).picks;
}

export async function saveLedger(picks) {
  const payload = {
    _schema: "Each entry: id, sport ('nfl'|'cfb', defaults to 'nfl' if omitted), dateIssued (ISO), category ('game'|'prop'), label (matchup or player), market, selection, price (american odds), player (prop picks only), gameDate, status ('pending'|'win'|'loss'|'push'), settledDate, note. Only picks the board actually commits to (not hedged 'market snapshot' notes) get logged here — see nfl-betting/README.md#track-record. Filter by sport before calling trackRecord.js helpers to get sport-scoped stats.",
    picks,
  };
  await writeFile(LEDGER_PATH, JSON.stringify(payload, null, 2));
}

// Append a new pick with status 'pending'. Caller supplies a stable id
// (e.g. `${week}-${team}-${market}`) so re-runs don't duplicate entries.
export function addPick(picks, entry) {
  if (picks.some((p) => p.id === entry.id)) return picks;
  return [...picks, { status: 'pending', ...entry }];
}

// Mark a pending pick settled. Throws if the id isn't found, so a typo in a
// routine run fails loudly instead of silently no-op'ing the grade.
export function settlePick(picks, id, status, settledDate) {
  const idx = picks.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`No pick with id "${id}" in ledger`);
  const next = [...picks];
  next[idx] = { ...next[idx], status, settledDate };
  return next;
}
