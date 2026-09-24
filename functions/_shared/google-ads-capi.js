// Google Ads offline click conversions, sent through the DATA MANAGER API
// (POST https://datamanager.googleapis.com/v1/events:ingest).
//
// Ported from krob-tracking-stack-main/functions/webhook/_core.js
// (sendToGoogleAds), generalized for a per-funnel-stage conversion instead
// of a per-product Purchase.
//
// *** WHY NOT THE GOOGLE ADS API (uploadClickConversions) *** Confirmed on
// the first real send (Margel, 2026-09-23): Google answers HTTP 200 with a
// partialFailureError saying "New integrations for uploading click
// conversions should use the Data Manager API. Usage of
// ConversionUploadService.UploadClickConversions is limited to existing
// users." (An earlier 404 on the same call was a separate cause: API v21
// had been sunset - v19-v21 answer 404, v22+ answer 401.) Do not go back to
// the Google Ads API for this.
//
// Data Manager API differences worth knowing:
//  - OAuth scope must be https://www.googleapis.com/auth/datamanager (a
//    refresh token minted for the old .../auth/adwords scope does NOT work),
//    and the API must be enabled in the Cloud project.
//  - No developer token, and no login-customer-id header: the login account
//    goes in the request body (destinations[].loginAccount).
//  - Fast-fail model: any invalid field rejects the whole request with an
//    HTTP 4xx + { error: { message } }; there is no per-row partial failure.
//
// Multi-tenant: each client has their own Google Ads account/MCC, so the
// OAuth token cache below is keyed per client.id (see
// functions/_shared/clients.js - getClientSecret).

import { getConfigValues } from './client-config.js';
import { getClientSecret } from './clients.js';

const DATA_MANAGER_INGEST_URL = 'https://datamanager.googleapis.com/v1/events:ingest';

const googleAdsTokenCache = new Map(); // clientId -> { token, expiresAt }

async function getGoogleAdsAccessToken(env, client) {
  const now = Math.floor(Date.now() / 1000);
  const cached = googleAdsTokenCache.get(client.id);
  if (cached && cached.expiresAt > now + 30) {
    return cached.token;
  }

  const clientId = getClientSecret(env, client, 'GOOGLE_ADS_CLIENT_ID');
  const clientSecret = getClientSecret(env, client, 'GOOGLE_ADS_CLIENT_SECRET');
  const refreshToken = getClientSecret(env, client, 'GOOGLE_ADS_REFRESH_TOKEN');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    console.error('Google Ads token refresh failed:', resp.status, await resp.text().catch(() => ''));
    return null;
  }

  const data = await resp.json();
  if (!data.access_token) {
    console.error('Google Ads token refresh: no access_token in response', data);
    return null;
  }

  googleAdsTokenCache.set(client.id, {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) - 60,
  });
  return data.access_token;
}

// conversionActionId: numeric Google Ads Conversion Action id (client- and
// stage-specific, read from D1/env by the caller - see
// STAGE_TO_GOOGLE_ADS_ENV_VAR in config/whatsapp.js).
export async function sendGoogleAdsConversion({ conversionActionId, gclid, gbraid, wbraid, value, currency, eventTime, env, client }) {
  // OAuth credentials are real secrets, Cloudflare-env-only, per client.
  const oauthClientId = getClientSecret(env, client, 'GOOGLE_ADS_CLIENT_ID');
  const oauthClientSecret = getClientSecret(env, client, 'GOOGLE_ADS_CLIENT_SECRET');
  const refreshToken = getClientSecret(env, client, 'GOOGLE_ADS_REFRESH_TOKEN');
  if (!oauthClientId || !oauthClientSecret || !refreshToken) {
    return { skipped: 'missing google ads env', payload: null, response: null };
  }
  if (!conversionActionId) {
    return { skipped: 'no conversion action configured for this stage', payload: null, response: null };
  }
  if (!gclid && !gbraid && !wbraid) {
    return { skipped: 'no click id', payload: null, response: null };
  }

  // CUSTOMER_ID/LOGIN_CUSTOMER_ID are non-secret account ids, editable from
  // the dashboard's "Configuracoes" tab (D1) - falls back to the env var
  // of the same name if never set there.
  const { GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID } = await getConfigValues(
    env, ['GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'], client.id
  );
  if (!GOOGLE_ADS_CUSTOMER_ID || !GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    return { skipped: 'missing google ads customer id', payload: null, response: null };
  }

  const accessToken = await getGoogleAdsAccessToken(env, client);
  if (!accessToken) {
    return { skipped: 'oauth token unavailable', payload: null, response: null };
  }

  const customerId = String(GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, '');
  const loginCustomerId = String(GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');

  // RFC 3339 in UTC (unambiguous, so no per-account timezone offset needed).
  const adIdentifiers = gclid ? { gclid } : wbraid ? { wbraid } : { gbraid };
  const body = {
    destinations: [{
      operatingAccount: { accountType: 'GOOGLE_ADS', accountId: customerId },
      loginAccount: { accountType: 'GOOGLE_ADS', accountId: loginCustomerId },
      productDestinationId: String(conversionActionId),
    }],
    events: [{
      eventTimestamp: new Date(eventTime * 1000).toISOString(),
      conversionValue: parseFloat(value) || 0,
      currency: currency || 'BRL',
      adIdentifiers,
      // Required by the API (WEB | APP | IN_STORE | PHONE | OTHER). A
      // WhatsApp lead that started from an ad click is none of the
      // specific ones. Found via the first real send (2026-09-23): 400
      // "events[0].event_source: Required field is missing".
      eventSource: 'OTHER',
    }],
    validateOnly: false,
  };
  const payloadJson = JSON.stringify(body);

  const response = await fetch(DATA_MANAGER_INGEST_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: payloadJson,
  });

  return { payload: payloadJson, response };
}
