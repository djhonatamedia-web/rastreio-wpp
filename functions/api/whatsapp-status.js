// POST /api/whatsapp-status
// Headers: x-dash-key: <DASH_KEY>
// Body: { "wa_id": "...", "new_status": "qualified|scheduled|sale|lost", "value"?: number, "currency"?: "BRL" }
//
// First mutating dashboard endpoint in this project (every other /api/*.js
// here and in krob-tracking-stack-main is read-only). Auth goes in a header,
// not the query string, specifically because this call changes state — a
// query-string key on a POST would land in Cloudflare's access logs.
//
// Marks a contact's lifecycle stage from the dashboard and, when the
// contact has a stored ctwa_clid, fires the matching Meta CAPI
// business_messaging event so ad delivery can optimize toward it.

import { sendWhatsAppEventToMeta } from '../webhook/_whatsapp-capi.js';
import { timingSafeEqual } from '../webhook/_utils.js';
import { STAGE_TO_META_EVENT, VALID_STATUSES } from '../../config/whatsapp.js';

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

  const { wa_id, new_status, value, currency } = body;
  if (!wa_id || !new_status) {
    return json({ error: 'wa_id and new_status are required' }, 400);
  }
  if (!VALID_STATUSES.includes(new_status)) {
    return json({ error: `new_status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  const contact = await env.DB
    .prepare('SELECT wa_id, phone, ctwa_clid FROM whatsapp_contacts WHERE wa_id = ?')
    .bind(wa_id)
    .first();
  if (!contact) {
    return json({ error: 'contact not found' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const eventId = crypto.randomUUID();
  const metaEventName = STAGE_TO_META_EVENT[new_status];

  await env.DB
    .prepare('UPDATE whatsapp_contacts SET status = ?, status_updated_at = ?, updated_at = ? WHERE wa_id = ?')
    .bind(new_status, now, now, wa_id)
    .run();

  if (!metaEventName) {
    await insertEvent(env, { waId: wa_id, eventName: new_status, eventId, now, value, currency, sentToMeta: 0 });
    return json({ ok: true, status: new_status, capi: 'skipped: no Meta event mapped for this status' });
  }

  // Guard against re-firing the same stage to Meta on every click. Confirmed
  // 2026-08-24: with no guard, re-clicking a stage button (done deliberately
  // during a ctwa_clid backfill, but just as easy to trigger by accident)
  // sent the same contact's QualifiedLead 3-6x each, inflating Meta's event
  // count well past the real number of qualified leads. One successful send
  // per event_name per contact is enough — status still updates either way.
  const alreadySent = await env.DB
    .prepare('SELECT 1 FROM whatsapp_events WHERE wa_id = ? AND event_name = ? AND sent_to_meta = 1 AND meta_response_ok = 1 LIMIT 1')
    .bind(wa_id, metaEventName)
    .first();
  if (alreadySent) {
    return json({ ok: true, status: new_status, capi: `skipped: ${metaEventName} already sent successfully for this contact` });
  }

  const customData = value != null ? { value: parseFloat(value) || 0, currency: currency || 'BRL' } : undefined;

  const { payload, response, skipped } = await sendWhatsAppEventToMeta({
    eventName: metaEventName,
    ctwaClid: contact.ctwa_clid,
    phone: contact.phone,
    eventId,
    eventTime: now,
    customData,
    env,
  });

  if (skipped) {
    await insertEvent(env, { waId: wa_id, eventName: metaEventName, eventId, now, value, currency, sentToMeta: 0 });
    return json({ ok: true, status: new_status, capi: `skipped: ${skipped}` });
  }

  const responseBody = await response.text();
  await insertEvent(env, {
    waId: wa_id, eventName: metaEventName, eventId, now, value, currency,
    sentToMeta: 1, statusCode: response.status, responseOk: response.ok ? 1 : 0,
    responseBody, payloadSent: payload,
  });

  return json({ ok: true, status: new_status, capi: response.ok ? 'sent' : `failed (${response.status})` });
}

async function insertEvent(env, { waId, eventName, eventId, now, value, currency, sentToMeta, statusCode, responseOk, responseBody, payloadSent }) {
  await env.DB.prepare(`
    INSERT INTO whatsapp_events (
      wa_id, event_name, event_id, event_time, source, value, currency,
      sent_to_meta, meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent, created_at
    ) VALUES (?, ?, ?, ?, 'dashboard', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    waId, eventName, eventId, now,
    value != null ? parseFloat(value) || 0 : null, currency || null,
    sentToMeta, statusCode || null, responseOk ?? null, responseBody || null, payloadSent || null, now
  ).run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
