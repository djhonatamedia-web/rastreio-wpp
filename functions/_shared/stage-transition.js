// Shared by the manual dashboard endpoint (functions/api/whatsapp-status.js)
// and the keyword-triggered path (functions/webhook/_whatsapp-core.js) so
// both go through the exact same status update, anti-duplicate guard, and
// ad-platform fan-out - no drift between "clicked a button" and "attendant
// typed a trigger phrase".
//
// Multi-tenant: everything is scoped by `client.id` (see
// functions/_shared/clients.js) so marking a stage for one client's
// contact never touches another client's data or credentials.
//
// A contact is normally attributed to exactly one ad platform (Meta via
// ctwa_clid, or Google via gclid/gbraid/wbraid - see
// docs/google-ads-whatsapp.md for how the Google side gets populated).
// This function doesn't assume that, though: it independently checks each
// platform's click id and fires to whichever one is present, so nothing
// breaks if a contact somehow ends up with both.

import { sendWhatsAppEventToMeta } from '../webhook/_whatsapp-capi.js';
import { sendGoogleAdsConversion } from './google-ads-capi.js';
import { getConfigValue } from './client-config.js';
import { STAGE_TO_META_EVENT, STAGE_TO_GOOGLE_ADS_ENV_VAR } from '../../config/whatsapp.js';

// source: 'manual' (dashboard button) | 'keyword' (trigger phrase match)
export async function applyStageTransition({ env, client, waId, newStatus, source, value, currency }) {
  const contact = await env.DB
    .prepare('SELECT wa_id, phone, ctwa_clid, gclid, gbraid, wbraid FROM whatsapp_contacts WHERE client_id = ? AND wa_id = ?')
    .bind(client.id, waId)
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
    .prepare('UPDATE whatsapp_contacts SET status = ?, status_source = ?, status_updated_at = ?, updated_at = ? WHERE client_id = ? AND wa_id = ?')
    .bind(newStatus, source, now, now, client.id, waId)
    .run();

  if (!metaEventName) {
    await insertEvent(env, { client, waId, eventName: newStatus, eventId, now, value, currency, sentToMeta: 0, eventSource });
    return { ok: true, status: newStatus, capi: 'skipped: no event mapped for this status' };
  }

  const [metaOutcome, googleOutcome] = await Promise.all([
    sendMetaIfNeeded({ env, client, waId, contact, metaEventName, value, currency, eventId, now }),
    sendGoogleAdsIfNeeded({ env, client, waId, contact, newStatus, value, currency, now }),
  ]);

  await insertEvent(env, {
    client, waId, eventName: metaEventName, eventId, now, value, currency, eventSource,
    sentToMeta: metaOutcome.attempted ? 1 : 0,
    statusCode: metaOutcome.statusCode, responseOk: metaOutcome.responseOk,
    responseBody: metaOutcome.responseBody, payloadSent: metaOutcome.payloadSent,
    googleAdsStatusCode: googleOutcome.statusCode, googleAdsResponseOk: googleOutcome.responseOk,
    googleAdsResponseBody: googleOutcome.responseBody, googleAdsPayloadSent: googleOutcome.payloadSent,
  });

  const capiParts = [`meta: ${metaOutcome.summary}`, `google_ads: ${googleOutcome.summary}`];
  return { ok: true, status: newStatus, capi: capiParts.join(', ') };
}

// Guard against re-firing the same stage to Meta more than once. Confirmed
// 2026-08-24: with no guard, re-triggering a stage (button click or a
// repeated keyword match) sent duplicate CAPI events for the same contact,
// inflating Meta's event count past the real number of leads.
async function sendMetaIfNeeded({ env, client, waId, contact, metaEventName, value, currency, eventId, now }) {
  if (!contact.ctwa_clid) {
    return { attempted: false, summary: 'skipped: no ctwa_clid', statusCode: null, responseOk: null, responseBody: null, payloadSent: null };
  }

  const alreadySent = await env.DB
    .prepare('SELECT 1 FROM whatsapp_events WHERE client_id = ? AND wa_id = ? AND event_name = ? AND sent_to_meta = 1 AND meta_response_ok = 1 LIMIT 1')
    .bind(client.id, waId, metaEventName)
    .first();
  if (alreadySent) {
    return { attempted: false, summary: `skipped: already sent`, statusCode: null, responseOk: null, responseBody: null, payloadSent: null };
  }

  const customData = value != null ? { value: parseFloat(value) || 0, currency: currency || 'BRL' } : undefined;
  const { payload, response, skipped } = await sendWhatsAppEventToMeta({
    eventName: metaEventName, ctwaClid: contact.ctwa_clid, phone: contact.phone,
    eventId, eventTime: now, customData, env, client,
  });

  if (skipped) {
    return { attempted: false, summary: `skipped: ${skipped}`, statusCode: null, responseOk: null, responseBody: null, payloadSent: null };
  }

  const responseBody = await response.text();
  return {
    attempted: true,
    summary: response.ok ? 'sent' : `failed (${response.status})`,
    statusCode: response.status, responseOk: response.ok ? 1 : 0, responseBody, payloadSent: payload,
  };
}

// Same duplicate guard as Meta, keyed off google_ads_response_ok instead.
async function sendGoogleAdsIfNeeded({ env, client, waId, contact, newStatus, value, currency, now }) {
  const clickId = contact.gclid || contact.gbraid || contact.wbraid;
  if (!clickId) {
    return { attempted: false, summary: 'skipped: no click id', statusCode: null, responseOk: null, responseBody: null, payloadSent: null };
  }

  // Conversion Action id is a non-secret, per-client, per-stage id -
  // editable from the dashboard's "Configuracoes" tab (D1), falls back to
  // the env var of the same name (STAGE_TO_GOOGLE_ADS_ENV_VAR) if never
  // set there.
  const envVarName = STAGE_TO_GOOGLE_ADS_ENV_VAR[newStatus];
  const conversionActionId = envVarName ? await getConfigValue(env, envVarName, client.id) : null;

  const alreadySent = await env.DB
    .prepare('SELECT 1 FROM whatsapp_events WHERE client_id = ? AND wa_id = ? AND event_name = ? AND google_ads_response_ok = 1 LIMIT 1')
    .bind(client.id, waId, newStatus)
    .first();
  if (alreadySent) {
    return { attempted: false, summary: 'skipped: already sent', statusCode: null, responseOk: null, responseBody: null, payloadSent: null };
  }

  const { payload, response, skipped } = await sendGoogleAdsConversion({
    conversionActionId, gclid: contact.gclid, gbraid: contact.gbraid, wbraid: contact.wbraid,
    value, currency, eventTime: now, env, client,
  });

  if (skipped) {
    return { attempted: false, summary: `skipped: ${skipped}`, statusCode: null, responseOk: null, responseBody: null, payloadSent: null };
  }

  const responseBody = await response.text();
  // HTTP 200 isn't enough - partialFailureError can hold per-row rejections.
  let responseOk = response.ok ? 1 : 0;
  if (response.ok) {
    try {
      const parsedBody = JSON.parse(responseBody);
      if (parsedBody?.partialFailureError) responseOk = 0;
    } catch (_) { /* non-JSON body, trust the HTTP status */ }
  }

  return {
    attempted: true,
    summary: responseOk ? 'sent' : `failed (${response.status})`,
    statusCode: response.status, responseOk, responseBody, payloadSent: payload,
  };
}

async function insertEvent(env, {
  client, waId, eventName, eventId, now, value, currency, sentToMeta, statusCode, responseOk, responseBody, payloadSent, eventSource,
  googleAdsStatusCode, googleAdsResponseOk, googleAdsResponseBody, googleAdsPayloadSent,
}) {
  await env.DB.prepare(`
    INSERT INTO whatsapp_events (
      client_id, wa_id, event_name, event_id, event_time, source, value, currency,
      sent_to_meta, meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent,
      google_ads_status_code, google_ads_response_ok, google_ads_response_body, google_ads_payload_sent,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    client.id, waId, eventName, eventId, now, eventSource,
    value != null ? parseFloat(value) || 0 : null, currency || null,
    sentToMeta, statusCode || null, responseOk ?? null, responseBody || null, payloadSent || null,
    googleAdsStatusCode || null, googleAdsResponseOk ?? null, googleAdsResponseBody || null, googleAdsPayloadSent || null,
    now
  ).run();
}
