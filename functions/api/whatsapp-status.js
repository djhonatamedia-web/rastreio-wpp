// POST /api/whatsapp-status
// Headers: x-dash-key: <DASH_KEY>
// Body: { "client": "<slug>", "wa_id": "...", "new_status": "qualified|scheduled|sale|lost",
//         "value"?: number, "currency"?: "BRL",
//         "payment_status"?: "paid"|"pending"|"partial", "paid_amount"?: number }
//
// payment_status/paid_amount (Bloco A3): so faz sentido com new_status
// "sale" - default 'paid' preserva o comportamento de sempre quando o
// dash nao manda nada (ver applyStageTransition em stage-transition.js).
//
// First mutating dashboard endpoint in this project (every other /api/*.js
// here and in krob-tracking-stack-main is read-only). Auth goes in a header,
// not the query string, specifically because this call changes state - a
// query-string key on a POST would land in Cloudflare's access logs.
//
// Marks a contact's lifecycle stage from the dashboard and, when the
// contact has stored attribution, fires the matching CAPI event(s) so ad
// delivery can optimize toward it. `client` scopes the change to one
// tenant (see functions/_shared/clients.js). Shares the actual transition
// logic (status update, anti-duplicate guard, CAPI send) with the
// keyword-triggered path in functions/webhook/_whatsapp-core.js via
// applyStageTransition().

import { VALID_STATUSES } from '../../config/whatsapp.js';
import { applyStageTransition } from '../_shared/stage-transition.js';
import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, assertClientAccess, jsonUnauthorized, jsonForbidden } from '../_shared/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await requireSession(request, env);
  if (!session) return jsonUnauthorized();

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { client: clientSlug, wa_id, new_status, value, currency, payment_status, paid_amount } = body;
  if (!wa_id || !new_status) {
    return json({ error: 'wa_id and new_status are required' }, 400);
  }
  if (!VALID_STATUSES.includes(new_status)) {
    return json({ error: `new_status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }
  if (payment_status && !['paid', 'pending', 'partial'].includes(payment_status)) {
    return json({ error: "payment_status must be one of: paid, pending, partial" }, 400);
  }

  const client = await resolveClientBySlug(env, clientSlug);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }
  if (!assertClientAccess(session, client)) return jsonForbidden();

  const result = await applyStageTransition({
    env, client, waId: wa_id, newStatus: new_status, source: 'manual', value, currency,
    paymentStatus: payment_status, paidAmount: paid_amount,
  });
  if (!result.ok) {
    return json({ error: result.error }, 404);
  }

  return json({ ok: true, status: result.status, capi: result.capi });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
