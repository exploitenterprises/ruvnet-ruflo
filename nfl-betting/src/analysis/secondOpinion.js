// Independent second-opinion cross-check on a pick, using a Hermes model
// (src/providers/hermesProvider.js) as a genuinely separate reasoning
// process from the in-house power-rating/matchup engine — not a data
// source, a second judgment. Never overrides our model's pick; the board
// shows both and flags when they disagree, same spirit as the book-price
// cross-check that used to live here before it got replaced with a
// decisive "Our Pick" (see board/README.md).
//
// Split into pure prompt-building/response-parsing (testable, no network)
// and a thin impure orchestrator that actually calls the model.

import { chatCompletion } from '../providers/hermesProvider.js';

export function buildSecondOpinionPrompt({ home, away, market, ourPick, ourReasoning, projectedSpread, projectedTotal, homeWinProb }) {
  const system = 'You are an independent sports betting handicapper giving a second opinion. ' +
    'You are shown another model\'s pick and reasoning for one game. Form your own independent view first, ' +
    'then say whether you agree or disagree. Reply with ONLY a JSON object, no markdown fences, no prose outside the JSON: ' +
    '{"pick": string, "confidence": integer 1-5, "agrees": boolean, "reasoning": string (2-3 sentences)}.';

  const facts = [
    `Matchup: ${away} @ ${home}`,
    `Market: ${market}`,
    projectedSpread != null ? `Our model's projected spread (home perspective): ${projectedSpread}` : null,
    projectedTotal != null ? `Our model's projected total: ${projectedTotal}` : null,
    homeWinProb != null ? `Our model's home win probability: ${homeWinProb}` : null,
    `Our pick: ${ourPick}`,
    `Our reasoning: ${ourReasoning}`,
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: facts },
  ];
}

// Tolerant of a model wrapping its JSON in a markdown code fence even when
// told not to — strip fences before parsing rather than failing outright.
export function parseSecondOpinionResponse(raw) {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { ok: false, error: 'Could not parse a JSON second opinion from the model response', raw };
  }
  const { pick, confidence, agrees, reasoning } = parsed;
  if (typeof pick !== 'string' || typeof reasoning !== 'string' || typeof agrees !== 'boolean') {
    return { ok: false, error: 'Second-opinion JSON was missing required fields', raw };
  }
  const clampedConfidence = Number.isInteger(confidence) ? Math.min(5, Math.max(1, confidence)) : null;
  return { ok: true, pick, confidence: clampedConfidence, agrees, reasoning };
}

// Impure orchestrator: calls the live model. Never throws for expected
// failure modes (no key, network-blocked, bad JSON) — returns an
// `{ok: false, error}` shape instead, so a board-refresh run can surface
// "second opinion unavailable" rather than crashing the whole pick.
export async function getSecondOpinion(context) {
  const messages = buildSecondOpinionPrompt(context);
  let raw;
  try {
    raw = await chatCompletion(messages);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return parseSecondOpinionResponse(raw);
}
