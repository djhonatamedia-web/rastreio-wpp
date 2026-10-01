// POST /api/auth-logout - limpa o cookie de sessao. Nao exige sessao
// valida pra responder ok (deslogar de um estado ja invalido nao e erro).

import { clearSessionCookie } from '../_shared/auth.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() },
  });
}
