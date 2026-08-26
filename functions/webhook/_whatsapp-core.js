// -----------------------------------------------------------------------------
// Shared brain for the WhatsApp webhook adapter - mirrors the adapter/core
// split in krob-tracking-stack-main's _core.js, but for a stateful
// conversation lifecycle instead of a one-shot purchase event.
//
// *** MULTI-TENANT (2026-08-26) ***
// Every row belongs to a client (`client.id`, resolved by the adapter from
// the webhook_slug before this file ever runs - see [slug].js and
// functions/_shared/clients.js). Every query in this file is scoped by
// client_id so two clients' contacts/events/keywords/codes never mix.
//
// *** FASE 0 STATUS: CLOSED - envelope and ctwa_clid both confirmed. ***
// Confirmed against real webhook payloads captured in production
// (docs/payload-uazapi.md): uazapi does NOT forward the raw Baileys proto -
// it sends its own flattened envelope (`{ EventType, chat, message }`, with
// fields like message.chatid/fromMe/isGroup/senderName/text/messageType at
// the top level of `message`). extractMessage() below matches that
// confirmed shape.
//
// ctwa_clid confirmed 2026-08 against 3 real ad-click leads: uazapi passes
// the untouched Baileys ad-context block through at
// `message.content.contextInfo.externalAdReply` (NOT `track_id`/
// `track_source`, which stayed empty on every message, ad-originated or
// not - those were a dead end).
//
// The one guarantee: `raw_payload` is ALWAYS persisted verbatim, regardless
// of whether extraction below finds anything. That's what let us recover
// the real envelope shape after the fact without needing a fresh capture.
//
// *** KNOWN ORDERING QUIRK (confirmed 2026-08-24) ***
// uazapi does not guarantee webhook delivery in the same order WhatsApp
// generated the messages. On a real CTWA lead, the ad-context message
// (externalAdReply, entryPointConversionSource "ctwa_ad") had an earlier
// messageTimestamp than the contact's free-typed first message, but our
// webhook received/processed it SECOND. Since attribution is captured
// once on contact creation, that meant the ad data landed on a message
// for a contact that already existed - see the `existing` branch below,
// which backfills attribution (and fires the first-touch CAPI send) the
// first time ad context shows up, regardless of which message it arrives
// on.
//
// *** GOOGLE ADS ATTRIBUTION (2026-08-25) ***
// Unlike Meta, Google Ads has no "Click to WhatsApp" ad format - a click
// carries no context into the WhatsApp message on its own. The bridge:
// the client's landing page captures gclid/gbraid/wbraid, POSTs it to
// /api/track-click keyed by a short code, and embeds "Ref: <code>" in the
// WhatsApp button's pre-filled message text. This file looks for that
// code in the first message (new or backfilled, same pattern as
// ctwa_clid above) and resolves it against ad_click_codes. See
// docs/google-ads-whatsapp.md. No automatic first-touch CAPI send for
// Google Ads (unlike LeadSubmitted for Meta) - only qualified/scheduled/
// sale get sent, via applyStageTransition(), same as everything else.
// -----------------------------------------------------------------------------

import { sendWhatsAppEventToMeta } from './_whatsapp-capi.js';
import { applyStageTransition } from '../_shared/stage-transition.js';
import { normalize } from '../_shared/text-normalize.js';

export async function processWhatsAppMessage({ raw, env, context, client }) {
  const now = Math.floor(Date.now() / 1000);
  const eventId = crypto.randomUUID();

  let extracted;
  try {
    extracted = extractMessage(raw); // FASE 0 GUESS - see extractMessage() below
  } catch (err) {
    extracted = null;
  }

  // Always log the raw event, even if extraction failed or this wasn't a
  // message we care about (status/ack/connection events) - nothing is lost.
  context.waitUntil(
    logRawEvent({
      env,
      client,
      waId: extracted?.waId || 'unknown',
      eventName: extracted ? 'message_received' : 'unrecognized_webhook',
      eventId,
      eventTime: extracted?.timestamp || now,
      messageType: extracted?.messageType || null,
      raw,
    })
  );

  // Attendant's own messages never create/attribute a contact (see the
  // early return right below), but they're the ones we check for a
  // configured trigger phrase - see the dynamic-funnel-by-keyword plan.
  // Backgrounded: matching a phrase and firing the CAPI event shouldn't
  // delay the 200 OK we owe uazapi.
  if (extracted && extracted.fromMe && !extracted.isGroup && extracted.waId && extracted.text) {
    context.waitUntil(checkStageKeyword({ env, client, waId: extracted.waId, text: extracted.text }));
  }

  if (!extracted || !extracted.waId || extracted.fromMe || extracted.isGroup) {
    return { ok: true, skipped: !extracted ? 'unrecognized payload shape' : 'not an inbound 1:1 message' };
  }

  const existing = await env.DB
    .prepare('SELECT id, ctwa_clid, gclid, gbraid, wbraid FROM whatsapp_contacts WHERE client_id = ? AND wa_id = ?')
    .bind(client.id, extracted.waId)
    .first();

  if (existing) {
    await env.DB
      .prepare('UPDATE whatsapp_contacts SET push_name = COALESCE(?, push_name), updated_at = ? WHERE client_id = ? AND wa_id = ?')
      .bind(extracted.pushName || null, now, client.id, extracted.waId)
      .run();

    // Ad context arriving on a later message than the one that created the
    // contact (see ordering quirk note above). Backfill it once, and fire
    // the same first-touch CAPI send we'd have fired had it arrived first -
    // this contact never got one, since sendWhatsAppEventToMeta() skips
    // without a ctwa_clid.
    if (!existing.ctwa_clid && extracted.ctwaClid) {
      await env.DB
        .prepare(`
          UPDATE whatsapp_contacts SET
            ctwa_clid = ?, ad_source_id = ?, ad_headline = ?, ad_source_url = ?,
            ad_media_type = ?, ad_thumbnail_url = ?, is_ctwa = 1, updated_at = ?
          WHERE client_id = ? AND wa_id = ?
        `)
        .bind(
          extracted.ctwaClid,
          extracted.adSourceId || null,
          extracted.adHeadline || null,
          extracted.adSourceUrl || null,
          extracted.adMediaType || null,
          extracted.adThumbnailUrl || null,
          now,
          client.id,
          extracted.waId
        )
        .run();

      const capi = await sendFirstTouchLead({ extracted, eventId, now, env, context, client });
      return { ok: true, contact: 'existing', waId: extracted.waId, capi: `backfilled ctwa_clid, ${capi}` };
    }

    // Same ordering-quirk handling, for Google Ads attribution: the "Ref:
    // <code>" text can land on a later message than the one that created
    // the contact. No CAPI send here (see file header) - just backfill.
    if (!existing.gclid && !existing.gbraid && !existing.wbraid && extracted.googleAdsCode) {
      await backfillGoogleAdsAttribution({ env, client, waId: extracted.waId, code: extracted.googleAdsCode, now });
      return { ok: true, contact: 'existing', waId: extracted.waId, capi: 'backfilled google ads click id' };
    }

    return { ok: true, contact: 'existing', waId: extracted.waId };
  }

  // Resolve a Google Ads click id before insert, if this first message
  // carries a "Ref: <code>" from the landing-page bridge (see file header).
  const googleClick = extracted.googleAdsCode
    ? await lookupGoogleAdsClick({ env, client, code: extracted.googleAdsCode })
    : null;

  // First-ever message from this wa_id: create the contact, first-touch
  // attribution (ctwa_clid, if present, is captured once and never
  // overwritten on later messages).
  await env.DB
    .prepare(`
      INSERT INTO whatsapp_contacts (
        client_id, wa_id, phone, push_name, ctwa_clid, ad_source_id, ad_headline,
        ad_source_url, ad_media_type, ad_thumbnail_url, is_ctwa,
        gclid, gbraid, wbraid, ad_platform,
        first_message_text, first_message_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, ?)
    `)
    .bind(
      client.id,
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
      googleClick?.gclid || null,
      googleClick?.gbraid || null,
      googleClick?.wbraid || null,
      extracted.ctwaClid ? 'meta' : (googleClick ? 'google' : null),
      extracted.text || null,
      extracted.timestamp || now,
      now,
      now
    )
    .run();

  if (googleClick) {
    context.waitUntil(markGoogleAdsCodeMatched({ env, client, code: extracted.googleAdsCode, waId: extracted.waId, now }));
  }

  const capi = await sendFirstTouchLead({ extracted, eventId, now, env, context, client });
  return { ok: true, contact: 'created', waId: extracted.waId, capi };
}

// Looks up a Google Ads click id captured earlier by /api/track-click.
// Returns null if the code is unknown (e.g. the lead edited the pre-filled
// message and the code never made it in - see docs/google-ads-whatsapp.md).
async function lookupGoogleAdsClick({ env, client, code }) {
  const row = await env.DB
    .prepare('SELECT gclid, gbraid, wbraid FROM ad_click_codes WHERE client_id = ? AND code = ?')
    .bind(client.id, code)
    .first();
  return row || null;
}

async function markGoogleAdsCodeMatched({ env, client, code, waId, now }) {
  await env.DB
    .prepare('UPDATE ad_click_codes SET matched_wa_id = ?, matched_at = ? WHERE client_id = ? AND code = ?')
    .bind(waId, now, client.id, code)
    .run();
}

// Existing-contact path: backfill Google Ads attribution once, same
// pattern as the ctwa_clid backfill above.
async function backfillGoogleAdsAttribution({ env, client, waId, code, now }) {
  const googleClick = await lookupGoogleAdsClick({ env, client, code });
  if (!googleClick) return;

  await env.DB
    .prepare('UPDATE whatsapp_contacts SET gclid = ?, gbraid = ?, wbraid = ?, ad_platform = ?, updated_at = ? WHERE client_id = ? AND wa_id = ?')
    .bind(googleClick.gclid || null, googleClick.gbraid || null, googleClick.wbraid || null, 'google', now, client.id, waId)
    .run();

  await markGoogleAdsCodeMatched({ env, client, code, waId, now });
}

// Fires the automatic first-touch 'LeadSubmitted' CAPI event and logs the
// result, shared by the new-contact path and the existing-contact backfill
// path (ad context can legitimately arrive on either message - see the
// ordering quirk note at the top of this file). Returns a short status
// string for the caller's response, doesn't throw.
async function sendFirstTouchLead({ extracted, eventId, now, env, context, client }) {
  if (!extracted.ctwaClid) {
    return 'skipped: no ctwa_clid';
  }

  const { payload, response, skipped } = await sendWhatsAppEventToMeta({
    eventName: 'LeadSubmitted', // NOT 'Lead' -- Meta rejects that literal name for business_messaging (400, error_subcode 2804066), confirmed 2026-08 in production; Meta's own error suggested this alternative
    ctwaClid: extracted.ctwaClid,
    phone: extracted.phone,
    eventId,
    eventTime: extracted.timestamp || now,
    env,
    client,
  });

  if (skipped) {
    return `skipped: ${skipped}`;
  }

  const responseBody = await response.text();
  context.waitUntil(
    env.DB.prepare(`
      UPDATE whatsapp_contacts SET
        lead_sent_to_meta = 1, lead_meta_status_code = ?, lead_meta_response_ok = ?,
        lead_meta_response_body = ?, lead_meta_payload_sent = ?, updated_at = ?
      WHERE client_id = ? AND wa_id = ?
    `).bind(response.status, response.ok ? 1 : 0, responseBody, payload, now, client.id, extracted.waId).run()
  );

  context.waitUntil(
    env.DB.prepare(`
      INSERT INTO whatsapp_events (
        client_id, wa_id, event_name, event_id, event_time, source, sent_to_meta,
        meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent, created_at
      ) VALUES (?, ?, 'LeadSubmitted', ?, ?, 'webhook', 1, ?, ?, ?, ?, ?)
    `).bind(
      client.id, extracted.waId, eventId, extracted.timestamp || now,
      response.status, response.ok ? 1 : 0, responseBody, payload, now
    ).run()
  );

  return response.ok ? 'sent' : `failed (${response.status})`;
}

// Checks the attendant's own message against the configured trigger
// phrases (stage_keywords table, managed from the "Palavras-chave"
// dashboard tab - see functions/api/whatsapp-keywords.js) and applies the
// matching stage transition through the same path a manual dashboard
// click would use. First match wins if more than one phrase matches the
// same message; a contact that doesn't exist yet (attendant replied
// before any inbound message created one) is silently ignored.
async function checkStageKeyword({ env, client, waId, text }) {
  const normalizedText = normalize(text);
  if (!normalizedText) return;

  const rows = await env.DB.prepare('SELECT status, phrase FROM stage_keywords WHERE client_id = ?').bind(client.id).all();
  for (const row of rows.results || []) {
    if (normalizedText.includes(normalize(row.phrase))) {
      await applyStageTransition({ env, client, waId, newStatus: row.status, source: 'keyword' });
      return;
    }
  }
}

async function logRawEvent({ env, client, waId, eventName, eventId, eventTime, messageType, raw }) {
  await env.DB
    .prepare(`
      INSERT INTO whatsapp_events (client_id, wa_id, event_name, event_id, event_time, source, message_type, raw_payload, created_at)
      VALUES (?, ?, ?, ?, ?, 'webhook', ?, ?, ?)
    `)
    .bind(client.id, waId, eventName, eventId, eventTime, messageType, JSON.stringify(raw), Math.floor(Date.now() / 1000))
    .run();
}

// Confirmed against real uazapi traffic (docs/payload-uazapi.md). Returns
// null if the shape isn't recognized at all (e.g. a status/ack/connection
// event, not a "messages" event, or missing the fields we need).
function extractMessage(raw) {
  const msg = raw?.message;
  if (!msg || !msg.chatid) return null;

  const waId = msg.chatid; // e.g. "5511999998888@s.whatsapp.net" or "...@g.us" - always the real phone, even when `sender`/`chatlid` use the newer @lid format
  const phone = waId.replace(/@.*/, '');

  // ctwa_clid: CONFIRMED (real ad-click test, 2026-08). Not at the top
  // level of `message` - uazapi nests the untouched Baileys ad-context
  // block at `message.content.contextInfo.externalAdReply`. Present on
  // every message type seen so far that originated from the ad click
  // (first text message, and the WhatsApp Flow form-submission reply),
  // not just the very first message - so no special-casing needed beyond
  // reading it whenever it's there.
  const adReply = msg.content?.contextInfo?.externalAdReply || null;
  const ctwaClid = adReply?.ctwaClid || null;

  // Google Ads landing-page bridge (see file header) - a short code the
  // page embeds in the pre-filled WhatsApp message text, e.g. "Ref: AB12CD".
  const googleAdsCodeMatch = /\bRef:\s*([A-Za-z0-9]{6})\b/i.exec(msg.text || '');
  // Uppercased so case never matters when matching against ad_click_codes
  // (the code is only ever compared, never shown back to a human).
  const googleAdsCode = googleAdsCodeMatch ? googleAdsCodeMatch[1].toUpperCase() : null;

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
    googleAdsCode,
  };
}
