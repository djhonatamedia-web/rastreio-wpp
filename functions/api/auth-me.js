// GET /api/auth-me - quem esta logado agora, pro frontend (Bloco B) saber
// o que mostrar sem precisar decidir isso sozinho no cliente. Aceita a
// DASH_KEY antiga tambem (ver requireSession), pra dar um "admin" mesmo
// antes de existir uma linha em `users` pro dono da chave.

import { requireSession, jsonUnauthorized } from '../_shared/auth.js';
import { resolveClientBySlug } from '../_shared/clients.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await requireSession(request, env);
  if (!session) return jsonUnauthorized();

  let client = null;
  if (session.clientId) {
    client = await env.DB
      .prepare('SELECT slug, name FROM clients WHERE id = ?')
      .bind(session.clientId)
      .first();
  }

  return new Response(JSON.stringify({
    name: session.name,
    email: session.email,
    role: session.role,
    client: client ? { slug: client.slug, name: client.name } : null,
    via_dash_key: session.viaDashKey,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
