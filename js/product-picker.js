// Shared searchable, multi-select product picker.
// Used by the packages tab (drop several products into a zone in one go) and by
// the contract editor (pick products for a "products" section — from the
// attached package or from the whole catalogue when there is no package).
// Resolves to an array of picked option values, or null when cancelled.
import { h, modal } from './ui.js';

export function pickProducts(title, options, { confirmLabel = 'הוספה' } = {}) {
  return new Promise((resolve) => {
    const picked = new Set();
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };

    const search = h('input', { type: 'search', placeholder: '🔍 חיפוש מוצר…' });
    const list = h('div', { class: 'picker-list' });
    const counter = h('span', { class: 'muted' }, 'לא נבחרו מוצרים');
    const empty = h('p', { class: 'muted', style: 'padding:10px' }, 'אין מוצר תואם');

    const sync = () => {
      counter.textContent = picked.size ? `נבחרו ${picked.size} מוצרים` : 'לא נבחרו מוצרים';
    };

    const rows = options.map((o) => {
      // pointer-events:none so every click comes from the row, never the box
      const box = h('input', { type: 'checkbox', tabindex: -1, style: 'pointer-events:none' });
      const row = h('div', { class: 'picker-row' },
        box,
        h('span', { class: 'picker-name' }, o.label),
        o.hint ? h('span', { class: 'muted' }, o.hint) : null);
      row.addEventListener('click', () => {
        const on = !picked.has(o.value);
        on ? picked.add(o.value) : picked.delete(o.value);
        box.checked = on;
        row.classList.toggle('on', on);
        sync();
      });
      return { row, box, value: o.value, hay: `${o.label} ${o.hint || ''}`.toLowerCase() };
    });

    const visible = () => rows.filter(r => r.row.style.display !== 'none');
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      rows.forEach(r => { r.row.style.display = !q || r.hay.includes(q) ? '' : 'none'; });
      empty.style.display = visible().length ? 'none' : '';
    });

    const toggleAll = h('button', { class: 'btn sm' }, '✓ סימון הכל');
    toggleAll.addEventListener('click', () => {
      const shown = visible();
      const turnOn = shown.some(r => !picked.has(r.value));
      shown.forEach((r) => {
        turnOn ? picked.add(r.value) : picked.delete(r.value);
        r.box.checked = turnOn;
        r.row.classList.toggle('on', turnOn);
      });
      sync();
    });

    list.append(...rows.map(r => r.row), empty);
    empty.style.display = 'none';

    const { box: modalBox } = modal(title, h('div', { class: 'picker' },
      h('div', { class: 'flex', style: 'gap:8px' }, search, toggleAll),
      list,
      h('div', { class: 'flex', style: 'margin-top:6px' }, counter)), {
      actions: [
        {
          label: confirmLabel, kind: 'primary', onclick: (c) => {
            if (!picked.size) return false; // nothing picked — keep the dialog open
            finish([...picked]); c();
          },
        },
        { label: 'ביטול', onclick: (c) => { finish(null); c(); } },
      ],
    });
    // dismissing via the ✕ or the backdrop resolves as "cancelled"
    modalBox.parentElement?.addEventListener('click', (e) => {
      if (e.target === modalBox.parentElement) finish(null);
    });
    modalBox.querySelector('[aria-label="סגור"]')?.addEventListener('click', () => finish(null));
    setTimeout(() => search.focus(), 30);
  });
}
