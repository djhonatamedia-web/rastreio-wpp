// GET    /api/users                                  - lista (admin only)
// POST   /api/users  { name, email, password, role, client_slug? }
// DELETE /api/users?id=<id>                           - desativa (soft)
//
// Bloco A1 do plano CRM: cadastro de login por papel. So admin mexe aqui -
// uma conta de equipe nunca cria outra conta. `role: 'admin'` nao leva
// client_slug (enxerga tudo); `role: 'team'` exige um client_slug valido
// (presa aquele cliente - ver functions/_shared/auth.js, assertClientAccess).
//
// Autenticado por requireSession() (sessao OU DASH_KEY antiga) - mesmo
// ponto unico de auth que as outras rotas do Bloco A1.

import { requireSession, jsonUnauthorized, hashPassword } from '../_shared/auth.js';
import { resolveClientBySlug } from '../_shared/clients.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await requireSession(request, env);
  if (!session || session.role !== 'admin') return jsonUnauthorized();

  const rows = await env.DB
    .prepare(`
      SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
             c.slug as client_slug, c.name as client_name
      FROM users u
      LEFT JOIN clients c ON c.id = u.client_id
      ORDER BY u.role, c.name, u.name
    `)
    .all();

  return json({ users: rows.results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await requireSession(request, env);
  if (!session || session.role !== 'admin') return jsonUnauthorized();

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const role = body?.role === 'admin' ? 'admin' : body?.role === 'team' ? 'team' : null;

  if (!name || !email || !password || !role) {
    return json({ error: 'name, email, password e role são obrigatórios' }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'email inválido' }, 400);
  }
  if (password.length < 8) {
    return json({ error: 'senha precisa ter pelo menos 8 caracteres' }, 400);
  }

  let clientId = null;
  if (role === 'team') {
    const slug = String(body?.client_slug || '').trim();
    if (!slug) return json({ error: 'client_slug é obrigatório para role "team"' }, 400);
    const client = await resolveClientBySlug(env, slug);
    if (!client) return json({ error: 'client_slug inválido ou cliente inativo' }, 400);
    clientId = client.id;
  }

  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await env.DB
      .prepare('INSERT INTO users (client_id, name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .bind(clientId, name, email, passwordHash, role, now)
      .run();
    return json({ ok: true, id: result.meta.last_row_id });
  } catch (e) {
    return json({ error: `falha ao criar usuário (email já existe? ${e.message})` }, 400);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const session = await requireSession(request, env);
  if (!session || session.role !== 'admin') return jsonUnauthorized();

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '', 10);
  if (!id) return json({ error: 'id é obrigatório' }, 400);
  if (session.userId === id) return json({ error: 'não dá para desativar a própria conta' }, 400);

  await env.DB.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
