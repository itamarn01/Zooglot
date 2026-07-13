// Monday-style Excel/CSV import wizard for מעקב זוגות.
// Steps:  choose what to import → upload → map columns → (leads: handle matches) → import.
import { get, post, upload } from '../api.js';
import { h, toast } from '../ui.js';

export async function openImportWizard(onDone) {
  let fields;
  try { fields = await get('/import/fields'); }
  catch (e) { toast(e.message, 'error'); return; }
  const targets = fields.targets;
  const targetByKey = Object.fromEntries(targets.map(t => [t.key, t]));

  const state = {
    mode: 'leads',          // 'leads' | 'updates'
    step: 'mode',
    columns: [], rows: [], suggested: {},
    mapping: {},            // leads: {sourceCol: targetKey}
    umap: {},               // updates: {match,content,author,date} → sourceCol
    matchStrategy: 'add',   // add | skip | update
    matchField: 'name',     // name | source_ref
    result: null,
  };

  // ---- shell ----
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => backdrop.remove();
  const stepsBar = h('div', { class: 'wiz-steps' });
  const body = h('div', { class: 'wiz-body' });
  const footer = h('div', { class: 'wiz-footer' });
  const box = h('div', { class: 'modal wide wizard' },
    h('div', { class: 'flex between' },
      h('h3', {}, '📥 ייבוא מאקסל'),
      h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'סגור' }, '✕')),
    stepsBar, body, footer);
  backdrop.append(box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);

  const STEP_LABELS = {
    leads: [['mode', 'בחירה'], ['upload', 'העלאה'], ['map', 'מיפוי טורים'], ['matches', 'התאמות'], ['done', 'ייבוא']],
    updates: [['mode', 'בחירה'], ['upload', 'העלאה'], ['umap', 'מיפוי טורים'], ['done', 'ייבוא']],
  };

  function drawSteps() {
    stepsBar.innerHTML = '';
    const list = STEP_LABELS[state.mode];
    const curIdx = list.findIndex(([s]) => s === state.step);
    list.forEach(([s, label], i) => {
      stepsBar.append(h('div', { class: `wiz-step${i === curIdx ? ' active' : ''}${i < curIdx ? ' done' : ''}` },
        h('span', { class: 'wiz-dot' }, i < curIdx ? '✓' : String(i + 1)),
        h('span', {}, label)));
      if (i < list.length - 1) stepsBar.append(h('span', { class: 'wiz-sep' }));
    });
  }

  function setFooter(...btns) { footer.innerHTML = ''; footer.append(...btns); }
  const btn = (label, opts = {}) => h('button', { class: `btn ${opts.kind || ''}`, onclick: opts.onclick, disabled: opts.disabled }, label);

  // ---- step: choose mode ----
  function renderMode() {
    body.innerHTML = '';
    const card = (mode, emoji, title, desc) => h('div', {
      class: `card wiz-choice${state.mode === mode ? ' sel' : ''}`,
      onclick: () => { state.mode = mode; drawSteps(); renderMode(); },
    }, h('div', { style: 'font-size:30px' }, emoji), h('h4', { style: 'margin:6px 0' }, title), h('p', { class: 'muted' }, desc));
    body.append(
      h('p', { class: 'muted' }, 'מה תרצו לייבא? העלו קובץ Excel (‎.xlsx/.xls) או CSV.'),
      h('div', { class: 'grid-2' },
        card('leads', '🎷', 'לידים (מעקב זוגות)', 'יצירת/עדכון שורות מעקב זוגות מתוך קובץ אקסל, עם מיפוי טורים.'),
        card('updates', '💬', 'עדכונים (Updates ממנדי)', 'ייבוא אזור העדכונים/תכתובת לתוך הלידים הקיימים, לפי שם או מזהה.')));
    setFooter(btn('המשך', { kind: 'primary', onclick: () => { state.step = 'upload'; drawSteps(); renderUpload(); } }));
  }

  // ---- step: upload ----
  function renderUpload() {
    body.innerHTML = '';
    const fileInput = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none' });
    const drop = h('div', { class: 'wiz-drop' },
      h('div', { style: 'font-size:34px' }, '📄'),
      h('p', {}, 'גררו לכאן קובץ, או '),
      btn('בחירת קובץ', { kind: 'primary', onclick: () => fileInput.click() }),
      h('p', { class: 'muted', style: 'margin-top:8px' }, 'נתמכים: ‎.xlsx, .xls, .csv'),
      fileInput);
    const status = h('p', { class: 'muted' });
    body.append(drop, status);

    const doParse = async (file) => {
      status.textContent = `מנתח את "${file.name}"…`;
      const fd = new FormData();
      fd.append('file', file, file.name);
      try {
        const rsp = await upload('/import/parse', fd);
        state.columns = rsp.columns; state.rows = rsp.rows; state.suggested = rsp.suggested_mapping || {};
        if (!state.rows.length) { toast('לא נמצאו שורות בקובץ', 'error'); status.textContent = ''; return; }
        if (state.mode === 'leads') { initLeadMapping(); state.step = 'map'; drawSteps(); renderMap(); }
        else { initUpdatesMapping(); state.step = 'umap'; drawSteps(); renderUpdatesMap(); }
      } catch (e) { toast(e.message, 'error'); status.textContent = ''; }
    };
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) doParse(fileInput.files[0]); });
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) doParse(e.dataTransfer.files[0]); });

    setFooter(btn('חזרה', { onclick: () => { state.step = 'mode'; drawSteps(); renderMode(); } }));
  }

  // ---- leads: column mapping ----
  function initLeadMapping() {
    state.mapping = { ...state.suggested };
    // default match field: prefer an external id column if one was mapped
    state.matchField = Object.values(state.mapping).includes('source_ref') ? 'source_ref' : 'name';
  }

  function renderMap() {
    body.innerHTML = '';
    const usedKeys = () => new Set(Object.values(state.mapping).filter(Boolean));
    const preview = state.rows.slice(0, 6);

    const headRow = h('tr', {}, ...state.columns.map(col => {
      const sel = h('select', {},
        h('option', { value: '' }, '— אל תייבא —'),
        ...targets.map(t => h('option', { value: t.key, selected: state.mapping[col] === t.key }, t.label + (t.required ? ' *' : ''))));
      sel.addEventListener('change', () => {
        const key = sel.value;
        // a target can only be used once — clear it from any other column
        if (key) for (const c of Object.keys(state.mapping)) if (c !== col && state.mapping[c] === key) delete state.mapping[c];
        if (key) state.mapping[col] = key; else delete state.mapping[col];
        state.matchField = usedKeys().has('source_ref') ? state.matchField : 'name';
        renderMap();
      });
      return h('th', {}, h('div', { class: 'muted', style: 'font-weight:700;color:var(--text)' }, col), sel);
    }));
    const bodyRows = preview.map(r => h('tr', {}, ...state.columns.map(col =>
      h('td', {}, String(r[col] ?? '').slice(0, 40)))));

    const mappedCount = usedKeys().size;
    body.append(
      h('h4', {}, 'מיפוי טורים — כך יראו הנתונים בייבוא'),
      h('p', { class: 'muted' }, `התאימו כל טור בקובץ לשדה במערכת (או "אל תייבא"). מוצגות ${preview.length} שורות ראשונות מתוך ${state.rows.length}.`),
      h('div', { class: 'wiz-table-wrap' }, h('table', { class: 'wiz-table' }, h('thead', {}, headRow), h('tbody', {}, ...bodyRows))),
      !usedKeys().has('name') ? h('p', { style: 'color:var(--danger)' }, '⚠️ חובה למפות טור אחד לשדה "שם".') : h('p', { class: 'muted' }, `${mappedCount} שדות ממופים.`));

    setFooter(
      btn('חזרה', { onclick: () => { state.step = 'upload'; drawSteps(); renderUpload(); } }),
      btn('המשך', { kind: 'primary', disabled: !usedKeys().has('name'), onclick: () => { state.step = 'matches'; drawSteps(); renderMatches(); } }));
  }

  // ---- leads: handle matches ----
  function renderMatches() {
    body.innerHTML = '';
    const hasExtId = Object.values(state.mapping).includes('source_ref');
    const opt = (val, title, desc) => {
      const radio = h('input', { type: 'radio', name: 'match-strat', checked: state.matchStrategy === val, style: 'width:auto' });
      radio.addEventListener('change', () => { state.matchStrategy = val; renderMatches(); });
      return h('label', { class: `card wiz-radio${state.matchStrategy === val ? ' sel' : ''}`, style: 'cursor:pointer;display:flex;gap:10px;align-items:flex-start' },
        radio, h('div', {}, h('b', {}, title), h('p', { class: 'muted', style: 'margin:2px 0 0' }, desc)));
    };
    const matchFieldSel = h('select', { style: 'max-width:260px' },
      h('option', { value: 'name', selected: state.matchField === 'name' }, 'לפי שם הליד'),
      hasExtId ? h('option', { value: 'source_ref', selected: state.matchField === 'source_ref' }, 'לפי מזהה חיצוני (Item ID)') : null);
    matchFieldSel.addEventListener('change', () => { state.matchField = matchFieldSel.value; });

    body.append(
      h('h4', {}, 'טיפול בהתאמות'),
      h('p', { class: 'muted' }, 'כשנמצאת שורה קיימת עם אותו ערך — מה לעשות?'),
      opt('add', 'הוספת כל השורות כחדשות', 'ייווצרו לידים חדשים לכל השורות, גם אם קיים ליד תואם.'),
      opt('skip', 'דילוג על התאמות', 'שורות שכבר קיימות (לפי שדה הזיהוי) יידלגו.'),
      opt('update', 'עדכון התאמות', 'לידים קיימים יעודכנו בערכים מהקובץ; חדשים ייווצרו.'),
      (state.matchStrategy !== 'add')
        ? h('label', { class: 'field mt' }, h('span', {}, 'זיהוי כפילות'), matchFieldSel) : null);

    setFooter(
      btn('חזרה', { onclick: () => { state.step = 'map'; drawSteps(); renderMap(); } }),
      importBtn(async () => {
        const rsp = await post('/import/leads', {
          rows: state.rows, mapping: state.mapping,
          match_strategy: state.matchStrategy, match_field: state.matchField,
        });
        state.result = rsp;
      }));
  }

  // ---- updates: mapping ----
  function initUpdatesMapping() {
    const find = (aliases) => state.columns.find(c => aliases.some(a => c.trim().toLowerCase() === a));
    state.umap = {
      match: find(['item name', 'שם', 'name']) || state.columns[0],
      matchField: 'name',
      content: find(['update content', 'תוכן', 'content', 'body']) || '',
      author: find(['user', 'author', 'משתמש']) || '',
      date: find(['created at', 'date', 'תאריך']) || '',
    };
  }

  function renderUpdatesMap() {
    body.innerHTML = '';
    const colSel = (val, allowEmpty, onchange) => {
      const sel = h('select', {}, allowEmpty ? h('option', { value: '' }, '— ללא —') : null,
        ...state.columns.map(c => h('option', { value: c, selected: val === c }, c)));
      sel.addEventListener('change', () => onchange(sel.value));
      return sel;
    };
    const hasExtId = state.columns.some(c => /item id/i.test(c));
    const matchFieldSel = h('select', {},
      h('option', { value: 'name', selected: state.umap.matchField === 'name' }, 'שם הליד'),
      hasExtId ? h('option', { value: 'source_ref', selected: state.umap.matchField === 'source_ref' }, 'מזהה חיצוני (Item ID)') : null);
    matchFieldSel.addEventListener('change', () => { state.umap.matchField = matchFieldSel.value; });

    const preview = state.rows.slice(0, 5);
    body.append(
      h('h4', {}, 'מיפוי עמודות העדכונים'),
      h('p', { class: 'muted' }, 'נתאים כל עדכון לליד הקיים לפי עמודת הזיהוי. עדכונים שלא יימצא להם ליד תואם — יידלגו.'),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'עמודת זיהוי הליד *'), colSel(state.umap.match, false, v => state.umap.match = v)),
        h('label', { class: 'field' }, h('span', {}, 'התאמה מול'), matchFieldSel),
        h('label', { class: 'field' }, h('span', {}, 'תוכן העדכון *'), colSel(state.umap.content, false, v => state.umap.content = v)),
        h('label', { class: 'field' }, h('span', {}, 'כותב (אופציונלי)'), colSel(state.umap.author, true, v => state.umap.author = v)),
        h('label', { class: 'field' }, h('span', {}, 'תאריך (אופציונלי)'), colSel(state.umap.date, true, v => state.umap.date = v))),
      h('div', { class: 'wiz-table-wrap' }, h('table', { class: 'wiz-table' },
        h('thead', {}, h('tr', {}, ...state.columns.map(c => h('th', {}, c)))),
        h('tbody', {}, ...preview.map(r => h('tr', {}, ...state.columns.map(c => h('td', {}, String(r[c] ?? '').slice(0, 40)))))))));

    setFooter(
      btn('חזרה', { onclick: () => { state.step = 'upload'; drawSteps(); renderUpload(); } }),
      importBtn(async () => {
        if (!state.umap.match || !state.umap.content) { toast('יש לבחור עמודת זיהוי ותוכן', 'error'); throw new Error('mapping'); }
        const rsp = await post('/import/updates', {
          rows: state.rows,
          mapping: { match: state.umap.match, content: state.umap.content, author: state.umap.author || undefined, date: state.umap.date || undefined },
          match_field: state.umap.matchField,
        });
        state.result = rsp;
      }));
  }

  // shared "run import" button with spinner + move to done step
  function importBtn(run) {
    const b = h('button', { class: 'btn primary' }, '🚀 התחל ייבוא');
    b.addEventListener('click', async () => {
      if (b.classList.contains('loading')) return;
      b.classList.add('loading');
      try { await run(); state.step = 'done'; drawSteps(); renderDone(); }
      catch (e) { if (e.message !== 'mapping') toast(e.message, 'error'); }
      finally { b.classList.remove('loading'); }
    });
    return b;
  }

  // ---- done ----
  function renderDone() {
    body.innerHTML = '';
    const r = state.result || {};
    const stat = (n, label, color) => h('div', { class: 'card stat-tile', style: 'padding:14px' },
      h('div', { class: 'num', style: `font-size:26px${color ? `;color:${color}` : ''}` }, String(n ?? 0)),
      h('div', { class: 'lbl' }, label));
    const errorsCard = (errors) => (errors && errors.length)
      ? h('div', { class: 'card mt' },
        h('p', { style: 'color:var(--danger);font-weight:700' }, `⚠️ סיבות הכשלון (${errors.length}${errors.length >= 20 ? '+' : ''}):`),
        h('div', { class: 'wiz-table-wrap' }, h('table', { class: 'wiz-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'שורה'), h('th', {}, 'שם'), h('th', {}, 'סיבה'))),
          h('tbody', {}, ...errors.map(e => h('tr', {},
            h('td', {}, String(e.row)), h('td', {}, e.name || '—'), h('td', {}, e.reason)))))))
      : null;

    if (state.mode === 'leads') {
      body.append(
        h('h4', {}, r.failed ? '⚠️ הייבוא הסתיים עם שגיאות' : '✅ הייבוא הושלם'),
        h('div', { class: 'grid-4' },
          stat(r.created, 'נוצרו', 'var(--win)'),
          stat(r.updated, 'עודכנו', 'var(--accent-cyan)'),
          stat(r.skipped, 'דולגו'),
          stat(r.failed, 'נכשלו', r.failed ? 'var(--danger)' : null)),
        errorsCard(r.errors));
    } else {
      body.append(
        h('h4', {}, r.failed ? '⚠️ ייבוא העדכונים הסתיים עם שגיאות' : '✅ ייבוא העדכונים הושלם'),
        h('div', { class: 'grid-3' },
          stat(r.imported, 'עדכונים יובאו', 'var(--win)'),
          stat(r.unmatched, 'ללא ליד תואם', r.unmatched ? 'var(--accent-orange)' : null),
          stat(r.empty, 'ריקים / דולגו')),
        (r.missing && r.missing.length)
          ? h('div', { class: 'card mt' }, h('p', { class: 'muted' }, 'לא נמצא ליד תואם עבור:'),
            h('p', {}, r.missing.join(' · ')))
          : null,
        errorsCard(r.errors));
    }
    setFooter(btn('סיום', { kind: 'primary', onclick: () => { close(); onDone?.(); } }));
  }

  drawSteps();
  renderMode();
}
