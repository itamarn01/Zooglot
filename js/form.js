// Public lead-capture form renderer (built by the form builder in Settings).
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
    const rsp = await fetch(`/api/public/forms/${slug}`);
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
  const fieldEl = (f) => {
    let input;
    if (f.type === 'select') {
      input = el('select', { name: f.key },
        el('option', { value: '' }, en ? '— choose —' : '— בחרו —'),
        ...(f.options || []).map(o => el('option', { value: o }, o)));
    } else if (f.type === 'textarea') {
      input = el('textarea', { name: f.key, rows: 4 });
    } else {
      input = el('input', { name: f.key, type: f.type || 'text' });
      if (['tel', 'email'].includes(f.type)) input.dir = 'ltr';
    }
    if (f.required) input.required = true;
    inputs[f.key] = input;
    return [el('label', { for: f.key }, f.label, f.required ? el('span', { class: 'req' }, ' *') : ''), input];
  };

  const formEl = el('form', {}, ...(form.fields || []).map(fieldEl),
    el('button', { type: 'submit' }, en ? 'Send' : 'שליחה 🎷'));

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(Object.entries(inputs)
      .map(([k, i]) => [k, i.value]).filter(([, v]) => v !== ''));
    try {
      const rsp = await fetch(`/api/public/forms/${slug}/submit`, {
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
