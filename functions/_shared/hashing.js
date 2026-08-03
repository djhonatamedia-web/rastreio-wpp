// -----------------------------------------------------------------------------
// PII hashing/normalization shared by every Meta CAPI sender in this project.
//
// Extracted from day one (unlike krob-tracking-stack-main, which duplicates
// this across _core.js and tracker.js) since this repo doesn't have that
// legacy to match — one implementation, imported everywhere.
// -----------------------------------------------------------------------------

export async function sha256(value) {
  if (!value) return '';
  const normalized = value.toLowerCase().trim();
  const encoded = new TextEncoder().encode(normalized);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Meta CAPI expects phone digits INCLUDING country code + area code
// (ex: `16505554444` or `5511987654321`). WhatsApp JIDs already carry the
// country code (`5511999998888@s.whatsapp.net`), but we still run this so
// numbers typed manually (dashboard corrections, etc.) get normalized the
// same way. `countryCode` defaults to 55 (Brazil); set
// `env.DEFAULT_COUNTRY_CODE` to change it.
export function normalizePhone(ph, countryCode) {
  if (!ph) return '';
  const cc = String(countryCode || '55');
  const digits = ph.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.startsWith(cc) && digits.length >= cc.length + 8 && digits.length <= cc.length + 11) {
    return digits;
  }
  if (digits.length >= 8 && digits.length <= 11) {
    return cc + digits;
  }
  return digits;
}

// Meta Advanced Matching spec for fn/ln is lowercase only — do NOT strip
// punctuation/accents.
export function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}
