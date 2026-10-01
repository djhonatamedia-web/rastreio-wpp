-- Rate limiting / bloqueio de tentativas no login (auditoria da skill
-- backend-designer: "Rate limiting quando necessario" + "Protecao de
-- APIs e endpoints"). Rode UMA linha por vez no D1 Console.

ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN locked_until INTEGER;
