// Tab 4 — חוזים / הצעות מחיר: a structured proposal builder styled like the
// KOLOT PDF — header + sections (title + product + details) + fill-in fields
// (each optionally client-editable) + closing terms + signatures. The client
// sees it in the portal (portal.js) and can approve/sign; a PDF is generated
// on their device on signing.
import { get, post, patch, del } from '../api.js';
import { h, toast, modal, confirmModal, fmtMoney, skeletonTable, withBusy, comboBox, debounce } from '../ui.js';

const STATUS_LABELS = {
  draft: ['טיוטה', 'stage'], sent: ['נשלח ללקוח', 'stage-form'],
  client_signed: ['נחתם ע"י הלקוח', 'status-win'], completed: ['הושלם ✓', 'status-win'],
  cancelled: ['בוטל', 'status-lost'],
};

// quick-insert lead variables for the terms text
const LEAD_VARS = [
  ['name', 'שם הליד'], ['contact_name', 'איש קשר'], ['event_date', 'תאריך אירוע'],
  ['event_location', 'מיקום'], ['event_type', 'סוג אירוע'], ['email', 'מייל'],
  ['phone1', 'טלפון'], ['id_number', 'ת"ז'], ['address', 'כתובת'],
  ['final_price', 'מחיר סופי'], ['base_price', 'מחיר בסיס'],
  ['package_type', 'שם החבילה'], ['today', 'תאריך היום'],
];

// lead columns a fill-in field can be bound to (must match the backend whitelist)
const LEAD_BIND = [
  ['contact_name', 'שם איש קשר'], ['id_number', 'ת"ז'], ['address', 'כתובת'],
  ['email', 'מייל'], ['phone1', 'טלפון'], ['phone2', 'טלפון נוסף'],
  ['event_date', 'תאריך אירוע'], ['event_location', 'מיקום'], ['event_type', 'סוג אירוע'],
];

const randKey = () => 'f_' + Math.random().toString(36).slice(2, 8);

export async function renderContractsTab(view) {
  const host = h('div', {});
  view.append(host);
  host.append(skeletonTable(6));
  let contracts = [], leads = [], packages = [], products = [], signatures = [];

  async function reload() {
    [{ contracts }, { leads }, { packages }, { products }, { signatures }] = await Promise.all([
      get('/contracts'), get('/leads'), get('/packages'), get('/products'), get('/settings/signatures'),
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
      h('td', {},
        c.management_signed_at ? '🖋️ הנהלה ' : '', c.client_signed_at ? '✍️ לקוח' : ''),
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

  // ---- editor ----
  function openEditor(contract) {
    let c = contract;
    c.header = c.header || {};
    c.sections = Array.isArray(c.sections) ? c.sections : [];
    c.fields = Array.isArray(c.fields) ? c.fields : [];

    const title = h('input', { type: 'text', value: c.title });

    // ---------- header (couple / intro) ----------
    const headTitle = h('input', { type: 'text', value: c.header.title || '', placeholder: 'כותרת ההצעה (למשל: החתונה של אליה ואלישע)' });
    const headIntro = h('textarea', { rows: 3, value: c.header.intro || '', placeholder: 'פסקת פתיחה (אפשר להשתמש ב-{{...}})' });
    const saveHeader = debounce(async () => {
      await patch(`/contracts/${c.id}`, { header: { title: headTitle.value, intro: headIntro.value } });
      c.header = { title: headTitle.value, intro: headIntro.value };
    }, 500);
    headTitle.addEventListener('input', saveHeader);
    headIntro.addEventListener('input', saveHeader);

    // ---------- package selector ----------
    const pkgSel = comboBox(
      packages.map(p => ({ value: p.id, label: `${p.name} · ${fmtMoney(p.base_price)}` })),
      { value: c.package_id || '', placeholder: '🔍 חיפוש חבילה…', empty: '— ללא חבילה —' });
    const pkgDrop = h('div', { class: 'dropzone', style: 'min-height:46px' },
      h('div', { class: 'dz-title' }, '📦 בחירה מהירה — לחצו על חבילה, או חפשו למעלה'),
      ...packages.map(p => h('span', {
        class: 'var-chip',
        onclick: async () => { pkgSel.set(p.id); await savePkg(p.id); },
      }, p.name)));
    pkgSel.el.addEventListener('change', () => savePkg(pkgSel.get() || null));
    async function savePkg(id) {
      ({ contract: c } = await patch(`/contracts/${c.id}`, { package_id: id }));
      c.header = c.header || {}; c.sections = c.sections || []; c.fields = c.fields || [];
      priceLine.textContent = priceText();
      toast('החבילה עודכנה ✓', 'success');
    }

    // ---------- sections builder (title + product + details) ----------
    const sectionsBox = h('div', { class: 'sections-box' });
    const saveSections = debounce(() => patch(`/contracts/${c.id}`, { sections: c.sections }), 500);

    function drawSections() {
      sectionsBox.innerHTML = '';
      if (!c.sections.length) {
        sectionsBox.append(h('p', { class: 'muted' }, 'אין סקשנים עדיין — הוסיפו סקשן כמו "קבלת פנים · רביעיית כנרים · פירוט".'));
      }
      c.sections.forEach((s, idx) => sectionsBox.append(sectionRow(s, idx)));
      sectionsBox.append(h('button', { class: 'btn sm primary mt', onclick: addSection }, '➕ הוספת סקשן'));
    }

    function sectionRow(s, idx) {
      const t = h('input', { type: 'text', value: s.title || '', placeholder: 'כותרת (למשל: קבלת פנים)' });
      const prod = comboBox(products.map(p => ({ value: p.id, label: p.name })),
        { value: s.product_id || '', placeholder: '🔍 מוצר…', empty: '— ללא מוצר —' });
      const details = h('textarea', { rows: 2, value: s.details || '', placeholder: 'פירוט (למשל: רביעיית כנרים קלאסית באווירה אינטימית שתדהים את האורחים)' });
      const commit = () => { s.title = t.value; s.product_id = prod.get() || null; s.details = details.value; saveSections(); };
      t.addEventListener('input', debounce(commit, 500));
      details.addEventListener('input', debounce(commit, 500));
      prod.el.addEventListener('change', () => {
        const p = products.find(x => x.id === prod.get());
        if (p && !details.value.trim()) details.value = p.description || '';
        commit();
      });
      const move = (dir) => {
        const j = idx + dir;
        if (j < 0 || j >= c.sections.length) return;
        [c.sections[idx], c.sections[j]] = [c.sections[j], c.sections[idx]];
        saveSections(); drawSections();
      };
      return h('div', { class: 'section-edit' },
        h('div', { class: 'flex between' },
          h('span', { class: 'muted', style: 'font-weight:700' }, `סקשן ${idx + 1}`),
          h('div', { class: 'row-actions' },
            h('button', { class: 'icon-btn', title: 'למעלה', onclick: () => move(-1) }, '↑'),
            h('button', { class: 'icon-btn', title: 'למטה', onclick: () => move(1) }, '↓'),
            h('button', {
              class: 'icon-btn', title: 'מחיקת סקשן', onclick: () => {
                c.sections.splice(idx, 1); saveSections(); drawSections();
              },
            }, '🗑️'))),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'כותרת'), t),
          h('label', { class: 'field' }, h('span', {}, 'מוצר (אופציונלי)'), prod.el)),
        h('label', { class: 'field' }, h('span', {}, 'פירוט'), details));
    }

    function addSection() {
      c.sections.push({ id: randKey(), title: '', product_id: null, details: '' });
      saveSections(); drawSections();
    }

    // ---------- fill-in fields (each optionally client-editable) ----------
    const fieldsBox = h('div', { class: 'fields-box' });
    const saveFields = debounce(() => patch(`/contracts/${c.id}`, { fields: c.fields }), 500);

    function drawFields() {
      fieldsBox.innerHTML = '';
      if (!c.fields.length) {
        fieldsBox.append(h('p', { class: 'muted' }, 'שדות למילוי בהצעה. סמנו "ניתן לעריכה ע"י הלקוח" כדי לאפשר ללקוח לעדכן — והערך יתעדכן אוטומטית במערכת.'));
      }
      c.fields.forEach((f, idx) => fieldsBox.append(fieldRow(f, idx)));
      fieldsBox.append(h('button', { class: 'btn sm primary mt', onclick: addField }, '➕ שדה חדש'));
    }

    function fieldRow(f, idx) {
      const label = h('input', { type: 'text', value: f.label || '', placeholder: 'תווית (למשל: ת"ז מזמין)' });
      const sourceSel = h('select', {},
        h('option', { value: 'custom', selected: f.source !== 'lead' }, 'ערך קבוע'),
        h('option', { value: 'lead', selected: f.source === 'lead' }, 'שדה מהמערכת (ליד)'));
      const valueInput = h('input', { type: 'text', value: f.value || '', placeholder: 'ערך' });
      const leadSel = h('select', {}, ...LEAD_BIND.map(([col, lbl]) =>
        h('option', { value: col, selected: (f.lead_field || 'contact_name') === col }, lbl)));
      const clientEdit = h('input', { type: 'checkbox', checked: !!f.client_editable });

      const valWrap = h('label', { class: 'field' }, h('span', {}, 'ערך'), valueInput);
      const leadWrap = h('label', { class: 'field' }, h('span', {}, 'שדה מהמערכת'), leadSel);
      const syncVis = () => {
        const isLead = sourceSel.value === 'lead';
        valWrap.style.display = isLead ? 'none' : '';
        leadWrap.style.display = isLead ? '' : 'none';
      };
      syncVis();

      const commit = () => {
        f.label = label.value;
        f.source = sourceSel.value;
        f.value = valueInput.value;
        f.lead_field = leadSel.value;
        f.client_editable = clientEdit.checked;
        if (f.source === 'lead') f.key = leadSel.value;   // {{event_date}} etc.
        else if (!f.key || LEAD_BIND.some(([col]) => col === f.key)) f.key = randKey();
        saveFields();
        chip.textContent = f.label || f.key;
      };
      label.addEventListener('input', debounce(commit, 500));
      valueInput.addEventListener('input', debounce(commit, 500));
      sourceSel.addEventListener('change', () => { syncVis(); commit(); });
      leadSel.addEventListener('change', commit);
      clientEdit.addEventListener('change', commit);

      const chip = h('span', {
        class: 'var-chip', title: 'הוספה בנקודת הסמן בטקסט התנאים',
        onclick: () => insertVar(f.key),
      }, f.label || f.key);

      return h('div', { class: 'section-edit' },
        h('div', { class: 'flex between' },
          h('div', { class: 'flex' }, chip),
          h('button', {
            class: 'icon-btn', title: 'מחיקת שדה', onclick: () => {
              c.fields.splice(idx, 1); saveFields(); drawFields();
            },
          }, '🗑️')),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'תווית'), label),
          h('label', { class: 'field' }, h('span', {}, 'מקור'), sourceSel),
          valWrap, leadWrap),
        h('label', { class: 'field-check' }, clientEdit, h('span', {}, '✏️ ניתן לעריכה ע"י הלקוח (יעדכן את המערכת)')));
    }

    function addField() {
      c.fields.push({ id: randKey(), key: randKey(), label: '', source: 'custom', lead_field: 'contact_name', value: '', client_editable: false });
      saveFields(); drawFields();
    }

    // ---------- closing terms (rich text) with caret-aware variable insert ----------
    const editor = h('div', { class: 'rte-editor', contenteditable: 'true', html: c.body_html });
    let savedRange = null;
    const rememberRange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0);
    };
    ['keyup', 'mouseup', 'input', 'blur'].forEach(ev => editor.addEventListener(ev, rememberRange));
    function insertVar(key) {
      editor.focus();
      const sel = window.getSelection();
      // restore the caret to where it last was inside the editor (fixes always-inserting-at-top)
      if (savedRange && editor.contains(savedRange.startContainer)) {
        sel.removeAllRanges(); sel.addRange(savedRange);
      }
      document.execCommand('insertText', false, `{{${key}}}`);
      rememberRange();
    }

    const exec = (cmd, val = null) => { editor.focus(); document.execCommand(cmd, false, val); rememberRange(); };
    const tbtn = (label, tt, fn) => h('button', { type: 'button', title: tt, onclick: fn }, label);
    const toolbar = h('div', { class: 'rte-toolbar' },
      tbtn('B', 'מודגש', () => exec('bold')),
      tbtn('I', 'נטוי', () => exec('italic')),
      tbtn('U', 'קו תחתון', () => exec('underline')),
      tbtn('H3', 'כותרת', () => exec('formatBlock', 'h3')),
      tbtn('¶', 'פסקה', () => exec('formatBlock', 'p')),
      tbtn('• רשימה', 'רשימה', () => exec('insertUnorderedList')),
      tbtn('1. רשימה', 'רשימה ממוספרת', () => exec('insertOrderedList')),
      tbtn('⇐', 'יישור לימין', () => exec('justifyRight')),
      tbtn('⇔', 'מרכוז', () => exec('justifyCenter')),
      tbtn('⇒', 'יישור לשמאל', () => exec('justifyLeft')),
      tbtn('␡ ניקוי', 'הסרת עיצוב', () => exec('removeFormat')));

    const legacyExtras = (c.extra_fields || []);
    const varsBox = h('div', { class: 'mt' },
      h('span', { class: 'muted' }, 'הזרקת שדות מהליד (בנקודת הסמן): '),
      ...LEAD_VARS.map(([k, lbl]) => h('span', { class: 'var-chip', onclick: () => insertVar(k) }, lbl)),
      ...legacyExtras.map(f => h('span', {
        class: 'var-chip', style: 'border-color:var(--warn);color:var(--warn)',
        onclick: () => insertVar(f.key),
      }, f.label || f.key)));

    // ---------- management signature + client-signature toggle ----------
    const sigSel = h('select', {},
      h('option', { value: '' }, '— בחר חתימת הנהלה —'),
      ...signatures.map(s => h('option', { value: s.id, selected: c.management_signature_id === s.id }, s.name)));
    sigSel.addEventListener('change', async () => {
      ({ contract: c } = await patch(`/contracts/${c.id}`, { management_signature_id: sigSel.value || null }));
      c.header = c.header || {}; c.sections = c.sections || []; c.fields = c.fields || [];
      toast('חתימת ההנהלה עודכנה ✓', 'success');
    });

    const reqSig = h('input', { type: 'checkbox', checked: c.require_client_signature !== false });
    reqSig.addEventListener('change', async () => {
      await patch(`/contracts/${c.id}`, { require_client_signature: reqSig.checked });
      c.require_client_signature = reqSig.checked;
      toast(reqSig.checked ? 'הלקוח יידרש לחתום' : 'הלקוח יאשר ללא חתימה', 'success');
    });

    const priceText = () => `מחיר בסיס: ${fmtMoney(c.base_price)} · מחיר סופי (כולל תוספות שנבחרו): ${fmtMoney(c.final_price)}`;
    const priceLine = h('p', { class: 'muted' }, priceText());

    const sendEmail = h('input', { type: 'email', dir: 'ltr', placeholder: c.lead?.email || 'מייל הלקוח', value: c.lead?.email || '' });

    modal(`עריכת הצעה — ${c.lead?.name || ''}`, h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'כותרת פנימית'), title),

      h('h4', {}, '🎩 כותרת ההצעה (מה שהלקוח רואה למעלה)'),
      h('label', { class: 'field' }, h('span', {}, 'כותרת ראשית'), headTitle),
      h('label', { class: 'field' }, h('span', {}, 'פסקת פתיחה'), headIntro),

      h('div', { class: 'grid-2 mt' },
        h('label', { class: 'field' }, h('span', {}, 'חבילה'), pkgSel.el),
        h('label', { class: 'field' }, h('span', {}, 'חתימת הנהלה'), sigSel)),
      pkgDrop, priceLine,

      h('h4', {}, '🎼 סקשנים (כמו ב-PDF: כותרת · מוצר · פירוט)'),
      sectionsBox,

      h('h4', { class: 'mt' }, '📝 שדות למילוי'),
      fieldsBox,

      h('h4', { class: 'mt' }, '📜 תנאים / טקסט סיום'),
      toolbar, editor, varsBox,

      h('label', { class: 'field-check mt' }, reqSig, h('span', {}, '✍️ דרישת חתימת לקוח (בטלו כדי שהלקוח יאשר ללא חתימה)')),

      h('div', { class: 'card mt', style: 'padding:12px' },
        h('div', { class: 'flex', style: 'flex-wrap:wrap' },
          h('span', {}, '📧 שליחה ללקוח:'), sendEmail,
          h('button', {
            class: 'btn primary', onclick: withBusy(async () => {
              await saveAll();
              const rsp = await post(`/contracts/${c.id}/send`, { email: sendEmail.value || undefined });
              navigator.clipboard?.writeText(rsp.portal_link);
              toast(`ההצעה נשלחה ✓ הקישור הועתק: ${rsp.portal_link}`, 'success');
              reload();
            }),
          }, 'שליחה ללקוח'),
          h('a', { class: 'btn', href: `/portal.html?t=${c.client_token}`, target: '_blank' }, '👁️ תצוגה מקדימה')))), {
      wide: true,
      actions: [
        {
          label: '💾 שמירה', kind: 'primary', onclick: async (close) => {
            await saveAll();
            toast('ההצעה נשמרה ✓', 'success');
            close(); reload();
          },
        },
        { label: 'סגירה', onclick: (close) => { close(); reload(); } },
      ],
    });

    drawSections();
    drawFields();

    async function saveAll() {
      ({ contract: c } = await patch(`/contracts/${c.id}`, {
        title: title.value, body_html: editor.innerHTML,
        header: { title: headTitle.value, intro: headIntro.value },
        sections: c.sections, fields: c.fields,
      }));
      c.header = c.header || {}; c.sections = c.sections || []; c.fields = c.fields || [];
    }
  }

  await reload();
}
