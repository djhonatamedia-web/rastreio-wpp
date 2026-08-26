// POST /api/track-click
// Body: { client, code, gclid?, gbraid?, wbraid?, utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?, landing_url? }
//
// Public, unauthenticated by design - called by client-side JS on a Google
// Ads landing page, before any dashboard auth exists (same pattern as
// checkout-session.js in krob-tracking-stack-main). `client` is the
// client's slug (see functions/_shared/clients.js) - each client's landing
// page hardcodes its own slug in this call, same as it hardcodes its own
// WhatsApp number in the button link. Bridges a Google Ads click (no
// native "Click to WhatsApp" format, unlike Meta) to a later WhatsApp
// conversation: the landing page embeds `code` in the WhatsApp button's
// pre-filled message text, and the webhook
// (functions/webhook/_whatsapp-core.js) looks it up here once the lead's
// first message arrives. See docs/google-ads-whatsapp.md.
//
// CORS is wide open because the landing page is normally a different
// domain than this Pages deployment.

import { resolveClientBySlug } from '../_shared/clients.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { client: clientSlug, code, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_url } = body;
  if (!code) {
    return json({ error: 'code is required' }, 400);
  }
  if (!gclid && !gbraid && !wbraid) {
    return json({ error: 'at least one of gclid, gbraid, wbraid is required' }, 400);
  }

  const client = await resolveClientBySlug(env, clientSlug);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  // Uppercased so case never matters when the webhook matches it back
  // against the WhatsApp message text.
  const normalizedCode = String(code).toUpperCase();
  await env.DB
    .prepare(`
      INSERT OR REPLACE INTO ad_click_codes (
        client_id, code, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      client.id, normalizedCode, gclid || null, gbraid || null, wbraid || null,
      utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null, utm_term || null,
      landing_url || null, now
    )
    .run();

  return json({ ok: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
