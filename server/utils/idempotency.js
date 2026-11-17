import { readJsonIdempotency, writeJsonIdempotency } from '../db/jsonLedger.js';

export function buildScopedIdemKey(endpoint, actor, rawKey) {
  const clean = String(rawKey || '').trim();
  if (!clean) return null;
  const actorPart = String(actor?.id || 'anon').trim();
  return `${endpoint}::${actorPart}::${clean}`.slice(0, 128);
}

export async function findPgIdempotency(client, scopedKey) {
  if (!scopedKey) return null;
  const dup = await client.query('SELECT response_json FROM idempotency_keys WHERE key_id = $1 LIMIT 1', [scopedKey]);
  return dup.rows[0]?.response_json || null;
}

export async function savePgIdempotency(client, scopedKey, actor, endpoint, responseJson) {
  if (!scopedKey) return;
  await client.query(
    `INSERT INTO idempotency_keys (key_id, user_id, endpoint, response_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key_id) DO NOTHING`,
    [scopedKey, actor?.id || null, endpoint, JSON.stringify(responseJson)]
  );
}

export function findJsonIdempotency(scopedKey) {
  if (!scopedKey) return null;
  const map = readJsonIdempotency();
  return map[scopedKey] || null;
}

export function saveJsonIdempotency(scopedKey, responseJson) {
  if (!scopedKey) return;
  const map = readJsonIdempotency();
  map[scopedKey] = responseJson;
  const keys = Object.keys(map);
  if (keys.length > 2000) {
    for (const oldKey of keys.slice(0, keys.length - 2000)) {
      delete map[oldKey];
    }
  }
  writeJsonIdempotency(map);
}
