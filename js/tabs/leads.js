// Tab 1 — מעקב זוגות: Monday-style board with inline autosave editing,
// search/filter/sort, pipelines (open/win/lost), merge, contacts, updates
// thread, voice-note AI capture and Google Calendar sync.
import { get, post, patch, del, upload } from '../api.js';
import { h, toast, modal, confirmModal, debounce, skeletonTable, withBusy } from '../ui.js';
import { openImportWizard } from './import.js';
import { formatPhone, sanitizePhone } from '../phone.js';

const PAGE_SIZE = 100;
const WIDTHS_KEY = 'zooglot_col_widths';

const RELATIONS = ['כלה', 'חתן', 'הורה', 'מפיק/ה', 'אחר'];
const STAGES = ['לקוח חדש ידני', 'לקוח משאלון'];
const EVENT_TYPES = ['חתונה', 'בר/בת מצווה', 'אירוע חברה', 'אחר'];
const HEAR = ['Instagram', 'Youtube', 'ניגנתם אצל חברים', 'המלצה', 'גוגל', 'אחר'];
const NEXT_ACTIONS = ['עוד פרטים', 'לקבוע פגישה', 'לשלוח הצעת מחיר', 'לשלוח חוזה', 'מעקב', 'אין פעולה'];
const SOURCES = { manual: 'ידני', form: 'טופס', webhook: 'אתר', whatsapp: 'וואטסאפ', voice: 'הקלטה', import: 'ייבוא' };

let ctx = null; // { view, state, leads, competitors, pipeline, search, sort, filters, colWidths }

const loadWidths = () => { try { return JSON.parse(localStorage.getItem(WIDTHS_KEY)) || {}; } catch { return {}; } };
const saveWidths = debounce((w) => localStorage.setItem(WIDTHS_KEY, JSON.stringify(w)), 300);

export async function renderLeadsTab(view, state) {
  ctx = {
    view, state, leads: [], competitors: [],
    pipeline: 'open', search: '', sort: { col: 'event_date', asc: true }, filters: {},
    limit: PAGE_SIZE,
    colWidths: loadWidths(),
    selected: new Set(),
  };
  const skel = h('div', {}, skeletonTable(10));
  view.append(skel);
  await reload(false);
  skel.remove();
  draw();
}

// reset pagination whenever the visible set changes (pipeline/search/filter/sort)
function resetPaging() { ctx.limit = PAGE_SIZE; ctx.selected.clear(); }

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
    { key: 'id_number', label: 'ת"ז', type: 'text' },
    { key: 'address', label: 'כתובת', type: 'text' },
    { key: 'proposed_price', label: 'מחיר שהוצע', type: 'number' },
    { key: 'deposit_amount', label: 'מקדמה', type: 'number' },
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
    sortControl(),
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

  const selBar = selectionBar();
  if (selBar) host.append(selBar);

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

// ---------------- bulk selection (Monday-style checkboxes) ----------------
// fields copied when duplicating a lead — same whitelist as the backend, minus
// bookkeeping/ingestion columns that shouldn't be cloned onto a new record
const DUP_FIELDS = [
  'name', 'contact_name', 'event_type', 'event_date', 'event_location', 'relation',
  'owner_id', 'team', 'email', 'phone1', 'phone2', 'id_number', 'address',
  'proposed_price', 'deposit_amount', 'stage', 'sale_status', 'next_action',
  'package_type', 'date_status', 'hear_about_us', 'referrer', 'came_to_see_event',
  'seen_at_date', 'seen_at_place', 'first_contact_date', 'close_date',
  'lost_reason', 'lost_competitor',
];

function selectionBar() {
  const n = ctx.selected.size;
  if (!n) return null;
  return h('div', { class: 'selection-bar' },
    h('b', {}, `נבחרו ${n} רשומות`),
    h('span', { style: 'flex:1' }),
    h('button', { class: 'btn sm', onclick: withBusy(bulkDuplicate) }, '📄 שכפול'),
    h('button', { class: 'btn sm danger', onclick: withBusy(bulkDelete) }, '🗑️ מחיקה'),
    h('button', { class: 'btn sm', onclick: () => { ctx.selected.clear(); draw(); } }, '✕ ביטול בחירה'));
}

async function bulkDelete() {
  const ids = [...ctx.selected];
  if (!ids.length) return;
  if (!await confirmModal('מחיקת רשומות', `למחוק ${ids.length} רשומות שנבחרו? הפעולה אינה הפיכה.`)) return;
  await Promise.all(ids.map(id => del(`/leads/${id}`)));
  ctx.selected.clear();
  toast('הרשומות נמחקו', 'success');
  reload();
}

async function bulkDuplicate() {
  const ids = [...ctx.selected];
  if (!ids.length) return;
  const leads = ctx.leads.filter(l => ids.includes(l.id));
  await Promise.all(leads.map((l) => {
    const data = {};
    for (const f of DUP_FIELDS) if (l[f] !== undefined) data[f] = l[f];
    data.name = `${l.name} (עותק)`;
    return post('/leads', data);
  }));
  ctx.selected.clear();
  toast(`${leads.length} רשומות שוכפלו ✓`, 'success');
  reload();
}

// explicit sort picker (column headers are still clickable to sort too)
function sortControl() {
  const sortable = columns().filter(c => !['contacts', 'readonly'].includes(c.type));
  const sel = h('select', { style: 'max-width:190px' },
    ...sortable.map(c => h('option', { value: c.key, selected: ctx.sort.col === c.key }, `מיון: ${c.label}`)));
  sel.addEventListener('change', () => {
    ctx.sort = { col: sel.value, asc: ctx.sort.asc };
    resetPaging(); draw();
  });
  const dir = h('button', {
    class: 'btn sm', title: ctx.sort.asc ? 'סדר עולה' : 'סדר יורד',
    onclick: () => { ctx.sort.asc = !ctx.sort.asc; resetPaging(); draw(); },
  }, ctx.sort.asc ? '▲' : '▼');
  return h('div', { class: 'flex', style: 'gap:4px' }, sel, dir);
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
const DEFAULT_W = 150;
// phones get a narrower checkbox column and tighter data columns so more fields
// fit beside the pinned name. Must stay in sync with --cb-w in main.css.
const isPhone = () => window.matchMedia('(max-width: 640px)').matches;
const CHECKBOX_COL_W = () => (isPhone() ? 30 : 38);
const PHONE_COL_SCALE = 0.72;

function buildTable(rows) {
  const cols = columns();
  const width = (c) => Math.round(
    (ctx.colWidths[c.key] || c.width || DEFAULT_W) * (isPhone() ? PHONE_COL_SCALE : 1));

  // fixed layout so explicit column widths are honoured exactly.
  // colgroup indices shift by 1 vs. `cols` because of the leading checkbox column.
  const colGroup = h('colgroup', {},
    h('col', { style: `width:${CHECKBOX_COL_W()}px` }),
    ...cols.map(c => h('col', { style: `width:${width(c)}px` })),
    h('col', { style: `width:${isPhone() ? 150 : 214}px` })); // actions: 5 icons + end padding

  const allSelected = rows.length > 0 && rows.every(l => ctx.selected.has(l.id));
  const selectAllCb = h('input', {
    type: 'checkbox', checked: allSelected,
    onclick: (e) => {
      if (e.target.checked) rows.forEach(l => ctx.selected.add(l.id));
      else rows.forEach(l => ctx.selected.delete(l.id));
      draw();
    },
  });

  const thead = h('thead', {}, h('tr', {},
    h('th', { class: 'checkbox-col sticky-col-1' }, selectAllCb),
    ...cols.map((c, i) => {
      const th = h('th', {
        class: `resizable${i === 0 ? ' sticky-col-2' : ''}`,
      },
        h('span', {
          class: 'th-label',
          onclick: () => {
            if (ctx.sort.col === c.key) ctx.sort.asc = !ctx.sort.asc;
            else ctx.sort = { col: c.key, asc: true };
            resetPaging();
            draw();
          },
        }, c.label, ctx.sort.col === c.key ? h('span', { class: 'sort-arrow' }, ctx.sort.asc ? ' ▲' : ' ▼') : ''),
        resizeHandle(c, i + 1));
      return th;
    }),
    h('th', {}, 'פעולות')));

  const tbody = h('tbody', {}, ...rows.map(lead => buildRow(lead, cols)));
  return h('table', { class: 'board grid' }, colGroup, thead, tbody);
}

// drag the edge of a header to resize that column; width persists in localStorage
function resizeHandle(col, colIndex) {
  const handle = h('span', { class: 'col-resize', title: 'גררו לשינוי רוחב · דאבל-קליק לאיפוס' });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const table = handle.closest('table');
    const colEl = table.querySelectorAll('colgroup col')[colIndex];
    const startX = e.clientX;
    const startW = colEl.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');

    // RTL: dragging left (negative dx) widens the column
    const onMove = (ev) => {
      const dx = startX - ev.clientX;
      const w = Math.max(70, Math.round(startW + dx));
      colEl.style.width = `${w}px`;
      // store the unscaled width so a phone resize doesn't shrink again on redraw
      ctx.colWidths[col.key] = isPhone() ? Math.round(w / PHONE_COL_SCALE) : w;
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      saveWidths(ctx.colWidths);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });

  handle.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    delete ctx.colWidths[col.key];
    saveWidths(ctx.colWidths);
    draw();
  });
  return handle;
}

function buildRow(lead, cols) {
  const selectCb = h('input', {
    type: 'checkbox', checked: ctx.selected.has(lead.id),
    onclick: (e) => {
      e.stopPropagation();
      e.target.checked ? ctx.selected.add(lead.id) : ctx.selected.delete(lead.id);
      draw();
    },
  });
  const tr = h('tr', {
    dataset: { id: lead.id },
    class: ctx.selected.has(lead.id) ? 'row-selected' : '',
  },
    h('td', { class: 'checkbox-col sticky-col-1' }, selectCb),
    ...cols.map((c, i) => i === 0 ? buildNameCell(lead, c) : buildCell(lead, c)),
    h('td', {}, h('div', { class: 'row-actions' },
      h('button', { class: 'icon-btn', title: 'כרטיס הליד (כל השדות)', onclick: () => openUpdatesDrawer(lead, 'card') }, '🪪'),
      h('button', { class: 'icon-btn', title: 'תזכורות', onclick: () => openUpdatesDrawer(lead, 'reminders') }, '⏰'),
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

// name column doubles as the 💬 updates entry point and stays pinned (with
// the checkbox column) while scrolling horizontally, so it's always clear
// which lead the visible fields belong to.
function buildNameCell(lead, col) {
  const td = buildCell(lead, col);
  td.classList.add('name-cell', 'sticky-col-2');
  // The <td> itself must stay a real table cell — `display:flex` on a sticky td
  // is unreliable in Safari/iOS — so the 💬 + name row lives in an inner wrapper.
  const inner = h('div', { class: 'name-cell-inner' }, ...td.childNodes);
  inner.prepend(h('button', {
    class: 'icon-btn updates-inline', title: 'עדכונים ותכתובת',
    onclick: (e) => { e.stopPropagation(); openUpdatesDrawer(lead); },
  }, '💬', lead.updates_count ? h('sup', {}, lead.updates_count) : ''));
  td.append(inner);
  return td;
}

// long-press (or long mouse-hold) on a row opens the editable item card —
// handy on phones where the wide board needs horizontal scrolling to see everything
function attachLongPress(tr, lead) {
  let timer = null;
  const start = (e) => {
    if (e.target.closest('input, select, textarea, button, a, .col-resize')) return;
    timer = setTimeout(() => { timer = null; openUpdatesDrawer(lead, 'card'); }, 550);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  tr.addEventListener('pointerdown', start);
  tr.addEventListener('pointerup', cancel);
  tr.addEventListener('pointerleave', cancel);
  tr.addEventListener('pointercancel', cancel);
}

// phone cell: shows a country flag + dash-formatted number, but switches to
// raw digits while focused so typing/selecting/copying never includes the
// display dashes. `onSave(rawValue)` is called on blur when the value changed.
function telCell(value, onSave) {
  let current = value || '';
  const flagEl = h('span', { class: 'tel-flag' });
  const input = h('input', { class: 'cell-edit', type: 'tel', dir: 'ltr' });
  const refresh = () => {
    const { iso2, display } = formatPhone(current);
    flagEl.innerHTML = '';
    // real flag SVGs (Windows can't render flag emoji) — fall back to 📞 if unknown
    flagEl.append(iso2
      ? h('img', { class: 'tel-flag-img', src: `/assets/flags/${iso2}.svg`, alt: iso2, loading: 'lazy' })
      : document.createTextNode('📞'));
    input.value = display || current;
  };
  refresh();
  input.addEventListener('focus', () => { input.value = current; });
  input.addEventListener('blur', refresh);
  input.addEventListener('change', async () => {
    current = sanitizePhone(input.value);
    await onSave(current);
    refresh();
  });
  return h('div', { class: 'tel-cell' }, flagEl, input);
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

  if (col.type === 'tel') { td.append(telCell(lead[col.key] ?? '', save)); return td; }

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
function openLostModal(lead, onCancel, onDone) {
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
            const { lead: updated } = await patch(`/leads/${lead.id}`, {
              sale_status: 'lost', lost_reason: reason.value.trim(), lost_competitor: competitor,
              close_date: new Date().toISOString().slice(0, 10),
            });
            Object.assign(lead, updated);
            close();
            toast('הליד הועבר ל-LOST', 'success');
            await reload();
            onDone?.();
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
      list.append(h('div', { class: 'pkg-item', style: 'flex-wrap:wrap' },
        h('b', {}, c.name), c.role ? h('span', { class: 'chip stage' }, c.role) : '',
        h('span', { dir: 'ltr' }, c.phone || ''), h('span', { dir: 'ltr' }, c.email || ''),
        c.id_number ? h('span', { class: 'muted' }, `ת"ז ${c.id_number}`) : '',
        c.address ? h('span', { class: 'muted' }, c.address) : '',
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
  const idNumber = h('input', { type: 'text', placeholder: 'ת"ז', dir: 'ltr' });
  const address = h('input', { type: 'text', placeholder: 'כתובת' });

  modal(`אנשי קשר — ${lead.name}`, h('div', {},
    list,
    h('h4', { class: 'mt' }, 'הוספת איש קשר'),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, name), h('label', { class: 'field' }, role),
      h('label', { class: 'field' }, phone), h('label', { class: 'field' }, email),
      h('label', { class: 'field' }, idNumber), h('label', { class: 'field' }, address)),
    h('button', {
      class: 'btn primary', onclick: withBusy(async () => {
        if (!name.value.trim()) { toast('שם איש קשר חובה', 'error'); return; }
        const { contact } = await post(`/leads/${lead.id}/contacts`, {
          name: name.value, role: role.value, phone: phone.value, email: email.value,
          id_number: idNumber.value, address: address.value,
        });
        lead.contacts = [...(lead.contacts || []), contact];
        name.value = role.value = phone.value = email.value = idNumber.value = address.value = '';
        renderList();
        draw();
      }),
    }, '+ הוספה')));
}

// ---------------- lead drawer: updates / item card / reminders ----------------
async function openUpdatesDrawer(lead, initialTab = 'updates') {
  let tab = initialTab;
  const bodyEl = h('div', { class: 'body' });
  const footerEl = h('footer', {});
  const close = () => { backdrop.remove(); drawer.remove(); };

  const tabsBar = h('div', { class: 'drawer-tabs' });
  const drawTabs = () => {
    tabsBar.innerHTML = '';
    for (const [id, label] of [['updates', '💬 עדכונים'], ['card', '🪪 כרטיס'], ['reminders', '⏰ תזכורות']]) {
      tabsBar.append(h('button', {
        class: tab === id ? 'active' : '',
        onclick: () => { tab = id; drawTabs(); renderTab(); },
      }, label));
    }
  };

  async function renderTab() {
    bodyEl.innerHTML = '';
    footerEl.innerHTML = '';
    if (tab === 'updates') await renderUpdatesTab();
    else if (tab === 'card') renderCardTab();
    else await renderRemindersTab();
  }

  // ---- updates thread ----
  async function renderUpdatesTab() {
    const { updates } = await get(`/leads/${lead.id}/updates`);
    const paint = (items) => {
      bodyEl.innerHTML = '';
      if (!items.length) bodyEl.append(h('p', { class: 'muted' }, 'אין עדכונים עדיין — כתבו את הראשון!'));
      for (const u of items) {
        bodyEl.append(h('div', { class: `update-item ${u.kind}` },
          h('div', { class: 'meta' }, `${u.author_name} · ${new Date(u.created_at).toLocaleString('he-IL')}`),
          h('div', { class: 'body-text' }, u.body)));
      }
    };
    paint(updates);

    const ta = h('textarea', { rows: 2, placeholder: 'כתבו עדכון…' });
    footerEl.append(h('div', { class: 'flex' }, ta,
      h('button', {
        class: 'btn primary', onclick: withBusy(async () => {
          if (!ta.value.trim()) return;
          await post(`/leads/${lead.id}/updates`, { body: ta.value });
          ta.value = '';
          const { updates: fresh } = await get(`/leads/${lead.id}/updates`);
          paint(fresh);
          lead.updates_count = fresh.length;
          draw();
        }),
      }, 'שליחה')));
  }

  // ---- item card: every field, vertical, inline autosave ----
  function renderCardTab() {
    const save = async (key, value) => {
      try {
        const { lead: updated } = await patch(`/leads/${lead.id}`, { [key]: value === '' ? null : value });
        Object.assign(lead, updated);
        draw();
      } catch (e) {
        toast(e.message, 'error');
        await reload(false);
        draw();
      }
    };

    const grid = h('div', { class: 'card-grid' });
    for (const col of columns()) {
      if (col.type === 'readonly') {
        grid.append(h('label', { class: 'field' }, h('span', {}, col.label), h('div', {}, col.render(lead))));
        continue;
      }
      if (col.type === 'contacts') {
        grid.append(h('label', { class: 'field' }, h('span', {}, col.label),
          h('button', { class: 'btn sm', onclick: () => openContactsModal(lead) },
            (lead.contacts || []).length ? `👥 ${lead.contacts.map(c => c.name).join(', ')}` : '+ הוספת איש קשר')));
        continue;
      }
      if (col.type === 'status') {
        const sel = h('select', {},
          ...[['open', 'צינור ראשי'], ['win', 'WIN 🎉'], ['lost', 'LOST']].map(([v, t]) =>
            h('option', { value: v, selected: lead.sale_status === v }, t)));
        sel.addEventListener('change', async () => {
          if (sel.value === 'lost') {
            openLostModal(lead, () => { sel.value = lead.sale_status; }, () => renderTab());
          } else {
            await save('sale_status', sel.value);
            if (sel.value === 'win' && !lead.close_date) await save('close_date', new Date().toISOString().slice(0, 10));
            renderTab();
          }
        });
        grid.append(h('label', { class: 'field' }, h('span', {}, col.label), sel));
        continue;
      }
      if (col.type === 'select') {
        const sel = h('select', {},
          h('option', { value: '' }, '—'),
          ...col.options.map(([v, t]) => h('option', { value: v, selected: String(lead[col.key] ?? '') === String(v) }, t)));
        sel.addEventListener('change', () => save(col.key, sel.value));
        grid.append(h('label', { class: 'field' }, h('span', {}, col.label), sel));
        continue;
      }
      if (col.type === 'tel') {
        grid.append(h('label', { class: 'field' }, h('span', {}, col.label), telCell(lead[col.key] ?? '', (v) => save(col.key, v))));
        continue;
      }
      const typeMap = { text: 'text', date: 'date', number: 'number', tel: 'tel', email: 'email' };
      const input = h('input', {
        type: typeMap[col.type] || 'text',
        value: lead[col.key] ?? '',
        dir: ['tel', 'email', 'number'].includes(col.type) ? 'ltr' : 'rtl',
      });
      input.addEventListener('change', () =>
        save(col.key, col.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value));
      grid.append(h('label', { class: 'field' }, h('span', {}, col.label), input));
    }
    bodyEl.append(h('p', { class: 'muted' }, 'כל שינוי נשמר אוטומטית.'), grid);
  }

  // ---- reminders ----
  async function renderRemindersTab() {
    const { reminders } = await get(`/leads/${lead.id}/reminders`);
    const owner = ctx.state.team.find(t => t.id === lead.owner_id);

    bodyEl.append(h('p', { class: 'muted' },
      owner ? `התזכורת תישלח כברירת מחדל ל-${owner.full_name || owner.email} (בטיפול).`
        : '⚠️ לליד אין איש צוות מטפל — בחרו נמען לתזכורת.'));

    if (!reminders.length) bodyEl.append(h('p', { class: 'muted' }, 'אין תזכורות לליד הזה.'));
    for (const r of reminders) {
      const when = new Date(r.remind_at).toLocaleString('he-IL');
      const statusLabel = { pending: '⏳ ממתינה', sent: '✅ נשלחה', failed: '❌ נכשלה', cancelled: 'בוטלה' }[r.status] || r.status;
      bodyEl.append(h('div', { class: `reminder-item ${r.status}` },
        h('div', { class: 'flex between' },
          h('b', {}, `${r.channel === 'email' ? '📧 מייל' : '📱 וואטסאפ'} · ${when}`),
          h('button', {
            class: 'icon-btn', title: 'מחיקה', onclick: async () => {
              await del(`/leads/${lead.id}/reminders/${r.id}`);
              renderTab();
            },
          }, '🗑️')),
        r.message ? h('div', {}, r.message) : null,
        h('div', { class: 'meta' }, `${statusLabel} · ל-${r.recipient_name || '—'}`),
        r.error ? h('div', { class: 'meta', style: 'color:var(--danger)' }, r.error) : null));
    }

    footerEl.append(h('button', {
      class: 'btn primary', style: 'width:100%',
      onclick: () => openReminderModal(lead, () => renderTab()),
    }, '+ תזכורת חדשה'));
  }

  const backdrop = h('div', { class: 'drawer-backdrop', onclick: close });
  const drawer = h('aside', { class: 'drawer' },
    h('header', {},
      h('h3', { style: 'margin:0;font-size:16px' }, lead.name),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'icon-btn', onclick: close }, '✕')),
    tabsBar, bodyEl, footerEl);

  document.body.append(backdrop, drawer);
  drawTabs();
  await renderTab();
}

// ---------------- reminder composer ----------------
function openReminderModal(lead, onSaved) {
  const team = ctx.state.team;
  const channel = h('select', {},
    h('option', { value: 'email' }, '📧 מייל'),
    h('option', { value: 'whatsapp' }, '📱 וואטסאפ'));
  const recipient = h('select', {},
    ...team.map(t => h('option', {
      value: t.id, selected: t.id === lead.owner_id,
    }, `${t.full_name || t.email}${t.phone ? '' : ' (ללא טלפון)'}`)));

  // default: tomorrow at 09:00, formatted for datetime-local
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const when = h('input', { type: 'datetime-local', value: local });
  const message = h('textarea', { rows: 3, placeholder: `למשל: להתקשר ל${lead.contact_name || lead.name} בנוגע להצעת המחיר` });

  const warn = h('p', { class: 'muted' });
  const syncWarn = () => {
    const p = team.find(t => t.id === recipient.value);
    warn.textContent = (channel.value === 'whatsapp' && p && !p.phone)
      ? `⚠️ ל-${p.full_name || p.email} אין מספר וואטסאפ בפרופיל — יש להוסיף בהגדרות → פרופיל.`
      : '';
  };
  channel.addEventListener('change', syncWarn);
  recipient.addEventListener('change', syncWarn);
  syncWarn();

  modal(`⏰ תזכורת חדשה — ${lead.name}`, h('div', {},
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', {}, 'ערוץ שליחה'), channel),
      h('label', { class: 'field' }, h('span', {}, 'למי לשלוח (מטפל האירוע)'), recipient)),
    h('label', { class: 'field' }, h('span', {}, 'מתי *'), when),
    h('label', { class: 'field' }, h('span', {}, 'תוכן התזכורת'), message),
    warn), {
    actions: [
      {
        label: 'קביעת תזכורת', kind: 'primary', onclick: async (close) => {
          if (!when.value) { toast('יש לבחור תאריך ושעה', 'error'); return false; }
          try {
            await post(`/leads/${lead.id}/reminders`, {
              channel: channel.value,
              remind_at: new Date(when.value).toISOString(),
              message: message.value,
              recipient_id: recipient.value,
            });
            close();
            toast('התזכורת נקבעה ✓', 'success');
            onSaved?.();
          } catch (e) { toast(e.message, 'error'); return false; }
        },
      },
      { label: 'ביטול', onclick: (close) => close() },
    ],
  });
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
