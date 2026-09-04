// GET /api/client-status?key=<DASH_KEY>&client=<slug>
//
// Backs the "Status da configuracao" card on the dashboard's
// "Configuracoes" tab: an onboarding checklist for one client, answering
// "o que ja esta pronto e o que ficou pra tras" without a trip to the
// Cloudflare env var UI (where secrets can't be read back anyway).
//
// Never returns a credential value - only whether each one is set and
// where it resolved from. That distinction is the whole point: because
// getClientSecret() silently falls back to the unprefixed env var (so
// client 1, created before multi-tenant, keeps working), a client whose
// <SLUG>_META_ACCESS_TOKEN was never created looks perfectly configured
// while sending events with another client's token. `source: 'fallback'`
// is what makes that visible.

import { resolveClientBySlug, describeClientSecret } from '../_shared/clients.js';
import { EDITABLE_CONFIG_KEYS } from '../_shared/client-config.js';

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

  try {
    // Same D1-wins-over-env resolution as /api/config, but reporting the
    // origin instead of the value.
    let overrides = {};
    try {
      const rows = await env.DB
        .prepare('SELECT key, value FROM client_config WHERE client_id = ?')
        .bind(client.id).all();
      for (const row of rows.results || []) overrides[row.key] = row.value;
    } catch (e) {
      // migration 0006 not run - everything falls back to env below
    }

    const config = {};
    for (const k of EDITABLE_CONFIG_KEYS) {
      if (overrides[k]) config[k] = { set: true, source: 'dashboard' };
      else if (env[k]) config[k] = { set: true, source: 'env' };
      else config[k] = { set: false, source: null };
    }

    const events = await env.DB.prepare(`
      SELECT COUNT(*) as total, MAX(created_at) as last_at
      FROM whatsapp_events WHERE client_id = ?
    `).bind(client.id).first();

    const contacts = await env.DB.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN is_ctwa = 1 THEN 1 ELSE 0 END) as ctwa
      FROM whatsapp_contacts WHERE client_id = ?
    `).bind(client.id).first();

    // Last event this client actually pushed to Meta - the only proof the
    // token/pixel/page combination works end to end.
    const lastSend = await env.DB.prepare(`
      SELECT event_name, meta_status_code, meta_response_ok, created_at
      FROM whatsapp_events
      WHERE client_id = ? AND sent_to_meta = 1
      ORDER BY id DESC LIMIT 1
    `).bind(client.id).first();

    return json({
      client: { id: client.id, name: client.name, slug: client.slug },
      webhook: {
        url: `${url.origin}/webhook/whatsapp/${client.webhook_slug}`,
        events_received: events?.total || 0,
        last_event_at: events?.last_at || null,
      },
      contacts: {
        total: contacts?.total || 0,
        ctwa: contacts?.ctwa || 0,
      },
      meta: {
        access_token: describeClientSecret(env, client, 'META_ACCESS_TOKEN'),
        pixel_id: config.META_PIXEL_ID,
        page_id: config.META_PAGE_ID,
      },
      google_ads: {
        refresh_token: describeClientSecret(env, client, 'GOOGLE_ADS_REFRESH_TOKEN'),
        customer_id: config.GOOGLE_ADS_CUSTOMER_ID,
      },
      last_capi_send: lastSend ? {
        event_name: lastSend.event_name,
        ok: lastSend.meta_response_ok === 1,
        status_code: lastSend.meta_status_code,
        at: lastSend.created_at,
      } : null,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
