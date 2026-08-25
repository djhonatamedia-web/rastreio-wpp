// Google Ads API (v21 REST) — uploadClickConversions, ported from
// krob-tracking-stack-main/functions/webhook/_core.js (sendToGoogleAds),
// generalized for a per-funnel-stage conversion instead of a per-product
// Purchase. Same OAuth2 refresh-token flow, same env var names — a client
// who already has krob-tracking-stack-main wired to their Google Ads
// account can reuse the exact same GOOGLE_ADS_* credentials here.
//
// Pinning v21 in the URL: the Google Ads SDKs lag the REST API and break
// with "API version not found" — call REST directly, same as krob does.

import { getConfigValues } from './client-config.js';

let googleAdsTokenCache = { token: null, expiresAt: 0 };

async function getGoogleAdsAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (googleAdsTokenCache.token && googleAdsTokenCache.expiresAt > now + 30) {
    return googleAdsTokenCache.token;
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
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

  googleAdsTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) - 60,
  };
  return data.access_token;
}

// Format unix seconds → "YYYY-MM-DD HH:MM:SS±HH:MM" in the account's
// timezone. Google Ads rejects conversions whose timestamp precedes the
// click with CONVERSION_PRECEDES_GCLID, so the offset must match the ad
// account's TZ. Default matches krob's default (-03:00, São Paulo).
function formatConversionDateTime(unixSeconds, offsetString) {
  const tz = offsetString || '-03:00';
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!match) {
    const d = new Date(unixSeconds * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const offsetSeconds = sign * (parseInt(match[2], 10) * 3600 + parseInt(match[3], 10) * 60);
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${tz}`;
}

// conversionActionId: numeric Google Ads Conversion Action id (client- and
// stage-specific, read from an env var by the caller — see
// STAGE_TO_GOOGLE_ADS_ENV_VAR in config/whatsapp.js).
export async function sendGoogleAdsConversion({ conversionActionId, gclid, gbraid, wbraid, value, currency, eventTime, env }) {
  // OAuth credentials + developer token are real secrets, Cloudflare-env-only.
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_CLIENT_ID ||
      !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
    return { skipped: 'missing google ads env', payload: null, response: null };
  }
  if (!conversionActionId) {
    return { skipped: 'no conversion action configured for this stage', payload: null, response: null };
  }
  if (!gclid && !gbraid && !wbraid) {
    return { skipped: 'no click id', payload: null, response: null };
  }

  // CUSTOMER_ID/LOGIN_CUSTOMER_ID are non-secret account ids, editable from
  // the dashboard's "Configurações" tab (D1) — falls back to the env var
  // of the same name if never set there.
  const { GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID } = await getConfigValues(
    env, ['GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID']
  );
  if (!GOOGLE_ADS_CUSTOMER_ID || !GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    return { skipped: 'missing google ads customer id', payload: null, response: null };
  }

  const accessToken = await getGoogleAdsAccessToken(env);
  if (!accessToken) {
    return { skipped: 'oauth token unavailable', payload: null, response: null };
  }

  const customerId = String(GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, '');
  const loginCustomerId = String(GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');

  const conversion = {
    conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
    conversionDateTime: formatConversionDateTime(eventTime, env.TIMEZONE_OFFSET),
    conversionValue: parseFloat(value) || 0,
    currencyCode: currency || 'BRL',
  };
  if (gclid) conversion.gclid = gclid;
  else if (wbraid) conversion.wbraid = wbraid;
  else if (gbraid) conversion.gbraid = gbraid;

  const body = { conversions: [conversion], partialFailure: true, validateOnly: false };
  const payloadJson = JSON.stringify(body);

  const response = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}:uploadClickConversions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': loginCustomerId,
        'Content-Type': 'application/json',
      },
      body: payloadJson,
    }
  );

  return { payload: payloadJson, response };
}
