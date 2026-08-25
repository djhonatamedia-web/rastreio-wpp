// -----------------------------------------------------------------------------
// Non-secret settings for the WhatsApp tracking module. Tracked in git —
// no tokens/keys here, those live in Cloudflare env vars (see
// wrangler.toml.example).
// -----------------------------------------------------------------------------

// Maps a dashboard "mark as" action to the Meta CAPI event_name fired for
// that stage transition. `null` means "internal status only, no CAPI call"
// (e.g. marking a contact as lost shouldn't tell Meta anything).
export const STAGE_TO_META_EVENT = {
  qualified: 'QualifiedLead',
  scheduled: 'Schedule',
  sale: 'Purchase',
  lost: null,
};

// Valid values for whatsapp_contacts.status — the dashboard and the status
// API both validate against this list.
export const VALID_STATUSES = ['lead', 'qualified', 'scheduled', 'sale', 'lost'];

// Stages that can be triggered by a keyword match on the attendant's own
// message (see functions/api/whatsapp-keywords.js and the keyword check in
// functions/webhook/_whatsapp-core.js). The actual phrases are configured
// per deployment through the dashboard, stored in the stage_keywords table
// — not here, since the right trigger words depend on the business
// (a clinic that schedules vs. a store that sells), not on the code.
export const KEYWORD_STATUSES = ['qualified', 'scheduled', 'sale'];

// Maps a stage to the env var name holding that stage's Google Ads
// Conversion Action id. The id itself is client-specific (a numeric id
// from that client's Google Ads account), so it lives in an env var —
// same treatment as META_PIXEL_ID — not hardcoded here. See
// functions/_shared/google-ads-capi.js and docs/google-ads-whatsapp.md.
export const STAGE_TO_GOOGLE_ADS_ENV_VAR = {
  qualified: 'GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED',
  scheduled: 'GOOGLE_ADS_CONVERSION_ACTION_SCHEDULE',
  sale: 'GOOGLE_ADS_CONVERSION_ACTION_SALE',
};
