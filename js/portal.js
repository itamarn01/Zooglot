// Public client portal: review the contract, toggle optional add-ons
// (live price), and sign digitally. Token-based access, no login.
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

function head() {
  return h('div', { class: 'portal-head' },
    h('img', { class: 'logo', src: '/assets/logo.svg', alt: 'KOLOT — להקת קולות' }),
    h('h1', { style: 'color:var(--brand);font-size:22px;margin:8px 0 0' }, contract.title),
    contract.lead?.event_date ? h('p', { class: 'muted' }, `האירוע שלכם · ${fmtDate(contract.lead.event_date)}${contract.lead.event_location ? ` · ${contract.lead.event_location}` : ''}`) : null);
}

function draw() {
  root.innerHTML = '';
  const signed = !!contract.client_signed_at;
  const optional = (contract.package?.items || []).filter(i => !i.included);
  const selected = new Set(contract.selected_options || []);

  const priceBanner = h('div', { class: 'price-banner' },
    `סה"כ לתשלום: ${fmtMoney(contract.final_price)}`);

  const optionsCard = optional.length ? h('div', { class: 'card mt' },
    h('h3', {}, '🎁 תוספות לבחירתכם'),
    h('p', { class: 'muted' }, signed ? 'התוספות שנבחרו:' : 'סמנו תוספות — המחיר מתעדכן מיידית.'),
    ...optional.map(item => {
      const cb = h('input', {
        type: 'checkbox', checked: selected.has(item.id), disabled: signed,
        onchange: async () => {
          cb.checked ? selected.add(item.id) : selected.delete(item.id);
          try {
            ({ contract } = await api('/options', { method: 'PATCH', body: { selected_options: [...selected] } }));
            priceBanner.textContent = `סה"כ לתשלום: ${fmtMoney(contract.final_price)}`;
          } catch (e) { toast(e.message, 'error'); }
        },
      });
      return h('label', { class: 'opt-row', style: signed && !selected.has(item.id) ? 'opacity:.45' : '' },
        cb,
        h('b', {}, item.product?.name || ''),
        h('span', { class: 'muted' }, item.product?.description || ''),
        h('span', { style: 'flex:1' }),
        h('b', {}, `+${fmtMoney(item.effective_price)}`));
    })) : null;

  const includedList = (contract.package?.items || []).filter(i => i.included);
  const packageCard = contract.package ? h('div', { class: 'card mt' },
    h('h3', {}, `📦 החבילה: ${contract.package.name}`),
    ...includedList.map(i => h('div', { class: 'opt-row' },
      '✅', h('b', {}, i.product?.name || ''), h('span', { class: 'muted' }, i.product?.description || ''))),
    h('p', { class: 'muted' }, `מחיר בסיס: ${fmtMoney(contract.base_price)}`)) : null;

  // signatures
  const sigCard = h('div', { class: 'card mt' }, h('h3', {}, '✍️ חתימות'));
  const sigRow = h('div', { class: 'grid-2' });
  sigRow.append(h('div', {},
    h('p', { class: 'muted' }, 'הנהלת הלהקה'),
    contract.management_signature
      ? h('img', { class: 'sig-img', src: contract.management_signature.image_data, alt: 'חתימת הנהלה' })
      : h('p', { class: 'muted' }, '(תיחתם ע"י הלהקה)')));

  if (signed) {
    sigRow.append(h('div', {},
      h('p', { class: 'muted' }, `הלקוח · ${contract.client_signer_name || ''} · ${fmtDate(contract.client_signed_at)}`),
      h('img', { class: 'sig-img', src: contract.client_signature, alt: 'חתימת הלקוח' })));
    sigCard.append(sigRow, h('p', { style: 'color:var(--ok);font-weight:700' }, '✔ החוזה נחתם — נתראה על הבמה! 🎷'));
  } else {
    const pad = signaturePad();
    const nameInput = h('input', { type: 'text', placeholder: 'שם מלא של החותם/ת *' });
    sigRow.append(h('div', {},
      h('p', { class: 'muted' }, 'החתימה שלכם (ציירו באצבע או בעכבר):'),
      pad.el,
      h('div', { class: 'flex mt' },
        nameInput,
        h('button', { class: 'btn sm', onclick: () => pad.clear() }, 'ניקוי'))));
    sigCard.append(sigRow,
      h('button', {
        class: 'btn primary mt', style: 'width:100%;font-size:17px;padding:12px',
        onclick: async () => {
          if (!nameInput.value.trim()) { toast('נא למלא שם חותם/ת', 'error'); return; }
          if (pad.isEmpty()) { toast('נא לחתום במסגרת', 'error'); return; }
          try {
            ({ contract } = await api('/sign', {
              method: 'POST',
              body: { signature: pad.dataUrl(), signer_name: nameInput.value.trim() },
            }));
            toast('החוזה נחתם בהצלחה! 🎉', 'success');
            draw();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, `חתימה ואישור · ${fmtMoney(contract.final_price)}`));
  }

  root.append(
    head(),
    h('div', { class: 'contract-paper mt', html: contract.rendered_body }),
    packageCard, optionsCard, sigCard, h('div', { class: 'mt' }), priceBanner,
    h('p', { class: 'muted', style: 'text-align:center;margin-top:24px' },
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
