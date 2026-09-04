// GET /api/whatsapp-contact?key=<DASH_KEY>&client=<slug>&wa_id=<wa_id>
//
// Backs the contact drawer on the dashboard's "Conversas" tab: one
// contact's full story instead of the single first-message row the list
// shows. Scoped to one client (functions/_shared/clients.js), like every
// other endpoint here.
//
// Everything below is reconstructed from data we already store - no new
// table. logRawEvent() in functions/webhook/_whatsapp-core.js persists the
// raw envelope of EVERY message, the attendant's own included (it runs
// before the fromMe early-return), so the whole conversation is already in
// whatsapp_events; it just was never served in this shape.
//
// The raw payloads are parsed here and NOT returned: a busy contact has
// dozens of full uazapi envelopes, and shipping them all would dwarf the
// rest of the response. The "Eventos" tab's inspector still shows the raw
// payload for anyone who needs it.

import { resolveClientBySlug } from '../_shared/clients.js';

// Stage events (written by applyStageTransition / sendFirstTouchLead)
// versus the raw message log - same table, told apart by event_name.
const MESSAGE_EVENT_NAMES = new Set(['message_received', 'unrecognized_webhook']);

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

  const waId = url.searchParams.get('wa_id');
  if (!waId) {
    return json({ error: 'wa_id e obrigatorio' }, 400);
  }

  try {
    const contact = await env.DB.prepare(`
      SELECT
        wa_id, phone, push_name, ctwa_clid, ad_source_id, ad_headline,
        ad_source_url, ad_media_type, ad_thumbnail_url, is_ctwa, ad_platform,
        gclid, gbraid, wbraid, first_message_text,
        first_message_at, status, status_source, status_updated_at,
        lead_sent_to_meta, lead_meta_status_code, lead_meta_response_ok,
        created_at, updated_at
      FROM whatsapp_contacts
      WHERE client_id = ? AND wa_id = ?
    `).bind(client.id, waId).first();

    if (!contact) {
      return json({ error: 'contato nao encontrado neste cliente' }, 404);
    }

    // COALESCE(event_time, created_at): event_time is WhatsApp's own
    // timestamp, which is the truthful conversation order - uazapi does
    // not guarantee delivery order (see the ordering quirk documented in
    // functions/webhook/_whatsapp-core.js), so ordering by arrival would
    // show messages out of sequence.
    const rows = await env.DB.prepare(`
      SELECT
        id, event_name, event_time, created_at, source, message_type,
        raw_payload, value, currency,
        sent_to_meta, meta_status_code, meta_response_ok,
        google_ads_status_code, google_ads_response_ok
      FROM whatsapp_events
      WHERE client_id = ? AND wa_id = ?
      ORDER BY COALESCE(event_time, created_at) ASC, id ASC
    `).bind(client.id, waId).all();

    const timeline = [];
    for (const row of rows.results || []) {
      const at = row.event_time || row.created_at;

      if (MESSAGE_EVENT_NAMES.has(row.event_name)) {
        const msg = parseMessage(row.raw_payload);
        // An unparseable envelope still belongs on the timeline - it means
        // something arrived and we couldn't read it, which is worth seeing.
        timeline.push({
          kind: 'message',
          at,
          from_me: msg ? !!msg.fromMe : null,
          text: msg ? msg.text || null : null,
          message_type: row.message_type || (msg ? msg.messageType : null),
          has_ad_context: msg ? !!msg.hasAdContext : false,
          unreadable: !msg,
        });
        continue;
      }

      timeline.push({
        kind: 'stage',
        at,
        event_name: row.event_name,
        // whatsapp_events.source is transport, and that's exactly what
        // separates the two ways a stage can change: 'dashboard' = someone
        // clicked a button, 'webhook' = a trigger phrase matched.
        trigger: row.source === 'webhook' ? 'keyword' : 'manual',
        value: row.value,
        currency: row.currency,
        sent_to_meta: row.sent_to_meta === 1,
        meta_status_code: row.meta_status_code,
        meta_response_ok: row.meta_response_ok === 1,
        google_ads_status_code: row.google_ads_status_code,
        google_ads_response_ok: row.google_ads_response_ok === 1,
      });
    }

    return json({
      contact,
      timeline,
      timings: buildTimings(timeline, contact),
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// Only the handful of fields the drawer renders - see the note at the top
// about why the envelope itself doesn't travel.
function parseMessage(rawPayload) {
  if (!rawPayload) return null;
  let raw;
  try {
    raw = JSON.parse(rawPayload);
  } catch (e) {
    return null;
  }
  const msg = raw?.message;
  if (!msg) return null;
  return {
    fromMe: !!msg.fromMe,
    text: msg.text || null,
    messageType: msg.messageType || null,
    hasAdContext: !!msg.content?.contextInfo?.externalAdReply,
  };
}

// The numbers the dashboard leads with. "Quanto o time do cliente demorou
// pra responder o lead" is the metric this whole drawer is built around,
// so it's computed here rather than left to the client.
function buildTimings(timeline, contact) {
  const messages = timeline.filter(t => t.kind === 'message');
  const inbound = messages.filter(m => m.from_me === false);
  const outbound = messages.filter(m => m.from_me === true);

  const firstInboundAt = inbound.length ? inbound[0].at : contact.first_message_at || null;

  // Only a reply that comes AFTER the lead's first message counts - an
  // outbound message that predates it is the attendant having reached out
  // first, which isn't a response time.
  const firstReply = firstInboundAt
    ? outbound.find(m => m.at >= firstInboundAt)
    : null;

  const qualified = timeline.find(t => t.kind === 'stage' && t.event_name === 'QualifiedLead');

  return {
    first_message_at: firstInboundAt,
    last_message_at: messages.length ? messages[messages.length - 1].at : null,
    first_reply_at: firstReply ? firstReply.at : null,
    response_seconds: firstReply && firstInboundAt ? firstReply.at - firstInboundAt : null,
    qualified_at: qualified ? qualified.at : null,
    time_to_qualify_seconds: qualified && firstInboundAt ? qualified.at - firstInboundAt : null,
    messages_total: messages.length,
    messages_inbound: inbound.length,
    messages_outbound: outbound.length,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
