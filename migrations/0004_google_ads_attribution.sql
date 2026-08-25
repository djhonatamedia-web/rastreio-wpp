CREATE TABLE ad_click_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, gclid TEXT, gbraid TEXT, wbraid TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, landing_url TEXT, matched_wa_id TEXT, matched_at INTEGER, created_at INTEGER NOT NULL);

CREATE UNIQUE INDEX idx_ad_click_codes_code ON ad_click_codes(code);

ALTER TABLE whatsapp_contacts ADD COLUMN gclid TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN gbraid TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN wbraid TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN ad_platform TEXT;

ALTER TABLE whatsapp_events ADD COLUMN google_ads_status_code INTEGER;

ALTER TABLE whatsapp_events ADD COLUMN google_ads_response_ok INTEGER;

ALTER TABLE whatsapp_events ADD COLUMN google_ads_response_body TEXT;

ALTER TABLE whatsapp_events ADD COLUMN google_ads_payload_sent TEXT;
