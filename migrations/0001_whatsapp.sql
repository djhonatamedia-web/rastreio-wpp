-- whatsapp_contacts: the first MUTABLE table in this project. Every other
-- table (whatsapp_events, and everything in the sibling krob-tracking-stack)
-- is append-only. A conversation's lifecycle stage is inherently a state,
-- not a fact, so this is a deliberate departure — see plan doc.
CREATE TABLE whatsapp_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,                  -- e.g. 5511999998888@s.whatsapp.net
  phone TEXT NOT NULL,                  -- normalized digits
  push_name TEXT,
  ctwa_clid TEXT,                       -- raw Meta click id, unhashed, if present
  ad_source_id TEXT,
  ad_headline TEXT,
  ad_source_url TEXT,
  ad_media_type TEXT,
  is_ctwa INTEGER NOT NULL DEFAULT 0,
  first_message_text TEXT,
  first_message_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'lead',  -- lead | qualified | scheduled | sale | lost
  status_updated_at INTEGER,
  lead_sent_to_meta INTEGER NOT NULL DEFAULT 0,
  lead_meta_status_code INTEGER,
  lead_meta_response_ok INTEGER,
  lead_meta_response_body TEXT,
  lead_meta_payload_sent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_whatsapp_contacts_wa_id ON whatsapp_contacts(wa_id);
CREATE INDEX idx_whatsapp_contacts_status ON whatsapp_contacts(status);
CREATE INDEX idx_whatsapp_contacts_created ON whatsapp_contacts(created_at);

-- whatsapp_events: append-only log, one row per inbound message or per
-- stage-transition. Powers the "Eventos" dashboard tab (raw webhook
-- inspector, mirrors the KROB WhatsApp Tracker reference) and the CAPI
-- bookkeeping columns mirror event_log's style in krob-tracking-stack-main.
CREATE TABLE whatsapp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,
  event_name TEXT NOT NULL,             -- message_received | Lead | QualifiedLead | Schedule | Purchase
  event_id TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  source TEXT NOT NULL,                 -- webhook | dashboard
  message_type TEXT,                    -- raw Baileys type (Conversation, ExtendedTextMessage, ...)
  raw_payload TEXT,                     -- full raw uazapi webhook body, JSON string
  value REAL,
  currency TEXT,
  sent_to_meta INTEGER NOT NULL DEFAULT 0,
  meta_status_code INTEGER,
  meta_response_ok INTEGER,
  meta_response_body TEXT,
  meta_payload_sent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_whatsapp_events_wa_id ON whatsapp_events(wa_id);
CREATE INDEX idx_whatsapp_events_created ON whatsapp_events(created_at);
CREATE INDEX idx_whatsapp_events_event_name ON whatsapp_events(event_name);
