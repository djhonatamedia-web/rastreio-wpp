// -----------------------------------------------------------------------------
// Meta Conversions API sender for the LANDING PAGE -> WhatsApp path.
//
// The Click-to-WhatsApp sender (_whatsapp-capi.js) needs a ctwa_clid, which
// WhatsApp delivers only some of the time (confirmed 2026-09-23/24: missing on
// ~half of Margel's ad leads and on Vanessa's first ad lead). This is the path
// that does NOT depend on it: the landing page captures fbc/fbp (the Pixel's
// own cookies, or fbc rebuilt from the fbclid in the URL), the visitor's real
// IP + User-Agent are recorded server-side by /api/track-click, and the code
// embedded in the WhatsApp message ties that click to the conversation. Each
// funnel stage is then sent as a normal `website` conversion, matched by
// fbc/fbp plus the hashed phone.
//
//   {
//     "data": [{
//       "event_name": "Schedule",
//       "event_time": 1790000000,
//       "event_id": "<uuid>",
//       "event_source_url": "<landing page url>",
//       "action_source": "website",
//       "user_data": {
//         "fbc": "fb.1.<ts>.<fbclid>", "fbp": "fb.1.<ts>.<rand>",
//         "ph": ["<sha256 phone>"], "external_id": ["<sha256 wa_id>"],
//         "client_ip_address": "...", "client_user_agent": "..."
//       }
//     }]
//   }
//
// Goes to the client's WEB Pixel (META_WEB_PIXEL_ID) - NOT the WhatsApp
// messaging dataset, which only accepts business_messaging events.
// event_time is "now": Meta rejects events older than 7 days.
//
// Multi-tenant: `client` picks the Pixel id (D1, client_config) and access
// token (Cloudflare env, slug-prefixed) - see docs/client-config.md.
// -----------------------------------------------------------------------------

import { sha256, normalizePhone } from '../_shared/hashing.js';
import { getConfigValues } from '../_shared/client-config.js';
import { getClientSecret } from '../_shared/clients.js';

// True when a click row / contact row proves a Meta AD click (fbc, or the
// fbclid it's built from) and carries no Google click id (a Google Ads click
// keeps its own path). fbp alone does NOT count: the Pixel sets it for every
// visitor, ad or not, so it can't tell paid traffic from organic.
export function hasMetaSiteId(row) {
  if (!row) return false;
  if (row.gclid || row.gbraid || row.wbraid) return false;
  return !!(row.fbc || row.fbclid);
}

// contact: { fbc, fbp, phone, waId, clientIp, clientUserAgent, landingUrl }
export async function sendMetaWebEvent({ eventName, contact, eventId, eventTime, customData, env, client }) {
  const { META_WEB_PIXEL_ID } = await getConfigValues(env, ['META_WEB_PIXEL_ID'], client.id);
  // A dataset-scoped token only works for that dataset, so the web Pixel may
  // need its own; falls back to the messaging token when one covers both.
  const accessToken = getClientSecret(env, client, 'META_WEB_ACCESS_TOKEN') || getClientSecret(env, client, 'META_ACCESS_TOKEN');

  if (!META_WEB_PIXEL_ID || !accessToken) {
    return { skipped: 'missing META_WEB_PIXEL_ID/access token', payload: null, response: null };
  }
  if (!contact?.fbc) {
    return { skipped: 'missing fbc - cannot attribute to an ad', payload: null, response: null };
  }

  const userData = {};
  if (contact.fbc) userData.fbc = contact.fbc;
  if (contact.fbp) userData.fbp = contact.fbp;
  const hashedPhone = await sha256(normalizePhone(contact.phone, env.DEFAULT_COUNTRY_CODE));
  if (hashedPhone) userData.ph = [hashedPhone];
  const hashedExternalId = await sha256(contact.waId);
  if (hashedExternalId) userData.external_id = [hashedExternalId];
  if (contact.clientIp) userData.client_ip_address = contact.clientIp;
  if (contact.clientUserAgent) userData.client_user_agent = contact.clientUserAgent;

  const metaPayload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      event_source_url: contact.landingUrl || '',
      action_source: 'website',
      user_data: userData,
      ...(customData ? { custom_data: customData } : {}),
    }],
  };
  const testEventCode = getClientSecret(env, client, 'META_TEST_EVENT_CODE');
  if (testEventCode) metaPayload.test_event_code = testEventCode;

  const payloadJson = JSON.stringify(metaPayload);
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${META_WEB_PIXEL_ID}/events?access_token=${accessToken}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadJson }
  );

  return { payload: payloadJson, response };
}
