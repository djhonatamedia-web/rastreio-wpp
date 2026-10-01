-- Bloco A4 do plano CRM: nota, responsavel por contato e auditoria de
-- quem mudou o estagio. Rode UMA linha por vez no D1 Console.

ALTER TABLE whatsapp_contacts ADD COLUMN assigned_to INTEGER REFERENCES users(id);

ALTER TABLE whatsapp_events ADD COLUMN changed_by INTEGER REFERENCES users(id);

-- Nenhuma tabela de log separada: changed_by acima ja aproveita que toda
-- mudanca de estagio passa por applyStageTransition() e ja vira uma linha
-- em whatsapp_events. contact_notes e so pra anotacao livre, que nao tinha
-- onde morar ate agora.
CREATE TABLE contact_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  user_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_contact_notes_client_wa ON contact_notes(client_id, wa_id);
