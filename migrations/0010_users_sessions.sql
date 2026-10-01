-- Bloco A1 do plano CRM: usuarios e papeis de acesso.
--
-- client_id NULL = admin global (enxerga qualquer cliente, equivalente ao
-- DASH_KEY de hoje). client_id preenchido = conta de equipe presa aquele
-- cliente - toda rota da API passa a validar isso no backend, nao so
-- esconder na UI (ver functions/_shared/auth.js).
--
-- Sem tabela de sessao: a sessao e um cookie assinado (HMAC) que carrega
-- so o user id + expiracao; role/client_id/active sao sempre relidos
-- desta tabela a cada request, pra uma desativacao ter efeito imediato
-- (nao esperar o cookie expirar). Rode UMA linha por vez no D1 Console.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','team')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_users_email ON users(email);

CREATE INDEX idx_users_client ON users(client_id);
