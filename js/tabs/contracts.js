// Tab 4 — חוזים / הצעות מחיר. A section-based proposal builder styled like the
// KOLOT PDF. The proposal is built ONLY from typed sections:
//   • title    — a heading (rich text)
//   • text     — a free rich-text block
//   • products — a section title + one or more products chosen from the package;
//                included products show as info, optional products as a
//                selectable line with their price (client sees the total update).
// Every title/description is a rich-text field (bold/italic/underline/size/dir)
// and any {{lead field}} or fill-in field can be injected at the caret.
// A live preview of the exact client page is shown alongside, and any design
// can be saved as a reusable template.
import { get, post, patch, del } from '../api.js';
import { h, toast, modal, confirmModal, fmtMoney, skeletonTable, withBusy, comboBox, debounce } from '../ui.js';
import { pickProducts } from '../product-picker.js';

const STATUS_LABELS = {
  draft: ['טיוטה', 'stage'], sent: ['נשלח ללקוח', 'stage-form'],
  client_signed: ['נחתם ע"י הלקוח', 'status-win'], completed: ['הושלם ✓', 'status-win'],
  cancelled: ['בוטל', 'status-lost'],
};

const LEAD_VARS = [
  ['name', 'שם הליד'], ['contact_name', 'איש קשר'], ['event_date', 'תאריך אירוע'],
  ['event_location', 'מיקום'], ['event_type', 'סוג אירוע'], ['email', 'מייל'],
  ['phone1', 'טלפון'], ['id_number', 'ת"ז'], ['address', 'כתובת'],
  ['final_price', 'מחיר סופי'], ['base_price', 'מחיר בסיס'], ['deposit', 'מקדמה'],
  ['package_type', 'שם החבילה'], ['today', 'תאריך היום'],
];

// Clean HTML pasted from Word / Google Docs: drop fixed widths, mso-* junk and
// fonts that break the page layout, keep only basic formatting.
function cleanPastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, meta, link, title, xml, o\\:p').forEach(n => n.remove());
  const KEEP = ['font-weight', 'font-style', 'text-decoration', 'text-align', 'color'];
  doc.querySelectorAll('*').forEach((el) => {
    ['width', 'height', 'align', 'class', 'lang', 'valign', 'hspace', 'vspace', 'cellspacing', 'cellpadding', 'border'].forEach(a => el.removeAttribute(a));
    const st = el.getAttribute('style');
    if (st) {
      const keep = st.split(';').map(x => x.trim()).filter((x) => KEEP.includes(x.split(':')[0].trim().toLowerCase()));
      if (keep.length) el.setAttribute('style', keep.join('; ')); else el.removeAttribute('style');
    }
  });
  return doc.body.innerHTML;
}

const LEAD_BIND = [
  ['contact_name', 'שם איש קשר'], ['id_number', 'ת"ז'], ['address', 'כתובת'],
  ['email', 'מייל'], ['phone1', 'טלפון'], ['phone2', 'טלפון נוסף'],
  ['event_date', 'תאריך אירוע'], ['event_location', 'מיקום'], ['event_type', 'סוג אירוע'],
];

const randKey = () => 'f_' + Math.random().toString(36).slice(2, 8);
const sid = () => 's_' + Math.random().toString(36).slice(2, 8);

// Built-in "Classic KOLOT" design, generated from the contract's package so the
// two-column look + pricing come out ready. Package-aware, so it always resolves.
function builtinSections(pkg) {
  const secs = [];
  secs.push({ id: sid(), type: 'title', html: '{{name}}', dir: null });
  secs.push({
    id: sid(), type: 'text', dir: null,
    html: 'תודה שבחרתם לשקול את להקת קולות להופעה החיה באירוע שלכם. אנו גאים להיחשב לאירוע המיוחד הזה ובטוחים שנצליח ליצור עבורכם חוויה מוזיקלית בלתי נשכחת.',
  });
  const included = (pkg?.items || []).filter(i => i.included);
  const optional = (pkg?.items || []).filter(i => !i.included);
  if (included.length) {
    secs.push({
      id: sid(), type: 'products', title_html: 'מה כולל', title_dir: null,
      items: included.map(i => ({ package_item_id: i.id, name_html: i.product?.name || '', name_dir: null, desc_html: i.product?.description || '', desc_dir: null })),
    });
  }
  if (optional.length) {
    secs.push({
      id: sid(), type: 'products', title_html: 'תוספות לבחירתכם', title_dir: null,
      items: optional.map(i => ({ package_item_id: i.id, name_html: i.product?.name || '', name_dir: null, desc_html: i.product?.description || '', desc_dir: null })),
    });
  }
  secs.push({
    id: sid(), type: 'text', dir: null,
    html: '<h3>מידע נוסף</h3><p>המחיר כולל מע"מ. לצורך שמירת התאריך נדרש תשלום מקדמה של 10%.</p><p>בברכה,<br>יניב וסלי, נתנאל יוסף · להקת קולות</p>',
  });
  return secs;
}

export async function renderContractsTab(view) {
  const host = h('div', {});
  view.append(host);
  host.append(skeletonTable(6));
  let contracts = [], leads = [], packages = [], signatures = [], templates = [], products = [];

  async function reload() {
    [{ contracts }, { leads }, { packages }, { signatures }, { templates }, { products }] = await Promise.all([
      get('/contracts'), get('/leads'), get('/packages'), get('/settings/signatures'),
      get('/contracts/templates'), get('/products'),
    ]);
    draw();
  }

  function draw() {
    host.innerHTML = '';
    host.append(
      h('div', { class: 'board-toolbar' },
        h('h2', { style: 'margin:0' }, 'חוזים והצעות מחיר'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn primary', onclick: openNew }, '+ הצעה חדשה')),
      contracts.length ? h('div', { class: 'table-wrap' },
        h('table', { class: 'board', style: 'min-width:900px' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'כותרת'), h('th', {}, 'ליד'), h('th', {}, 'חבילה'),
            h('th', {}, 'מחיר סופי'), h('th', {}, 'סטטוס'), h('th', {}, 'חתימות'), h('th', {}, ''))),
          h('tbody', {}, ...contracts.map(row))))
        : h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '📄'), h('p', {}, 'אין הצעות עדיין')));
  }

  function row(c) {
    const [label, cls] = STATUS_LABELS[c.status] || [c.status, 'stage'];
    return h('tr', {},
      h('td', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openEditor(c); } }, c.title)),
      h('td', {}, c.lead?.name || '—'),
      h('td', {}, c.package?.name || '—'),
      h('td', {}, fmtMoney(c.final_price)),
      h('td', {}, h('span', { class: `chip ${cls}` }, label)),
      h('td', {}, c.management_signed_at ? '🖋️ הנהלה ' : '', c.client_signed_at ? '✍️ לקוח' : ''),
      h('td', {}, h('div', { class: 'row-actions' },
        h('button', { class: 'icon-btn', title: 'עריכה', onclick: () => openEditor(c) }, '✏️'),
        h('button', {
          class: 'icon-btn', title: 'קישור לפורטל הלקוח', onclick: () => {
            const link = `${location.origin}/portal.html?t=${c.client_token}`;
            navigator.clipboard?.writeText(link);
            toast('הקישור הועתק ✓', 'success');
          },
        }, '🔗'),
        h('button', {
          class: 'icon-btn', title: 'מחיקה', onclick: async () => {
            if (!await confirmModal('מחיקת הצעה', `למחוק את "${c.title}"?`)) return;
            await del(`/contracts/${c.id}`);
            reload();
          },
        }, '🗑️'))));
  }

  // ---- create ----
  function openNew() {
    if (!leads.length) { toast('אין לידים — צרו ליד קודם', 'error'); return; }
    const leadCombo = comboBox(
      leads.map(l => ({ value: l.id, label: `${l.name} (${l.sale_status})` })),
      { placeholder: '🔍 חיפוש ליד לפי שם…', empty: '' });
    const pkgCombo = comboBox(
      packages.map(p => ({ value: p.id, label: `${p.name} · ${fmtMoney(p.base_price)}` })),
      { placeholder: '🔍 חיפוש חבילה…', empty: '— ללא חבילה בשלב זה —' });

    modal('הצעת מחיר חדשה', h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'שיוך לליד (מעקב זוגות) *'), leadCombo.el),
      h('label', { class: 'field' }, h('span', {}, 'חבילה'), pkgCombo.el)), {
      actions: [
        {
          label: 'יצירה ועריכה', kind: 'primary', onclick: async (close) => {
            if (!leadCombo.get()) { toast('יש לבחור ליד', 'error'); return false; }
            const { contract } = await post('/contracts', { lead_id: leadCombo.get(), package_id: pkgCombo.get() || null });
            close(); reload();
            openEditor(contract);
          },
        },
        { label: 'ביטול', onclick: (close) => close() },
      ],
    });
  }

  // =================== editor ===================
  function openEditor(contract) {
    let c = contract;
    c.sections = Array.isArray(c.sections) ? c.sections : [];
    c.fields = Array.isArray(c.fields) ? c.fields : [];
    c.language = c.language || 'he';
    c.direction = c.direction || 'rtl';
    // fill-in fields live inside 'fields' sections (one or more, each movable).
    // Normalise older shapes: ensure every fields section has an items array, and
    // migrate any legacy global c.fields into a fields section. A fields section
    // is only created when there are legacy fields to preserve — otherwise none
    // is forced, so the user is free to have no fill-in section (or delete it).
    function ensureFieldsSection() {
      c.sections = Array.isArray(c.sections) ? c.sections : [];
      c.sections.forEach(s => { if (s.type === 'fields' && !Array.isArray(s.items)) s.items = []; });
      if (Array.isArray(c.fields) && c.fields.length) {
        let first = c.sections.find(s => s.type === 'fields');
        if (!first) { first = { id: sid(), type: 'fields', title_html: '', title_dir: null, items: [] }; c.sections.push(first); }
        first.items.push(...c.fields); c.fields = [];
      }
    }
    ensureFieldsSection();

    const curPkg = () => packages.find(p => p.id === c.package_id) || null;

    // ---- shared rich-text state ----
    let activeEl = null, savedRange = null;
    const saveRange = (el) => {
      const s = window.getSelection();
      if (s && s.rangeCount && el.contains(s.anchorNode)) savedRange = s.getRangeAt(0);
    };
    function richField(model, htmlKey, dirKey, { placeholder = '', cls = '' } = {}) {
      const el = h('div', { class: `rich ${cls}`, contenteditable: 'true', dataset: { ph: placeholder }, html: model[htmlKey] || '' });
      const applyDir = () => {
        const d = model[dirKey] || c.direction || 'rtl';
        el.dir = d; el.style.textAlign = d === 'rtl' ? 'right' : 'left';
      };
      applyDir();
      el._toggleDir = () => {
        model[dirKey] = ((model[dirKey] || c.direction || 'rtl') === 'rtl') ? 'ltr' : 'rtl';
        applyDir(); scheduleSave();
      };
      el.addEventListener('focus', () => { activeEl = el; });
      ['keyup', 'mouseup'].forEach(ev => el.addEventListener(ev, () => saveRange(el)));
      el.addEventListener('paste', (e) => {
        const cd = e.clipboardData || window.clipboardData;
        const html = cd && cd.getData('text/html');
        e.preventDefault();
        if (html) document.execCommand('insertHTML', false, cleanPastedHtml(html));
        else document.execCommand('insertText', false, (cd && cd.getData('text/plain')) || '');
        el.dispatchEvent(new Event('input'));
      });
      el.addEventListener('input', () => { model[htmlKey] = el.innerHTML; saveRange(el); scheduleSave(); });
      return el;
    }
    function focusActive() {
      if (!activeEl) return false;
      activeEl.focus();
      if (savedRange && activeEl.contains(savedRange.startContainer)) {
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange);
      }
      return true;
    }
    function exec(cmd, val = null) {
      if (!focusActive()) { toast('לחצו קודם בתוך טקסט', 'error'); return; }
      document.execCommand(cmd, false, val);
      activeEl.dispatchEvent(new Event('input'));
    }
    function insertVar(key) {
      if (!focusActive()) { toast('לחצו קודם בתוך טקסט להזרקה', 'error'); return; }
      document.execCommand('insertText', false, `{{${key}}}`);
      activeEl.dispatchEvent(new Event('input'));
    }
    // ordered list; 'decimal' = 1.2.3, 'alpha' = א/ב (RTL) or a/b (LTR)
    function orderedList(kind) {
      if (!focusActive()) { toast('לחצו קודם בתוך טקסט', 'error'); return; }
      document.execCommand('insertOrderedList');
      const sel = window.getSelection();
      let node = sel.anchorNode;
      while (node && node !== activeEl && node.nodeName !== 'OL') node = node.parentNode;
      if (node && node.nodeName === 'OL') {
        const rtl = (activeEl.dir || c.direction) === 'rtl';
        node.style.listStyleType = kind === 'alpha' ? (rtl ? 'hebrew' : 'lower-alpha') : 'decimal';
      }
      activeEl.dispatchEvent(new Event('input'));
    }
    // wrap the current selection in a span carrying a font style. Two of the
    // choices share a family (Assistant) and differ only in weight, so plain
    // execCommand('fontName') won't do — we surround the selection ourselves.
    function applyFont(css) {
      if (!focusActive()) { toast('לחצו קודם בתוך טקסט', 'error'); return; }
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) { toast('בחרו טקסט קודם', 'error'); return; }
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.cssText = css;
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
        sel.removeAllRanges();
        const nr = document.createRange(); nr.selectNodeContents(span); sel.addRange(nr);
      } catch { toast('לא ניתן להחיל על הבחירה', 'error'); return; }
      activeEl.dispatchEvent(new Event('input'));
    }
    const FONTS = [
      ['', 'פונט…'],
      ["font-family:'Assistant',sans-serif;font-weight:400", 'Assistant'],
      ["font-family:'Assistant',sans-serif;font-weight:200", 'Assistant ExtraLight'],
      ["font-family:'Adam CG Pro',sans-serif;font-weight:400", 'Adam CG'],
    ];
    const fontSel = h('select', { class: 'tb-font', title: 'בחירת פונט לטקסט מסומן' },
      ...FONTS.map(([css, label]) => h('option', { value: css }, label)));
    fontSel.addEventListener('mousedown', () => { /* keep selection: handled by change */ });
    fontSel.addEventListener('change', () => { if (fontSel.value) applyFont(fontSel.value); fontSel.value = ''; });

    const tb = (label, tt, fn) => h('button', {
      type: 'button', class: 'tb-btn', title: tt,
      onmousedown: (e) => { e.preventDefault(); fn(); },
    }, label);
    const toolbar = h('div', { class: 'rte-toolbar sticky' },
      tb('B', 'מודגש', () => exec('bold')),
      tb('I', 'נטוי', () => exec('italic')),
      tb('U', 'קו תחתון', () => exec('underline')),
      tb('A−', 'קטן', () => exec('fontSize', '2')),
      tb('A', 'רגיל', () => exec('fontSize', '3')),
      tb('A+', 'גדול', () => exec('fontSize', '5')),
      tb('A++', 'ענק', () => exec('fontSize', '6')),
      fontSel,
      tb('⟺', 'כיוון טקסט RTL/LTR', () => { if (activeEl?._toggleDir) activeEl._toggleDir(); }),
      tb('⇥', 'יישור לימין', () => exec('justifyRight')),
      tb('≡', 'מרכוז', () => exec('justifyCenter')),
      tb('⇤', 'יישור לשמאל', () => exec('justifyLeft')),
      tb('•', 'רשימת תבליטים', () => exec('insertUnorderedList')),
      tb('1.', 'רשימה ממוספרת', () => orderedList('decimal')),
      tb('א.', 'רשימה לפי אותיות', () => orderedList('alpha')),
      tb('␡', 'ניקוי עיצוב', () => exec('removeFormat')));

    const injectRow = h('div', { class: 'inject-row' });
    function drawInject() {
      injectRow.innerHTML = '';
      injectRow.append(h('span', { class: 'muted', style: 'font-size:12px' }, 'הזרקה: '),
        ...LEAD_VARS.map(([k, lbl]) => h('span', { class: 'var-chip', onmousedown: (e) => { e.preventDefault(); insertVar(k); } }, lbl)),
        ...allFields().map(f => h('span', {
          class: 'var-chip', style: 'border-color:var(--warn);color:var(--warn)',
          onmousedown: (e) => { e.preventDefault(); insertVar(f.key); },
        }, f.label || f.key)));
    }

    // ---- sections builder ----
    const sectionsBox = h('div', { class: 'sections-box' });
    function drawSections() {
      sectionsBox.innerHTML = '';
      if (!c.sections.length) sectionsBox.append(h('p', { class: 'muted' }, 'הוסיפו סקשן כדי להתחיל — או החילו תבנית.'));
      c.sections.forEach((s, i) => sectionsBox.append(sectionCard(s, i)));
      sectionsBox.append(h('div', { class: 'add-section' },
        h('span', { class: 'muted' }, '➕ הוספת סקשן: '),
        h('button', { class: 'btn sm', onclick: () => addSection('title') }, '🔠 כותרת'),
        h('button', { class: 'btn sm', onclick: () => addSection('text') }, '📝 טקסט'),
        h('button', { class: 'btn sm', onclick: () => addSection('side') }, '📑 כותרת צדדית + טקסט'),
        h('button', { class: 'btn sm', onclick: () => addSection('product') }, '🎼 כותרת + מוצרים'),
        h('button', { class: 'btn sm', onclick: () => addSection('fields') }, '📝 שדות למילוי')));
    }

    // every fill-in field across all 'fields' sections (for injection chips)
    const allFields = () => c.sections.filter(s => s.type === 'fields').flatMap(s => s.items || []);

    function moveSection(i, dir) {
      const j = i + dir; if (j < 0 || j >= c.sections.length) return;
      [c.sections[i], c.sections[j]] = [c.sections[j], c.sections[i]];
      scheduleSave(); drawSections();
    }

    function sectionCard(s, i) {
      const badge = { title: '🔠 כותרת', text: '📝 טקסט', side: '📑 כותרת צדדית', product: '🎼 מוצרים', products: '🎼 מוצרים', fields: '📝 שדות למילוי' }[s.type] || 'סקשן';
      const head = h('div', { class: 'flex between' },
        h('span', { class: 'muted', style: 'font-weight:700' }, `${badge} · ${i + 1}`),
        h('div', { class: 'row-actions' },
          h('button', { class: 'icon-btn', title: 'למעלה', onclick: () => moveSection(i, -1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'למטה', onclick: () => moveSection(i, 1) }, '↓'),
          h('button', {
            class: 'icon-btn', title: 'מחיקה', onclick: () => { c.sections.splice(i, 1); scheduleSave(); drawSections(); },
          }, '🗑️')));

      if (s.type === 'title') {
        return h('div', { class: 'section-edit', dataset: { sid: s.id } }, head, richField(s, 'html', 'dir', { placeholder: 'כותרת (למשל: החתונה של…)', cls: 'as-title' }));
      }
      if (s.type === 'text') {
        const cols = h('input', { type: 'checkbox', checked: s.cols === 2 });
        cols.addEventListener('change', () => { s.cols = cols.checked ? 2 : 1; scheduleSave(); });
        return h('div', { class: 'section-edit', dataset: { sid: s.id } }, head,
          richField(s, 'html', 'dir', { placeholder: 'טקסט חופשי…' }),
          h('label', { class: 'field-check', style: 'margin-top:6px' }, cols, h('span', {}, '🗂️ פיצול ל-2 טורים')));
      }
      if (s.type === 'side') {
        const scols = h('input', { type: 'checkbox', checked: s.cols === 2 });
        scols.addEventListener('change', () => { s.cols = scols.checked ? 2 : 1; scheduleSave(); });
        return h('div', { class: 'section-edit', dataset: { sid: s.id } }, head,
          h('label', { class: 'field' }, h('span', {}, 'כותרת צדדית'), richField(s, 'title_html', 'title_dir', { placeholder: 'למשל: קבלת פנים', cls: 'as-label' })),
          h('label', { class: 'field' }, h('span', {}, 'טקסט'), richField(s, 'html', 'dir', { placeholder: 'תיאור…' })),
          h('label', { class: 'field-check', style: 'margin-top:6px' }, scols, h('span', {}, '🗂️ פיצול הטקסט ל-2 טורים')));
      }
      if (s.type === 'fields') return fieldsSectionCard(s, head);
      // product (side title + products)
      const itemsBox = h('div', {});
      const drawItems = () => {
        itemsBox.innerHTML = '';
        (s.items || []).forEach((it, k) => itemsBox.append(productItemRow(s, it, k, drawItems)));
        itemsBox.append(
          h('button', { class: 'btn sm primary', onclick: () => addProductsToSection(s, drawItems) }, '➕ הוספת מוצרים'),
          h('button', {
            class: 'btn sm', style: 'margin-inline-start:6px',
            title: 'שורת טקסט חופשי בלי מוצר מהמערכת',
            onclick: () => {
              s.items = s.items || [];
              s.items.push({ package_item_id: null, product_id: null, name_html: '', name_dir: null, desc_html: '', desc_dir: null });
              scheduleSave(); drawItems();
            },
          }, '✍️ שורת טקסט'));
      };
      const pcols = h('input', { type: 'checkbox', checked: s.cols === 2 });
      pcols.addEventListener('change', () => { s.cols = pcols.checked ? 2 : 1; scheduleSave(); });
      const card = h('div', { class: 'section-edit', dataset: { sid: s.id } }, head,
        h('label', { class: 'field' }, h('span', {}, 'כותרת הסקשן'), richField(s, 'title_html', 'title_dir', { placeholder: 'למשל: קבלת פנים', cls: 'as-label' })),
        h('label', { class: 'field-check', style: 'margin:2px 0 6px' }, pcols, h('span', {}, '🗂️ הצגת המוצרים ב-2 טורים')),
        itemsBox);
      drawItems();
      return card;
    }

    // Pick any number of products in one pass — from the attached package if
    // there is one, and from the whole catalogue either way (so a contract with
    // no package can still list products). Package items keep the package's
    // included/price; catalogue items get their own, editable on the row.
    async function addProductsToSection(s, redraw) {
      const pkg = curPkg();
      const opts = [];
      const fromPkg = new Set();
      for (const pi of (pkg?.items || [])) {
        fromPkg.add(pi.product_id);
        opts.push({
          value: `pi:${pi.id}`, label: pi.product?.name || '?',
          hint: pi.included ? 'כלול בחבילה' : `תוספת ${fmtMoney(pi.effective_price)}`,
        });
      }
      for (const p of products) {
        if (!p.active || fromPkg.has(p.id)) continue;
        opts.push({ value: `pr:${p.id}`, label: p.name, hint: `מהקטלוג · ${fmtMoney(p.default_price)}` });
      }
      if (!opts.length) { toast('אין מוצרים במערכת — הוסיפו מוצרים בלשונית "מוצרים"', 'error'); return; }

      const chosen = await pickProducts('הוספת מוצרים לסקשן', opts);
      if (!chosen?.length) return;
      s.items = s.items || [];
      for (const v of chosen) {
        const id = v.slice(3);
        if (v.startsWith('pi:')) {
          const pi = (pkg?.items || []).find(x => x.id === id);
          s.items.push({
            package_item_id: id, product_id: pi?.product_id || null, included: !!pi?.included,
            name_html: pi?.product?.name || '', name_dir: null,
            desc_html: pi?.product?.description || '', desc_dir: null,
          });
        } else {
          const p = products.find(x => x.id === id);
          s.items.push({
            package_item_id: null, product_id: id, included: true, price: Number(p?.default_price) || 0,
            name_html: p?.name || '', name_dir: null,
            desc_html: p?.description || '', desc_dir: null,
          });
        }
      }
      scheduleSave(); redraw();
    }

    function productItemRow(s, it, k, redraw) {
      const pkg = curPkg();
      const pi = (pkg?.items || []).find(x => x.id === it.package_item_id);

      // head: what this line is + (for catalogue items) included / price controls
      let head;
      if (it.package_item_id) {
        head = pi
          ? h('span', { class: `chip ${pi.included ? 'status-win' : 'stage-form'}` },
            pi.included ? 'כלול בחבילה' : `תוספת ${fmtMoney(pi.effective_price)}`)
          : h('span', { class: 'chip status-lost' }, 'לא נמצא בחבילה');
      } else if (it.product_id) {
        const incSel = h('select', { style: 'max-width:170px' },
          h('option', { value: '1', selected: it.included !== false }, '✅ כלול במחיר'),
          h('option', { value: '0', selected: it.included === false }, '➕ תוספת בתשלום'));
        const priceInp = h('input', {
          class: 'price-input', type: 'number', dir: 'ltr', value: it.price ?? 0,
          style: it.included === false ? '' : 'display:none',
        });
        incSel.addEventListener('change', () => {
          it.included = incSel.value === '1';
          priceInp.style.display = it.included ? 'none' : '';
          scheduleSave();
        });
        priceInp.addEventListener('change', () => { it.price = Number(priceInp.value) || 0; scheduleSave(); });
        head = h('div', { class: 'flex' }, incSel, priceInp);
      } else {
        head = h('span', { class: 'chip stage' }, 'טקסט בלבד');
      }

      return h('div', { class: 'prod-item-edit' },
        h('div', { class: 'flex between' },
          h('div', { class: 'flex' }, head),
          h('button', { class: 'icon-btn', title: 'הסרה', onclick: () => { s.items.splice(k, 1); scheduleSave(); redraw(); } }, '✕')),
        h('label', { class: 'field' }, h('span', {}, 'שם המוצר (ניתן לעיצוב)'), richField(it, 'name_html', 'name_dir', { placeholder: 'שם המוצר' })),
        h('label', { class: 'field' }, h('span', {}, 'תיאור (ניתן לעיצוב)'), richField(it, 'desc_html', 'desc_dir', { placeholder: 'תיאור המוצר' })));
    }

    function addSection(type, index) {
      const base = { id: sid(), type, dir: null };
      if (type === 'product' || type === 'products') Object.assign(base, { type: 'product', title_html: '', title_dir: null, items: [] });
      else if (type === 'fields') Object.assign(base, { title_html: '', title_dir: null, items: [] });
      else if (type === 'side') Object.assign(base, { title_html: '', title_dir: null, html: '' });
      else base.html = ''; // title / text
      if (typeof index === 'number' && index >= 0 && index <= c.sections.length) c.sections.splice(index, 0, base);
      else c.sections.push(base);
      scheduleSave(); drawSections();
    }

    // ---- fill-in fields section (title + its own fields, reorderable) ----
    function fieldsSectionCard(s, head) {
      s.items = s.items || [];
      const itemsBox = h('div', {});
      const drawItems = () => {
        itemsBox.innerHTML = '';
        if (!s.items.length) itemsBox.append(h('p', { class: 'muted', style: 'font-size:12px;margin:4px 0' }, 'שדות למילוי — סמנו "ניתן לעריכה" כדי שהלקוח יעדכן והמערכת תתעדכן. ניתן להזריק אותם לכל טקסט.'));
        s.items.forEach((f, k) => itemsBox.append(fieldItemRow(s, f, k, drawItems)));
        itemsBox.append(h('button', {
          class: 'btn sm primary mt', onclick: () => {
            s.items.push({ id: randKey(), key: randKey(), label: '', source: 'custom', lead_field: 'contact_name', value: '', client_editable: false });
            scheduleSave(); drawItems(); drawInject();
          },
        }, '➕ שדה למילוי'));
      };
      drawItems();
      return h('div', { class: 'section-edit', dataset: { sid: s.id } }, head,
        h('label', { class: 'field' }, h('span', {}, 'כותרת צד (אופציונלי)'), richField(s, 'title_html', 'title_dir', { placeholder: 'למשל: פרטי המזמין', cls: 'as-label' })),
        itemsBox);
    }
    function fieldItemRow(s, f, idx, rerender) {
      const label = h('input', { type: 'text', value: f.label || '', placeholder: 'תווית' });
      const sourceSel = h('select', {},
        h('option', { value: 'custom', selected: f.source !== 'lead' }, 'ערך קבוע'),
        h('option', { value: 'lead', selected: f.source === 'lead' }, 'שדה מהמערכת'));
      const valueInput = h('input', { type: 'text', value: f.value || '', placeholder: 'ערך' });
      const leadSel = h('select', {}, ...LEAD_BIND.map(([col, lbl]) => h('option', { value: col, selected: (f.lead_field || 'contact_name') === col }, lbl)));
      const clientEdit = h('input', { type: 'checkbox', checked: !!f.client_editable });
      const valWrap = h('label', { class: 'field' }, h('span', {}, 'ערך'), valueInput);
      const leadWrap = h('label', { class: 'field' }, h('span', {}, 'שדה'), leadSel);
      const syncVis = () => { const l = sourceSel.value === 'lead'; valWrap.style.display = l ? 'none' : ''; leadWrap.style.display = l ? '' : 'none'; };
      syncVis();
      const commit = () => {
        f.label = label.value; f.source = sourceSel.value; f.value = valueInput.value;
        f.lead_field = leadSel.value; f.client_editable = clientEdit.checked;
        if (f.source === 'lead') f.key = leadSel.value;
        else if (!f.key || LEAD_BIND.some(([col]) => col === f.key)) f.key = randKey();
        scheduleSave(); drawInject();
      };
      label.addEventListener('input', debounce(commit, 400));
      valueInput.addEventListener('input', debounce(commit, 400));
      sourceSel.addEventListener('change', () => { syncVis(); commit(); });
      leadSel.addEventListener('change', commit);
      clientEdit.addEventListener('change', commit);
      const move = (dir) => {
        const j = idx + dir; if (j < 0 || j >= s.items.length) return;
        [s.items[idx], s.items[j]] = [s.items[j], s.items[idx]];
        scheduleSave(); rerender();
      };
      return h('div', { class: 'section-edit' },
        h('div', { class: 'flex between' },
          h('span', { class: 'var-chip', onmousedown: (e) => { e.preventDefault(); insertVar(f.key); } }, f.label || f.key),
          h('div', { class: 'row-actions' },
            h('button', { class: 'icon-btn', title: 'למעלה', onclick: () => move(-1) }, '↑'),
            h('button', { class: 'icon-btn', title: 'למטה', onclick: () => move(1) }, '↓'),
            h('button', { class: 'icon-btn', title: 'מחיקה', onclick: () => { s.items.splice(idx, 1); scheduleSave(); rerender(); drawInject(); } }, '🗑️'))),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'תווית'), label),
          h('label', { class: 'field' }, h('span', {}, 'מקור'), sourceSel), valWrap, leadWrap),
        h('label', { class: 'field-check' }, clientEdit, h('span', {}, '✏️ ניתן לעריכה ע"י הלקוח')));
    }

    // ---- top controls ----
    const title = h('input', { type: 'text', value: c.title });
    const langSel = h('select', {}, h('option', { value: 'he', selected: c.language === 'he' }, 'עברית'), h('option', { value: 'en', selected: c.language === 'en' }, 'English'));
    const dirSel = h('select', {}, h('option', { value: 'rtl', selected: c.direction === 'rtl' }, 'ימין↦שמאל (RTL)'), h('option', { value: 'ltr', selected: c.direction === 'ltr' }, 'שמאל↦ימין (LTR)'));
    langSel.addEventListener('change', () => { c.language = langSel.value; c.direction = langSel.value === 'en' ? 'ltr' : 'rtl'; dirSel.value = c.direction; scheduleSave(); });
    dirSel.addEventListener('change', () => { c.direction = dirSel.value; scheduleSave(); });

    const pkgSel = comboBox(packages.map(p => ({ value: p.id, label: `${p.name} · ${fmtMoney(p.base_price)}` })),
      { value: c.package_id || '', placeholder: '🔍 חבילה…', empty: '— ללא חבילה —' });
    pkgSel.el.addEventListener('change', async () => {
      ({ contract: c } = await patch(`/contracts/${c.id}`, { package_id: pkgSel.get() || null }));
      c.sections = c.sections || []; c.fields = c.fields || []; c.language = c.language || 'he'; c.direction = c.direction || 'rtl';
      priceLine.textContent = priceText(); drawSections(); refreshPreview();
      toast('החבילה עודכנה ✓', 'success');
    });

    // up to two management signatories — a select each
    const mkSigSel = (key) => {
      const sel = h('select', {}, h('option', { value: '' }, '— חתימת הנהלה —'),
        ...signatures.map(s => h('option', { value: s.id, selected: c[key] === s.id }, s.name)));
      sel.addEventListener('change', async () => {
        ({ contract: c } = await patch(`/contracts/${c.id}`, { [key]: sel.value || null }));
        c.sections = c.sections || []; c.fields = c.fields || [];
        refreshPreview(); toast('חתימת ההנהלה עודכנה ✓', 'success');
      });
      return sel;
    };
    const sigSel = mkSigSel('management_signature_id');
    const sigSel2 = mkSigSel('management_signature_id_2');

    const reqSig = h('input', { type: 'checkbox', checked: c.require_client_signature !== false });
    reqSig.addEventListener('change', async () => {
      await patch(`/contracts/${c.id}`, { require_client_signature: reqSig.checked });
      c.require_client_signature = reqSig.checked; refreshPreview();
    });

    // ---- pricing terms: VAT + discount (shown in the proposal's TOTAL box) ----
    c.vat_mode = c.vat_mode || 'none';
    c.vat_rate = c.vat_rate ?? 18;
    c.discount_type = c.discount_type || 'none';
    c.discount_value = c.discount_value ?? 0;

    const vatModeSel = h('select', {},
      h('option', { value: 'none', selected: c.vat_mode === 'none' }, 'ללא מע"מ'),
      h('option', { value: 'added', selected: c.vat_mode === 'added' }, 'לא כולל — יתווסף מע"מ'),
      h('option', { value: 'included', selected: c.vat_mode === 'included' }, 'כולל מע"מ'));
    const vatRateInp = h('input', { type: 'number', dir: 'ltr', min: '0', step: '0.1', value: c.vat_rate });
    const discTypeSel = h('select', {},
      h('option', { value: 'none', selected: c.discount_type === 'none' }, 'ללא הנחה'),
      h('option', { value: 'percent', selected: c.discount_type === 'percent' }, 'הנחה באחוזים (%)'),
      h('option', { value: 'amount', selected: c.discount_type === 'amount' }, 'הנחה בסכום (₪)'));
    const discValInp = h('input', { type: 'number', dir: 'ltr', min: '0', step: '1', value: c.discount_value });

    const syncTermsDisabled = () => {
      vatRateInp.disabled = c.vat_mode === 'none';
      discValInp.disabled = c.discount_type === 'none';
    };
    syncTermsDisabled();

    async function applyTerms() {
      syncTermsDisabled();
      const { contract: resp } = await patch(`/contracts/${c.id}`, {
        vat_mode: c.vat_mode, vat_rate: Number(c.vat_rate) || 0,
        discount_type: c.discount_type, discount_value: Number(c.discount_value) || 0,
      });
      c.price = resp.price; c.final_price = resp.final_price;
      priceLine.textContent = priceText();
      refreshPreview();
    }
    vatModeSel.addEventListener('change', () => { c.vat_mode = vatModeSel.value; applyTerms(); });
    vatRateInp.addEventListener('change', () => { c.vat_rate = vatRateInp.value; applyTerms(); });
    discTypeSel.addEventListener('change', () => { c.discount_type = discTypeSel.value; applyTerms(); });
    discValInp.addEventListener('change', () => { c.discount_value = discValInp.value; applyTerms(); });

    // ---- templates ----
    const tplBar = h('div', { class: 'flex', style: 'flex-wrap:wrap;gap:6px' });
    function drawTemplates() {
      tplBar.innerHTML = '';
      tplBar.append(
        h('span', { class: 'muted', style: 'font-size:12px' }, 'תבניות: '),
        h('button', { class: 'btn sm', onclick: () => applyBuiltin() }, '⭐ קלאסי קולות'),
        ...templates.map(t => h('span', { class: 'tpl-chip' },
          h('button', { class: 'btn sm', onclick: () => applyTemplate(t) }, `📋 ${t.name}`),
          h('button', {
            class: 'icon-btn', title: 'מחיקת תבנית', onclick: async () => {
              if (!await confirmModal('מחיקת תבנית', `למחוק את "${t.name}"?`)) return;
              await del(`/contracts/templates/${t.id}`);
              ({ templates } = await get('/contracts/templates')); drawTemplates();
            },
          }, '🗑️'))),
        h('button', { class: 'btn sm primary', onclick: saveAsTemplate }, '💾 שמירה כתבנית'));
    }
    async function applyBuiltin() {
      if (!await confirmModal('החלת תבנית', 'להחליף את התוכן הנוכחי בתבנית "קלאסי קולות"?')) return;
      c.sections = builtinSections(curPkg());
      ensureFieldsSection();
      await saveAll(); drawSections(); refreshPreview(); toast('התבנית הוחלה ✓', 'success');
    }
    async function applyTemplate(t) {
      if (!await confirmModal('החלת תבנית', `להחליף את התוכן הנוכחי בתבנית "${t.name}"?`)) return;
      const d = t.data || {};
      c.sections = JSON.parse(JSON.stringify(d.sections || []));
      c.fields = Array.isArray(d.fields) ? JSON.parse(JSON.stringify(d.fields)) : [];
      if (d.language) c.language = d.language;
      if (d.direction) c.direction = d.direction;
      langSel.value = c.language; dirSel.value = c.direction;
      if ('require_client_signature' in d) { c.require_client_signature = d.require_client_signature; reqSig.checked = d.require_client_signature; }
      ensureFieldsSection();
      await saveAll(); drawSections(); refreshPreview(); toast('התבנית הוחלה ✓', 'success');
    }
    const templateData = () => ({
      language: c.language, direction: c.direction, sections: c.sections,
      fields: c.fields, require_client_signature: c.require_client_signature,
    });
    function saveAsTemplate() {
      // choose: overwrite an existing template, or save as a new one
      const targetSel = h('select', {},
        h('option', { value: '' }, '➕ תבנית חדשה'),
        ...templates.map(t => h('option', { value: t.id }, `♻️ עדכון: ${t.name}`)));
      const nameInput = h('input', { type: 'text', placeholder: 'שם התבנית' });
      const nameRow = h('label', { class: 'field' }, h('span', {}, 'שם'), nameInput);
      // when overwriting, prefill + hide the name (kept unless renamed)
      targetSel.addEventListener('change', () => {
        const t = templates.find(x => x.id === targetSel.value);
        nameInput.value = t ? t.name : '';
        nameRow.style.display = targetSel.value ? 'none' : '';
      });
      modal('שמירת תבנית', h('div', {},
        h('label', { class: 'field' }, h('span', {}, 'יעד'), targetSel), nameRow), {
        actions: [
          {
            label: 'שמירה', kind: 'primary', onclick: async (close) => {
              await saveAll();
              if (targetSel.value) {
                await patch(`/contracts/templates/${targetSel.value}`, { data: templateData() });
              } else {
                if (!nameInput.value.trim()) { toast('שם חובה', 'error'); return false; }
                await post('/contracts/templates', { name: nameInput.value.trim(), data: templateData() });
              }
              ({ templates } = await get('/contracts/templates')); drawTemplates();
              close(); toast('התבנית נשמרה ✓', 'success');
            },
          },
          { label: 'ביטול', onclick: (close) => close() },
        ],
      });
    }

    // ---- price + send ----
    const priceText = () => {
      const p = c.price || { subtotal: c.final_price, discount_amount: 0, vat_mode: 'none', vat_amount: 0, total: c.final_price };
      const bits = [`ביניים: ${fmtMoney(p.subtotal)}`];
      if ((p.discount_amount || 0) > 0) bits.push(`הנחה: −${fmtMoney(p.discount_amount)}`);
      if (p.vat_mode === 'added') bits.push(`מע"מ ${p.vat_rate}%: +${fmtMoney(p.vat_amount)}`);
      else if (p.vat_mode === 'included') bits.push(`כולל מע"מ ${p.vat_rate}%`);
      bits.push(`לתשלום: ${fmtMoney(p.total)}`);
      return bits.join(' · ');
    };
    const priceLine = h('p', { class: 'muted' }, priceText());
    const sendEmail = h('input', { type: 'email', dir: 'ltr', placeholder: c.lead?.email || 'מייל הלקוח', value: c.lead?.email || '' });

    // ---- live preview (edit=1 → shows floating "+ add section" points) ----
    const previewFrame = h('iframe', { class: 'ce-frame', src: `/portal.html?t=${c.client_token}&edit=1` });
    const reloadFrame = () => { try { previewFrame.contentWindow.location.reload(); } catch { previewFrame.src = `/portal.html?t=${c.client_token}&edit=1&_=${Date.now()}`; } };
    const refreshPreview = debounce(reloadFrame, 900);

    // insert a section from the preview's floating "+" menu (postMessage)
    async function onPreviewMessage(e) {
      if (!previewFrame.isConnected) { window.removeEventListener('message', onPreviewMessage); return; }
      if (e.origin !== location.origin) return;
      const d = e.data || {};
      if (d.source !== 'zooglot-preview' || d.token !== c.client_token) return;
      if (d.action === 'add-section') {
        addSection(d.sectionType, d.index);
        await saveAll();
        reloadFrame();
      } else if (d.action === 'focus-section') {
        const card = buildPane.querySelector(`.section-edit[data-sid="${CSS.escape(d.id)}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('flash');
          setTimeout(() => card.classList.remove('flash'), 1200);
          const rf = card.querySelector('.rich');
          if (rf) setTimeout(() => rf.focus(), 350);
        }
      }
    }
    window.addEventListener('message', onPreviewMessage);

    // ---- persistence ----
    const scheduleSave = debounce(async () => { await saveAll(); refreshPreview(); }, 700);
    async function saveAll() {
      const { contract: resp } = await patch(`/contracts/${c.id}`, {
        title: title.value, sections: c.sections, fields: c.fields,
        language: c.language, direction: c.direction,
      });
      c.final_price = resp.final_price; c.base_price = resp.base_price; c.status = resp.status;
      c.price = resp.price;
      priceLine.textContent = priceText();
    }
    title.addEventListener('input', debounce(() => scheduleSave(), 500));

    // ---- assemble ----
    const stickyBar = h('div', { class: 'editor-sticky' }, toolbar, injectRow);
    const buildPane = h('div', { class: 'ce-build' },
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'כותרת פנימית'), title),
        h('label', { class: 'field' }, h('span', {}, 'חבילה'), pkgSel.el)),
      h('details', { class: 'ce-settings' },
        h('summary', {}, '⚙️ הגדרות (שפה, כיוון, חתימה, מע"מ, הנחה)'),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'שפה'), langSel),
          h('label', { class: 'field' }, h('span', {}, 'כיוון ברירת מחדל'), dirSel),
          h('label', { class: 'field' }, h('span', {}, 'חתימת הנהלה 1'), sigSel),
          h('label', { class: 'field' }, h('span', {}, 'חתימת הנהלה 2 (אופציונלי)'), sigSel2),
          h('label', { class: 'field-check', style: 'align-self:end' }, reqSig, h('span', {}, '✍️ דרישת חתימת לקוח'))),
        h('div', { class: 'ce-terms' },
          h('h5', {}, '💰 מחיר, מע"מ והנחה'),
          h('div', { class: 'grid-2' },
            h('label', { class: 'field' }, h('span', {}, 'מע"מ'), vatModeSel),
            h('label', { class: 'field' }, h('span', {}, 'שיעור מע"מ (%)'), vatRateInp),
            h('label', { class: 'field' }, h('span', {}, 'הנחה'), discTypeSel),
            h('label', { class: 'field' }, h('span', {}, 'סכום/אחוז הנחה'), discValInp)))),
      priceLine,
      tplBar,
      stickyBar,
      h('h4', { class: 'mt' }, '🧱 סקשנים'),
      sectionsBox,
      h('div', { class: 'card mt', style: 'padding:12px' },
        h('div', { class: 'flex', style: 'flex-wrap:wrap' },
          h('span', {}, '📧 שליחה ללקוח:'), sendEmail,
          h('button', {
            class: 'btn primary', onclick: withBusy(async () => {
              await saveAll();
              const rsp = await post(`/contracts/${c.id}/send`, { email: sendEmail.value || undefined });
              navigator.clipboard?.writeText(rsp.portal_link);
              toast(`ההצעה נשלחה ✓ הקישור הועתק`, 'success'); reload();
            }),
          }, 'שליחה ללקוח'),
          h('a', { class: 'btn', href: `/portal.html?t=${c.client_token}`, target: '_blank' }, '🔗 פתיחה בכרטיסייה'))));

    const previewPane = h('div', { class: 'ce-preview' },
      h('div', { class: 'flex between', style: 'margin-bottom:6px' },
        h('span', { class: 'muted' }, '👁️ תצוגה מקדימה חיה'),
        h('button', { class: 'btn sm', onclick: () => { try { previewFrame.contentWindow.location.reload(); } catch { previewFrame.src = previewFrame.src; } } }, '🔄 רענון')),
      previewFrame);

    modal(`עריכת הצעה — ${c.lead?.name || ''}`, h('div', { class: 'contract-editor' }, buildPane, previewPane), {
      wide: true,
      actions: [
        { label: '💾 שמירה', kind: 'primary', onclick: async (close) => { await saveAll(); window.removeEventListener('message', onPreviewMessage); toast('נשמר ✓', 'success'); close(); reload(); } },
        { label: 'סגירה', onclick: (close) => { window.removeEventListener('message', onPreviewMessage); close(); reload(); } },
      ],
    });

    drawTemplates();
    drawSections();
    drawInject();
  }

  await reload();
}
