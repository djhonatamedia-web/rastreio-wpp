// -----------------------------------------------------------------------------
// uazapi webhook adapter.
//
// URL shape: /webhook/whatsapp/<client's webhook_slug>
// Each client has its own webhook_slug (see the `clients` table /
// functions/_shared/clients.js) - paste that client's full URL into their
// uazapi instance's webhook configuration, enabling at least the "message
// received" event type.
//
// Thin by design: resolve the client from the slug, read the body, delegate
// everything else to _whatsapp-core.js. Never grows provider-branching
// logic here.
// -----------------------------------------------------------------------------

import { processWhatsAppMessage } from '../_whatsapp-core.js';
import { resolveClientByWebhookSlug } from '../../_shared/clients.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const client = await resolveClientByWebhookSlug(env, params.slug);
  if (!client) {
    // Missing/wrong slug and a slug that simply doesn't exist look the
    // same on purpose - scanners learn nothing either way.
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const raw = await request.json();
    const result = await processWhatsAppMessage({ raw, env, context, client });
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
