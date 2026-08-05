// Venue autocomplete, shared by the board, the public lead form and the
// contract portal — three pages with different origins and no auth in common,
// so the endpoint is a parameter rather than baked in.
//
// The dropdown is positioned with `fixed` rather than `absolute` on purpose: on
// the board this input lives inside a table cell with its own overflow, and an
// absolutely positioned list gets clipped to the cell.

const DEBOUNCE_MS = 260;   // Photon asks callers to be fair; don't fire per keystroke
const MIN_CHARS = 2;

/**
 * @param input     an existing <input> to attach to
 * @param endpoint  full URL of the suggest API (…/api/places or …/api/public/places)
 * @param onPick    optional (label) => void, fired when a suggestion is chosen
 */
export function attachPlaceAutocomplete(input, endpoint, onPick) {
  ensureStyles(); // three separate pages use this; none of them owns the CSS
  let list = null;
  let timer = null;
  let seq = 0;           // guards against a slow response overwriting a newer one
  let items = [];
  let active = -1;
  let lastQuery = '';

  const vv = window.visualViewport || null;

  const close = () => {
    list?.remove();
    list = null;
    active = -1;
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    vv?.removeEventListener('resize', place);
    vv?.removeEventListener('scroll', place);
  };

  function place() {
    if (!list) return;
    const r = input.getBoundingClientRect();
    // The keyboard is the thing that decides where this list fits, and on iOS
    // opening it does NOT change window.innerHeight — only the visual viewport
    // shrinks. Measured against the window, a field near the bottom of a sheet
    // looked like it had 300px of room below it and the list was drawn under
    // the keyboard, where nothing is visible. visualViewport is what the user
    // can actually see.
    const seenTop = vv ? vv.offsetTop : 0;
    const seenBottom = seenTop + (vv ? vv.height : window.innerHeight);
    const below = seenBottom - r.bottom;
    const above = r.top - seenTop;
    // never taller than the free space on the side it lands, so the last
    // suggestion is always reachable rather than half off the edge
    const room = Math.max(below, above) - 12;
    const height = Math.max(96, Math.min(list.scrollHeight || 260, 260, room));
    list.style.left = `${r.left}px`;
    list.style.width = `${Math.max(r.width, 220)}px`;
    if (below < height + 8 && above > below) {
      list.style.top = `${Math.max(seenTop + 4, r.top - height - 4)}px`;
    } else {
      list.style.top = `${r.bottom + 4}px`;
    }
    list.style.maxHeight = `${height}px`;
  }

  function render() {
    if (!items.length) return close();
    if (!list) {
      list = document.createElement('div');
      list.className = 'place-list';
      document.body.append(list);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      // the keyboard opening or closing is a visualViewport event, not a resize
      vv?.addEventListener('resize', place);
      vv?.addEventListener('scroll', place);
    }
    list.innerHTML = '';
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = `place-opt${i === active ? ' active' : ''}`;
      const mark = document.createElement('span');
      mark.className = 'place-mark';
      // a venue they have already played is worth pointing out
      mark.textContent = it.source === 'history' ? '★' : '📍';
      const text = document.createElement('span');
      text.className = 'place-text';
      text.textContent = it.label;
      row.append(mark, text);
      if (it.source === 'history' && it.used > 1) {
        const n = document.createElement('span');
        n.className = 'place-count';
        n.textContent = `${it.used}×`;
        row.append(n);
      }
      // mousedown beats blur, so the click isn't swallowed by the field closing
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.append(row);
    });
    place();
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    input.value = it.label;
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    onPick?.(it.label, it);
  }

  async function search(q) {
    const mine = ++seq;
    try {
      const rsp = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, {
        headers: authHeader(),
      });
      if (!rsp.ok) throw new Error('lookup failed');
      const data = await rsp.json();
      if (mine !== seq) return;      // a newer keystroke already went out
      items = data.places || [];
      active = -1;
      render();
    } catch {
      if (mine === seq) close();     // a failed lookup must never block typing
    }
  }

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < MIN_CHARS) { seq++; return close(); }
    if (q === lastQuery) return;
    lastQuery = q;
    timer = setTimeout(() => search(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (!list) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));
  return { close };
}

// The board sends a bearer token; the public form and portal have none.
function authHeader() {
  try {
    const t = localStorage.getItem('zooglot_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}

function ensureStyles() {
  if (document.getElementById('places-css')) return;
  const el = document.createElement('style');
  el.id = 'places-css';
  el.textContent = PLACES_CSS;
  document.head.append(el);
}

const PLACES_CSS = `
.place-list {
  position: fixed; z-index: 9999; overflow-y: auto;
  background: var(--surface, #16232a); color: var(--text, #eef7fa);
  border: 1px solid var(--line, rgba(255,255,255,.18));
  border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.45);
  font-size: 14px;
}
.place-opt {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; cursor: pointer; min-height: 44px;
}
.place-opt:hover, .place-opt.active { background: rgba(135,206,223,.16); }
.place-mark { flex: none; opacity: .8; font-size: 13px; }
.place-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.place-count { flex: none; opacity: .55; font-size: 12px; direction: ltr; }
`;
