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
//
// Bloqueio por tentativas (migration 0013): 5 senhas erradas seguidas
// trava a CONTA (nao o IP - mais simples, sem precisar de KV/Durable
// Object, e o que importa e nao deixar tentar senha infinitamente numa
// conta especifica) por 15 minutos. Zera a cada acerto.
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

import { verifyPassword, createSessionCookie } from '../_shared/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SESSION_SECRET) {
    // Falha de configuracao, nao de credencial - mensagem clara em vez de
    // deixar createSessionCookie() estourar e o Cloudflare devolver um
    // "error code: 1101" opaco sem dizer o motivo.
    return json({ error: 'SESSION_SECRET não configurado no Cloudflare Pages (variável de ambiente)' }, 500);
  }

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

  const now = Math.floor(Date.now() / 1000);
  const user = await env.DB
    .prepare('SELECT id, client_id, name, email, password_hash, role, active, failed_attempts, locked_until FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (user && user.locked_until && user.locked_until > now) {
    const minutes = Math.ceil((user.locked_until - now) / 60);
    return json({ error: `Muitas tentativas erradas. Tente de novo em ${minutes} min.` }, 429);
  }

  const passwordOk = user && user.active && await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    // So grava tentativa quando o e-mail existe - nao ha o que travar
    // pra um e-mail que nunca foi cadastrado.
    if (user) {
      const attempts = (user.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= MAX_ATTEMPTS ? now + LOCKOUT_SECONDS : null;
      await env.DB
        .prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
        .bind(lockedUntil ? 0 : attempts, lockedUntil, user.id)
        .run();
    }
    return json({ error: 'email ou senha invalidos' }, 401);
  }

  if (user.failed_attempts || user.locked_until) {
    await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
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
