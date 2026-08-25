// GET    /api/whatsapp-keywords?key=...
// POST   /api/whatsapp-keywords   { status, phrase }   header x-dash-key
// DELETE /api/whatsapp-keywords   { id }                header x-dash-key
//
// Manages the trigger phrases behind the "Palavras-chave" dashboard tab.
// The right phrase is per-business (a clinic that schedules vs. a store
// that sells), so it lives in the DB and is editable from the dashboard —
// not hardcoded, unlike STAGE_TO_META_EVENT in config/whatsapp.js. See the
// match logic in functions/webhook/_whatsapp-core.js.

import { timingSafeEqual } from '../webhook/_utils.js';
import { KEYWORD_STATUSES } from '../../config/whatsapp.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const rows = await env.DB
    .prepare('SELECT id, status, phrase, created_at FROM stage_keywords ORDER BY status, created_at')
    .all();

  return json({ keywords: rows.results || [] });
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

  const { status, phrase } = body;
  if (!status || !phrase || !phrase.trim()) {
    return json({ error: 'status and phrase are required' }, 400);
  }
  if (!KEYWORD_STATUSES.includes(status)) {
    return json({ error: `status must be one of: ${KEYWORD_STATUSES.join(', ')}` }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB
    .prepare('INSERT INTO stage_keywords (status, phrase, created_at) VALUES (?, ?, ?)')
    .bind(status, phrase.trim(), now)
    .run();

  return json({ ok: true, id: result.meta.last_row_id });
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

  if (!body.id) {
    return json({ error: 'id is required' }, 400);
  }

  await env.DB.prepare('DELETE FROM stage_keywords WHERE id = ?').bind(body.id).run();
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
