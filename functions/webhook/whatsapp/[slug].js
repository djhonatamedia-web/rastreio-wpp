// -----------------------------------------------------------------------------
// uazapi webhook adapter.
//
// URL shape: /webhook/whatsapp/<WHATSAPP_WEBHOOK_SLUG>
// Paste this full URL into the uazapi instance's webhook configuration
// (https://djhonata.uazapi.com panel), enabling at least the "message
// received" event type.
//
// Thin by design: gate on the slug, read the body, delegate everything else
// to _whatsapp-core.js. Never grows provider-branching logic here.
// -----------------------------------------------------------------------------

import { processWhatsAppMessage } from '../_whatsapp-core.js';
import { guardSlug } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const slugFailure = guardSlug(params.slug, env.WHATSAPP_WEBHOOK_SLUG);
  if (slugFailure) return slugFailure;

  try {
    const raw = await request.json();
    const result = await processWhatsAppMessage({ raw, env, context });
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
