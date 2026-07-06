// Tab 4 — חוזים: attach a contract to a lead, drag a package into it,
// RTL rich-text editor with {{variable}} injection + custom fields,
// management signature, and sending to the client portal.
import { get, post, patch, del } from '../api.js';
import { h, toast, modal, confirmModal, fmtMoney, fmtDate, skeletonTable, withBusy } from '../ui.js';

const STATUS_LABELS = {
  draft: ['טיוטה', 'stage'], sent: ['נשלח ללקוח', 'stage-form'],
  client_signed: ['נחתם ע"י הלקוח', 'status-win'], completed: ['הושלם ✓', 'status-win'],
  cancelled: ['בוטל', 'status-lost'],
};

const LEAD_VARS = [
  ['name', 'שם הליד'], ['contact_name', 'איש קשר'], ['event_date', 'תאריך אירוע'],
  ['event_location', 'מיקום'], ['event_type', 'סוג אירוע'], ['email', 'מייל'],
  ['phone1', 'טלפון'], ['final_price', 'מחיר סופי'], ['base_price', 'מחיר בסיס'],
  ['package_type', 'שם החבילה'], ['today', 'תאריך היום'],
];

export async function renderContractsTab(view) {
  const host = h('div', {});
  view.append(host);
  host.append(skeletonTable(6));
  let contracts = [], leads = [], packages = [], signatures = [];

  async function reload() {
    [{ contracts }, { leads }, { packages }, { signatures }] = await Promise.all([
      get('/contracts'), get('/leads'), get('/packages'), get('/settings/signatures'),
    ]);
    draw();
  }

  function draw() {
    host.innerHTML = '';
    host.append(
      h('div', { class: 'board-toolbar' },
        h('h2', { style: 'margin:0' }, 'חוזים'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn primary', onclick: openNew }, '+ חוזה חדש')),
      contracts.length ? h('div', { class: 'table-wrap' },
        h('table', { class: 'board', style: 'min-width:900px' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'כותרת'), h('th', {}, 'ליד'), h('th', {}, 'חבילה'),
            h('th', {}, 'מחיר סופי'), h('th', {}, 'סטטוס'), h('th', {}, 'חתימות'), h('th', {}, ''))),
          h('tbody', {}, ...contracts.map(row))))
        : h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '📄'), h('p', {}, 'אין חוזים עדיין')));
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
            if (!await confirmModal('מחיקת חוזה', `למחוק את "${c.title}"?`)) return;
            await del(`/contracts/${c.id}`);
            reload();
          },
        }, '🗑️'))));
  }

  // ---- create ----
  function openNew() {
    const leadSel = h('select', {}, ...leads.map(l => h('option', { value: l.id }, `${l.name} (${l.sale_status})`)));
    const pkgSel = h('select', {}, h('option', { value: '' }, '— ללא חבילה בשלב זה —'),
      ...packages.map(p => h('option', { value: p.id }, `${p.name} · ${fmtMoney(p.base_price)}`)));
    if (!leads.length) { toast('אין לידים — צרו ליד קודם', 'error'); return; }
    modal('חוזה חדש', h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'שיוך לליד (מעקב זוגות) *'), leadSel),
      h('label', { class: 'field' }, h('span', {}, 'חבילה'), pkgSel)), {
      actions: [
        {
          label: 'יצירה ועריכה', kind: 'primary', onclick: async (close) => {
            const { contract } = await post('/contracts', { lead_id: leadSel.value, package_id: pkgSel.value || null });
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
    const title = h('input', { type: 'text', value: c.title });

    // package selector + drag & drop target
    const pkgSel = h('select', {},
      h('option', { value: '' }, '— בחר חבילה —'),
      ...packages.map(p => h('option', { value: p.id, selected: c.package_id === p.id }, `${p.name} · ${fmtMoney(p.base_price)}`)));
    const pkgDrop = h('div', { class: 'dropzone', style: 'min-height:46px' },
      h('div', { class: 'dz-title' }, '📦 גררו לכאן חבילה מהרשימה, או בחרו למעלה'),
      ...packages.map(p => h('span', {
        class: 'var-chip', draggable: true,
        ondragstart: (e) => e.dataTransfer.setData('pkg', p.id),
      }, p.name)));
    pkgDrop.addEventListener('dragover', (e) => { e.preventDefault(); pkgDrop.classList.add('over'); });
    pkgDrop.addEventListener('dragleave', () => pkgDrop.classList.remove('over'));
    pkgDrop.addEventListener('drop', async (e) => {
      e.preventDefault(); pkgDrop.classList.remove('over');
      const id = e.dataTransfer.getData('pkg');
      if (id) { pkgSel.value = id; await savePkg(id); }
    });
    pkgSel.addEventListener('change', () => savePkg(pkgSel.value || null));
    async function savePkg(id) {
      ({ contract: c } = await patch(`/contracts/${c.id}`, { package_id: id }));
      priceLine.textContent = priceText();
      toast('החבילה עודכנה ✓', 'success');
    }

    // rich text editor
    const editor = h('div', { class: 'rte-editor', contenteditable: 'true', html: c.body_html });
    const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); editor.focus(); };
    const tbtn = (label, title, fn) => h('button', { type: 'button', title, onclick: fn }, label);
    const toolbar = h('div', { class: 'rte-toolbar' },
      tbtn('B', 'מודגש', () => exec('bold')),
      tbtn('I', 'נטוי', () => exec('italic')),
      tbtn('U', 'קו תחתון', () => exec('underline')),
      tbtn('H2', 'כותרת', () => exec('formatBlock', 'h2')),
      tbtn('H3', 'כותרת משנה', () => exec('formatBlock', 'h3')),
      tbtn('¶', 'פסקה', () => exec('formatBlock', 'p')),
      tbtn('• רשימה', 'רשימה', () => exec('insertUnorderedList')),
      tbtn('1. רשימה', 'רשימה ממוספרת', () => exec('insertOrderedList')),
      tbtn('⇐', 'יישור לימין', () => exec('justifyRight')),
      tbtn('⇔', 'מרכוז', () => exec('justifyCenter')),
      tbtn('⇒', 'יישור לשמאל', () => exec('justifyLeft')),
      tbtn('␡ ניקוי', 'הסרת עיצוב', () => exec('removeFormat')));

    // variable chips
    const varsBox = h('div', { class: 'mt' },
      h('span', { class: 'muted' }, 'הזרקת שדות מהליד (לחצו להוספה בנקודת הסמן): '),
      ...LEAD_VARS.map(([k, lbl]) => h('span', {
        class: 'var-chip',
        onclick: () => { editor.focus(); document.execCommand('insertText', false, `{{${k}}}`); },
      }, lbl)),
      ...(c.extra_fields || []).map(f => h('span', {
        class: 'var-chip', style: 'border-color:var(--warn);color:var(--warn)',
        onclick: () => { editor.focus(); document.execCommand('insertText', false, `{{${f.key}}}`); },
      }, f.label || f.key)),
      h('span', {
        class: 'var-chip', style: 'border-style:dashed',
        onclick: () => addExtraField(),
      }, '+ שדה חדש'));

    function addExtraField() {
      const key = h('input', { type: 'text', placeholder: 'מפתח (באנגלית, למשל: parking_info)', dir: 'ltr' });
      const label = h('input', { type: 'text', placeholder: 'תווית' });
      const value = h('input', { type: 'text', placeholder: 'ערך למילוי בחוזה' });
      modal('שדה מותאם חדש לחוזה', h('div', {},
        h('label', { class: 'field' }, key), h('label', { class: 'field' }, label), h('label', { class: 'field' }, value)), {
        actions: [{
          label: 'הוספה', kind: 'primary', onclick: async (close) => {
            const k = key.value.trim().replace(/\W+/g, '_');
            if (!k) { toast('מפתח חובה', 'error'); return false; }
            const extra = [...(c.extra_fields || []), { key: k, label: label.value || k, value: value.value }];
            ({ contract: c } = await patch(`/contracts/${c.id}`, { extra_fields: extra }));
            close();
            editor.focus();
            document.execCommand('insertText', false, `{{${k}}}`);
            toast('השדה נוסף ✓', 'success');
          },
        }, { label: 'ביטול', onclick: (close) => close() }],
      });
    }

    // management signature
    const sigSel = h('select', {},
      h('option', { value: '' }, '— בחר חתימת הנהלה —'),
      ...signatures.map(s => h('option', { value: s.id, selected: c.management_signature_id === s.id }, s.name)));
    sigSel.addEventListener('change', async () => {
      ({ contract: c } = await patch(`/contracts/${c.id}`, { management_signature_id: sigSel.value || null }));
      toast('חתימת ההנהלה עודכנה ✓', 'success');
    });

    const priceText = () => `מחיר בסיס: ${fmtMoney(c.base_price)} · מחיר סופי (כולל תוספות שנבחרו): ${fmtMoney(c.final_price)}`;
    const priceLine = h('p', { class: 'muted' }, priceText());

    const sendEmail = h('input', { type: 'email', dir: 'ltr', placeholder: c.lead?.email || 'מייל הלקוח', value: c.lead?.email || '' });

    modal(`עריכת חוזה — ${c.lead?.name || ''}`, h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'כותרת החוזה'), title),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'חבילה'), pkgSel),
        h('label', { class: 'field' }, h('span', {}, 'חתימת הנהלה'), sigSel)),
      pkgDrop, priceLine,
      h('h4', {}, 'תוכן החוזה (RTL מלא)'),
      toolbar, editor, varsBox,
      h('div', { class: 'card mt', style: 'padding:12px' },
        h('div', { class: 'flex', style: 'flex-wrap:wrap' },
          h('span', {}, '📧 שליחה ללקוח:'), sendEmail,
          h('button', {
            class: 'btn primary', onclick: withBusy(async () => {
              await saveAll();
              const rsp = await post(`/contracts/${c.id}/send`, { email: sendEmail.value || undefined });
              navigator.clipboard?.writeText(rsp.portal_link);
              toast(`החוזה נשלח ✓ הקישור הועתק: ${rsp.portal_link}`, 'success');
              reload();
            }),
          }, 'שליחה ללקוח'),
          h('a', { class: 'btn', href: `/portal.html?t=${c.client_token}`, target: '_blank' }, '👁️ תצוגה מקדימה')))), {
      wide: true,
      actions: [
        {
          label: '💾 שמירה', kind: 'primary', onclick: async (close) => {
            await saveAll();
            toast('החוזה נשמר ✓', 'success');
            close(); reload();
          },
        },
        { label: 'סגירה', onclick: (close) => { close(); reload(); } },
      ],
    });

    async function saveAll() {
      ({ contract: c } = await patch(`/contracts/${c.id}`, {
        title: title.value, body_html: editor.innerHTML,
      }));
    }
  }

  await reload();
}
