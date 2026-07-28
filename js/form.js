// Public lead-capture form renderer (built by the form builder in Settings).
//
// Two shapes, chosen per form:
//   single — every field on one page (best for 2–3 fields)
//   steps  — fields split across numbered steps. Starting is cheap and the
//            progress bar shows how close the end is, so more people finish
//            (Zeigarnik effect). Sensitive fields go last, once the visitor is
//            already invested.
//
// Every view is tracked so the band can see views, submissions, completion rate
// and where people drop off. Tracking is best-effort and never blocks a submit.
const API_BASE = window.__API_BASE__ || '';
const slug = new URLSearchParams(location.search).get('f');
const root = document.getElementById('form-root');

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}

// ---- analytics ----
const startedAt = Date.now();
let viewId = null;
const track = (path, body) => {
  try {
    return fetch(`${API_BASE}/api/public/forms/${slug}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), keepalive: true,
    });
  } catch { return Promise.resolve(); }
};
// touch capability settles iPadOS, which reports itself as a Mac in the UA
const guessDevice = () => {
  const touch = navigator.maxTouchPoints > 1;
  const w = Math.min(screen.width, screen.height);
  if (!touch) return 'desktop';
  return w >= 600 ? 'tablet' : 'mobile';
};

// autocomplete hints let a phone fill name/phone/email in one tap — one of the
// biggest wins on mobile, where most of this traffic comes from
const AUTOCOMPLETE = {
  name: 'name', contact_name: 'name', groom_name: 'name', bride_name: 'name',
  email: 'email', phone1: 'tel', phone2: 'tel',
  address: 'street-address', id_number: 'off',
};

(async () => {
  if (!slug) { root.innerHTML = '<p class="done">קישור טופס לא תקין</p>'; return; }
  let form;
  try {
    const rsp = await fetch(`${API_BASE}/api/public/forms/${slug}`);
    if (!rsp.ok) throw new Error();
    ({ form } = await rsp.json());
  } catch {
    root.innerHTML = '<p class="done">הטופס לא נמצא 😕</p>';
    return;
  }

  const en = form.language === 'en';
  const T = en ? {
    choose: '— choose —', specify: 'Please specify…', send: 'Send',
    next: 'Continue →', back: '← Back', step: 'Step', of: 'of',
    required: 'This field is required', badEmail: 'Please enter a valid email address',
    badPhone: 'Please enter a valid phone number', oops: 'Something went wrong',
  } : {
    choose: '— בחרו —', specify: 'פרטו…', send: 'שליחה 🎷',
    next: 'המשך ←', back: '→ חזרה', step: 'שלב', of: 'מתוך',
    required: 'שדה חובה', badEmail: 'נא להזין כתובת מייל תקינה',
    badPhone: 'נא להזין מספר טלפון תקין', oops: 'משהו השתבש, נסו שוב',
  };

  document.documentElement.lang = en ? 'en' : 'he';
  document.documentElement.dir = en ? 'ltr' : 'rtl';
  document.title = `${form.name} — KOLOT`;
  const c = form.colors || {};
  document.body.style.setProperty('--f-primary', c.primary || '#87cedf');
  document.body.style.setProperty('--f-bg', c.bg || '#0e1b20');
  document.body.style.setProperty('--f-text', c.text || '#eef7fa');

  // register the view (non-blocking)
  track('view', {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    device: guessDevice(),
    referrer: document.referrer || '',
  }).then(r => r && r.json()).then(d => { viewId = d?.view_id || null; }).catch(() => {});

  const fields = form.fields || [];
  const stepped = form.form_type === 'steps';
  const stepOf = (f) => Math.max(1, Number(f.step) || 1);
  const steps = stepped
    ? [...new Set(fields.map(stepOf))].sort((a, b) => a - b)
    : [1];

  const inputs = {};
  const freeText = {};
  const wrappers = {};
  const errors = {};
  const onChange = [];

  const optionLabel = (f, i, value) => (en && f.options_en && f.options_en[i]) || value;
  const isOther = (f, value) => f.other_free_text && value === (f.options || []).slice(-1)[0];
  const visible = (key) => wrappers[key] && wrappers[key].style.display !== 'none';

  // ---- validation, shown inline as soon as a field loses focus ----
  const setError = (key, msg) => {
    const box = errors[key];
    if (!box) return;
    box.textContent = msg || '';
    box.style.display = msg ? '' : 'none';
    inputs[key]?.classList.toggle('invalid', !!msg);
  };
  const validate = (f) => {
    const input = inputs[f.key];
    if (!input || !visible(f.key)) return true;
    const typed = freeText[f.key];
    const v = (typed && typed.style.display !== 'none' ? typed.value : input.value).trim();
    if (f.required && !v) { setError(f.key, T.required); return false; }
    if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setError(f.key, T.badEmail); return false; }
    // 9–15 digits covers Israeli and international numbers in any punctuation
    if (v && f.type === 'tel' && (v.replace(/\D/g, '').length < 9 || v.replace(/\D/g, '').length > 15)) {
      setError(f.key, T.badPhone); return false;
    }
    setError(f.key, '');
    return true;
  };

  const fieldEl = (f) => {
    let input;
    if (f.type === 'select') {
      input = el('select', { name: f.key },
        el('option', { value: '' }, T.choose),
        ...(f.options || []).map((o, i) => el('option', { value: o }, optionLabel(f, i, o))));
    } else if (f.type === 'textarea') {
      input = el('textarea', { name: f.key, rows: 4 });
    } else {
      input = el('input', {
        name: f.key, type: f.type || 'text',
        autocomplete: AUTOCOMPLETE[f.key] || 'on',
        // a numeric keypad for phones, without losing '+' and spaces
        inputmode: f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : null,
      });
      if (['tel', 'email'].includes(f.type)) input.dir = 'ltr';
    }
    if (f.required) input.required = true;
    inputs[f.key] = input;

    const label = f.label || (en && f.label_en) || f.key;
    const kids = [el('label', { for: f.key }, label, f.required ? el('span', { class: 'req' }, ' *') : '')];
    if (f.description) kids.push(el('div', { class: 'field-help' }, f.description));
    kids.push(input);

    if (f.type === 'select' && f.other_free_text) {
      const other = el('input', { type: 'text', class: 'other-input', placeholder: T.specify });
      other.style.display = 'none';
      freeText[f.key] = other;
      input.addEventListener('change', () => {
        const show = isOther(f, input.value);
        other.style.display = show ? '' : 'none';
        if (!show) other.value = '';
        if (show) other.focus();
      });
      kids.push(other);
    }

    const err = el('div', { class: 'field-error' });
    err.style.display = 'none';
    errors[f.key] = err;
    kids.push(err);
    input.addEventListener('blur', () => validate(f));
    input.addEventListener('input', () => { if (err.textContent) validate(f); });

    const wrap = el('div', { class: 'field-wrap' }, ...kids);
    wrappers[f.key] = wrap;

    if (f.show_when) {
      onChange.push(() => {
        const src = inputs[f.show_when.field];
        const show = !!src && src.value === f.show_when.equals;
        wrap.style.display = show ? '' : 'none';
        if (!show) { input.value = ''; setError(f.key, ''); }
        input.required = show && !!f.required;
      });
    }
    return wrap;
  };

  // ---- build the step panels ----
  let current = 0;
  const panels = steps.map((s) => {
    const inStep = stepped ? fields.filter(f => stepOf(f) === s) : fields;
    const title = (form.step_titles || [])[s - 1];
    return el('div', { class: 'step-panel' },
      title ? el('h2', { class: 'step-title' }, title) : null,
      ...inStep.map(fieldEl));
  });

  const progressBar = el('div', { class: 'progress-fill' });
  const progressWrap = el('div', { class: 'progress' }, progressBar);
  const progressText = el('div', { class: 'progress-text' });

  const backBtn = el('button', { type: 'button', class: 'btn-secondary' }, T.back);
  const nextBtn = el('button', { type: 'button', class: 'btn-primary' }, form.next_label || T.next);
  const submitBtn = el('button', { type: 'submit', class: 'btn-primary' }, form.submit_label || T.send);
  const nav = el('div', { class: 'form-nav' }, backBtn, nextBtn, submitBtn);

  const showStep = (i) => {
    current = i;
    panels.forEach((p, k) => { p.style.display = k === i ? '' : 'none'; });
    const last = i === panels.length - 1;
    backBtn.style.display = stepped && i > 0 ? '' : 'none';
    nextBtn.style.display = stepped && !last ? '' : 'none';
    submitBtn.style.display = last ? '' : 'none';
    progressWrap.style.display = stepped ? '' : 'none';
    progressText.style.display = stepped ? '' : 'none';
    if (stepped) {
      progressBar.style.width = `${Math.round((i + 1) / panels.length * 100)}%`;
      progressText.textContent = `${T.step} ${i + 1} ${T.of} ${panels.length}`;
    }
    // moving between steps scrolls the new one into view — on a phone the fields
    // would otherwise stay below the fold
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (stepped && viewId) track('step', { view_id: viewId, step: i + 1 });
  };

  const validateStep = (i) => {
    const inStep = stepped ? fields.filter(f => stepOf(f) === steps[i]) : fields;
    let ok = true;
    let firstBad = null;
    for (const f of inStep) {
      if (!validate(f)) { ok = false; if (!firstBad) firstBad = f.key; }
    }
    if (firstBad) inputs[firstBad]?.focus();
    return ok;
  };

  nextBtn.addEventListener('click', () => { if (validateStep(current)) showStep(current + 1); });
  backBtn.addEventListener('click', () => showStep(current - 1));

  const formEl = el('form', { novalidate: 'novalidate' },
    progressWrap, progressText, ...panels,
    nav,
    form.privacy_note ? el('p', { class: 'privacy-note' }, form.privacy_note) : null);

  formEl.addEventListener('change', () => onChange.forEach(fn => fn()));
  onChange.forEach(fn => fn());

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep(current)) return;
    submitBtn.disabled = true;

    const payload = { __view_id: viewId, __duration_ms: Date.now() - startedAt };
    for (const [k, i] of Object.entries(inputs)) {
      if (!visible(k)) continue;
      const typed = freeText[k];
      const v = (typed && typed.style.display !== 'none' && typed.value.trim())
        ? typed.value.trim() : i.value;
      if (v !== '') payload[k] = v;
    }
    try {
      const rsp = await fetch(`${API_BASE}/api/public/forms/${slug}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await rsp.json();
      if (!rsp.ok) throw new Error(data?.error);
      root.innerHTML = `<p class="done">🎉 ${data.message}</p>`;
    } catch (err) {
      submitBtn.disabled = false;
      alert(err.message || T.oops);
    }
  });

  root.innerHTML = '';
  root.append(
    el('img', { class: 'logo', src: form.logo_url || '/assets/logo.svg', alt: 'KOLOT' }),
    el('h1', {}, form.name),
    form.intro_html ? el('div', { class: 'intro', html: form.intro_html }) : '',
    formEl);
  showStep(0);
})();
