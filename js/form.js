// Public lead-capture form renderer (built by the form builder in Settings).
const API_BASE = window.__API_BASE__ || '';
const slug = new URLSearchParams(location.search).get('f');
const root = document.getElementById('form-root');

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}

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
  document.documentElement.lang = en ? 'en' : 'he';
  document.documentElement.dir = en ? 'ltr' : 'rtl';
  document.title = `${form.name} — KOLOT`;
  const c = form.colors || {};
  document.body.style.setProperty('--f-primary', c.primary || '#87cedf');
  document.body.style.setProperty('--f-bg', c.bg || '#0e1b20');
  document.body.style.setProperty('--f-text', c.text || '#eef7fa');

  const inputs = {};
  const freeText = {};   // key → the "other" text box, when one is showing
  const wrappers = {};   // key → the field's wrapper, for conditional fields
  const onChange = [];   // re-evaluate conditional fields after any change

  // English forms show English labels but still SUBMIT the Hebrew value, so the
  // CRM keeps one canonical vocabulary (chips, filters and reports all match).
  const optionLabel = (f, i, value) => (en && f.options_en && f.options_en[i]) || value;
  const isOther = (f, value) => f.other_free_text && value === (f.options || []).slice(-1)[0];

  const fieldEl = (f) => {
    let input;
    if (f.type === 'select') {
      input = el('select', { name: f.key },
        el('option', { value: '' }, en ? '— choose —' : '— בחרו —'),
        ...(f.options || []).map((o, i) => el('option', { value: o }, optionLabel(f, i, o))));
    } else if (f.type === 'textarea') {
      input = el('textarea', { name: f.key, rows: 4 });
    } else {
      input = el('input', { name: f.key, type: f.type || 'text' });
      if (['tel', 'email'].includes(f.type)) input.dir = 'ltr';
    }
    if (f.required) input.required = true;
    inputs[f.key] = input;

    // the builder's own wording wins — it is already written in the form's
    // language; label_en is only a fallback for fields that were never labelled
    const label = f.label || (en && f.label_en) || f.key;
    const kids = [el('label', { for: f.key }, label, f.required ? el('span', { class: 'req' }, ' *') : '')];
    if (f.description) kids.push(el('div', { class: 'field-help' }, f.description));
    kids.push(input);

    // picking the last option ("אחר" / "Other") reveals a free-text box
    if (f.type === 'select' && f.other_free_text) {
      const other = el('input', {
        type: 'text', class: 'other-input',
        placeholder: en ? 'Please specify…' : 'פרטו…',
      });
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

    const wrap = el('div', { class: 'field-wrap' }, ...kids);
    wrappers[f.key] = wrap;

    // conditional visibility (e.g. "who recommended us?" only after picking
    // "recommendation"). A hidden field is never required and never submitted.
    if (f.show_when) {
      const apply = () => {
        const src = inputs[f.show_when.field];
        const show = !!src && src.value === f.show_when.equals;
        wrap.style.display = show ? '' : 'none';
        if (!show) input.value = '';
        input.required = show && !!f.required;
      };
      onChange.push(apply);
    }
    return wrap;
  };

  const formEl = el('form', {}, ...(form.fields || []).map(fieldEl),
    el('button', { type: 'submit' }, en ? 'Send' : 'שליחה 🎷'));

  // wire conditional fields once every input exists, then set their initial state
  formEl.addEventListener('change', () => onChange.forEach(fn => fn()));
  onChange.forEach(fn => fn());

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {};
    for (const [k, i] of Object.entries(inputs)) {
      // skip fields hidden by a condition — they are not part of this answer
      if (wrappers[k] && wrappers[k].style.display === 'none') continue;
      // "other" → send what they typed, so the real answer isn't lost as "אחר"
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
      alert(err.message || (en ? 'Something went wrong' : 'משהו השתבש, נסו שוב'));
    }
  });

  root.innerHTML = '';
  root.append(
    el('img', { class: 'logo', src: form.logo_url || '/assets/logo.svg', alt: 'KOLOT' }),
    el('h1', {}, form.name),
    form.intro_html ? el('div', { class: 'intro', html: form.intro_html }) : '',
    formEl);
})();
