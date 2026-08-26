-- Multi-tenant: every row belongs to a client (clients.id) instead of one
-- implicit client per deployment. See docs/multi-tenant.md.
--
-- Run ONE statement at a time in the D1 Console (established constraint —
-- pasting more than one gets flattened/mangled).
--
-- client_id 1 keeps the deployment's existing webhook_slug (it's the
-- user's own test account, not a real client) so its history/URL don't
-- change. Margel, Barbara, Vanessa and Mariel are new real clients, each
-- with a freshly generated webhook_slug (they still need their own
-- Cloudflare secrets + Configurações fields before they'll actually send
-- CAPI events — see docs/multi-tenant.md).

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  webhook_slug TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_clients_slug ON clients(slug);

CREATE UNIQUE INDEX idx_clients_webhook_slug ON clients(webhook_slug);

ALTER TABLE whatsapp_contacts ADD COLUMN client_id INTEGER NOT NULL DEFAULT 1;

ALTER TABLE whatsapp_events ADD COLUMN client_id INTEGER NOT NULL DEFAULT 1;

ALTER TABLE stage_keywords ADD COLUMN client_id INTEGER NOT NULL DEFAULT 1;

ALTER TABLE ad_click_codes ADD COLUMN client_id INTEGER NOT NULL DEFAULT 1;

DROP INDEX idx_whatsapp_contacts_wa_id;

CREATE UNIQUE INDEX idx_whatsapp_contacts_client_wa_id ON whatsapp_contacts(client_id, wa_id);

CREATE INDEX idx_whatsapp_events_client ON whatsapp_events(client_id);

CREATE INDEX idx_stage_keywords_client ON stage_keywords(client_id);

DROP INDEX idx_ad_click_codes_code;

CREATE UNIQUE INDEX idx_ad_click_codes_client_code ON ad_click_codes(client_id, code);

CREATE TABLE client_config_new (client_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (client_id, key));

INSERT INTO client_config_new SELECT 1, key, value, updated_at FROM client_config;

DROP TABLE client_config;

ALTER TABLE client_config_new RENAME TO client_config;

INSERT INTO clients (id, name, slug, webhook_slug, active, created_at) VALUES (1, 'Teste (Djhonata)', 'teste', 'a593d67e-0900-4b46-a41f-37a3ad5c5ad5', 1, unixepoch());

INSERT INTO clients (name, slug, webhook_slug, active, created_at) VALUES ('Margel', 'margel', '7d487a75-7fef-4f59-a46d-59a76a29f676', 1, unixepoch());

INSERT INTO clients (name, slug, webhook_slug, active, created_at) VALUES ('Barbara', 'barbara', '98d7cd1d-272f-4368-ac2f-f7dd9309116c', 1, unixepoch());

INSERT INTO clients (name, slug, webhook_slug, active, created_at) VALUES ('Vanessa', 'vanessa', '69081b75-096d-4f26-94ad-8f856f723c06', 1, unixepoch());

INSERT INTO clients (name, slug, webhook_slug, active, created_at) VALUES ('Mariel', 'mariel', '7cb0c437-d05e-4662-af92-80ba9cd380be', 1, unixepoch());
