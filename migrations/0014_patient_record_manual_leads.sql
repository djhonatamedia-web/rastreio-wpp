-- Bloco C do plano "Funil visual + ficha do paciente". Rode UMA linha
-- por vez no D1 Console.

-- C1: ficha do paciente (campos fixos - ver plano sobre por que nao e um
-- construtor de campos customizados).
ALTER TABLE whatsapp_contacts ADD COLUMN birth_date TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN insurance TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN interest TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN cpf TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN address TEXT;

-- C2: lead manual. 'webhook' e o default pra toda linha ja existente -
-- nasceram todas de mensagem real.
ALTER TABLE whatsapp_contacts ADD COLUMN created_source TEXT NOT NULL DEFAULT 'webhook';

-- C3: motivo da perda.
ALTER TABLE whatsapp_events ADD COLUMN lost_reason TEXT;
