// GET    /api/config?key=<DASH_KEY>                     — list current values + where each comes from
// POST   /api/config   { key, value }   header x-dash-key — set an override in D1
// DELETE /api/config   { key }          header x-dash-key — remove the override (falls back to env var again)
//
// Backs the dashboard's "Configurações" tab: the non-secret ad-platform
// IDs (Pixel/Page/Customer/Conversion Action ids) editable without a trip
// to the Cloudflare Pages env var UI. Real credentials (access tokens,
// OAuth client secret/refresh token, developer token) are NOT covered
// here — see EDITABLE_CONFIG_KEYS in functions/_shared/client-config.js
// for why those stay Cloudflare-only.

import { timingSafeEqual } from '../webhook/_utils.js';
import { EDITABLE_CONFIG_KEYS } from '../_shared/client-config.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let overrides = {};
  if (env.DB) {
    try {
      const rows = await env.DB.prepare('SELECT key, value FROM client_config').all();
      for (const row of rows.results || []) overrides[row.key] = row.value;
    } catch (e) {
      // migration 0005 not run yet — every key just falls back to env below.
    }
  }

  const config = EDITABLE_CONFIG_KEYS.map(k => {
    const dbValue = overrides[k];
    const value = dbValue || env[k] || null;
    const source = dbValue ? 'dashboard' : (env[k] ? 'env' : null);
    return { key: k, value, source };
  });

  return json({ config });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const providedKey = request.headers.get('x-dash-key') || '';
  if (!env.DASH_KEY || !timingSafeEqual(providedKey, env.DASH_KEY)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { key: configKey, value } = body;
  if (!configKey || !value || !String(value).trim()) {
    return json({ error: 'key and value are required' }, 400);
  }
  if (!EDITABLE_CONFIG_KEYS.includes(configKey)) {
    return json({ error: `key must be one of: ${EDITABLE_CONFIG_KEYS.join(', ')}` }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare('INSERT INTO client_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(configKey, String(value).trim(), now)
    .run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  const providedKey = request.headers.get('x-dash-key') || '';
  if (!env.DASH_KEY || !timingSafeEqual(providedKey, env.DASH_KEY)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  if (!body.key || !EDITABLE_CONFIG_KEYS.includes(body.key)) {
    return json({ error: `key must be one of: ${EDITABLE_CONFIG_KEYS.join(', ')}` }, 400);
  }

  await env.DB.prepare('DELETE FROM client_config WHERE key = ?').bind(body.key).run();
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
