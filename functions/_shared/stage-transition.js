// Shared by the manual dashboard endpoint (functions/api/whatsapp-status.js)
// and the keyword-triggered path (functions/webhook/_whatsapp-core.js) so
// both go through the exact same status update, anti-duplicate guard, and
// Meta CAPI fan-out — no drift between "clicked a button" and "attendant
// typed a trigger phrase".

import { sendWhatsAppEventToMeta } from '../webhook/_whatsapp-capi.js';
import { STAGE_TO_META_EVENT } from '../../config/whatsapp.js';

// source: 'manual' (dashboard button) | 'keyword' (trigger phrase match)
export async function applyStageTransition({ env, waId, newStatus, source, value, currency }) {
  const contact = await env.DB
    .prepare('SELECT wa_id, phone, ctwa_clid FROM whatsapp_contacts WHERE wa_id = ?')
    .bind(waId)
    .first();
  if (!contact) {
    return { ok: false, error: 'contact not found' };
  }

  const now = Math.floor(Date.now() / 1000);
  const eventId = crypto.randomUUID();
  const metaEventName = STAGE_TO_META_EVENT[newStatus];
  // whatsapp_events.source tracks transport (who called the webhook vs the
  // dashboard API), distinct from status_source (why the stage changed).
  const eventSource = source === 'keyword' ? 'webhook' : 'dashboard';

  await env.DB
    .prepare('UPDATE whatsapp_contacts SET status = ?, status_source = ?, status_updated_at = ?, updated_at = ? WHERE wa_id = ?')
    .bind(newStatus, source, now, now, waId)
    .run();

  if (!metaEventName) {
    await insertEvent(env, { waId, eventName: newStatus, eventId, now, value, currency, sentToMeta: 0, eventSource });
    return { ok: true, status: newStatus, capi: 'skipped: no Meta event mapped for this status' };
  }

  // Guard against re-firing the same stage to Meta more than once. Confirmed
  // 2026-08-24: with no guard, re-triggering a stage (button click or,
  // now, a repeated keyword match) sent duplicate CAPI events for the same
  // contact, inflating Meta's event count past the real number of leads.
  const alreadySent = await env.DB
    .prepare('SELECT 1 FROM whatsapp_events WHERE wa_id = ? AND event_name = ? AND sent_to_meta = 1 AND meta_response_ok = 1 LIMIT 1')
    .bind(waId, metaEventName)
    .first();
  if (alreadySent) {
    return { ok: true, status: newStatus, capi: `skipped: ${metaEventName} already sent successfully for this contact` };
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
    await insertEvent(env, { waId, eventName: metaEventName, eventId, now, value, currency, sentToMeta: 0, eventSource });
    return { ok: true, status: newStatus, capi: `skipped: ${skipped}` };
  }

  const responseBody = await response.text();
  await insertEvent(env, {
    waId, eventName: metaEventName, eventId, now, value, currency,
    sentToMeta: 1, statusCode: response.status, responseOk: response.ok ? 1 : 0,
    responseBody, payloadSent: payload, eventSource,
  });

  return { ok: true, status: newStatus, capi: response.ok ? 'sent' : `failed (${response.status})` };
}

async function insertEvent(env, { waId, eventName, eventId, now, value, currency, sentToMeta, statusCode, responseOk, responseBody, payloadSent, eventSource }) {
  await env.DB.prepare(`
    INSERT INTO whatsapp_events (
      wa_id, event_name, event_id, event_time, source, value, currency,
      sent_to_meta, meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    waId, eventName, eventId, now, eventSource,
    value != null ? parseFloat(value) || 0 : null, currency || null,
    sentToMeta, statusCode || null, responseOk ?? null, responseBody || null, payloadSent || null, now
  ).run();
}
