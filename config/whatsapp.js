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
