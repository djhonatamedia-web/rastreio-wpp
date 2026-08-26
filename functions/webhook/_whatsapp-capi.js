// -----------------------------------------------------------------------------
// Meta Conversions API sender for Click-to-WhatsApp Ads (CTWA) attribution.
//
// Distinct from a normal Pixel/CAPI event: WhatsApp conversation events use
// action_source "business_messaging" + messaging_channel "whatsapp", and are
// attributed via `ctwa_clid` (the raw click id Meta embeds in the ad
// referral) instead of fbc/fbp. Confirmed shape (Meta docs, verified
// 2026-08-03):
//
//   {
//     "data": [{
//       "event_name": "Purchase",
//       "event_time": 1675999999,
//       "action_source": "business_messaging",
//       "messaging_channel": "whatsapp",
//       "event_id": "<uuid>",
//       "user_data": {
//         "page_id": "<Facebook Page ID linked to the WhatsApp number>",
//         "ctwa_clid": "<raw string, NOT hashed>",
//         "ph": ["<sha256 of the phone>"]
//       },
//       "custom_data": { "currency": "BRL", "value": 123 }
//     }]
//   }
//
// Without ctwa_clid, Meta cannot tie the event back to an ad click, so this
// silently skips (returns `{ skipped }`) rather than sending a useless event.
//
// Multi-tenant: `client` (see functions/_shared/clients.js) picks which
// client's Pixel/Page id (D1, client_config) and access token
// (Cloudflare env var, slug-prefixed) this send uses.
// -----------------------------------------------------------------------------

import { sha256, normalizePhone } from '../_shared/hashing.js';
import { getConfigValues } from '../_shared/client-config.js';
import { getClientSecret } from '../_shared/clients.js';

export async function sendWhatsAppEventToMeta({
  eventName,
  ctwaClid,
  phone,
  eventId,
  eventTime,
  customData,
  env,
  client,
}) {
  // PIXEL_ID/PAGE_ID are non-secret ids, editable from the dashboard's
  // "Configuracoes" tab (D1) - falls back to the env var of the same name
  // if never set there. ACCESS_TOKEN is a real credential and stays
  // Cloudflare-env-only, per client (slug-prefixed) - see docs/client-config.md.
  const { META_PIXEL_ID, META_PAGE_ID } = await getConfigValues(env, ['META_PIXEL_ID', 'META_PAGE_ID'], client.id);
  const accessToken = getClientSecret(env, client, 'META_ACCESS_TOKEN');

  if (!META_PIXEL_ID || !accessToken) {
    return { skipped: 'missing META_PIXEL_ID/META_ACCESS_TOKEN', payload: null, response: null };
  }
  if (!ctwaClid) {
    return { skipped: 'missing ctwa_clid - cannot attribute to an ad', payload: null, response: null };
  }
  if (!META_PAGE_ID) {
    return { skipped: 'missing META_PAGE_ID', payload: null, response: null };
  }

  const hashedPhone = await sha256(normalizePhone(phone, env.DEFAULT_COUNTRY_CODE));

  const userData = {
    page_id: META_PAGE_ID,
    ctwa_clid: ctwaClid,
  };
  if (hashedPhone) userData.ph = [hashedPhone];

  const metaPayload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: userData,
      ...(customData ? { custom_data: customData } : {}),
    }],
  };
  const testEventCode = getClientSecret(env, client, 'META_TEST_EVENT_CODE');
  if (testEventCode) metaPayload.test_event_code = testEventCode;

  const payloadJson = JSON.stringify(metaPayload);

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${META_PIXEL_ID}/events?access_token=${accessToken}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadJson }
  );

  return { payload: payloadJson, response };
}
