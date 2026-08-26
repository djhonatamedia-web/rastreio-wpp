// -----------------------------------------------------------------------------
// Shared helpers for webhook adapters.
//
// The webhook URL shape is `/webhook/<provider>/<slug>`, where `<slug>` is a
// 36-character UUID v4 (122 bits of entropy), one per CLIENT (not one per
// deployment anymore - see functions/_shared/clients.js,
// resolveClientByWebhookSlug). Unguessable to scanners, simple to set up
// (paste one URL into that client's uazapi instance webhook config).
// -----------------------------------------------------------------------------

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
