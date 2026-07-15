// Public client portal: the proposal styled like the KOLOT PDF — header,
// two-column sections, add-ons with live price, client-editable fields (write
// straight back to the CRM), and approve/sign. On signing, a PDF is generated
// on the client's device and downloaded. Token-based access, no login.
import { h, toast, signaturePad, fmtMoney, fmtDate } from './ui.js';

const API_BASE = window.__API_BASE__ || '';
const token = new URLSearchParams(location.search).get('t');
const root = document.getElementById('portal');

async function api(path, opts = {}) {
  const rsp = await fetch(`${API_BASE}/api/portal/${token}${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await rsp.json().catch(() => null);
  if (!rsp.ok) throw new Error(data?.error || 'שגיאה');
  return data;
}

let contract = null;

function proposalHeader() {
  return h('div', { class: 'prop-head' },
    h('div', { class: 'prop-head-tri' }),
    h('div', { class: 'prop-head-info' },
      h('div', {}, '055-5081080'),
      h('div', { dir: 'ltr' }, 'kolotmusic@gmail.com'),
      h('div', { dir: 'ltr' }, 'kolotband.co.il')),
    h('img', { class: 'prop-logo', src: '/assets/logo.svg', alt: 'KOLOT — להקת קולות' }));
}

function eventLine() {
  const l = contract.lead || {};
  const parts = [];
  if (l.event_date) parts.push(`תאריך האירוע: ${fmtDate(l.event_date)}`);
  if (l.event_location) parts.push(`מקום: ${l.event_location}`);
  return parts.length ? h('p', { class: 'prop-event' }, parts.join(' · ')) : null;
}

function sectionsBlock() {
  const sections = contract.resolved_sections || [];
  if (!sections.length) return null;
  return h('div', { class: 'prop-sections' },
    ...sections.map(s => h('div', { class: 'prop-section' },
      h('div', { class: 'prop-section-label' }, s.title || ''),
      h('div', { class: 'prop-section-body' },
        s.product ? h('div', { class: 'prop-section-name' }, s.product.name) : null,
        s.details ? h('div', { class: 'prop-section-details' }, s.details) : null))));
}

function packageBlock() {
  if (!contract.package) return null;
  const included = (contract.package.items || []).filter(i => i.included);
  return h('div', { class: 'prop-package' },
    h('h3', {}, `📦 ${contract.package.name}`),
    ...included.map(i => h('div', { class: 'prop-inc' },
      '✅ ', h('b', {}, i.product?.name || ''),
      i.product?.description ? h('span', { class: 'muted' }, ` — ${i.product.description}`) : null)));
}

function fieldsBlock(signed) {
  const fields = (contract.client_fields || [])
    .filter(f => f.client_editable || (f.value !== '' && f.value != null));
  if (!fields.length) return null;
  const rows = fields.map(f => {
    if (signed || !f.client_editable) {
      return h('div', { class: 'prop-field' }, h('span', { class: 'muted' }, `${f.label}: `), h('b', {}, f.value || '—'));
    }
    const inp = h('input', { type: 'text', value: f.value || '', dataset: { key: f.key } });
    inp.addEventListener('change', saveFields);
    return h('label', { class: 'field' }, h('span', {}, `${f.label} ✏️`), inp);
  });
  return h('div', { class: 'card mt' }, h('h3', {}, '📝 פרטים'), ...rows);
}

async function saveFields() {
  const values = {};
  root.querySelectorAll('input[data-key]').forEach(i => { values[i.dataset.key] = i.value; });
  try {
    ({ contract } = await api('/fields', { method: 'PATCH', body: { values } }));
    toast('הפרטים נשמרו ✓', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function optionsBlock(signed, onPrice) {
  const optional = (contract.package?.items || []).filter(i => !i.included);
  if (!optional.length) return null;
  const selected = new Set(contract.selected_options || []);
  return h('div', { class: 'card mt' },
    h('h3', {}, '🎁 תוספות לבחירתכם'),
    h('p', { class: 'muted no-print' }, signed ? 'התוספות שנבחרו:' : 'סמנו תוספות — המחיר מתעדכן מיידית.'),
    ...optional.map(item => {
      const cb = h('input', {
        type: 'checkbox', class: 'no-print', checked: selected.has(item.id), disabled: signed,
        onchange: async () => {
          cb.checked ? selected.add(item.id) : selected.delete(item.id);
          try {
            ({ contract } = await api('/options', { method: 'PATCH', body: { selected_options: [...selected] } }));
            onPrice();
          } catch (e) { toast(e.message, 'error'); }
        },
      });
      return h('label', { class: 'opt-row', style: signed && !selected.has(item.id) ? 'opacity:.45' : '' },
        cb,
        signed ? h('span', {}, selected.has(item.id) ? '✅' : '▫️') : null,
        h('b', {}, item.product?.name || ''),
        h('span', { class: 'muted' }, item.product?.description || ''),
        h('span', { style: 'flex:1' }),
        h('b', {}, `+${fmtMoney(item.effective_price)}`));
    }));
}

function signatureBlock(signed, reqSig, afterSign) {
  const card = h('div', { class: 'card mt' }, h('h3', {}, '✍️ חתימות ואישור'));
  const rowMgmt = h('div', {},
    h('p', { class: 'muted' }, 'הנהלת הלהקה'),
    contract.management_signature
      ? h('img', { class: 'sig-img', src: contract.management_signature.image_data, alt: 'חתימת הנהלה' })
      : h('p', { class: 'muted' }, '(תיחתם ע"י הלהקה)'));

  if (signed) {
    card.append(h('div', { class: 'grid-2' }, rowMgmt,
      h('div', {},
        h('p', { class: 'muted' }, `הלקוח · ${contract.client_signer_name || ''} · ${fmtDate(contract.client_signed_at)}`),
        contract.client_signature
          ? h('img', { class: 'sig-img', src: contract.client_signature, alt: 'חתימת הלקוח' })
          : h('p', { style: 'color:var(--ok);font-weight:700' }, '✔ אושר'))),
      h('p', { style: 'color:var(--ok);font-weight:700' }, '✔ ההצעה אושרה — נתראה על הבמה! 🎷'));
    return card;
  }

  const nameInput = h('input', { type: 'text', placeholder: 'שם מלא של החותם/ת *' });
  const controls = h('div', { class: 'no-print' });
  let pad = null;
  if (reqSig) {
    pad = signaturePad();
    controls.append(
      h('p', { class: 'muted' }, 'החתימה שלכם (ציירו באצבע או בעכבר):'),
      pad.el,
      h('div', { class: 'flex mt' }, nameInput, h('button', { class: 'btn sm', onclick: () => pad.clear() }, 'ניקוי')));
  } else {
    controls.append(
      h('p', { class: 'muted' }, 'אישור ההצעה (ללא חתימה):'),
      nameInput);
  }
  card.append(h('div', { class: 'grid-2' }, rowMgmt, controls),
    h('button', {
      class: 'btn primary mt no-print', style: 'width:100%;font-size:17px;padding:12px',
      onclick: async () => {
        if (!nameInput.value.trim()) { toast('נא למלא שם', 'error'); return; }
        if (reqSig && pad.isEmpty()) { toast('נא לחתום במסגרת', 'error'); return; }
        try {
          ({ contract } = await api('/sign', {
            method: 'POST',
            body: { signature: reqSig ? pad.dataUrl() : undefined, signer_name: nameInput.value.trim() },
          }));
          toast(reqSig ? 'ההצעה נחתמה! 🎉' : 'ההצעה אושרה! 🎉', 'success');
          draw();
          afterSign();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, reqSig ? `חתימה ואישור · ${fmtMoney(contract.final_price)}` : `אישור ההצעה · ${fmtMoney(contract.final_price)}`));
  return card;
}

function downloadPdf() {
  const el = document.getElementById('proposal-doc');
  if (!el || !window.html2pdf) { toast('לא ניתן ליצור PDF במכשיר זה', 'error'); return; }
  const opt = {
    margin: [8, 8, 8, 8],
    filename: `הצעת מחיר - ${contract.lead?.name || 'KOLOT'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', ignoreElements: (n) => n.classList?.contains('no-print') },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] },
  };
  window.html2pdf().set(opt).from(el).save();
}

function draw() {
  root.innerHTML = '';
  const signed = !!contract.client_signed_at;
  const reqSig = contract.require_client_signature !== false;

  const priceBanner = h('div', { class: 'price-banner no-print' }, `סה"כ לתשלום: ${fmtMoney(contract.final_price)}`);
  const priceSummary = h('div', { class: 'prop-price' }, `סה"כ לתשלום: ${fmtMoney(contract.final_price)}`);
  const onPrice = () => {
    priceBanner.textContent = `סה"כ לתשלום: ${fmtMoney(contract.final_price)}`;
    priceSummary.textContent = `סה"כ לתשלום: ${fmtMoney(contract.final_price)}`;
  };

  const doc = h('div', { class: 'contract-paper proposal', id: 'proposal-doc' },
    proposalHeader(),
    h('h1', { class: 'prop-title' }, contract.rendered_header?.title || contract.title),
    eventLine(),
    contract.rendered_header?.intro ? h('p', { class: 'prop-intro' }, contract.rendered_header.intro) : null,
    sectionsBlock(),
    packageBlock(),
    fieldsBlock(signed),
    optionsBlock(signed, onPrice),
    priceSummary,
    contract.rendered_body ? h('div', { class: 'prop-terms', html: contract.rendered_body }) : null,
    signatureBlock(signed, reqSig, () => setTimeout(downloadPdf, 400)));

  root.append(
    doc,
    signed ? h('button', { class: 'btn primary mt no-print', style: 'width:100%', onclick: downloadPdf }, '⬇️ הורדת ה-PDF') : null,
    h('div', { class: 'mt' }), priceBanner,
    h('p', { class: 'muted no-print', style: 'text-align:center;margin-top:24px' },
      'להקת קולות · KOLOT · 055-5081080'));
}

(async () => {
  if (!token) {
    root.innerHTML = '<div class="empty-state"><div class="big">🔒</div><p>קישור לא תקין</p></div>';
    return;
  }
  try {
    ({ contract } = await api(''));
    document.title = `${contract.title} — להקת קולות KOLOT`;
    draw();
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><div class="big">😕</div><p>${e.message}</p></div>`;
  }
})();
