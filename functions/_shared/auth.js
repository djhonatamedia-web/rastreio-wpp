// Bloco A1 do plano CRM: autenticacao central por sessao + papel.
//
// Substitui o "key === env.DASH_KEY" solto que cada functions/api/*.js
// fazia por conta propria. Toda rota passa a chamar requireSession() (ou
// requireAdmin() nas rotas so-admin) daqui, uma vez so.
//
// Design:
// - Senha: PBKDF2-SHA256 (Web Crypto, disponivel nativamente no runtime
//   do Cloudflare Pages Functions) - sem dependencia nova.
// - Sessao: cookie assinado (HMAC-SHA256 com env.SESSION_SECRET) carregando
//   so { uid, exp }. Nao ha tabela de sessao: role/client_id/active sao
//   SEMPRE relidos de `users` a cada request - uma conta desativada perde
//   acesso no proximo request, nao so quando o cookie expirar (ver
//   migrations/0010_users_sessions.sql).
// - DASH_KEY antiga continua funcionando como login de admin durante a
//   transicao (zero downtime pros clientes ja em producao) - ver
//   requireSession({ allowDashKey: true }).

const COOKIE_NAME = 'rwpp_session';
const SESSION_DAYS = 7;

function base64UrlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function sign(secret, data) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

// ---- senha ----

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const iterations = 100000;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return `pbkdf2:${iterations}:${base64UrlEncode(salt)}:${base64UrlEncode(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = base64UrlDecode(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  const got = base64UrlEncode(new Uint8Array(bits));
  // Comparacao em tempo constante - mesmo padrao de timingSafeEqual em
  // functions/webhook/_utils.js, reimplementado aqui pra nao criar uma
  // dependencia cruzada entre webhook/ e _shared/.
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---- cookie de sessao ----

export async function createSessionCookie(env, userId) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET nao configurado');
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ uid: userId, exp })));
  const sig = await sign(env.SESSION_SECRET, payload);
  const token = `${payload}.${sig}`;
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

// Decodifica e confere assinatura+validade do cookie. NAO consulta o
// banco - so prova que o token foi emitido por nos e ainda nao expirou.
async function verifySessionToken(env, token) {
  if (!env.SESSION_SECRET || !token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = await sign(env.SESSION_SECRET, payload);
  if (expectedSig.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (diff !== 0) return null;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch (_) {
    return null;
  }
  if (!data.uid || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data;
}

// Le o cookie, confere a assinatura e - se valido - rele o usuario do
// banco (role/client_id/active sempre frescos). Devolve null se nao
// autenticado ou se a conta foi desativada depois do cookie emitido.
export async function resolveSession(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  const data = await verifySessionToken(env, token);
  if (!data) return null;
  const user = await env.DB
    .prepare('SELECT id, client_id, name, email, role, active FROM users WHERE id = ?')
    .bind(data.uid)
    .first();
  if (!user || !user.active) return null;
  return { userId: user.id, name: user.name, email: user.email, role: user.role, clientId: user.client_id, viaDashKey: false };
}

// Ponto unico de autenticacao pras rotas de API. Tenta a sessao primeiro;
// se nao houver e allowDashKey=true, aceita a DASH_KEY antiga (header
// x-dash-key OU query ?key=, pra nao quebrar nenhuma rota GET existente)
// como um admin "sintetico" - viaDashKey:true marca a origem, pra sumir
// quando o login de verdade estiver no ar em todo lugar (Bloco B).
export async function requireSession(request, env, { allowDashKey = true } = {}) {
  const session = await resolveSession(request, env);
  if (session) return session;
  if (allowDashKey && env.DASH_KEY) {
    const url = new URL(request.url);
    const provided = request.headers.get('x-dash-key') || url.searchParams.get('key') || '';
    if (provided && timingSafeEqualLocal(provided, env.DASH_KEY)) {
      return { userId: null, name: 'Admin (DASH_KEY)', email: null, role: 'admin', clientId: null, viaDashKey: true };
    }
  }
  return null;
}

function timingSafeEqualLocal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// Confere se a sessao pode acessar o `client` (linha de clients.js) dado.
// Admin acessa qualquer um; conta de equipe so o proprio client_id - essa
// checagem e o que fecha o buraco de isolamento (hoje qualquer DASH_KEY
// via ?client= via qualquer tenant, documentado em docs/multi-tenant.md).
export function assertClientAccess(session, client) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  return client && session.clientId === client.id;
}

export function jsonUnauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonForbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden: sem acesso a este cliente' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
