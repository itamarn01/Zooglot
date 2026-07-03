// Tab 2 — מוצרים: full CRUD with inline editing and default pricing.
import { get, post, patch, del } from '../api.js';
import { h, toast, modal, confirmModal, fmtMoney } from '../ui.js';

export async function renderProductsTab(view) {
  const host = h('div', {});
  view.append(host);
  let products = [];

  async function reload() {
    ({ products } = await get('/products'));
    draw();
  }

  function draw() {
    host.innerHTML = '';
    host.append(
      h('div', { class: 'board-toolbar' },
        h('h2', { style: 'margin:0' }, 'מוצרים'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn primary', onclick: openNew }, '+ מוצר חדש')),
      products.length ? h('div', { class: 'table-wrap' },
        h('table', { class: 'board', style: 'min-width:700px' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'שם המוצר'), h('th', {}, 'תיאור'),
            h('th', {}, 'מחיר ברירת מחדל'), h('th', {}, 'פעיל'), h('th', {}, ''))),
          h('tbody', {}, ...products.map(row))))
        : h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '🎸'), h('p', {}, 'אין מוצרים עדיין — הוסיפו את הראשון')));
  }

  function cell(p, key, type = 'text') {
    const input = h('input', {
      class: 'cell-edit', type, value: p[key] ?? '',
      dir: type === 'number' ? 'ltr' : 'rtl',
    });
    input.addEventListener('change', async () => {
      try {
        const { product } = await patch(`/products/${p.id}`, { [key]: input.value });
        Object.assign(p, product);
        input.closest('td').classList.add('saved-flash');
      } catch (e) { toast(e.message, 'error'); }
    });
    return h('td', {}, input);
  }

  function row(p) {
    const activeToggle = h('input', { type: 'checkbox', checked: p.active, style: 'width:auto' });
    activeToggle.addEventListener('change', () => patch(`/products/${p.id}`, { active: activeToggle.checked }));
    return h('tr', {},
      cell(p, 'name'), cell(p, 'description'), cell(p, 'default_price', 'number'),
      h('td', {}, activeToggle),
      h('td', {}, h('button', {
        class: 'icon-btn', title: 'מחיקה', onclick: async () => {
          if (!await confirmModal('מחיקת מוצר', `למחוק את "${p.name}"?`)) return;
          try {
            await del(`/products/${p.id}`);
            toast('המוצר נמחק', 'success');
            reload();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, '🗑️')));
  }

  function openNew() {
    const name = h('input', { type: 'text' });
    const desc = h('input', { type: 'text' });
    const price = h('input', { type: 'number', dir: 'ltr', value: 0 });
    modal('מוצר חדש', h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'שם המוצר * (למשל: גיטריסט, טריו ג׳אז)'), name),
      h('label', { class: 'field' }, h('span', {}, 'תיאור'), desc),
      h('label', { class: 'field' }, h('span', {}, 'מחיר ברירת מחדל (₪)'), price)), {
      actions: [
        {
          label: 'יצירה', kind: 'primary', onclick: async (close) => {
            if (!name.value.trim()) { toast('שם המוצר חובה', 'error'); return false; }
            await post('/products', { name: name.value, description: desc.value, default_price: price.value });
            close(); toast('המוצר נוצר ✓', 'success'); reload();
          },
        },
        { label: 'ביטול', onclick: (close) => close() },
      ],
    });
  }

  await reload();
}
