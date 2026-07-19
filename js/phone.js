// Phone number helpers: best-effort country detection + display formatting.
// The formatting (dashes/spaces + flag) is display-only — the stored value
// and anything copied from the field stays raw digits (+ leading '+').

// dial code -> ISO2, longest codes first so prefix matching picks the most
// specific match (e.g. "1" for US/CA vs longer NANP-style codes elsewhere)
const DIAL_CODES = [
  ['972', 'IL'], ['971', 'AE'], ['966', 'SA'], ['965', 'KW'], ['962', 'JO'],
  ['961', 'LB'], ['380', 'UA'], ['358', 'FI'], ['353', 'IE'], ['351', 'PT'], ['420', 'CZ'],
  ['44', 'GB'], ['49', 'DE'], ['33', 'FR'], ['39', 'IT'], ['34', 'ES'],
  ['41', 'CH'], ['43', 'AT'], ['31', 'NL'], ['32', 'BE'], ['46', 'SE'],
  ['47', 'NO'], ['45', 'DK'], ['30', 'GR'], ['48', 'PL'], ['36', 'HU'],
  ['90', 'TR'], ['20', 'EG'], ['91', 'IN'], ['86', 'CN'], ['81', 'JP'],
  ['82', 'KR'], ['61', 'AU'], ['64', 'NZ'], ['27', 'ZA'], ['55', 'BR'],
  ['52', 'MX'], ['54', 'AR'], ['65', 'SG'], ['7', 'RU'], ['1', 'US'],
].sort((a, b) => b[0].length - a[0].length);

function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(ch => A + (ch.charCodeAt(0) - 65)));
}

// group a digit string into dash-separated chunks per `sizes`, e.g.
// groupDigits('0584849089', [3, 3, 4]) -> '058-484-9089'
function groupDigits(digits, sizes, sep = '-') {
  const parts = [];
  let i = 0;
  for (const size of sizes) {
    if (i >= digits.length) break;
    parts.push(digits.slice(i, i + size));
    i += size;
  }
  if (i < digits.length) parts.push(digits.slice(i));
  return parts.filter(Boolean).join(sep);
}

// strip everything but digits (keep a leading '+' if present) — this is what
// gets saved to the DB and what a user copying the raw field will get.
export function sanitizePhone(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  return (s.startsWith('+') ? '+' : '') + s.replace(/\D/g, '');
}

// returns { flag, display } — display is formatted with dashes/spaces for
// readability, flag is an emoji (or '' if the country couldn't be detected).
export function formatPhone(raw) {
  const s = (raw || '').trim();
  if (!s) return { flag: '', display: '' };
  const digits = s.replace(/\D/g, '');
  if (!digits) return { flag: '', display: s };

  if (!s.startsWith('+') && digits.startsWith('0')) {
    // local Israeli format: 05X-XXX-XXXX (mobile / 07x) or 0X-XXX-XXXX (classic landline)
    const display = digits.length === 10 ? groupDigits(digits, [3, 3, 4])
      : digits.length === 9 ? groupDigits(digits, [2, 3, 4])
        : digits;
    return { flag: flagEmoji('IL'), display };
  }

  if (s.startsWith('+')) {
    const match = DIAL_CODES.find(([code]) => digits.startsWith(code));
    if (match) {
      const [code, iso2] = match;
      const national = digits.slice(code.length);
      const display = code === '972'
        // international IL: 58-484-9089 (2-3-4) / 2-123-4567 (1-3-4)
        ? `+${code} ${national.length === 9 ? groupDigits(national, [2, 3, 4])
          : national.length === 8 ? groupDigits(national, [1, 3, 4]) : national}`
        : `+${code} ${groupDigits(national, [3, 3, 3, 3])}`;
      return { flag: flagEmoji(iso2), display: display.trim() };
    }
    return { flag: '', display: `+${digits}` };
  }

  return { flag: '', display: digits };
}
