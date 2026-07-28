// Tab 1 — מעקב זוגות: Monday-style board with inline autosave editing,
// search/filter/sort, pipelines (open/win/lost), merge, contacts, updates
// thread, voice-note AI capture and Google Calendar sync.
import { get, post, patch, del, upload } from '../api.js';
import { h, toast, modal, confirmModal, debounce, skeletonTable, withBusy } from '../ui.js';
import { openImportWizard } from './import.js';
import { formatPhone, sanitizePhone, phoneKey } from '../phone.js';
import { toIsraelInputValue, israelInputValueToDate, formatIsrael } from '../time.js';

const PAGE_SIZE = 100;
const WIDTHS_KEY = 'zooglot_col_widths';
const TEXTSIZE_KEY = 'zooglot_board_textsize';

// Three board text sizes on phones (like Monday's pinch-to-resize): each level
// scales the column widths, the row height and the font together, so smaller
// text really does reveal more columns rather than just shrinking the letters.
const TEXT_SIZES = ['s', 'm', 'l'];
const TEXT_SIZE_SCALE = { s: 0.56, m: 0.72, l: 0.92 };
const loadTextSize = () => {
  try { const v = localStorage.getItem(TEXTSIZE_KEY); return TEXT_SIZES.includes(v) ? v : 'm'; }
  catch { return 'm'; }
};
let textSize = loadTextSize();
function setTextSize(v) {
  if (!TEXT_SIZES.includes(v) || v === textSize) return;
  textSize = v;
  try { localStorage.setItem(TEXTSIZE_KEY, v); } catch { /* private mode */ }
  draw();
}

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
    dismissals: [],   // phone numbers confirmed as "not a duplicate"
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
  const [{ leads }, { competitors }, dismissed] = await Promise.all([
    get('/leads'), get('/leads/meta/competitors'),
    // approvals are a nice-to-have: if the table isn't migrated yet the board
    // must still load, just without the "not a duplicate" memory
    get('/leads/meta/duplicate-dismissals').catch(() => ({ dismissals: [] })),
  ]);
  ctx.leads = leads;
  ctx.competitors = competitors;
  ctx.dismissals = dismissed.dismissals || [];
  if (redraw) draw();
}

// ---------------- columns ----------------
function columns() {
  const team = ctx.state.team;
  return [
    { key: 'name', label: 'שם', type: 'text', width: 190 },
    // Updates sits immediately after the name (Monday's layout): it is the first
    // scrolling column, so it scrolls away while the name stays pinned.
    { key: '__updates', label: 'Updates', type: 'updates', width: 84 },
    { key: 'contact_name', label: 'איש קשר', type: 'text' },
    { key: 'groom_name', label: 'שם החתן', type: 'text' },
    { key: 'bride_name', label: 'שם הכלה', type: 'text' },
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
    { key: 'contract_link', label: 'קישור לחוזה', type: 'link', width: 190 },
    { key: 'creation_log', label: 'Creation Log', type: 'text', width: 190 },
    { key: 'last_updated_log', label: 'Last Updated', type: 'text', width: 190 },
    { key: 'date_status', label: 'סטטוס תאריך', type: 'text' },
    { key: 'lost_reason', label: 'למה לא?', type: 'text', lostOnly: true },
    { key: 'lost_competitor', label: 'מתחרה שזכה', type: 'text', lostOnly: true },
    { key: 'source', label: 'מקור', type: 'readonly', render: (l) => h('span', { class: 'chip source' }, SOURCES[l.source] || l.source) },
  ];
}

// ---------------- filtering / sorting ----------------
// One shared collator. `String.localeCompare(x, 'he')` builds a fresh collator on
// every single comparison — with thousands of leads that is tens of thousands of
// constructions per sort, and it is the slowest thing on a large board.
const HE_COLLATOR = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });

// Free-text search scans every field of every lead. Rebuilding that string per
// keystroke is wasteful, so cache one lowercase haystack per lead and rebuild it
// only when the lead actually changes (reload/edit bumps updated_at).
const HAY = new WeakMap();
function haystack(l) {
  const cached = HAY.get(l);
  if (cached && cached.stamp === l.updated_at) return cached.text;
  let text = '';
  for (const v of Object.values(l)) if (typeof v === 'string') text += v + '';
  for (const c of (l.contacts || [])) text += `${c.name || ''}${c.phone || ''}`;
  text = text.toLowerCase();
  HAY.set(l, { stamp: l.updated_at, text });
  return text;
}

function visibleLeads() {
  let rows = ctx.leads;
  if (ctx.pipeline !== 'all') rows = rows.filter(l => l.sale_status === ctx.pipeline);
  const q = ctx.search.trim().toLowerCase();
  if (q) rows = rows.filter(l => haystack(l).includes(q));
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
      const cmp = (!isNaN(nx) && !isNaN(ny)) ? nx - ny : HE_COLLATOR.compare(String(x), String(y));
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
      textSizeControl(),
      filterControl(),
      h('button', { class: 'btn sm', onclick: openVoiceModal }, '🎙️ ליד מהקלטה'),
      h('button', { class: 'btn sm', onclick: openMergePicker }, '🔀 מיזוג כפולים'),
      h('button', { class: 'btn sm', onclick: exportCsv }, '⬇️ ייצוא לאקסל'),
      // the wizard defaults to the pipeline currently on screen, so a WON export
      // lands in WIN and a LOST export in LOST without extra steps
      h('button', { class: 'btn sm', onclick: () => openImportWizard(() => reload(), ctx.pipeline) }, '⬆️ ייבוא מאקסל'),
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

  const dupBar = duplicateBanner();
  if (dupBar) host.append(dupBar);

  if (!rows.length) {
    host.append(h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '🎷'), h('p', {}, 'אין לידים בתצוגה הזו')));
    return;
  }

  host.append(buildBoard(shown));

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
  'name', 'contact_name', 'groom_name', 'bride_name', 'event_type', 'event_date',
  'event_location', 'relation',
  'owner_id', 'team', 'email', 'phone1', 'phone2', 'id_number', 'address',
  'proposed_price', 'deposit_amount', 'stage', 'sale_status', 'next_action',
  'package_type', 'date_status', 'hear_about_us', 'referrer', 'came_to_see_event',
  'seen_at_date', 'seen_at_place', 'first_contact_date', 'close_date',
  'lost_reason', 'lost_competitor',
];

function selectionBar() {
  const n = ctx.selected.size;
  if (!n) return null;
  // merging is a two-record operation, so the button only appears at exactly 2 —
  // no picker, no searching for the twin: tick the pair and merge
  const mergeBtn = n === 2
    ? h('button', {
      class: 'btn sm', onclick: () => {
        const [a, b] = [...ctx.selected].map(id => ctx.leads.find(l => l.id === id));
        if (a && b) openMergeResolve(a, b);
      },
    }, '🔀 מיזוג')
    : null;
  return h('div', { class: 'selection-bar' },
    h('b', {}, `נבחרו ${n} רשומות`),
    n > 2 ? h('span', { class: 'muted', style: 'font-size:12px' }, '(למיזוג — סמנו בדיוק 2)') : null,
    h('span', { style: 'flex:1' }),
    mergeBtn,
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
// the pinned checkbox+name pane shrinks with the text size too, so the smallest
// setting really does leave more room for the scrolling columns
const CHECKBOX_COL_W = () => (isPhone() ? (textSize === 's' ? 24 : textSize === 'l' ? 34 : 28) : 38);
const PHONE_COL_SCALE = () => (isPhone() ? TEXT_SIZE_SCALE[textSize] : 1);

// On desktop the board is one table with the checkbox + name columns pinned via
// position:sticky. That is unusable on iOS — Safari drops sticky table cells
// whenever an outer scroller moves — so phones get a genuine frozen pane
// instead: two tables side by side, the right one holding checkbox + name and
// the left one scrolling horizontally. No sticky involved, so nothing to repaint
// wrongly. The two tables stay row-aligned because every row is a fixed height
// (--row-h) and cells never wrap.
function buildBoard(rows) {
  const cols = columns();
  if (!isPhone()) {
    return h('div', { class: 'table-wrap' }, buildTable(rows, cols, 'all'));
  }
  const frozen = buildTable(rows, cols, 'frozen');
  const rest = buildTable(rows, cols, 'rest');
  const wrap = h('div', { class: `table-wrap board-split ts-${textSize}` },
    h('div', { class: 'split-frozen' }, frozen),
    h('div', { class: 'split-rest' }, rest));

  // CSS alone cannot guarantee the two panes line up: a cell height is only a
  // MINIMUM in table layout, so any row whose content is a pixel taller in one
  // pane pushes that pane out of step and the rows visibly drift apart. Measure
  // both panes and pin each row pair to the taller of the two.
  const syncRows = () => {
    const pairs = [];
    const head = [frozen.tHead?.rows[0], rest.tHead?.rows[0]];
    if (head[0] && head[1]) pairs.push(head);
    const a = frozen.tBodies[0]?.rows || [], b = rest.tBodies[0]?.rows || [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) pairs.push([a[i], b[i]]);

    // clear every override first, then measure: reading heights that are still
    // pinned from the previous pass would just re-apply the old (stale) values
    for (const [x, y] of pairs) { x.style.height = ''; y.style.height = ''; }
    const heights = pairs.map(([x, y]) =>
      Math.max(x.getBoundingClientRect().height, y.getBoundingClientRect().height));
    pairs.forEach(([x, y], i) => {
      x.style.height = `${heights[i]}px`;
      y.style.height = `${heights[i]}px`;
    });
  };
  requestAnimationFrame(syncRows);
  // fonts land after first paint and change text metrics → re-sync once more
  document.fonts?.ready?.then(() => requestAnimationFrame(syncRows));
  attachPinchZoom(wrap);
  return wrap;
}

// Pinch on the board to step through the three text sizes, like Monday. Uses
// raw touch points (not gesture events, which Chrome/Android lacks) and only
// fires once per pinch so a single gesture moves exactly one step.
function attachPinchZoom(el) {
  let startDist = 0, fired = false;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    startDist = dist(e.touches); fired = false;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !startDist || fired) return;
    const ratio = dist(e.touches) / startDist;
    if (ratio > 1.25 || ratio < 0.8) {
      const i = TEXT_SIZES.indexOf(textSize);
      const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + (ratio > 1 ? 1 : -1)))];
      fired = true;
      if (next !== textSize) setTextSize(next);
    }
  }, { passive: true });
  el.addEventListener('touchend', () => { startDist = 0; }, { passive: true });
}

// visible 3-step text-size switcher (phones) — pinching is not discoverable
function textSizeControl() {
  if (!isPhone()) return null;
  return h('div', { class: 'text-size-ctl' },
    ...[['s', 'א', 'טקסט קטן'], ['m', 'א', 'טקסט בינוני'], ['l', 'א', 'טקסט גדול']].map(([v, lbl, title]) =>
      h('button', {
        class: `ts-btn ts-btn-${v}${textSize === v ? ' active' : ''}`, title,
        onclick: () => setTextSize(v),
      }, lbl)));
}

// part: 'all' (one table) | 'frozen' (checkbox + name) | 'rest' (everything else)
function buildTable(rows, cols, part) {
  const width = (c) => Math.round((ctx.colWidths[c.key] || c.width || DEFAULT_W) * PHONE_COL_SCALE());
  const dataCols = part === 'frozen' ? cols.slice(0, 1) : part === 'rest' ? cols.slice(1) : cols;
  const hasCheckbox = part !== 'rest';
  const hasActions = part !== 'frozen';

  // fixed layout so explicit column widths are honoured exactly
  const colGroup = h('colgroup', {},
    ...(hasCheckbox ? [h('col', { style: `width:${CHECKBOX_COL_W()}px` })] : []),
    ...dataCols.map(c => h('col', { style: `width:${width(c)}px` })),
    ...(hasActions ? [h('col', { style: `width:${isPhone() ? 150 : 214}px` })] : [])); // actions: 5 icons + end padding

  const allSelected = rows.length > 0 && rows.every(l => ctx.selected.has(l.id));
  const selectAllCb = h('input', {
    type: 'checkbox', checked: allSelected,
    onclick: (e) => {
      if (e.target.checked) rows.forEach(l => ctx.selected.add(l.id));
      else rows.forEach(l => ctx.selected.delete(l.id));
      draw();
    },
  });

  // column index within THIS table, for the resize handle's colgroup lookup
  let colIndex = hasCheckbox ? 1 : 0;
  const thead = h('thead', {}, h('tr', {},
    ...(hasCheckbox ? [h('th', { class: 'checkbox-col' + (part === 'all' ? ' sticky-col-1' : '') }, selectAllCb)] : []),
    ...dataCols.map((c) => {
      const isName = part !== 'rest' && c === cols[0];
      const th = h('th', { class: `resizable${part === 'all' && isName ? ' sticky-col-2' : ''}` },
        h('span', {
          class: 'th-label',
          onclick: () => {
            if (ctx.sort.col === c.key) ctx.sort.asc = !ctx.sort.asc;
            else ctx.sort = { col: c.key, asc: true };
            resetPaging();
            draw();
          },
        }, c.label, ctx.sort.col === c.key ? h('span', { class: 'sort-arrow' }, ctx.sort.asc ? ' ▲' : ' ▼') : ''),
        // resizable on phones too (the grip gets a wider touch target in CSS),
        // so columns that don't fit can simply be widened
        resizeHandle(c, colIndex));
      colIndex++;
      return th;
    }),
    ...(hasActions ? [h('th', {}, 'פעולות')] : [])));

  const tbody = h('tbody', {}, ...rows.map(lead => buildRow(lead, cols, part)));
  return h('table', { class: `board grid pane-${part}` }, colGroup, thead, tbody);
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
      ctx.colWidths[col.key] = Math.round(w / PHONE_COL_SCALE());
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

function buildRow(lead, cols, part = 'all') {
  const selectCb = h('input', {
    type: 'checkbox', checked: ctx.selected.has(lead.id),
    onclick: (e) => {
      e.stopPropagation();
      e.target.checked ? ctx.selected.add(lead.id) : ctx.selected.delete(lead.id);
      draw();
    },
  });
  const dataCols = part === 'frozen' ? cols.slice(0, 1) : part === 'rest' ? cols.slice(1) : cols;
  const tr = h('tr', {
    dataset: { id: lead.id },
    class: ctx.selected.has(lead.id) ? 'row-selected' : '',
  },
    ...(part !== 'rest'
      ? [h('td', { class: 'checkbox-col' + (part === 'all' ? ' sticky-col-1' : '') }, selectCb)]
      : []),
    ...dataCols.map(c => c === cols[0] ? buildNameCell(lead, c, part) : buildCell(lead, c)),
    ...(part === 'frozen' ? [] : [h('td', {}, h('div', { class: 'row-actions' },
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
      }, '🗑️')))]));
  attachLongPress(tr, lead);
  return tr;
}

// the name column stays visible while the fields scroll — pinned via sticky on
// desktop, in the frozen pane on phones. (💬 updates is its own column now,
// immediately after this one, matching Monday.)
function buildNameCell(lead, col, part = 'all') {
  const td = buildCell(lead, col);
  td.classList.add('name-cell');
  if (part === 'all') td.classList.add('sticky-col-2');
  // The <td> itself must stay a real table cell — `display:flex` on a sticky td
  // is unreliable in Safari/iOS — so the name row lives in an inner wrapper.
  td.append(h('div', { class: 'name-cell-inner' }, ...td.childNodes));
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

  // the 💬 updates entry point, as its own column right after the name
  if (col.type === 'updates') {
    td.classList.add('updates-col');
    td.append(h('button', {
      class: 'icon-btn updates-inline', title: 'עדכונים ותכתובת',
      onclick: (e) => { e.stopPropagation(); openUpdatesDrawer(lead); },
    }, '💬', lead.updates_count ? h('sup', {}, lead.updates_count) : ''));
    return td;
  }

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

  // a pasteable URL with a click-through button, so old Monday contract links
  // and the live proposal link both open in one tap
  if (col.type === 'link') {
    const val = lead[col.key] ?? '';
    const input = h('input', { class: 'cell-edit', type: 'text', dir: 'ltr', value: val, placeholder: 'https://…' });
    input.addEventListener('change', () => save(input.value.trim()));
    const open = h('a', {
      class: 'icon-btn link-open', title: 'פתיחת הקישור', target: '_blank', rel: 'noopener noreferrer',
      href: /^https?:\/\//i.test(val) ? val : '#',
    }, '🔗');
    if (!/^https?:\/\//i.test(val)) open.style.visibility = 'hidden';
    td.append(h('div', { class: 'link-cell' }, input, open));
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

// ---------------- LOST flow ----------------
// Reason + competitor are recommended, not required: historical leads genuinely
// don't have them, and blocking the move only pushed people to invent answers.
function openLostModal(lead, onCancel, onDone) {
  const reason = h('textarea', { rows: 3, placeholder: 'למה הפסדנו את הליד?' });
  const compSel = h('select', {},
    h('option', { value: '' }, '— בחר מתחרה —'),
    ...ctx.competitors.map(c => h('option', { value: c.name }, c.name)),
    h('option', { value: '__new__' }, '+ מתחרה חדש…'));
  const newComp = h('input', { type: 'text', placeholder: 'שם המתחרה החדש', style: 'display:none;margin-top:6px' });
  compSel.addEventListener('change', () => { newComp.style.display = compSel.value === '__new__' ? '' : 'none'; });

  const m = modal(`העברת "${lead.name}" ל-LOST`, h('div', {},
    h('p', { class: 'muted' }, 'מומלץ למלא סיבת הפסד ומתחרה — אבל אפשר גם להשאיר ריק ולהשלים מאוחר יותר.'),
    h('label', { class: 'field' }, h('span', {}, 'סיבת הפסד'), reason),
    h('label', { class: 'field' }, h('span', {}, 'המתחרה שזכה'), compSel, newComp)), {
    actions: [
      {
        label: 'העברה ל-LOST', kind: 'danger', onclick: async (close) => {
          const competitor = compSel.value === '__new__' ? newComp.value.trim() : compSel.value;
          try {
            if (compSel.value === '__new__' && competitor) {
              await post('/leads/meta/competitors', { name: competitor });
            }
            const { lead: updated } = await patch(`/leads/${lead.id}`, {
              sale_status: 'lost',
              lost_reason: reason.value.trim() || null,
              lost_competitor: competitor || null,
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
    for (const [id, label] of [['updates', '💬 עדכונים'], ['card', '🪪 כרטיס'], ['reminders', '⏰ תזכורות'], ['whatsapp', '🟢 וואטסאפ']]) {
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
    else if (tab === 'whatsapp') await renderWhatsappTab();
    else await renderRemindersTab();
  }

  // ---- WhatsApp thread: chat bubbles + send box ----
  async function renderWhatsappTab() {
    const dfmt = (d) => new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const paint = (messages, wa) => {
      bodyEl.innerHTML = '';
      const chat = h('div', { class: 'wa-chat' });
      if (!messages.length) {
        chat.append(h('p', { class: 'muted', style: 'text-align:center;margin-top:20px' }, 'אין הודעות וואטסאפ לליד הזה עדיין.'));
      }
      for (const m of messages) {
        chat.append(h('div', { class: `wa-msg ${m.direction === 'out' ? 'out' : 'in'}` },
          h('div', { class: 'wa-body' }, m.body || ''),
          h('div', { class: 'wa-time' }, dfmt(m.created_at))));
      }
      bodyEl.append(chat);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      // reflect connection state in the footer
      footerEl.innerHTML = '';
      const ta = h('textarea', { rows: 1, placeholder: wa.connected ? 'הודעת וואטסאפ…' : 'וואטסאפ אינו מחובר (הגדרות → וואטסאפ)' });

      // insert an emoji at the caret (or append) and keep focus
      const insertEmoji = (emo) => {
        const s = ta.selectionStart ?? ta.value.length;
        const e = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, s) + emo + ta.value.slice(e);
        const pos = s + emo.length;
        ta.focus(); ta.setSelectionRange(pos, pos);
      };
      const EMOJIS = ['😀', '😊', '😍', '👍', '🙏', '🎉', '🎷', '🎶', '❤️', '🔥', '✨', '😅', '🙌', '💪', '👏', '😎', '🥂', '💍', '📅', '✅', '😢', '🤔', '📞', '💬'];
      const palette = h('div', { class: 'emoji-palette' },
        ...EMOJIS.map(e => h('button', { type: 'button', class: 'emoji-btn', onclick: () => insertEmoji(e) }, e)));
      palette.style.display = 'none';
      const emojiToggle = h('button', { type: 'button', class: 'btn sm', title: 'אימוג׳י', onclick: () => { palette.style.display = palette.style.display === 'none' ? 'flex' : 'none'; } }, '😊');

      const sendBtn = h('button', {
        class: 'btn primary', disabled: !wa.connected,
        onclick: withBusy(async () => {
          if (!ta.value.trim()) return;
          try {
            await post(`/leads/${lead.id}/messages`, { body: ta.value.trim() });
            ta.value = '';
            const fresh = await get(`/leads/${lead.id}/messages`);
            paint(fresh.messages, fresh.wa);
          } catch (e) { toast(e.message, 'error'); }
        }),
      }, 'שליחה');
      footerEl.append(palette, h('div', { class: 'flex' }, emojiToggle, ta, sendBtn));
    };
    try {
      const { messages, wa } = await get(`/leads/${lead.id}/messages`);
      paint(messages, wa);
    } catch (e) {
      bodyEl.append(h('p', { class: 'muted' }, e.message));
    }
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
      // always shown on the Israel clock, so the list matches when it really fires
      const when = formatIsrael(r.remind_at);
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

  // Default: tomorrow 09:00 ISRAEL time. The picker is read as Israel wall clock
  // regardless of the device's timezone, so a reminder set from a laptop on
  // another zone (or a phone abroad) still fires when the band expects it.
  const tomorrow = toIsraelInputValue(new Date(Date.now() + 24 * 3600 * 1000)).slice(0, 10);
  const when = h('input', { type: 'datetime-local', value: `${tomorrow}T09:00` });
  const whenHint = h('p', { class: 'muted', style: 'font-size:12px;margin:4px 0 0' });
  const syncWhen = () => {
    whenHint.textContent = when.value
      ? `⏰ תישלח ב-${formatIsrael(israelInputValueToDate(when.value))} (שעון ישראל)`
      : '';
  };
  when.addEventListener('input', syncWhen);
  syncWhen();
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
    h('label', { class: 'field' }, h('span', {}, 'מתי * (שעון ישראל)'), when, whenHint),
    h('label', { class: 'field' }, h('span', {}, 'תוכן התזכורת'), message),
    warn), {
    actions: [
      {
        label: 'קביעת תזכורת', kind: 'primary', onclick: async (close) => {
          if (!when.value) { toast('יש לבחור תאריך ושעה', 'error'); return false; }
          try {
            await post(`/leads/${lead.id}/reminders`, {
              channel: channel.value,
              remind_at: israelInputValueToDate(when.value).toISOString(),
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
// ---------------- duplicate detection by phone ----------------
// Two leads sharing a phone number are almost always the same couple entered
// twice (import + WhatsApp + manual). Numbers are compared by phoneKey, so the
// same line written in different formats still pairs up. phone1 and phone2 are
// both considered — a duplicate often has the number in the other slot.
// includeApproved: pass true to also get the groups the team already confirmed
// are legitimate (one producer, many events) — used by the "approved" list.
function phoneDuplicateGroups(includeApproved = false) {
  const byKey = new Map();
  for (const l of ctx.leads) {
    // one lead counts once per distinct number, so a lead whose phone1 and
    // phone2 are the same value doesn't pair with itself
    const keys = new Set([phoneKey(l.phone1), phoneKey(l.phone2)].filter(Boolean));
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(l);
    }
  }
  const approved = new Map((ctx.dismissals || []).map(d => [d.phone_key, d]));
  return [...byKey.entries()]
    .filter(([, ls]) => ls.length > 1)
    .filter(([k]) => includeApproved ? approved.has(k) : !approved.has(k))
    .map(([key, leads]) => ({ key, leads, approval: approved.get(key) || null }))
    .sort((a, b) => b.leads.length - a.leads.length);
}

// slim banner above the board — visible, but never blocking
function duplicateBanner() {
  const groups = phoneDuplicateGroups();
  if (!groups.length) return null;
  const leadCount = new Set(groups.flatMap(g => g.leads.map(l => l.id))).size;
  return h('div', { class: 'dup-banner' },
    h('span', {}, `📞 נמצאו ${groups.length} מספרי טלפון שחוזרים ביותר מליד אחד (${leadCount} רשומות)`),
    h('span', { style: 'flex:1' }),
    h('button', { class: 'btn sm primary', onclick: () => openDuplicateReview() }, 'סקירה, מיזוג ואישור'));
}

function openDuplicateReview(showApproved = false) {
  const body = h('div', {});
  let m = null;

  // "not a duplicate": a producer books many weddings on one number. Approving
  // hides the number for the whole team; it stays listed under "approved" so it
  // can be undone.
  const approve = async (g) => {
    const label = g.leads.map(l => l.contact_name || l.name).filter(Boolean)[0] || '';
    try {
      await post('/leads/meta/duplicate-dismissals', { phone_key: g.key, note: label });
      await reload(false);
      toast('סומן כלא-כפילות ✓', 'success');
      drawList();
    } catch (e) { toast(e.message, 'error'); }
  };
  const undo = async (g) => {
    try {
      await del(`/leads/meta/duplicate-dismissals/${encodeURIComponent(g.key)}`);
      await reload(false);
      toast('הוחזר לרשימת הכפילויות', 'success');
      drawList();
    } catch (e) { toast(e.message, 'error'); }
  };

  const groupCard = (g, approved) => {
    const { display } = formatPhone(g.leads[0].phone1 || g.leads[0].phone2 || g.key);
    const rows = g.leads.map(l => h('div', { class: 'dup-lead' },
      h('div', {},
        h('b', {}, l.name),
        h('span', { class: 'muted' }, ` · ${(l.sale_status || '').toUpperCase()}`),
        h('div', { class: 'muted', style: 'font-size:12px' },
          [l.contact_name, l.event_date, l.event_location].filter(Boolean).join(' · ') || '—')),
      h('span', { style: 'flex:1' }),
      approved ? null : h('button', {
        class: 'btn sm', onclick: () => {
          const other = g.leads.find(x => x.id !== l.id);
          m?.close?.();
          openMergeResolve(l, other, () => openDuplicateReview(showApproved));
        },
      }, g.leads.length === 2 ? '✅ שמור את זה ומזג' : '✅ שמור את זה')));

    return h('div', { class: 'card dup-group' },
      h('div', { class: 'dup-head' },
        h('div', { class: 'dup-phone' }, `📞 ${display}`,
          g.leads.length > 2 ? h('span', { class: 'muted' }, ` · ${g.leads.length} רשומות`) : null),
        h('span', { style: 'flex:1' }),
        approved
          ? h('button', { class: 'btn sm', onclick: () => undo(g) }, '↩︎ החזרה לבדיקה')
          : h('button', { class: 'btn sm ghost', title: 'אירועים שונים של אותו איש קשר — לא למזג', onclick: () => approve(g) },
            '👤 לא כפילות — אשר')),
      ...rows);
  };

  const drawList = () => {
    body.innerHTML = '';
    const pending = phoneDuplicateGroups(false);
    const approvedGroups = phoneDuplicateGroups(true);

    // tabs: what still needs a decision vs what was already approved
    body.append(h('div', { class: 'dup-tabs' },
      h('button', {
        class: showApproved ? '' : 'active',
        onclick: () => { showApproved = false; drawList(); },
      }, `לבדיקה (${pending.length})`),
      h('button', {
        class: showApproved ? 'active' : '',
        onclick: () => { showApproved = true; drawList(); },
      }, `מאושרים כלא-כפילות (${approvedGroups.length})`)));

    const list = showApproved ? approvedGroups : pending;
    if (!list.length) {
      body.append(h('div', { class: 'empty-state' },
        h('div', { class: 'big' }, showApproved ? '👤' : '✅'),
        h('p', {}, showApproved
          ? 'עדיין לא אישרתם מספרים כלא-כפילות'
          : 'לא נותרו כפילויות לבדיקה')));
      return;
    }
    body.append(h('p', { class: 'muted' }, showApproved
      ? 'המספרים האלה אושרו כשייכים לאותו איש קשר עם אירועים שונים — הם לא יופיעו יותר בבדיקה.'
      : 'כל קבוצה חולקת את אותו מספר. אם זה מפיק/ה עם אירועים שונים — לחצו "לא כפילות". אחרת בחרו איזה ליד נשאר.'));
    for (const g of list) body.append(groupCard(g, showApproved));
  };

  drawList();
  m = modal('🔀 כפילויות לפי טלפון', body, {
    wide: true,
    actions: [{ label: 'סגירה', onclick: (close) => close() }],
  });
}

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

function openMergeResolve(primary, dup, onDone) {
  const cols = columns().filter(c => !['contacts', 'readonly', 'status'].includes(c.type));
  const conflicts = cols.filter(c => {
    const a = primary[c.key], b = dup[c.key];
    return a != null && a !== '' && b != null && b !== '' && String(a) !== String(b);
  });
  const resolutions = {};
  const body = h('div', {},
    // which record survives matters (the other is deleted), so make the roles
    // explicit and let them be swapped without going back to the board
    h('div', { class: 'card', style: 'padding:10px;margin-bottom:12px' },
      h('div', {}, h('b', {}, '✅ נשאר: '), primary.name,
        h('span', { class: 'muted' }, ` · ${primary.phone1 || 'ללא טלפון'}`)),
      h('div', { style: 'margin-top:4px' }, h('b', {}, '🗑️ יימחק אחרי המיזוג: '), dup.name,
        h('span', { class: 'muted' }, ` · ${dup.phone1 || 'ללא טלפון'}`)),
      h('button', {
        class: 'btn sm', style: 'margin-top:8px',
        onclick: (e) => {
          e.target.closest('.modal-backdrop')?.remove();
          openMergeResolve(dup, primary, onDone);
        },
      }, '⇄ החלפה — שהשני יישאר')),
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
            ctx.selected.delete(primary.id); ctx.selected.delete(dup.id);
            toast('הלידים מוזגו בהצלחה', 'success');
            await reload();
            onDone?.();
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
  let mediaRecorder = null, chunks = [], stream = null, tick = null, started = 0;

  const status = h('p', { class: 'muted' }, 'מבקש גישה למיקרופון…');
  const timer = h('div', { class: 'rec-timer' }, '0:00');
  // one button, one job — recording starts by itself, so the whole capture is
  // open → talk → tap once. A second tap used to be needed just to say "analyse".
  const recBtn = h('button', { class: 'btn primary lg' }, '⏹️ סיום וניתוח');
  const retryBtn = h('button', { class: 'btn', style: 'display:none' }, '🔴 הקלטה מחדש');
  const result = h('div', {});

  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function stopTracks() {
    clearInterval(tick); tick = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
  }

  async function startRecording() {
    retryBtn.style.display = 'none';
    result.innerHTML = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      chunks = [];
      // Opus at 24kbps is plenty for speech and roughly a quarter of the default
      // size — on a phone the upload is the slowest part of the whole flow.
      const opts = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 }
        : { audioBitsPerSecond: 24000 };
      mediaRecorder = new MediaRecorder(stream, opts);
      mediaRecorder.ondataavailable = e => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stopTracks();
        analyze(blob);
      };
      mediaRecorder.start();
      started = Date.now();
      timer.textContent = '0:00';
      timer.classList.add('on');
      tick = setInterval(() => { timer.textContent = fmt(Math.floor((Date.now() - started) / 1000)); }, 250);
      recBtn.disabled = false;
      recBtn.textContent = '⏹️ סיום וניתוח';
      status.textContent = 'מקליט… דברו חופשי — שם, תאריך, מקום, טלפון, מחיר.';
    } catch {
      timer.classList.remove('on');
      status.textContent = 'אין גישה למיקרופון. אשרו את ההרשאה בדפדפן ונסו שוב.';
      recBtn.style.display = 'none';
      retryBtn.style.display = '';
    }
  }

  recBtn.addEventListener('click', () => {
    if (mediaRecorder?.state !== 'recording') return;
    recBtn.disabled = true;
    mediaRecorder.stop(); // onstop uploads straight away
  });
  retryBtn.addEventListener('click', () => { recBtn.style.display = ''; startRecording(); });

  async function analyze(blob) {
    timer.classList.remove('on');
    status.textContent = '⏳ מתמלל ומנתח…';
    recBtn.textContent = '⏳ מנתח…';
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'recording.webm');
      if (isLead) fd.append('lead_id', lead.id);
      const { voice_note } = await upload('/voice', fd);
      renderExtractReview(voice_note);
    } catch (e) {
      toast(e.message, 'error');
      status.textContent = `הניתוח נכשל: ${e.message}`;
      recBtn.style.display = 'none';
      retryBtn.style.display = '';
    }
  }

  // every field the AI can now fill — anything missing here would show as a raw
  // column name in the review list
  const fieldLabels = {
    name: 'שם', contact_name: 'איש קשר', groom_name: 'שם החתן', bride_name: 'שם הכלה',
    relation: 'קרבה', event_type: 'סוג אירוע', event_date: 'תאריך אירוע',
    event_location: 'מיקום האירוע', email: 'מייל', phone1: 'טלפון 1', phone2: 'טלפון 2',
    id_number: 'ת"ז', address: 'כתובת', proposed_price: 'מחיר שהוצע', deposit_amount: 'מקדמה',
    package_type: 'סוג חבילה', date_status: 'סטטוס תאריך', hear_about_us: 'איך שמעו עלינו',
    referrer: 'מי המליץ', came_to_see_event: 'באו לראות באירוע', seen_at_date: 'הגיעו בתאריך',
    seen_at_place: 'מקום שראו', next_action: 'פעולה הבאה', team: 'צוות', notes: 'הערות',
  };
  const DATE_KEYS = ['event_date', 'seen_at_date'];

  function renderExtractReview(note) {
    result.innerHTML = '';
    const inputs = {};
    result.append(
      h('h4', { class: 'mt' }, '📝 תמלול'),
      h('p', { class: 'muted', style: 'max-height:90px;overflow-y:auto' }, note.transcript || ''),
      h('h4', {}, '🤖 שדות שזוהו — ניתן לערוך לפני שמירה'),
      ...Object.entries(note.extracted || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => {
        inputs[k] = h('input', { type: DATE_KEYS.includes(k) ? 'date' : 'text', value: v });
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
    recBtn.style.display = 'none';
    retryBtn.style.display = '';
    retryBtn.textContent = '🔴 הקלטה נוספת';
    status.style.display = 'none';
    timer.style.display = 'none';
  }

  const m = modal(isLead ? `🎙️ הקלטה קולית — ${lead.name}` : '🎙️ ליד חדש מהקלטה קולית',
    h('div', {}, status, timer, h('div', { class: 'flex', style: 'flex-wrap:wrap' }, recBtn, retryBtn), result));

  // release the mic if the modal is dismissed mid-recording
  m?.box?.closest('.modal-backdrop')?.addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) stopTracks();
  });
  startRecording();
}

// ---------------- calendar ----------------
async function syncToCalendar(lead) {
  try {
    const rsp = await post(`/calendar/sync/${lead.id}`, {});
    if (rsp.result?.mock) toast('Google Calendar לא מוגדר — הזן מפתחות Google ב-.env וחבר את היומן בהגדרות', 'error');
    else toast('הליד סונכרן ליומן Google ✓', 'success');
  } catch (e) { toast(e.message, 'error'); }
}
