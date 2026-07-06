// Small UI toolkit: element builder, toasts, modals, signature pad, helpers.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, type = 'info') {
  const el = h('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 3200);
}

export function modal(title, contentEl, { wide = false, actions = [] } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => backdrop.remove();
  const actionBtns = actions.map(a => {
    const b = h('button', { class: `btn ${a.kind || ''}` }, a.label);
    // Auto spinner + double-click guard for every modal action.
    b.addEventListener('click', async () => {
      if (b.classList.contains('loading')) return;
      b.classList.add('loading');
      try { await a.onclick(close); } finally { b.classList.remove('loading'); }
    });
    return b;
  });
  const box = h('div', { class: `modal${wide ? ' wide' : ''}` },
    h('div', { class: 'flex between' },
      h('h3', {}, title),
      h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'סגור' }, '✕')),
    contentEl,
    actionBtns.length ? h('div', { class: 'modal-actions' }, ...actionBtns) : null,
  );
  backdrop.append(box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  return { close, box };
}

// Wrap an async click handler so the button shows a spinner and can't be
// double-clicked while the promise is pending. Usage: onclick: withBusy(async (e) => {...})
export function withBusy(handler) {
  return async function (e) {
    const btn = e.currentTarget;
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    try { return await handler.call(this, e); }
    finally { btn.classList.remove('loading'); }
  };
}

// Password input wrapped with a show/hide eye toggle. Returns { wrap, input }.
export function passwordField(attrs = {}) {
  const input = h('input', { type: 'password', dir: 'ltr', ...attrs });
  const eye = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'הצג/הסתר סיסמה', tabindex: -1, html: EYE_CLOSED });
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.innerHTML = show ? EYE_OPEN : EYE_CLOSED;
  });
  const wrap = h('div', { class: 'pw-wrap' }, input, eye);
  return { wrap, input };
}

// ---- skeleton builders ----
export const sk = (cls = 'sk-line', style = '') => h('div', { class: `skeleton ${cls}`, style });
export function skeletonToolbar() { return h('div', { class: 'skeleton sk-toolbar' }); }
export function skeletonTable(rows = 8) {
  return h('div', {}, skeletonToolbar(),
    h('div', {}, ...Array.from({ length: rows }, () => sk('sk-row'))));
}
export function skeletonCards(n = 4) {
  return h('div', { class: 'grid-2' }, ...Array.from({ length: n }, () => sk('sk-card')));
}

// ---- animated splash screen ----
export function showSplash(subtitle = 'CRM · להקת קולות') {
  if (document.getElementById('splash')) return;
  const el = h('div', { id: 'splash' },
    h('img', { class: 'splash-logo', src: '/assets/logo.svg', alt: 'KOLOT' }),
    h('div', { class: 'splash-name' }, 'Zooglot.DB'),
    h('div', { class: 'splash-sub' }, subtitle),
    h('div', { class: 'splash-bar' }, h('i', {})));
  document.body.append(el);
  el.addEventListener('animationend', (e) => { if (e.animationName === 'splashOut') el.remove(); });
  // safety net in case the animationend never fires
  setTimeout(() => el.remove(), 2200);
}

// ---- inline SVG icons (KOLOT geometric style) ----
const svg = (paths) => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
export const ICONS = {
  leads: svg('<path d="M4 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><circle cx="10" cy="7" r="3.2"/><path d="M17 11l2 2 3-3.5"/>'),
  products: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  packages: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  contracts: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>'),
  dashboard: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  signout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  eyeOpen: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeClosed: svg('<path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.2 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.2-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M4 4l16 16"/>'),
};
const EYE_OPEN = ICONS.eyeOpen;
const EYE_CLOSED = ICONS.eyeClosed;

export function confirmModal(title, text) {
  return new Promise((resolve) => {
    const m = modal(title, h('p', {}, text), {
      actions: [
        { label: 'אישור', kind: 'primary', onclick: (close) => { close(); resolve(true); } },
        { label: 'ביטול', onclick: (close) => { close(); resolve(false); } },
      ],
    });
    m.box.querySelector('.icon-btn').addEventListener('click', () => resolve(false));
  });
}

export const debounce = (fn, ms = 400) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

export const fmtMoney = (n) => (n === null || n === undefined || n === '' || isNaN(Number(n)))
  ? '—' : `₪${Number(n).toLocaleString('he-IL')}`;
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '—';

export const initialsAvatar = (name, url) => url
  ? h('img', { class: 'avatar-circle', src: url, alt: name || '' })
  : h('span', { class: 'avatar-circle' }, (name || '?').trim().charAt(0).toUpperCase());

// ---- signature pad (mouse + touch) ----
export function signaturePad() {
  const canvas = h('canvas', { class: 'sig-pad', width: 560, height: 160 });
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#16232a';
  let drawing = false, dirty = false;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
  };
  const start = (e) => { drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty = true; e.preventDefault(); };
  const end = () => { drawing = false; };

  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  return {
    el: canvas,
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    isEmpty: () => !dirty,
    dataUrl: () => canvas.toDataURL('image/png'),
  };
}

// read a File into a downscaled data URL (avatars, logos)
export function fileToDataUrl(file, maxSize = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(reader.result); // e.g. svg fallback
    reader.readAsDataURL(file);
  });
}
