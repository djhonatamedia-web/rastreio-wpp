// POST /api/auth-login
// Body: { email, password }
//
// Unica rota publica (sem sessao previa) do Bloco A1. Confere a senha,
// emite o cookie assinado (ver functions/_shared/auth.js) e devolve o
// papel/cliente pro frontend decidir o que mostrar (Bloco B).
//
// Mensagem de erro propositalmente generica ("email ou senha invalidos")
// pros dois casos (email nao existe / senha errada) - nao dar pista de
// qual dos dois esta errado.

import { verifyPassword, createSessionCookie } from '../_shared/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email || !password) {
    return json({ error: 'email e senha sao obrigatorios' }, 400);
  }

  const user = await env.DB
    .prepare('SELECT id, client_id, name, email, password_hash, role, active FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: 'email ou senha invalidos' }, 401);
  }

  const cookie = await createSessionCookie(env, user.id);
  return new Response(JSON.stringify({
    ok: true,
    user: { name: user.name, email: user.email, role: user.role, client_id: user.client_id },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
