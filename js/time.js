// Israel-time helpers for the UI.
//
// The band schedules everything in Israel time, but a <input type="datetime-local">
// is interpreted in the *device's* timezone. On a laptop set to another zone (or
// a phone roaming abroad) "tomorrow 09:00" would fire at the wrong moment. These
// helpers read and write wall-clock times in Asia/Jerusalem no matter what the
// device thinks the time is.

export const IL_TZ = 'Asia/Jerusalem';

// how far Asia/Jerusalem is from UTC at a given instant (handles DST)
function tzOffsetMs(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IL_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUTC - date.getTime();
}

// instant → 'YYYY-MM-DDTHH:MM' showing the Israel wall clock (for datetime-local)
export function toIsraelInputValue(date = new Date()) {
  const shifted = new Date(date.getTime() + tzOffsetMs(date));
  return shifted.toISOString().slice(0, 16);
}

// 'YYYY-MM-DDTHH:MM' typed as Israel wall clock → the real instant
export function israelInputValueToDate(value) {
  const [datePart, timePart = '00:00'] = String(value).split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  let ts = Date.UTC(y, mo - 1, d, h, mi);
  // subtract the zone offset, then correct once in case the guess landed on the
  // other side of a DST switch
  const off = tzOffsetMs(new Date(ts));
  ts -= off;
  const off2 = tzOffsetMs(new Date(ts));
  if (off2 !== off) ts += off - off2;
  return new Date(ts);
}

// human Israel time, e.g. "28.7.2026, 9:00" — always labelled as Israel time
export function formatIsrael(date, opts = {}) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: IL_TZ, dateStyle: 'short', timeStyle: 'short', ...opts,
  }).format(new Date(date));
}
