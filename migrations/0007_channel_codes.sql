-- Lets ad_click_codes hold a fixed-channel code (bio link, Google Meu
-- Negocio) alongside the existing per-click Google Ads codes. A row with
-- gclid/gbraid/wbraid set is a Google Ads click, same as before; a row
-- with `channel` set instead ('bio' | 'gmb') is a fixed link pasted once
-- into that channel, matched by the same "Ref: <code>" regex in
-- functions/webhook/_whatsapp-core.js. See docs/google-ads-whatsapp.md.

ALTER TABLE ad_click_codes ADD COLUMN channel TEXT;
