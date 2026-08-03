// -----------------------------------------------------------------------------
// Shared brain for the WhatsApp webhook adapter — mirrors the adapter/core
// split in krob-tracking-stack-main's _core.js, but for a stateful
// conversation lifecycle instead of a one-shot purchase event.
//
// *** FASE 0 STATUS: payload shape is UNCONFIRMED. ***
// uazapi's exact webhook envelope (top-level event-type field name, where
// the Baileys message object is nested, whether it's a single message or an
// array) has not been observed against a real webhook yet. Every field
// extraction below is a best-effort guess based on (a) the Baileys library's
// known proto shape (confirmed via public docs: message.contextInfo
// .externalAdReplyInfo.ctwaClid) and (b) the KROB WhatsApp Tracker reference
// screenshot, which shows raw Baileys message-type strings (Conversation,
// ExtendedTextMessage, ImageMessage, ReactionMessage, PollUpdateMessage)
// surfacing unmodified — meaning uazapi does not rewrite/flatten them.
//
// The one guarantee: `raw_payload` is ALWAYS persisted verbatim, regardless
// of whether the guesses below extract anything usefully. Once a real
// webhook is captured (see docs/payload-uazapi.md), come back and correct
// every block marked "FASE 0 GUESS" against the actual JSON.
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
        ad_source_url, ad_media_type, is_ctwa, first_message_text,
        first_message_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, ?)
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
    eventName: 'Lead',
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
      ) VALUES (?, 'Lead', ?, ?, 'webhook', 1, ?, ?, ?, ?, ?)
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

// FASE 0 GUESS — replace this whole function once a real uazapi payload has
// been captured (docs/payload-uazapi.md). Returns null if the shape isn't
// recognized at all (e.g. a status/ack/connection event, not a message).
function extractMessage(raw) {
  // uazapi envelope: try the common field names unofficial gateways use.
  // Adjust once confirmed.
  const msg = raw?.message || raw?.data?.message || raw?.messages?.[0] || null;
  if (!msg) return null;

  const key = msg.key || {};
  const remoteJid = key.remoteJid || raw?.chatid || null;
  if (!remoteJid) return null;

  const isGroup = remoteJid.endsWith('@g.us');
  const fromMe = !!key.fromMe;
  const waId = remoteJid;
  const phone = remoteJid.replace(/@.*/, '');

  const content = msg.message || {};
  const messageType = Object.keys(content)[0] || null; // e.g. "conversation", "extendedTextMessage"

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    null;

  const contextInfo =
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    null;
  const adReply = contextInfo?.externalAdReplyInfo || null;

  return {
    waId,
    phone,
    isGroup,
    fromMe,
    pushName: msg.pushName || null,
    messageType,
    text,
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : null,
    ctwaClid: adReply?.ctwaClid || null,
    adSourceId: adReply?.sourceId || null,
    adHeadline: adReply?.title || null,
    adSourceUrl: adReply?.sourceUrl || null,
    adMediaType: adReply?.mediaType || null,
  };
}
