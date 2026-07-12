// Tab 1 — מעקב זוגות: Monday-style board with inline autosave editing,
// search/filter/sort, pipelines (open/win/lost), merge, contacts, updates
// thread, voice-note AI capture and Google Calendar sync.
import { get, post, patch, del, upload } from '../api.js';
import { h, toast, modal, confirmModal, debounce, fmtMoney, fmtDate, skeletonTable, withBusy } from '../ui.js';
import { openImportWizard } from './import.js';

const PAGE_SIZE = 100;

const RELATIONS = ['כלה', 'חתן', 'הורה', 'מפיק/ה', 'אחר'];
const STAGES = ['לקוח חדש ידני', 'לקוח משאלון'];
const EVENT_TYPES = ['חתונה', 'בר/בת מצווה', 'אירוע חברה', 'אחר'];
const HEAR = ['Instagram', 'Youtube', 'ניגנתם אצל חברים', 'המלצה', 'גוגל', 'אחר'];
const NEXT_ACTIONS = ['עוד פרטים', 'לקבוע פגישה', 'לשלוח הצעת מחיר', 'לשלוח חוזה', 'מעקב', 'אין פעולה'];
const SOURCES = { manual: 'ידני', form: 'טופס', webhook: 'אתר', whatsapp: 'וואטסאפ', voice: 'הקלטה' };

let ctx = null; // { view, state, leads, competitors, pipeline, search, sort, filters }

export async function renderLeadsTab(view, state) {
  ctx = {
    view, state, leads: [], competitors: [],
    pipeline: 'open', search: '', sort: { col: 'event_date', asc: true }, filters: {},
    limit: PAGE_SIZE,
  };
  const skel = h('div', {}, skeletonTable(10));
  view.append(skel);
  await reload(false);
  skel.remove();
  draw();
}

// reset pagination whenever the visible set changes (pipeline/search/filter/sort)
function resetPaging() { ctx.limit = PAGE_SIZE; }

async function reload(redraw = true) {
  const [{ leads }, { competitors }] = await Promise.all([
    get('/leads'), get('/leads/meta/competitors'),
  ]);
  ctx.leads = leads;
  ctx.competitors = competitors;
  if (redraw) draw();
}

// ---------------- columns ----------------
function columns() {
  const team = ctx.state.team;
  return [
    { key: 'name', label: 'שם', type: 'text', width: 190 },
    { key: 'contact_name', label: 'איש קשר', type: 'text' },
    { key: 'contacts', label: 'אנשי קשר נוספים', type: 'contacts' },
    { key: 'owner_id', label: 'בטיפול', type: 'select', options: team.map(t => [t.id, t.full_name || t.email]) },
    { key: 'relation', label: 'קרבה', type: 'select', options: RELATIONS.map(r => [r, r]), chip: 'relation' },
    { key: 'event_type', label: 'סוג אירוע', type: 'select', options: EVENT_TYPES.map(x => [x, x]) },
    { key: 'event_date', label: 'תאריך אירוע', type: 'date' },
    { key: 'event_location', label: 'מיקום האירוע', type: 'text' },
    { key: 'phone1', label: 'טלפון 1', type: 'tel' },
    { key: 'phone2', label: 'טלפון 2', type: 'tel' },
    { key: 'email', label: 'מייל', type: 'email' },
    { key: 'proposed_price', label: 'מחיר שהוצע', type: 'number' },
    { key: 'stage', label: 'שלב', type: 'select', options: STAGES.map(x => [x, x]), chip: 'stage' },
    { key: 'sale_status', label: 'סטאטוס מכירה', type: 'status' },
    { key: 'next_action', label: 'פעולה הבאה', type: 'select', options: NEXT_ACTIONS.map(x => [x, x]) },
    { key: 'team', label: 'צוות', type: 'text' },
    { key: 'hear_about_us', label: 'איך שמעו עלינו', type: 'select', options: HEAR.map(x => [x, x]) },
    { key: 'referrer', label: 'מי המליץ', type: 'text' },
    { key: 'came_to_see_event', label: 'באו לראות באירוע', type: 'text' },
    { key: 'seen_at_date', label: 'הגיעו בתאריך', type: 'date' },
    { key: 'seen_at_place', label: 'מקום שראו', type: 'text' },
    { key: 'first_contact_date', label: 'תאריך התקשרות', type: 'date' },
    { key: 'close_date', label: 'תאריך סגירה', type: 'date' },
    { key: 'package_type', label: 'סוג חבילה', type: 'text' },
    { key: 'date_status', label: 'סטטוס תאריך', type: 'text' },
    { key: 'lost_reason', label: 'למה לא?', type: 'text', lostOnly: true },
    { key: 'lost_competitor', label: 'מתחרה שזכה', type: 'text', lostOnly: true },
    { key: 'source', label: 'מקור', type: 'readonly', render: (l) => h('span', { class: 'chip source' }, SOURCES[l.source] || l.source) },
  ];
}

// ---------------- filtering / sorting ----------------
function visibleLeads() {
  let rows = ctx.leads;
  if (ctx.pipeline !== 'all') rows = rows.filter(l => l.sale_status === ctx.pipeline);
  const q = ctx.search.trim().toLowerCase();
  if (q) {
    rows = rows.filter(l => Object.values(l).some(v =>
      typeof v === 'string' && v.toLowerCase().includes(q)) ||
      (l.contacts || []).some(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)));
  }
  for (const [key, val] of Object.entries(ctx.filters)) {
    if (val === '' || val === null) continue;
    rows = rows.filter(l => String(l[key] ?? '') === String(val));
  }
  const { col, asc } = ctx.sort;
  if (col) {
    rows = [...rows].sort((a, b) => {
      const x = a[col], y = b[col];
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      const nx = Number(x), ny = Number(y);
      const cmp = (!isNaN(nx) && !isNaN(ny)) ? nx - ny : String(x).localeCompare(String(y), 'he');
      return asc ? cmp : -cmp;
    });
  }
  return rows;
}

// ---------------- Excel-compatible CSV import / export ----------------
// Export uses UTF-8 CSV with a BOM so Excel opens Hebrew correctly.
// Import is handled by the Monday-style wizard in ./import.js (supports .xlsx too).
const CSV_SKIP_TYPES = ['contacts', 'readonly'];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const cols = columns().filter(c => !CSV_SKIP_TYPES.includes(c.type));
  const statusLabels = { open: 'צינור ראשי', win: 'WIN', lost: 'LOST' };
  const header = cols.map(c => c.label);
  const rows = visibleLeads().map(l => cols.map(c => {
    if (c.type === 'status') return statusLabels[l[c.key]] || l[c.key] || '';
    if (c.type === 'select') {
      const opt = (c.options || []).find(([v]) => String(v) === String(l[c.key]));
      return opt ? opt[1] : (l[c.key] ?? '');
    }
    return l[c.key] ?? '';
  }));
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `zooglot-leads-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`יוצאו ${rows.length} לידים ✓`, 'success');
}

// ---------------- main draw ----------------
function draw() {
  const host = ctx.view.querySelector('#leads-host') || h('div', { id: 'leads-host' });
  if (!host.parentNode) ctx.view.append(host);

  // preserve focus/cursor on the search box across re-renders (it's rebuilt every draw())
  const prevSearch = host.querySelector('input[type="search"]');
  const hadFocus = prevSearch && document.activeElement === prevSearch;
  const selStart = hadFocus ? prevSearch.selectionStart : null;
  const selEnd = hadFocus ? prevSearch.selectionEnd : null;

  host.innerHTML = '';

  const counts = { open: 0, win: 0, lost: 0 };
  for (const l of ctx.leads) counts[l.sale_status] = (counts[l.sale_status] || 0) + 1;

  const searchInput = h('input', {
    type: 'search', placeholder: '🔍 חיפוש בכל השדות…', value: ctx.search,
    oninput: debounce((e) => { ctx.search = e.target.value; resetPaging(); draw(); }, 250),
  });

  const toolbar = h('div', { class: 'board-toolbar' },
    h('div', { class: 'pipeline-tabs' },
      pipeBtn('open', `צינור ראשי (${counts.open})`),
      pipeBtn('win', `WIN (${counts.win})`),
      pipeBtn('lost', `LOST (${counts.lost})`),
      pipeBtn('all', 'הכל')),
    searchInput,
    h('div', { class: 'toolbar-actions' },
      filterControl(),
      h('button', { class: 'btn sm', onclick: openVoiceModal }, '🎙️ ליד מהקלטה'),
      h('button', { class: 'btn sm', onclick: openMergePicker }, '🔀 מיזוג כפולים'),
      h('button', { class: 'btn sm', onclick: exportCsv }, '⬇️ ייצוא לאקסל'),
      h('button', { class: 'btn sm', onclick: () => openImportWizard(() => reload()) }, '⬆️ ייבוא מאקסל'),
      h('button', { class: 'btn sm primary', onclick: openNewLead }, '+ ליד חדש')),
  );

  if (hadFocus) {
    // restore after the new input is in the DOM
    requestAnimationFrame(() => {
      searchInput.focus();
      try { searchInput.setSelectionRange(selStart, selEnd); } catch { /* ignore */ }
    });
  }

  const rows = visibleLeads();
  const shown = rows.slice(0, ctx.limit);
  host.append(toolbar);

  if (!rows.length) {
    host.append(h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '🎷'), h('p', {}, 'אין לידים בתצוגה הזו')));
    return;
  }

  host.append(h('div', { class: 'table-wrap' }, buildTable(shown)));

  // infinite scroll: reveal 100 more rows as the sentinel comes into view
  if (rows.length > shown.length) {
    const remaining = rows.length - shown.length;
    const sentinel = h('div', {
      class: 'muted', style: 'text-align:center;padding:16px',
    }, `מציג ${shown.length} מתוך ${rows.length} — גללו לטעינת ${Math.min(PAGE_SIZE, remaining)} נוספים…`);
    host.append(sentinel);
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { io.disconnect(); ctx.limit += PAGE_SIZE; draw(); }
    }, { rootMargin: '400px' });
    io.observe(sentinel);
  } else if (rows.length > PAGE_SIZE) {
    host.append(h('div', { class: 'muted', style: 'text-align:center;padding:12px' }, `סה"כ ${rows.length} לידים`));
  }
}

function pipeBtn(status, label) {
  return h('button', {
    class: ctx.pipeline === status ? 'active' : '',
    dataset: { status },
    onclick: () => { ctx.pipeline = status; resetPaging(); draw(); },
  }, label);
}

function filterControl() {
  const filterable = columns().filter(c => c.type === 'select' || c.type === 'status');
  const active = Object.keys(ctx.filters).filter(k => ctx.filters[k] !== '').length;
  return h('button', {
    class: 'btn', onclick: () => {
      const body = h('div', {},
        ...filterable.map(c => {
          const opts = c.type === 'status'
            ? [['open', 'צינור ראשי'], ['win', 'WIN'], ['lost', 'LOST']]
            : c.options;
          return h('label', { class: 'field' }, h('span', {}, c.label),
            h('select', {
              onchange: (e) => { ctx.filters[c.key] = e.target.value; },
            },
              h('option', { value: '' }, '— הכל —'),
              ...opts.map(([v, t]) => h('option', { value: v, selected: String(ctx.filters[c.key] ?? '') === String(v) }, t))));
        }));
      modal('סינון מתקדם', body, {
        actions: [
          { label: 'החל סינון', kind: 'primary', onclick: (close) => { close(); resetPaging(); draw(); } },
          { label: 'נקה הכל', onclick: (close) => { ctx.filters = {}; close(); resetPaging(); draw(); } },
        ],
      });
    },
  }, `⚙️ סינון${active ? ` (${active})` : ''}`);
}

// ---------------- table ----------------
function buildTable(rows) {
  const cols = columns();
  const thead = h('thead', {}, h('tr', {},
    h('th', {}, ''),
    ...cols.map(c => h('th', {
      onclick: () => {
        if (ctx.sort.col === c.key) ctx.sort.asc = !ctx.sort.asc;
        else ctx.sort = { col: c.key, asc: true };
        resetPaging();
        draw();
      },
    }, c.label, ctx.sort.col === c.key ? h('span', { class: 'sort-arrow' }, ctx.sort.asc ? ' ▲' : ' ▼') : '')),
    h('th', {}, 'פעולות')));

  const tbody = h('tbody', {}, ...rows.map(lead => buildRow(lead, cols)));
  return h('table', { class: 'board' }, thead, tbody);
}

function buildRow(lead, cols) {
  const tr = h('tr', { dataset: { id: lead.id } },
    h('td', {},
      h('button', { class: 'icon-btn', title: 'עדכונים ותכתובת', onclick: () => openUpdatesDrawer(lead) },
        '💬', lead.updates_count ? h('sup', {}, lead.updates_count) : '')),
    ...cols.map(c => buildCell(lead, c)),
    h('td', {}, h('div', { class: 'row-actions' },
      h('button', { class: 'icon-btn', title: 'סנכרון ליומן Google', onclick: () => syncToCalendar(lead) }, '📅'),
      h('button', { class: 'icon-btn', title: 'הקלטה קולית לליד זה', onclick: () => openVoiceModal(lead) }, '🎙️'),
      h('button', {
        class: 'icon-btn', title: 'מחיקה', onclick: async () => {
          if (!await confirmModal('מחיקת ליד', `למחוק את "${lead.name}"? הפעולה אינה הפיכה.`)) return;
          await del(`/leads/${lead.id}`);
          toast('הליד נמחק', 'success');
          reload();
        },
      }, '🗑️'))));
  attachLongPress(tr, lead);
  return tr;
}

// long-press (or long mouse-hold) on a row opens a vertical detail card —
// handy on phones where the wide board needs horizontal scrolling to see everything
function attachLongPress(tr, lead) {
  let timer = null;
  const start = (e) => {
    if (e.target.closest('input, select, textarea, button, a')) return;
    timer = setTimeout(() => { timer = null; openLeadDetailCard(lead); }, 550);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  tr.addEventListener('pointerdown', start);
  tr.addEventListener('pointerup', cancel);
  tr.addEventListener('pointerleave', cancel);
  tr.addEventListener('pointercancel', cancel);
}

function openLeadDetailCard(lead) {
  const statusLabels = { open: 'צינור ראשי', win: 'WIN 🎉', lost: 'LOST' };
  const rows = columns().map(c => {
    let value;
    if (c.type === 'readonly') value = c.render(lead);
    else if (c.type === 'contacts') value = (lead.contacts || []).map(x => x.name).join(', ') || '—';
    else if (c.type === 'status') value = statusLabels[lead[c.key]] || '—';
    else if (c.type === 'select') {
      const opt = c.options.find(([v]) => String(v) === String(lead[c.key]));
      value = opt ? opt[1] : (lead[c.key] || '—');
    } else if (c.type === 'date') value = fmtDate(lead[c.key]);
    else if (c.type === 'number') value = lead[c.key] != null ? fmtMoney(lead[c.key]) : '—';
    else value = lead[c.key] || '—';
    return h('div', { class: 'detail-row' },
      h('span', { class: 'detail-label' }, c.label),
      h('span', { class: 'detail-value' }, value));
  });
  modal(`כרטיס לקוח — ${lead.name}`, h('div', { class: 'detail-card' }, ...rows), {
    actions: [{ label: 'סגירה', onclick: (close) => close() }],
  });
}

function buildCell(lead, col) {
  const td = h('td', {});
  const save = async (value) => {
    try {
      const { lead: updated } = await patch(`/leads/${lead.id}`, { [col.key]: value === '' ? null : value });
      Object.assign(lead, updated);
      td.classList.remove('saved-flash'); void td.offsetWidth;
      td.classList.add('saved-flash');
    } catch (e) {
      toast(e.message, 'error');
      reload();
    }
  };

  if (col.type === 'readonly') { td.append(col.render(lead)); return td; }

  if (col.type === 'contacts') {
    const n = (lead.contacts || []).length;
    td.append(h('button', { class: 'btn sm', onclick: () => openContactsModal(lead) },
      n ? `👥 ${lead.contacts.map(c => c.name).join(', ').slice(0, 22)}${n > 1 ? '…' : ''}` : '+ הוספה'));
    return td;
  }

  if (col.type === 'status') {
    const sel = h('select', { class: 'cell-edit' },
      ...[['open', 'צינור ראשי'], ['win', 'WIN 🎉'], ['lost', 'LOST']].map(([v, t]) =>
        h('option', { value: v, selected: lead.sale_status === v }, t)));
    sel.style.color = { open: 'var(--warn)', win: 'var(--win)', lost: 'var(--lost)' }[lead.sale_status];
    sel.addEventListener('change', async () => {
      if (sel.value === 'lost') {
        openLostModal(lead, () => { sel.value = lead.sale_status; });
      } else {
        await save(sel.value);
        if (sel.value === 'win' && !lead.close_date) {
          await patch(`/leads/${lead.id}`, { close_date: new Date().toISOString().slice(0, 10) });
        }
        reload();
      }
    });
    td.append(sel);
    return td;
  }

  if (col.type === 'select') {
    const sel = h('select', { class: 'cell-edit' },
      h('option', { value: '' }, '—'),
      ...col.options.map(([v, t]) => h('option', { value: v, selected: String(lead[col.key] ?? '') === String(v) }, t)));
    sel.addEventListener('change', () => save(sel.value));
    if (col.chip && lead[col.key]) {
      // colorize like monday chips — chip shows the label text, the real
      // <select> sits invisibly on top so the whole thing stays clickable
      const cls = col.chip === 'relation' ? `relation-${lead[col.key]}` : (lead[col.key] === 'לקוח משאלון' ? 'stage-form' : 'stage');
      const opt = col.options.find(([v]) => String(v) === String(lead[col.key]));
      td.append(h('div', { class: 'chip-select-wrap' },
        h('span', { class: `chip ${cls}` }, opt ? opt[1] : lead[col.key]), sel));
    } else td.append(sel);
    return td;
  }

  const typeMap = { text: 'text', date: 'date', number: 'number', tel: 'tel', email: 'email' };
  const input = h('input', {
    class: 'cell-edit',
    type: typeMap[col.type] || 'text',
    value: lead[col.key] ?? '',
    dir: ['tel', 'email', 'number'].includes(col.type) ? 'ltr' : 'rtl',
  });
  input.addEventListener('change', () => save(col.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value));
  td.append(input);
  return td;
}

// ---------------- LOST flow (hard requirement) ----------------
function openLostModal(lead, onCancel) {
  const reason = h('textarea', { rows: 3, placeholder: 'למה הפסדנו את הליד?' });
  const compSel = h('select', {},
    h('option', { value: '' }, '— בחר מתחרה —'),
    ...ctx.competitors.map(c => h('option', { value: c.name }, c.name)),
    h('option', { value: '__new__' }, '+ מתחרה חדש…'));
  const newComp = h('input', { type: 'text', placeholder: 'שם המתחרה החדש', style: 'display:none;margin-top:6px' });
  compSel.addEventListener('change', () => { newComp.style.display = compSel.value === '__new__' ? '' : 'none'; });

  const m = modal(`העברת "${lead.name}" ל-LOST`, h('div', {},
    h('p', { class: 'muted' }, 'כדי להעביר ליד ל-LOST חובה למלא סיבת הפסד ולבחור את המתחרה שזכה.'),
    h('label', { class: 'field' }, h('span', {}, 'סיבת הפסד *'), reason),
    h('label', { class: 'field' }, h('span', {}, 'המתחרה שזכה *'), compSel, newComp)), {
    actions: [
      {
        label: 'העברה ל-LOST', kind: 'danger', onclick: async (close) => {
          let competitor = compSel.value === '__new__' ? newComp.value.trim() : compSel.value;
          if (!reason.value.trim() || !competitor) { toast('יש למלא סיבת הפסד ומתחרה', 'error'); return false; }
          try {
            if (compSel.value === '__new__') {
              await post('/leads/meta/competitors', { name: competitor });
            }
            await patch(`/leads/${lead.id}`, {
              sale_status: 'lost', lost_reason: reason.value.trim(), lost_competitor: competitor,
              close_date: new Date().toISOString().slice(0, 10),
            });
            close();
            toast('הליד הועבר ל-LOST', 'success');
            reload();
          } catch (e) { toast(e.message, 'error'); }
        },
      },
      { label: 'ביטול', onclick: (close) => { close(); onCancel?.(); } },
    ],
  });
  m.box.querySelector('.icon-btn').addEventListener('click', () => onCancel?.());
}

// ---------------- new lead ----------------
function openNewLead() {
  const name = h('input', { type: 'text', required: true });
  const contact = h('input', { type: 'text' });
  const phone = h('input', { type: 'tel', dir: 'ltr' });
  const email = h('input', { type: 'email', dir: 'ltr' });
  const date = h('input', { type: 'date' });
  const relation = h('select', {}, h('option', { value: '' }, '—'), ...RELATIONS.map(r => h('option', { value: r }, r)));
  modal('ליד חדש', h('div', { class: 'grid-2' },
    h('label', { class: 'field' }, h('span', {}, 'שם *'), name),
    h('label', { class: 'field' }, h('span', {}, 'איש קשר'), contact),
    h('label', { class: 'field' }, h('span', {}, 'טלפון'), phone),
    h('label', { class: 'field' }, h('span', {}, 'מייל'), email),
    h('label', { class: 'field' }, h('span', {}, 'תאריך אירוע'), date),
    h('label', { class: 'field' }, h('span', {}, 'קרבה'), relation)), {
    actions: [
      {
        label: 'יצירה', kind: 'primary', onclick: async (close) => {
          if (!name.value.trim()) { toast('שם הוא שדה חובה', 'error'); return false; }
          await post('/leads', {
            name: name.value.trim(), contact_name: contact.value, phone1: phone.value,
            email: email.value, event_date: date.value || null, relation: relation.value || null,
            owner_id: ctx.state.user.id,
          });
          close();
          toast('הליד נוצר ✓', 'success');
          reload();
        },
      },
      { label: 'ביטול', onclick: (close) => close() },
    ],
  });
}

// ---------------- contacts ----------------
function openContactsModal(lead) {
  const list = h('div', {});
  const renderList = () => {
    list.innerHTML = '';
    if (!(lead.contacts || []).length) list.append(h('p', { class: 'muted' }, 'אין אנשי קשר נוספים עדיין.'));
    for (const c of lead.contacts || []) {
      list.append(h('div', { class: 'pkg-item' },
        h('b', {}, c.name), c.role ? h('span', { class: 'chip stage' }, c.role) : '',
        h('span', { dir: 'ltr' }, c.phone || ''), h('span', { dir: 'ltr' }, c.email || ''),
        h('span', { style: 'flex:1' }),
        h('button', {
          class: 'icon-btn', onclick: async () => {
            await del(`/leads/${lead.id}/contacts/${c.id}`);
            lead.contacts = lead.contacts.filter(x => x.id !== c.id);
            renderList();
          },
        }, '🗑️')));
    }
  };
  renderList();

  const name = h('input', { type: 'text', placeholder: 'שם *' });
  const role = h('input', { type: 'text', placeholder: 'תפקיד/קרבה' });
  const phone = h('input', { type: 'tel', placeholder: 'טלפון', dir: 'ltr' });
  const email = h('input', { type: 'email', placeholder: 'מייל', dir: 'ltr' });

  modal(`אנשי קשר — ${lead.name}`, h('div', {},
    list,
    h('h4', { class: 'mt' }, 'הוספת איש קשר'),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, name), h('label', { class: 'field' }, role),
      h('label', { class: 'field' }, phone), h('label', { class: 'field' }, email)),
    h('button', {
      class: 'btn primary', onclick: withBusy(async () => {
        if (!name.value.trim()) { toast('שם איש קשר חובה', 'error'); return; }
        const { contact } = await post(`/leads/${lead.id}/contacts`, {
          name: name.value, role: role.value, phone: phone.value, email: email.value,
        });
        lead.contacts = [...(lead.contacts || []), contact];
        name.value = role.value = phone.value = email.value = '';
        renderList();
        draw();
      }),
    }, '+ הוספה')));
}

// ---------------- updates drawer ----------------
async function openUpdatesDrawer(lead) {
  const { updates } = await get(`/leads/${lead.id}/updates`);
  const bodyEl = h('div', { class: 'body' });
  const renderUpdates = (items) => {
    bodyEl.innerHTML = '';
    if (!items.length) bodyEl.append(h('p', { class: 'muted' }, 'אין עדכונים עדיין — כתבו את הראשון!'));
    for (const u of items) {
      bodyEl.append(h('div', { class: `update-item ${u.kind}` },
        h('div', { class: 'meta' }, `${u.author_name} · ${new Date(u.created_at).toLocaleString('he-IL')}`),
        h('div', { class: 'body-text' }, u.body)));
    }
  };
  renderUpdates(updates);

  const ta = h('textarea', { rows: 2, placeholder: 'כתבו עדכון…' });
  const backdrop = h('div', { class: 'drawer-backdrop', onclick: () => { backdrop.remove(); drawer.remove(); } });
  const drawer = h('aside', { class: 'drawer' },
    h('header', {}, h('h3', { style: 'margin:0' }, `💬 ${lead.name}`),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'icon-btn', onclick: () => { backdrop.remove(); drawer.remove(); } }, '✕')),
    bodyEl,
    h('footer', {}, h('div', { class: 'flex' }, ta,
      h('button', {
        class: 'btn primary', onclick: withBusy(async () => {
          if (!ta.value.trim()) return;
          await post(`/leads/${lead.id}/updates`, { body: ta.value });
          ta.value = '';
          const { updates: fresh } = await get(`/leads/${lead.id}/updates`);
          renderUpdates(fresh);
          lead.updates_count = fresh.length;
        }),
      }, 'שליחה'))));
  document.body.append(backdrop, drawer);
}

// ---------------- merge ----------------
function openMergePicker() {
  const rows = ctx.leads;
  const sel1 = h('select', {}, ...rows.map(l => h('option', { value: l.id }, l.name)));
  const sel2 = h('select', {}, ...rows.map((l, i) => h('option', { value: l.id, selected: i === 1 }, l.name)));
  modal('מיזוג לידים כפולים', h('div', {},
    h('p', { class: 'muted' }, 'בחרו את הליד הראשי (שיישאר) ואת הכפיל (שימוזג ויימחק).'),
    h('label', { class: 'field' }, h('span', {}, 'ליד ראשי'), sel1),
    h('label', { class: 'field' }, h('span', {}, 'כפיל למיזוג'), sel2)), {
    actions: [
      {
        label: 'המשך למיזוג', kind: 'primary', onclick: (close) => {
          const a = rows.find(l => l.id === sel1.value), b = rows.find(l => l.id === sel2.value);
          if (!a || !b || a.id === b.id) { toast('יש לבחור שני לידים שונים', 'error'); return false; }
          close();
          openMergeResolve(a, b);
        },
      },
      { label: 'ביטול', onclick: (close) => close() },
    ],
  });
}

function openMergeResolve(primary, dup) {
  const cols = columns().filter(c => !['contacts', 'readonly', 'status'].includes(c.type));
  const conflicts = cols.filter(c => {
    const a = primary[c.key], b = dup[c.key];
    return a != null && a !== '' && b != null && b !== '' && String(a) !== String(b);
  });
  const resolutions = {};
  const body = h('div', {},
    h('p', { class: 'muted' }, conflicts.length
      ? 'נמצאו ערכים סותרים — בחרו איזה מידע לשמור עבור כל שדה:'
      : 'אין התנגשויות — שדות ריקים בליד הראשי יושלמו אוטומטית מהכפיל.'),
    ...conflicts.map(c => {
      const nameA = `merge-${c.key}`;
      resolutions[c.key] = primary[c.key];
      const mk = (val, who, checked) => h('label', { class: 'pkg-item', style: 'cursor:pointer' },
        h('input', {
          type: 'radio', name: nameA, checked, style: 'width:auto',
          onchange: () => { resolutions[c.key] = val; },
        }),
        h('b', {}, who), h('span', {}, String(val)));
      return h('div', { class: 'card', style: 'padding:10px;margin-bottom:10px' },
        h('div', { class: 'muted', style: 'margin-bottom:6px' }, c.label),
        mk(primary[c.key], `ראשי (${primary.name})`, true),
        mk(dup[c.key], `כפיל (${dup.name})`, false));
    }));
  modal(`מיזוג: ${primary.name} ⟵ ${dup.name}`, body, {
    wide: conflicts.length > 0,
    actions: [
      {
        label: '🔀 בצע מיזוג', kind: 'primary', onclick: async (close) => {
          try {
            await post('/leads/merge', { primary_id: primary.id, duplicate_id: dup.id, resolutions });
            close();
            toast('הלידים מוזגו בהצלחה', 'success');
            reload();
          } catch (e) { toast(e.message, 'error'); }
        },
      },
      { label: 'ביטול', onclick: (close) => close() },
    ],
  });
}

// ---------------- voice note (AI) ----------------
// Exported so the mobile bottom-nav FAB can capture a lead by voice from
// any tab, even before the leads tab has ever been mounted (ctx is null then).
export function openVoiceModal(lead) {
  const isLead = lead && lead.id;
  let mediaRecorder = null, chunks = [], blob = null;

  const status = h('p', { class: 'muted' }, 'הקליטו הודעה קולית או העלו קובץ אודיו — ה-AI יתמלל וימלא את השדות אוטומטית.');
  const recBtn = h('button', { class: 'btn' }, '🔴 התחלת הקלטה');
  const fileInput = h('input', { type: 'file', accept: 'audio/*' });
  const analyzeBtn = h('button', { class: 'btn primary', disabled: true }, '🤖 ניתוח AI');
  const result = h('div', {});

  recBtn.addEventListener('click', async () => {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        recBtn.textContent = '🔴 הקלטה מחדש';
        status.textContent = `הקלטה מוכנה (${Math.round(blob.size / 1024)}KB) — לחצו על ניתוח AI.`;
        analyzeBtn.disabled = false;
      };
      mediaRecorder.start();
      recBtn.textContent = '⏹️ עצירת הקלטה';
      status.textContent = 'מקליט… דברו חופשי על הליד.';
    } catch {
      toast('אין גישה למיקרופון — העלו קובץ במקום', 'error');
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      blob = fileInput.files[0];
      analyzeBtn.disabled = false;
      status.textContent = `קובץ נבחר: ${blob.name || 'אודיו'} — לחצו על ניתוח AI.`;
    }
  });

  analyzeBtn.addEventListener('click', async () => {
    if (!blob) return;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = '⏳ מתמלל ומנתח…';
    try {
      const fd = new FormData();
      fd.append('audio', blob, blob.name || 'recording.webm');
      if (isLead) fd.append('lead_id', lead.id);
      const { voice_note } = await upload('/voice', fd);
      renderExtractReview(voice_note);
    } catch (e) {
      toast(e.message, 'error');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '🤖 ניתוח AI';
    }
  });

  const fieldLabels = {
    name: 'שם', contact_name: 'איש קשר', relation: 'קרבה', event_type: 'סוג אירוע',
    event_date: 'תאריך אירוע', event_location: 'מיקום', email: 'מייל', phone1: 'טלפון',
    proposed_price: 'מחיר שהוצע', hear_about_us: 'איך שמעו עלינו', referrer: 'מי המליץ',
    next_action: 'פעולה הבאה', notes: 'הערות',
  };

  function renderExtractReview(note) {
    result.innerHTML = '';
    const inputs = {};
    result.append(
      h('h4', { class: 'mt' }, '📝 תמלול'),
      h('p', { class: 'muted', style: 'max-height:90px;overflow-y:auto' }, note.transcript || ''),
      h('h4', {}, '🤖 שדות שזוהו — ניתן לערוך לפני שמירה'),
      ...Object.entries(note.extracted || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => {
        inputs[k] = h('input', { type: 'text', value: v });
        return h('label', { class: 'field' }, h('span', {}, fieldLabels[k] || k), inputs[k]);
      }),
      h('button', {
        class: 'btn primary', onclick: async () => {
          const fields = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
          const { lead: saved } = await post(`/voice/${note.id}/apply`, {
            lead_id: isLead ? lead.id : undefined, fields,
          });
          toast(isLead ? 'השדות עודכנו בליד ✓' : `נוצר ליד חדש: ${saved.name} ✓`, 'success');
          document.querySelector('.modal-backdrop')?.remove();
          // ctx is only set once the leads tab has mounted in this session
          if (ctx) reload(); else location.hash = 'tab=leads';
        },
      }, isLead ? '💾 עדכון הליד' : '💾 יצירת ליד חדש'));
    analyzeBtn.style.display = 'none';
    recBtn.style.display = 'none';
    fileInput.style.display = 'none';
    status.style.display = 'none';
  }

  modal(isLead ? `🎙️ הקלטה קולית — ${lead.name}` : '🎙️ ליד חדש מהקלטה קולית',
    h('div', {}, status, h('div', { class: 'flex', style: 'flex-wrap:wrap' }, recBtn, fileInput, analyzeBtn), result));
}

// ---------------- calendar ----------------
async function syncToCalendar(lead) {
  try {
    const rsp = await post(`/calendar/sync/${lead.id}`, {});
    if (rsp.result?.mock) toast('Google Calendar לא מוגדר — הזן מפתחות Google ב-.env וחבר את היומן בהגדרות', 'error');
    else toast('הליד סונכרן ליומן Google ✓', 'success');
  } catch (e) { toast(e.message, 'error'); }
}
