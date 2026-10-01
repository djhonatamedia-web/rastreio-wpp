-- Bloco A2 (consulta real + calendario) e A3 (pago x a receber) do plano
-- CRM. Rode UMA linha/bloco por vez no D1 Console.

-- A2: agendamento com data/hora real, separado do status geral do funil
-- (whatsapp_contacts.status continua existindo do jeito que esta - isso
-- aqui e o fato novo "tem uma consulta marcada pra dia X", que alimenta o
-- calendario e a taxa de compareceu/nao compareceu).
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  wa_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','attended','no_show','canceled')),
  procedure_label TEXT,
  created_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_appointments_client_date ON appointments(client_id, scheduled_at);

CREATE INDEX idx_appointments_client_wa ON appointments(client_id, wa_id);

-- A3: conciliacao financeira simples. Default 'paid' preserva o
-- comportamento de hoje (todo evento Purchase existente ja fica marcado
-- como pago, sem precisar de um backfill separado - SQLite aplica o
-- DEFAULT nas linhas existentes ao adicionar a coluna).
ALTER TABLE whatsapp_events ADD COLUMN payment_status TEXT DEFAULT 'paid';

ALTER TABLE whatsapp_events ADD COLUMN paid_amount REAL;
