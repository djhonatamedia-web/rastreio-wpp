// GET /api/ad-clicks?key=...&client=<slug>&unmatched=1&limit=50
//
// Dashboard "Configurações" tab - diagnostic list of every click captured
// by POST /api/track-click or /api/channel-codes for one client (see
// functions/_shared/clients.js). Source: ad_click_codes.
//
// Exists to answer "is the LP -> WhatsApp bridge actually working?"
// without hand-writing SQL in the D1 console - a click with a real gclid
// that never got matched_wa_id is exactly the failure mode that hid two
// real bugs in 2026-09 (href rewritten too late for target="_blank",
// then a missing `channel` column crashing the lookup) until a human
// happened to notice one unattributed lead.

import { resolveClientBySlug } from '../_shared/clients.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const client = await resolveClientBySlug(env, url.searchParams.get('client'));
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }

  const unmatchedOnly = url.searchParams.get('unmatched') === '1';
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500);

  const clauses = ['client_id = ?'];
  const binds = [client.id];
  if (unmatchedOnly) {
    clauses.push('matched_wa_id IS NULL');
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  try {
    const rows = await env.DB.prepare(`
      SELECT
        code, gclid, gbraid, wbraid, channel, utm_source, utm_medium,
        utm_campaign, utm_content, utm_term, landing_url,
        matched_wa_id, matched_at, created_at
      FROM ad_click_codes
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(...binds, limit).all();

    return json({ clicks: rows.results || [] });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
