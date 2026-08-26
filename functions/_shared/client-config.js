// Non-secret ad-platform IDs (Pixel/Page/Customer/Conversion Action ids),
// editable from the dashboard's "Configuracoes" tab and stored in D1
// (client_config), scoped per client (client_id) instead of requiring a
// trip to the Cloudflare Pages env var UI for every new client. Real
// credentials (access tokens, OAuth client secret/refresh token,
// developer token) are NOT in this list and stay Cloudflare-only, per
// client via a slug-prefixed env var - see getClientSecret() in
// functions/_shared/clients.js and the "why" in docs/client-config.md.
//
// D1 value wins when set; otherwise falls back to the env var of the same
// name, so a client with no client_config rows yet keeps working off env
// vars with zero migration required.
export const EDITABLE_CONFIG_KEYS = [
  'META_PIXEL_ID',
  'META_PAGE_ID',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED',
  'GOOGLE_ADS_CONVERSION_ACTION_SCHEDULE',
  'GOOGLE_ADS_CONVERSION_ACTION_SALE',
];

// One query for however many keys the caller needs - never one round trip
// per key. Safe to call even before migration 0006 runs (env fallback
// still works if the table doesn't exist yet, or if clientId is missing).
export async function getConfigValues(env, keys, clientId) {
  const result = {};
  for (const key of keys) result[key] = env[key] || null;

  if (!env.DB || !keys.length || !clientId) return result;

  try {
    const placeholders = keys.map(() => '?').join(',');
    const rows = await env.DB
      .prepare(`SELECT key, value FROM client_config WHERE client_id = ? AND key IN (${placeholders})`)
      .bind(clientId, ...keys)
      .all();
    for (const row of rows.results || []) {
      if (row.value) result[row.key] = row.value;
    }
  } catch (e) {
    // Table doesn't exist yet, or still has the pre-multi-tenant shape - env fallback stands.
  }

  return result;
}

export async function getConfigValue(env, key, clientId) {
  const values = await getConfigValues(env, [key], clientId);
  return values[key];
}
