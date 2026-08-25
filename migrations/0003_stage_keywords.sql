CREATE TABLE stage_keywords (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, phrase TEXT NOT NULL, created_at INTEGER NOT NULL);

ALTER TABLE whatsapp_contacts ADD COLUMN status_source TEXT DEFAULT 'manual';
