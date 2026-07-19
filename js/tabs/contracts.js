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

const STATUS_LABELS = {
  draft: ['טיוטה', 'stage'], sent: ['נשלח ללקוח', 'stage-form'],
  client_signed: ['נחתם ע"י הלקוח', 'status-win'], completed: ['הושלם ✓', 'status-win'],
  cancelled: ['בוטל', 'status-lost'],
};

const LEAD_VARS = [
  ['name', 'שם הליד'], ['contact_name', 'איש קשר'], ['event_date', 'תאריך אירוע'],
  ['event_location', 'מיקום'], ['event_type', 'סוג אירוע'], ['email', 'מייל'],
  ['phone1', 'טלפון'], ['id_number', 'ת"ז'], ['address', 'כתובת'],
  ['final_price', 'מחיר סופי'], ['base_price', 'מחיר בסיס'], ['deposit', 'מקדמה (10%)'],
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
  let contracts = [], leads = [], packages = [], signatures = [], templates = [];

  async function reload() {
    [{ contracts }, { leads }, { packages }, { signatures }, { templates }] = await Promise.all([
      get('/contracts'), get('/leads'), get('/packages'), get('/settings/signatures'), get('/contracts/templates'),
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
    // the fill-in fields render as a movable block; ensure a positional marker exists
    if (!c.sections.some(s => s.type === 'fields')) c.sections.push({ id: sid(), type: 'fields' });

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
      tb('⟺', 'כיוון טקסט RTL/LTR', () => { if (activeEl?._toggleDir) activeEl._toggleDir(); }),
      tb('⇥', 'יישור לימין', () => exec('justifyRight')),
      tb('≡', 'מרכוז', () => exec('justifyCenter')),
      tb('⇤', 'יישור לשמאל', () => exec('justifyLeft')),
      tb('•', 'רשימה', () => exec('insertUnorderedList')),
      tb('␡', 'ניקוי עיצוב', () => exec('removeFormat')));

    const injectRow = h('div', { class: 'inject-row' });
    function drawInject() {
      injectRow.innerHTML = '';
      injectRow.append(h('span', { class: 'muted', style: 'font-size:12px' }, 'הזרקה: '),
        ...LEAD_VARS.map(([k, lbl]) => h('span', { class: 'var-chip', onmousedown: (e) => { e.preventDefault(); insertVar(k); } }, lbl)),
        ...c.fields.map(f => h('span', {
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
        h('button', { class: 'btn sm', onclick: () => addSection('product') }, '🎼 כותרת + מוצרים')));
    }

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
          s.type === 'fields' ? null : h('button', {
            class: 'icon-btn', title: 'מחיקה', onclick: () => { c.sections.splice(i, 1); scheduleSave(); drawSections(); },
          }, '🗑️')));

      if (s.type === 'title') {
        return h('div', { class: 'section-edit' }, head, richField(s, 'html', 'dir', { placeholder: 'כותרת (למשל: החתונה של…)', cls: 'as-title' }));
      }
      if (s.type === 'text') {
        const cols = h('input', { type: 'checkbox', checked: s.cols === 2 });
        cols.addEventListener('change', () => { s.cols = cols.checked ? 2 : 1; scheduleSave(); });
        return h('div', { class: 'section-edit' }, head,
          richField(s, 'html', 'dir', { placeholder: 'טקסט חופשי…' }),
          h('label', { class: 'field-check', style: 'margin-top:6px' }, cols, h('span', {}, '🗂️ פיצול ל-2 טורים')));
      }
      if (s.type === 'side') {
        return h('div', { class: 'section-edit' }, head,
          h('label', { class: 'field' }, h('span', {}, 'כותרת צדדית'), richField(s, 'title_html', 'title_dir', { placeholder: 'למשל: קבלת פנים', cls: 'as-label' })),
          h('label', { class: 'field' }, h('span', {}, 'טקסט'), richField(s, 'html', 'dir', { placeholder: 'תיאור…' })));
      }
      if (s.type === 'fields') {
        drawFields();
        return h('div', { class: 'section-edit' }, head,
          h('p', { class: 'muted', style: 'font-size:12px;margin:4px 0' }, 'הבלוק הזה נראה ללקוח במיקום הזה. גררו למעלה/למטה כדי לשנות מיקום.'),
          fieldsBox);
      }
      // product (side title + products)
      const itemsBox = h('div', {});
      const drawItems = () => {
        itemsBox.innerHTML = '';
        (s.items || []).forEach((it, k) => itemsBox.append(productItemRow(s, it, k, drawItems)));
        itemsBox.append(h('button', {
          class: 'btn sm', onclick: () => {
            if (!curPkg()) { toast('שייכו חבילה קודם כדי לבחור מוצרים', 'error'); return; }
            s.items = s.items || [];
            s.items.push({ package_item_id: null, name_html: '', name_dir: null, desc_html: '', desc_dir: null });
            scheduleSave(); drawItems();
          },
        }, '➕ הוספת מוצר לסקשן'));
      };
      const card = h('div', { class: 'section-edit' }, head,
        h('label', { class: 'field' }, h('span', {}, 'כותרת הסקשן'), richField(s, 'title_html', 'title_dir', { placeholder: 'למשל: קבלת פנים', cls: 'as-label' })),
        itemsBox);
      drawItems();
      return card;
    }

    function productItemRow(s, it, k, redraw) {
      const pkg = curPkg();
      const opts = (pkg?.items || []).map(pi => ({
        value: pi.id,
        label: `${pi.product?.name || '?'} — ${pi.included ? 'כלול' : 'תוספת ' + fmtMoney(pi.effective_price)}`,
      }));
      const sel = h('select', {},
        h('option', { value: '' }, '— בחרו מוצר מהחבילה —'),
        ...opts.map(o => h('option', { value: o.value, selected: it.package_item_id === o.value }, o.label)));
      sel.addEventListener('change', () => {
        it.package_item_id = sel.value || null;
        const pi = (pkg?.items || []).find(x => x.id === sel.value);
        if (pi && !it.name_html) it.name_html = pi.product?.name || '';
        if (pi && !it.desc_html) it.desc_html = pi.product?.description || '';
        scheduleSave(); redraw();
      });
      const pi = (pkg?.items || []).find(x => x.id === it.package_item_id);
      const badge = it.package_item_id
        ? (pi ? h('span', { class: `chip ${pi.included ? 'status-win' : 'stage-form'}` }, pi.included ? 'כלול' : `תוספת ${fmtMoney(pi.effective_price)}`)
          : h('span', { class: 'chip status-lost' }, 'לא נמצא בחבילה'))
        : null;
      return h('div', { class: 'prod-item-edit' },
        h('div', { class: 'flex between' },
          h('div', { class: 'flex' }, sel, badge),
          h('button', { class: 'icon-btn', title: 'הסרה', onclick: () => { s.items.splice(k, 1); scheduleSave(); redraw(); } }, '✕')),
        h('label', { class: 'field' }, h('span', {}, 'שם המוצר (ניתן לעיצוב)'), richField(it, 'name_html', 'name_dir', { placeholder: 'שם המוצר' })),
        h('label', { class: 'field' }, h('span', {}, 'תיאור (ניתן לעיצוב)'), richField(it, 'desc_html', 'desc_dir', { placeholder: 'תיאור המוצר' })));
    }

    function addSection(type, index) {
      const base = { id: sid(), type, dir: null };
      if (type === 'product' || type === 'products') Object.assign(base, { type: 'product', title_html: '', title_dir: null, items: [] });
      else if (type === 'side') Object.assign(base, { title_html: '', title_dir: null, html: '' });
      else base.html = ''; // title / text
      if (typeof index === 'number' && index >= 0 && index <= c.sections.length) c.sections.splice(index, 0, base);
      else c.sections.push(base);
      scheduleSave(); drawSections();
    }

    // ---- fill-in fields manager (compact) ----
    const fieldsBox = h('div', { class: 'fields-box' });
    function drawFields() {
      fieldsBox.innerHTML = '';
      if (!c.fields.length) fieldsBox.append(h('p', { class: 'muted', style: 'font-size:12.5px' }, 'שדות למילוי שאפשר להזריק לכל טקסט. סמנו "ניתן לעריכה ע"י הלקוח" כדי שהלקוח יעדכן והמערכת תתעדכן.'));
      c.fields.forEach((f, i) => fieldsBox.append(fieldRow(f, i)));
      fieldsBox.append(h('button', { class: 'btn sm primary mt', onclick: addField }, '➕ שדה חדש'));
      drawInject();
    }
    function fieldRow(f, idx) {
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
      return h('div', { class: 'section-edit' },
        h('div', { class: 'flex between' },
          h('span', { class: 'var-chip', onmousedown: (e) => { e.preventDefault(); insertVar(f.key); } }, f.label || f.key),
          h('button', { class: 'icon-btn', title: 'מחיקה', onclick: () => { c.fields.splice(idx, 1); scheduleSave(); drawFields(); } }, '🗑️')),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'תווית'), label),
          h('label', { class: 'field' }, h('span', {}, 'מקור'), sourceSel), valWrap, leadWrap),
        h('label', { class: 'field-check' }, clientEdit, h('span', {}, '✏️ ניתן לעריכה ע"י הלקוח')));
    }
    function addField() {
      c.fields.push({ id: randKey(), key: randKey(), label: '', source: 'custom', lead_field: 'contact_name', value: '', client_editable: false });
      scheduleSave(); drawFields();
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

    const sigSel = h('select', {}, h('option', { value: '' }, '— חתימת הנהלה —'),
      ...signatures.map(s => h('option', { value: s.id, selected: c.management_signature_id === s.id }, s.name)));
    sigSel.addEventListener('change', async () => {
      ({ contract: c } = await patch(`/contracts/${c.id}`, { management_signature_id: sigSel.value || null }));
      c.sections = c.sections || []; c.fields = c.fields || [];
      refreshPreview(); toast('חתימת ההנהלה עודכנה ✓', 'success');
    });

    const reqSig = h('input', { type: 'checkbox', checked: c.require_client_signature !== false });
    reqSig.addEventListener('change', async () => {
      await patch(`/contracts/${c.id}`, { require_client_signature: reqSig.checked });
      c.require_client_signature = reqSig.checked; refreshPreview();
    });

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
      await saveAll(); drawSections(); refreshPreview(); toast('התבנית הוחלה ✓', 'success');
    }
    async function applyTemplate(t) {
      if (!await confirmModal('החלת תבנית', `להחליף את התוכן הנוכחי בתבנית "${t.name}"?`)) return;
      const d = t.data || {};
      c.sections = JSON.parse(JSON.stringify(d.sections || []));
      if (Array.isArray(d.fields)) c.fields = JSON.parse(JSON.stringify(d.fields));
      if (d.language) c.language = d.language;
      if (d.direction) c.direction = d.direction;
      langSel.value = c.language; dirSel.value = c.direction;
      if ('require_client_signature' in d) { c.require_client_signature = d.require_client_signature; reqSig.checked = d.require_client_signature; }
      await saveAll(); drawSections(); drawFields(); refreshPreview(); toast('התבנית הוחלה ✓', 'success');
    }
    function saveAsTemplate() {
      const nameInput = h('input', { type: 'text', placeholder: 'שם התבנית' });
      modal('שמירת תבנית', h('div', {}, h('label', { class: 'field' }, h('span', {}, 'שם'), nameInput)), {
        actions: [
          {
            label: 'שמירה', kind: 'primary', onclick: async (close) => {
              if (!nameInput.value.trim()) { toast('שם חובה', 'error'); return false; }
              await saveAll();
              await post('/contracts/templates', {
                name: nameInput.value.trim(),
                data: { language: c.language, direction: c.direction, sections: c.sections, fields: c.fields, require_client_signature: c.require_client_signature },
              });
              ({ templates } = await get('/contracts/templates')); drawTemplates();
              close(); toast('התבנית נשמרה ✓', 'success');
            },
          },
          { label: 'ביטול', onclick: (close) => close() },
        ],
      });
    }

    // ---- price + send ----
    const priceText = () => `מחיר בסיס: ${fmtMoney(c.base_price)} · סופי (כולל תוספות שנבחרו): ${fmtMoney(c.final_price)}`;
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
        h('summary', {}, '⚙️ הגדרות (שפה, כיוון, חתימה)'),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'שפה'), langSel),
          h('label', { class: 'field' }, h('span', {}, 'כיוון ברירת מחדל'), dirSel),
          h('label', { class: 'field' }, h('span', {}, 'חתימת הנהלה'), sigSel),
          h('label', { class: 'field-check', style: 'align-self:end' }, reqSig, h('span', {}, '✍️ דרישת חתימת לקוח')))),
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
    drawFields();
  }

  await reload();
}
