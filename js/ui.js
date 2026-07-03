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
  const box = h('div', { class: `modal${wide ? ' wide' : ''}` },
    h('div', { class: 'flex between' },
      h('h3', {}, title),
      h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'סגור' }, '✕')),
    contentEl,
    actions.length ? h('div', { class: 'modal-actions' },
      ...actions.map(a => h('button', {
        class: `btn ${a.kind || ''}`,
        onclick: async () => { if (await a.onclick(close) !== false) { /* action decides close */ } },
      }, a.label))) : null,
  );
  backdrop.append(box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  return { close, box };
}

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
