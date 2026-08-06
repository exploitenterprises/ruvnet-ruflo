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
    _schema: "Each entry: id, sport ('nfl'|'cfb', defaults to 'nfl' if omitted), dateIssued (ISO), category ('game'|'prop'), label (matchup or player), market, selection, price (american odds), units (1-5, conviction-scaled stake size — see nfl-betting/README.md#units), player (prop picks only), gameDate, status ('pending'|'win'|'loss'|'push'), settledDate, note, revisions (optional — appended by picksLedger.revisePick/upsertPick whenever a pending pick's call changes after first being logged; each entry is {at, from: {selection, price, units}, reason}, so a changed mind is visible in the record, never silently overwritten). Only picks the board actually commits to (not hedged 'market snapshot' notes) get logged here — see nfl-betting/README.md#track-record. Filter by sport before calling trackRecord.js helpers to get sport-scoped stats.",
    picks,
  };
  await writeFile(LEDGER_PATH, JSON.stringify(payload, null, 2));
}

// Append a new pick with status 'pending'. Caller supplies a stable id
// (e.g. `${week}-${team}-${market}`) so re-runs don't duplicate entries.
// `entry.units` should be a 1-5 conviction-scaled stake size (see
// trackRecord.js's netUnits) — defaults to 1 (a lean) if the caller omits it,
// never silently 0, so every committed pick counts toward the season total.
export function addPick(picks, entry) {
  if (picks.some((p) => p.id === entry.id)) return picks;
  return [...picks, { status: 'pending', units: 1, ...entry }];
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

// Overwrite a *pending* pick's call — used when a fresh run of the model
// disagrees with what's already logged (new data came in: injury news, a
// line move, an updated EPA/power-rating snapshot). The ledger should
// reflect the current best pick, not whatever was true when it was first
// generated — but it should also stay honest that the call changed, so
// every revision is appended to `revisions` rather than silently
// overwritten. Throws on an unknown id (same as settlePick) and on an
// already-settled pick — a graded result is history, never editable.
export function revisePick(picks, id, updates, { reason, revisedDate } = {}) {
  const idx = picks.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`No pick with id "${id}" in ledger`);
  const current = picks[idx];
  if (current.status !== 'pending') {
    throw new Error(`Cannot revise pick "${id}" — already settled as "${current.status}"`);
  }
  const revisionEntry = {
    at: revisedDate ?? new Date().toISOString(),
    from: { selection: current.selection, price: current.price, units: current.units },
    reason: reason ?? null,
  };
  const next = [...picks];
  next[idx] = { ...current, ...updates, revisions: [...(current.revisions ?? []), revisionEntry] };
  return next;
}

// The weekly-refresh entry point: log a fresh pick if this id hasn't been
// seen before, revise it if the model's call has changed since it was
// logged, or leave it untouched if nothing material changed (selection or
// price) — so re-running the same week repeatedly doesn't pile up no-op
// revision entries. Never touches an already-settled pick.
export function upsertPick(picks, entry, { reason } = {}) {
  const existing = picks.find((p) => p.id === entry.id);
  if (!existing) return addPick(picks, entry);
  if (existing.status !== 'pending') return picks;
  const changed = existing.selection !== entry.selection || existing.price !== entry.price;
  if (!changed) return picks;
  return revisePick(picks, entry.id, {
    selection: entry.selection,
    price: entry.price,
    market: entry.market ?? existing.market,
    note: entry.note ?? existing.note,
  }, { reason });
}
