// Tab 3 — חבילות: add products into "included" / "optional" zones via a
// simple picker (no drag & drop), with per-package price overrides for
// optional items.
import { get, post, patch, del } from '../api.js';
import { h, toast, modal, confirmModal, fmtMoney, skeletonCards } from '../ui.js';

export async function renderPackagesTab(view) {
  const host = h('div', {});
  view.append(host);
  host.append(skeletonCards(3));
  let packages = [], products = [];

  async function reload() {
    [{ packages }, { products }] = await Promise.all([get('/packages'), get('/products')]);
    draw();
  }

  function draw() {
    host.innerHTML = '';
    host.append(
      h('div', { class: 'board-toolbar' },
        h('h2', { style: 'margin:0' }, 'חבילות'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn primary', onclick: openNew }, '+ חבילה חדשה')),
      h('div', { class: 'pkg-layout' },
        productsPanel(),
        h('div', {}, packages.length
          ? packages.map(pkgCard)
          : h('div', { class: 'empty-state card' }, h('div', { class: 'big' }, '📦'), h('p', {}, 'אין חבילות — צרו חבילה והוסיפו אליה מוצרים')))));
  }

  const activeProducts = () => products.filter(p => p.active);

  // ---- side panel: reference list of available products ----
  function productsPanel() {
    const items = activeProducts();
    return h('div', { class: 'card products-panel' },
      h('h3', {}, '🎸 מוצרים'),
      h('p', { class: 'muted' }, 'השתמשו בכפתור "➕ הוספת מוצר" בכל אזור בחבילה כדי לצרף מוצר.'),
      items.length ? items.map(p =>
        h('div', { class: 'dnd-product' },
          h('span', {}, p.name),
          h('span', { class: 'muted' }, fmtMoney(p.default_price))))
        : h('p', { class: 'muted' }, 'אין מוצרים פעילים — הוסיפו בטאב "מוצרים".'));
  }

  // ---- package card with two "zones" ----
  function pkgCard(pkg) {
    const included = pkg.items.filter(i => i.included);
    const optional = pkg.items.filter(i => !i.included);

    const nameInput = h('input', { class: 'cell-edit', style: 'font-size:17px;font-weight:700;max-width:220px', value: pkg.name });
    nameInput.addEventListener('change', () => patch(`/packages/${pkg.id}`, { name: nameInput.value }));
    const priceInput = h('input', { class: 'cell-edit', type: 'number', dir: 'ltr', style: 'max-width:110px', value: pkg.base_price });
    priceInput.addEventListener('change', async () => {
      await patch(`/packages/${pkg.id}`, { base_price: priceInput.value });
      reload();
    });

    return h('div', { class: 'card', style: 'margin-bottom:16px' },
      h('div', { class: 'flex between', style: 'flex-wrap:wrap' },
        h('div', { class: 'flex' }, nameInput),
        h('div', { class: 'flex' },
          h('span', { class: 'muted' }, 'מחיר בסיס:'), priceInput,
          h('button', {
            class: 'icon-btn', title: 'מחיקת חבילה', onclick: async () => {
              if (!await confirmModal('מחיקת חבילה', `למחוק את "${pkg.name}"?`)) return;
              await del(`/packages/${pkg.id}`);
              reload();
            },
          }, '🗑️'))),
      h('div', { class: 'grid-2' },
        zone(pkg, true, `✅ כלול במחיר (${fmtMoney(pkg.base_price)})`, included),
        zone(pkg, false, '➕ תוספות אופציונליות (הלקוח בוחר בחוזה)', optional)));
  }

  async function addProduct(pkg, productId, included) {
    const existing = pkg.items.find(i => i.product_id === productId);
    try {
      if (existing) {
        if (existing.included === included) return;
        await patch(`/packages/${pkg.id}/items/${existing.id}`, { included });
      } else {
        await post(`/packages/${pkg.id}/items`, { product_id: productId, included, sort_order: pkg.items.length });
      }
      reload();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openProductPicker(pkg, included) {
    const inZone = new Set(pkg.items.filter(i => i.included === included).map(i => i.product_id));
    const available = activeProducts().filter(p => !inZone.has(p.id));
    if (!available.length) { toast('כל המוצרים כבר נמצאים באזור זה', 'error'); return; }
    const body = h('div', {}, ...available.map(p =>
      h('button', {
        class: 'btn', style: 'width:100%;justify-content:space-between;margin-bottom:6px',
        onclick: async (e) => {
          e.currentTarget.classList.add('loading');
          await addProduct(pkg, p.id, included);
          document.querySelector('.modal-backdrop')?.remove();
        },
      }, h('span', {}, p.name), h('span', { class: 'muted' }, fmtMoney(p.default_price)))));
    modal(included ? 'הוספת מוצר כלול' : 'הוספת תוספת אופציונלית', body, {
      actions: [{ label: 'סגירה', onclick: (close) => close() }],
    });
  }

  function zone(pkg, included, title, items) {
    return h('div', { class: 'dropzone' },
      h('div', { class: 'flex between' },
        h('div', { class: 'dz-title' }, title),
        h('button', { class: 'btn sm primary', onclick: () => openProductPicker(pkg, included) }, '➕ הוספת מוצר')),
      ...items.map(i => itemRow(pkg, i)),
      !items.length ? h('p', { class: 'muted', style: 'margin:4px' }, 'לחצו "הוספת מוצר" כדי לצרף מוצר לאזור זה') : null);
  }

  function itemRow(pkg, item) {
    const els = [h('b', {}, item.product?.name || '?')];
    if (!item.included) {
      // optional items: per-package price override
      const priceInput = h('input', {
        class: 'price-input', type: 'number', dir: 'ltr',
        value: item.override_price ?? '',
        placeholder: String(item.product?.default_price ?? 0),
        title: 'דריסת מחיר לחבילה זו (ריק = מחיר ברירת המחדל של המוצר)',
      });
      priceInput.addEventListener('change', async () => {
        await patch(`/packages/${pkg.id}/items/${item.id}`, { override_price: priceInput.value === '' ? null : priceInput.value });
        reload();
      });
      els.push(h('span', { class: 'muted' }, '₪'), priceInput,
        item.override_price !== null && item.override_price !== undefined
          ? h('span', { class: 'chip stage-form', title: 'מחיר מותאם לחבילה' }, 'מותאם')
          : h('span', { class: 'muted', style: 'font-size:12px' }, `ברירת מחדל: ${fmtMoney(item.product?.default_price)}`));
    } else {
      els.push(h('span', { class: 'muted', style: 'font-size:12px' }, 'כלול במחיר הבסיס'));
    }
    els.push(h('span', { style: 'flex:1' }),
      h('button', {
        class: 'icon-btn', title: 'הסרה מהחבילה', onclick: async () => {
          await del(`/packages/${pkg.id}/items/${item.id}`);
          reload();
        },
      }, '✕'));
    return h('div', { class: 'pkg-item' }, ...els);
  }

  function openNew() {
    const name = h('input', { type: 'text', placeholder: 'למשל: PREMIUM' });
    const desc = h('input', { type: 'text' });
    const price = h('input', { type: 'number', dir: 'ltr', value: 0 });
    modal('חבילה חדשה', h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'שם החבילה *'), name),
      h('label', { class: 'field' }, h('span', {}, 'תיאור'), desc),
      h('label', { class: 'field' }, h('span', {}, 'מחיר בסיס (₪) — עבור המוצרים הכלולים'), price)), {
      actions: [
        {
          label: 'יצירה', kind: 'primary', onclick: async (close) => {
            if (!name.value.trim()) { toast('שם החבילה חובה', 'error'); return false; }
            await post('/packages', { name: name.value, description: desc.value, base_price: price.value });
            close(); toast('החבילה נוצרה ✓', 'success'); reload();
          },
        },
        { label: 'ביטול', onclick: (close) => close() },
      ],
    });
  }

  await reload();
}
