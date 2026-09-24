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

  const { client: clientSlug, code, gclid, gbraid, wbraid, fbclid, fbc, fbp, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_url } = body;
  if (!code) {
    return json({ error: 'code is required' }, 400);
  }
  // Google Ads click id, Meta click/browser ids, OR any UTM field - a click
  // with none of these carries no attribution signal at all, so there'd be
  // nothing to bridge to the WhatsApp message. UTM-only clicks (Instagram,
  // email, etc.) are valid: see docs/google-ads-whatsapp.md.
  const hasAttribution = gclid || gbraid || wbraid || fbclid || fbc || fbp || utm_source || utm_medium || utm_campaign || utm_content || utm_term;
  if (!hasAttribution) {
    return json({ error: 'ao menos um identificador (gclid/gbraid/wbraid) ou campo utm_* e obrigatorio' }, 400);
  }

  const client = await resolveClientBySlug(env, clientSlug);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  // Uppercased so case never matters when the webhook matches it back
  // against the WhatsApp message text.
  const normalizedCode = String(code).toUpperCase();
  // IP and User-Agent are taken from the request headers, never the body:
  // the lead's own browser makes this call, so they are the real visitor's,
  // and Meta requires both for action_source "website" events.
  const clientIp = request.headers.get('CF-Connecting-IP') || null;
  const clientUa = (request.headers.get('User-Agent') || '').slice(0, 500) || null;
  // No _fbc cookie (Pixel not on the page yet) but a fbclid in the URL: Meta's
  // documented format is fb.<subdomainIndex>.<clickTimeMs>.<fbclid>.
  const fbcValue = fbc || (fbclid ? `fb.1.${now * 1000}.${fbclid}` : null);

  await env.DB
    .prepare(`
      INSERT OR REPLACE INTO ad_click_codes (
        client_id, code, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_url, fbclid, fbc, fbp, client_ip, client_user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      client.id, normalizedCode, gclid || null, gbraid || null, wbraid || null,
      utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null, utm_term || null,
      landing_url || null, fbclid || null, fbcValue, fbp || null, clientIp, clientUa, now
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
