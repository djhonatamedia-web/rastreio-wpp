// GET /api/whatsapp-events?key=...&client=<slug>&only_ctwa=1&search=5511&limit=50
//
// Dashboard "Eventos" tab - raw webhook-by-webhook, message-by-message log,
// scoped to one client (see functions/_shared/clients.js). Mirrors the KROB
// WhatsApp Tracker reference screenshot (ID, recebido, nome, telefone, tipo,
// conteudo/anuncio). Source: whatsapp_events, joined to whatsapp_contacts
// for push_name/ctwa flag.

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

  const onlyCtwa = url.searchParams.get('only_ctwa') === '1';
  const search = url.searchParams.get('search') || null;
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500);

  const clauses = ['e.client_id = ?'];
  const binds = [client.id];
  if (onlyCtwa) {
    clauses.push('c.is_ctwa = 1');
  }
  if (search) {
    clauses.push('e.wa_id LIKE ?');
    binds.push(`%${search.replace(/\D/g, '')}%`);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  try {
    const rows = await env.DB.prepare(`
      SELECT
        e.id, e.wa_id, e.event_name, e.event_id, e.event_time, e.source,
        e.message_type, e.raw_payload, e.value, e.currency,
        e.sent_to_meta, e.meta_status_code, e.meta_response_ok,
        e.meta_response_body, e.meta_payload_sent, e.created_at,
        c.push_name, c.is_ctwa, c.ad_headline
      FROM whatsapp_events e
      LEFT JOIN whatsapp_contacts c ON e.wa_id = c.wa_id AND e.client_id = c.client_id
      ${where}
      ORDER BY e.id DESC
      LIMIT ?
    `).bind(...binds, limit).all();

    return json({ events: rows.results || [] });
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
