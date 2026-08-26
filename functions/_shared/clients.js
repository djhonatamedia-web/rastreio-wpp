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
