// Multi-tenant client resolution. Every row in every table belongs to a
// client (clients.id) — see docs/multi-tenant.md for the full model and
// the onboarding steps for a new client.
//
// Real credentials (Meta access token, Google Ads OAuth client secret/
// refresh token/developer token) never go to D1 — they live in Cloudflare
// env vars prefixed with the client's slug (e.g. TINTIM_META_ACCESS_TOKEN),
// resolved by getClientSecret() below. Non-secret ids (Pixel ID, Customer
// ID, Conversion Action ids) live in D1's client_config table, scoped by
// client_id (see client-config.js) — same split as before multi-tenant,
// just keyed per client now instead of per deployment.

export async function resolveClientBySlug(env, slug) {
  if (!slug) return null;
  return await env.DB
    .prepare('SELECT id, name, slug, webhook_slug, active FROM clients WHERE slug = ? AND active = 1')
    .bind(slug)
    .first();
}

export async function resolveClientByWebhookSlug(env, webhookSlug) {
  if (!webhookSlug) return null;
  return await env.DB
    .prepare('SELECT id, name, slug, webhook_slug, active FROM clients WHERE webhook_slug = ? AND active = 1')
    .bind(webhookSlug)
    .first();
}

function prefixedSecretName(client, name) {
  return client.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_' + name;
}

// Falls back to the unprefixed env var when the client-prefixed one isn't
// set — lets a client created before multi-tenant existed keep working
// without renaming anything in Cloudflare Pages.
export function getClientSecret(env, client, name) {
  return env[prefixedSecretName(client, name)] || env[name] || null;
}

// Same lookup as getClientSecret(), but returns only whether the secret
// exists and which of the two names it came from - never the value. The
// fallback above is silent by design (it keeps client 1 working), which
// means "forgot to create <SLUG>_META_ACCESS_TOKEN" looks identical to
// "configured correctly" from the outside: the client's events go out
// with another client's token. This is what /api/client-status uses to
// surface that in the dashboard.
export function describeClientSecret(env, client, name) {
  const prefixed = prefixedSecretName(client, name);
  if (env[prefixed]) return { set: true, source: 'prefixed', env_var: prefixed };
  if (env[name]) return { set: true, source: 'fallback', env_var: prefixed };
  return { set: false, source: null, env_var: prefixed };
}
