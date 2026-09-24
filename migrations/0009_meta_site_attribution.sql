-- Meta attribution for the landing-page -> WhatsApp path (no ctwa_clid).
-- The LP script captures fbclid/_fbc/_fbp; the server records the visitor's
-- real IP and User-Agent from the request headers (Meta requires both for
-- action_source "website"). Run ONE statement at a time in the D1 Console.

ALTER TABLE ad_click_codes ADD COLUMN fbclid TEXT;

ALTER TABLE ad_click_codes ADD COLUMN fbc TEXT;

ALTER TABLE ad_click_codes ADD COLUMN fbp TEXT;

ALTER TABLE ad_click_codes ADD COLUMN client_ip TEXT;

ALTER TABLE ad_click_codes ADD COLUMN client_user_agent TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN fbc TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN fbp TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN client_ip TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN client_user_agent TEXT;

ALTER TABLE whatsapp_contacts ADD COLUMN landing_url TEXT;
