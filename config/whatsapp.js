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
