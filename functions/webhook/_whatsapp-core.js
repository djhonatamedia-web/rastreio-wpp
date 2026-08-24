// -----------------------------------------------------------------------------
// Shared brain for the WhatsApp webhook adapter — mirrors the adapter/core
// split in krob-tracking-stack-main's _core.js, but for a stateful
// conversation lifecycle instead of a one-shot purchase event.
//
// *** FASE 0 STATUS: CLOSED — envelope and ctwa_clid both confirmed. ***
// Confirmed against real webhook payloads captured in production
// (docs/payload-uazapi.md): uazapi does NOT forward the raw Baileys proto —
// it sends its own flattened envelope (`{ EventType, chat, message }`, with
// fields like message.chatid/fromMe/isGroup/senderName/text/messageType at
// the top level of `message`). extractMessage() below matches that
// confirmed shape.
//
// ctwa_clid confirmed 2026-08 against 3 real ad-click leads: uazapi passes
// the untouched Baileys ad-context block through at
// `message.content.contextInfo.externalAdReply` (NOT `track_id`/
// `track_source`, which stayed empty on every message, ad-originated or
// not — those were a dead end).
//
// The one guarantee: `raw_payload` is ALWAYS persisted verbatim, regardless
// of whether extraction below finds anything. That's what let us recover
// the real envelope shape after the fact without needing a fresh capture.
// -----------------------------------------------------------------------------

import { sendWhatsAppEventToMeta } from './_whatsapp-capi.js';

export async function processWhatsAppMessage({ raw, env, context }) {
  const now = Math.floor(Date.now() / 1000);
  const eventId = crypto.randomUUID();

  let extracted;
  try {
    extracted = extractMessage(raw); // FASE 0 GUESS — see extractMessage() below
  } catch (err) {
    extracted = null;
  }

  // Always log the raw event, even if extraction failed or this wasn't a
  // message we care about (status/ack/connection events) — nothing is lost.
  context.waitUntil(
    logRawEvent({
      env,
      waId: extracted?.waId || 'unknown',
      eventName: extracted ? 'message_received' : 'unrecognized_webhook',
      eventId,
      eventTime: extracted?.timestamp || now,
      messageType: extracted?.messageType || null,
      raw,
    })
  );

  if (!extracted || !extracted.waId || extracted.fromMe || extracted.isGroup) {
    return { ok: true, skipped: !extracted ? 'unrecognized payload shape' : 'not an inbound 1:1 message' };
  }

  const existing = await env.DB
    .prepare('SELECT id, ctwa_clid FROM whatsapp_contacts WHERE wa_id = ?')
    .bind(extracted.waId)
    .first();

  if (existing) {
    await env.DB
      .prepare('UPDATE whatsapp_contacts SET push_name = COALESCE(?, push_name), updated_at = ? WHERE wa_id = ?')
      .bind(extracted.pushName || null, now, extracted.waId)
      .run();
    return { ok: true, contact: 'existing', waId: extracted.waId };
  }

  // First-ever message from this wa_id: create the contact, first-touch
  // attribution (ctwa_clid, if present, is captured once and never
  // overwritten on later messages).
  await env.DB
    .prepare(`
      INSERT INTO whatsapp_contacts (
        wa_id, phone, push_name, ctwa_clid, ad_source_id, ad_headline,
        ad_source_url, ad_media_type, ad_thumbnail_url, is_ctwa,
        first_message_text, first_message_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, ?)
    `)
    .bind(
      extracted.waId,
      extracted.phone,
      extracted.pushName || null,
      extracted.ctwaClid || null,
      extracted.adSourceId || null,
      extracted.adHeadline || null,
      extracted.adSourceUrl || null,
      extracted.adMediaType || null,
      extracted.adThumbnailUrl || null,
      extracted.ctwaClid ? 1 : 0,
      extracted.text || null,
      extracted.timestamp || now,
      now,
      now
    )
    .run();

  if (!extracted.ctwaClid) {
    return { ok: true, contact: 'created', waId: extracted.waId, capi: 'skipped: no ctwa_clid' };
  }

  const { payload, response, skipped } = await sendWhatsAppEventToMeta({
    eventName: 'LeadSubmitted', // NOT 'Lead' -- Meta rejects that literal name for business_messaging (400, error_subcode 2804066), confirmed 2026-08 in production; Meta's own error suggested this alternative
    ctwaClid: extracted.ctwaClid,
    phone: extracted.phone,
    eventId,
    eventTime: extracted.timestamp || now,
    env,
  });

  if (skipped) {
    return { ok: true, contact: 'created', waId: extracted.waId, capi: `skipped: ${skipped}` };
  }

  const responseBody = await response.text();
  context.waitUntil(
    env.DB.prepare(`
      UPDATE whatsapp_contacts SET
        lead_sent_to_meta = 1, lead_meta_status_code = ?, lead_meta_response_ok = ?,
        lead_meta_response_body = ?, lead_meta_payload_sent = ?, updated_at = ?
      WHERE wa_id = ?
    `).bind(response.status, response.ok ? 1 : 0, responseBody, payload, now, extracted.waId).run()
  );

  context.waitUntil(
    env.DB.prepare(`
      INSERT INTO whatsapp_events (
        wa_id, event_name, event_id, event_time, source, sent_to_meta,
        meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent, created_at
      ) VALUES (?, 'LeadSubmitted', ?, ?, 'webhook', 1, ?, ?, ?, ?, ?)
    `).bind(
      extracted.waId, eventId, extracted.timestamp || now,
      response.status, response.ok ? 1 : 0, responseBody, payload, now
    ).run()
  );

  return { ok: true, contact: 'created', waId: extracted.waId, capi: response.ok ? 'sent' : `failed (${response.status})` };
}

async function logRawEvent({ env, waId, eventName, eventId, eventTime, messageType, raw }) {
  await env.DB
    .prepare(`
      INSERT INTO whatsapp_events (wa_id, event_name, event_id, event_time, source, message_type, raw_payload, created_at)
      VALUES (?, ?, ?, ?, 'webhook', ?, ?, ?)
    `)
    .bind(waId, eventName, eventId, eventTime, messageType, JSON.stringify(raw), Math.floor(Date.now() / 1000))
    .run();
}

// Confirmed against real uazapi traffic (docs/payload-uazapi.md). Returns
// null if the shape isn't recognized at all (e.g. a status/ack/connection
// event, not a "messages" event, or missing the fields we need).
function extractMessage(raw) {
  const msg = raw?.message;
  if (!msg || !msg.chatid) return null;

  const waId = msg.chatid; // e.g. "5511999998888@s.whatsapp.net" or "...@g.us" — always the real phone, even when `sender`/`chatlid` use the newer @lid format
  const phone = waId.replace(/@.*/, '');

  // ctwa_clid: CONFIRMED (real ad-click test, 2026-08). Not at the top
  // level of `message` — uazapi nests the untouched Baileys ad-context
  // block at `message.content.contextInfo.externalAdReply`. Present on
  // every message type seen so far that originated from the ad click
  // (first text message, and the WhatsApp Flow form-submission reply),
  // not just the very first message — so no special-casing needed beyond
  // reading it whenever it's there.
  const adReply = msg.content?.contextInfo?.externalAdReply || null;
  const ctwaClid = adReply?.ctwaClid || null;

  return {
    waId,
    phone,
    isGroup: typeof msg.isGroup === 'boolean' ? msg.isGroup : waId.endsWith('@g.us'),
    fromMe: !!msg.fromMe,
    pushName: msg.senderName || null,
    messageType: msg.messageType || null,
    text: msg.text || null,
    timestamp: msg.messageTimestamp ? Math.floor(Number(msg.messageTimestamp) / 1000) : null,
    ctwaClid,
    adSourceId: adReply?.sourceID || null,
    adHeadline: adReply?.title || null,
    adSourceUrl: adReply?.sourceURL || null,
    adMediaType: adReply?.mediaType != null ? String(adReply.mediaType) : null,
    adThumbnailUrl: adReply?.thumbnailURL || null,
  };
}
