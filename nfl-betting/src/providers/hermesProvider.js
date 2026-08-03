// Nous Research's Hermes models — direct inference API (OpenAI-compatible
// chat completions), not the "Hermes Agent" CLI/OAuth product. Used as a
// second, independent model for a cross-check opinion on picks (see
// src/analysis/secondOpinion.js) — never the source of truth, just another
// signal alongside the in-house power-rating/matchup engine.
//
// Requires HERMES_API_KEY (sign up at
// https://portal.nousresearch.com/manage-subscription — described as "free
// to start"). Needs inference-api.nousresearch.com allowlisted for outbound
// network access in this environment's settings, same as the other live
// providers — see nfl-betting/README.md.

const BASE = 'https://inference-api.nousresearch.com/v1';

// Nous's own docs describe Hermes-4-70B, Hermes-4-405B, and Hermes-4.3-36B
// as available on this backend but don't publish a single canonical model-ID
// string list. Default to the 70B tier (quality/cost balance for a periodic
// cross-check call, not a high-volume path) but let the caller/env override
// once the exact ID is confirmed against a real API response.
const DEFAULT_MODEL = process.env.HERMES_MODEL || 'Hermes-4-70B';

function requireKey() {
  const key = process.env.HERMES_API_KEY;
  if (!key) throw new Error('HERMES_API_KEY is not set — get a key at https://portal.nousresearch.com/manage-subscription and add it to nfl-betting/.env');
  return key;
}

// Plain OpenAI-compatible chat completion. `messages` is the standard
// [{role, content}] array; returns the assistant's reply text.
export async function chatCompletion(messages, { model = DEFAULT_MODEL, temperature = 0.4, maxTokens = 800 } = {}) {
  const key = requireKey();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Nous inference API ${res.status} ${res.statusText} for ${model}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Nous inference API returned no message content');
  return content;
}
