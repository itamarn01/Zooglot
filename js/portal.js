// Public client portal: the proposal styled like the KOLOT PDF, built from
// typed sections (title / text / products). Optional products are selectable
// with a live total. Client-editable fields write straight back to the CRM.
// Approve or sign; on signing a PDF is generated on the device. he/en + RTL/LTR.
import { h, toast, signaturePad, fmtMoney } from './ui.js';

const API_BASE = window.__API_BASE__ || '';
const params = new URLSearchParams(location.search);
const token = params.get('t');
// preview-only: when embedded in the editor iframe, show floating "+" controls
// that ask the parent editor to insert a section at a position.
const editMode = params.get('edit') === '1';
const root = document.getElementById('portal');

const STR = {
  he: {
    total: 'סה"כ לתשלום', signatures: 'חתימות ואישור', band: 'הנהלת הלהקה', client: 'הלקוח',
    sign: 'חתימה ואישור', approve: 'אישור ההצעה', signHint: 'החתימה שלכם (ציירו באצבע או בעכבר):',
    approveHint: 'אישור ההצעה (ללא חתימה):', namePh: 'שם מלא של החותם/ת *', clear: 'ניקוי',
    approved: '✔ ההצעה אושרה — נתראה על הבמה! 🎷', details: 'פרטים', download: '⬇️ הורדת ה-PDF',
    willSign: '(תיחתם ע"י הלהקה)', eventDate: 'תאריך האירוע', venue: 'מקום',
    needName: 'נא למלא שם', needSign: 'נא לחתום במסגרת', saved: 'הפרטים נשמרו ✓',
    signedMsg: 'ההצעה נחתמה! 🎉', approvedMsg: 'ההצעה אושרה! 🎉', badLink: 'קישור לא תקין',
    included: 'כלול',
    subtotal: 'סכום ביניים', discountL: 'הנחה', vatL: 'מע"מ',
    inclVat: 'כולל מע"מ', plusVat: 'לפני מע"מ',
    addonHint: '➕ אפשר להוסיף תוספות גם לאחר החתימה — הסימון יעדכן את ההזמנה שלכם',
    addonAdded: 'התוספת נוספה להזמנה ✓', addonRemoved: 'התוספת הוסרה',
  },
  en: {
    total: 'Total', signatures: 'Signatures & Approval', band: 'The band', client: 'Client',
    sign: 'Sign & Approve', approve: 'Approve proposal', signHint: 'Your signature (draw with finger or mouse):',
    approveHint: 'Approve the proposal (no signature):', namePh: 'Full name of signer *', clear: 'Clear',
    approved: '✔ Approved — see you on stage! 🎷', details: 'Details', download: '⬇️ Download PDF',
    willSign: '(to be signed by the band)', eventDate: 'Event date', venue: 'Venue',
    needName: 'Please enter a name', needSign: 'Please sign in the box', saved: 'Saved ✓',
    signedMsg: 'Signed! 🎉', approvedMsg: 'Approved! 🎉', badLink: 'Invalid link',
    included: 'Included',
    subtotal: 'Subtotal', discountL: 'Discount', vatL: 'VAT',
    inclVat: 'incl. VAT', plusVat: 'before VAT',
    addonHint: '➕ You can add extras even after signing — ticking updates your order',
    addonAdded: 'Added to your order ✓', addonRemoved: 'Removed',
  },
};

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
let t = STR.he;
let dir = 'rtl';
const dfmt = (d) => d ? new Date(d).toLocaleDateString(contract.language === 'en' ? 'en-GB' : 'he-IL') : '';
const bandDate = (d) => {
  const dt = d ? new Date(d) : new Date();
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][dt.getMonth()];
  return `${dt.getDate()}-${mon}-${String(dt.getFullYear()).slice(2)}`;
};

function headerBand() {
  return h('div', { class: 'prop-head' },
    h('div', { class: 'prop-head-tri' }),
    h('div', { class: 'prop-head-info' },
      h('div', {}, bandDate(contract.created_at)),
      h('div', {}, '055-5081080'),
      h('div', { dir: 'ltr' }, 'KOLOTMUSIC@GMAIL.COM'),
      h('div', { dir: 'ltr' }, 'KOLOTBAND.CO.IL')),
    h('div', { class: 'prop-head-brand' }, brandLogo()));
}

// KOLOT wordmark. Falls back to styled text if the SVG can't be fetched, so the
// top-right of the proposal is never blank.
function brandLogo() {
  const img = h('img', { class: 'prop-logo', src: '/assets/logo-full.svg', alt: 'KOLOT — TURN IT UP.' });
  img.addEventListener('error', () => {
    img.replaceWith(h('div', { class: 'prop-logo-fallback' },
      h('b', {}, 'KOLOT'), h('span', {}, 'TURN IT UP.')));
  });
  return img;
}


function renderSection(s, signed, onChange) {
  if (s.type === 'title') {
    return h('div', { class: 'prop-titleblock', dir: s.dir || dir, html: s.html || '' });
  }
  if (s.type === 'text') {
    return h('div', { class: 'prop-textblock' + (s.cols === 2 ? ' cols2' : ''), dir: s.dir || dir, html: s.html || '' });
  }
  if (s.type === 'fields') {
    return fieldsSection(s, signed);
  }
  if (s.type === 'side') {
    return h('div', { class: 'prop-section' },
      h('div', { class: 'prop-section-label', dir: s.title_dir || dir, html: s.title_html || '' }),
      h('div', { class: 'prop-section-body' }, h('div', { class: 'pp-text' + (s.cols === 2 ? ' cols2' : ''), dir: s.dir || dir, html: s.html || '' })));
  }
  // product — two-column: side label + product lines
  const selected = new Set(contract.selected_options || []);   // locked at signing
  const postSel = new Set(contract.post_sign_options || []);   // added after signing
  let hasAddon = false;
  const lines = (s.items || []).map((it) => {
    const name = h('div', { class: 'pp-name', dir: it.name_dir || dir, html: it.name_html || '' });
    const desc = it.desc_html ? h('div', { class: 'pp-desc', dir: it.desc_dir || dir, html: it.desc_html }) : null;
    // content-only line (no product attached) → plain text, no ✓ and no checkbox (#4)
    if (!it.exists) {
      return h('div', { class: 'prop-prod' }, h('div', { class: 'pp-text' }, name, desc));
    }
    if (it.included) {
      // included products: plain line, no ✓ icon
      return h('div', { class: 'prop-prod' }, h('div', { class: 'pp-text' }, name, desc));
    }
    // optional (option_id covers package extras and catalogue products alike)
    const oid = it.option_id || it.package_item_id;
    const priceTag = h('b', { class: 'pp-price' }, `+${fmtMoney(it.price)}`);

    if (signed) {
      // agreed at signing → locked line, cannot be changed
      if (selected.has(oid)) {
        return h('div', { class: 'prop-prod optional' },
          h('span', { class: 'pp-check' }, '✓'),
          h('div', { class: 'pp-text' }, name, desc), h('span', { style: 'flex:1' }), priceTag);
      }
      // not agreed → the client may still ADD it after signing (upsell)
      hasAddon = true;
      const added = postSel.has(oid);
      const cb = h('input', {
        type: 'checkbox', class: 'no-print', checked: added,
        onchange: async () => {
          added ? postSel.delete(oid) : postSel.add(oid);
          try {
            ({ contract } = await api('/addons', { method: 'PATCH', body: { post_sign_options: [...postSel] } }));
            toast(added ? t.addonRemoved : t.addonAdded, 'success');
            onChange();
          } catch (e) { toast(e.message, 'error'); }
        },
      });
      return h('label', { class: 'prop-prod optional addon' + (added ? ' on' : '') },
        cb, h('div', { class: 'pp-text' }, name, desc), h('span', { style: 'flex:1' }), priceTag);
    }

    // before signing → normal live selection
    const checked = selected.has(oid);
    const cb = h('input', {
      type: 'checkbox', class: 'no-print', checked,
      onchange: async () => {
        checked ? selected.delete(oid) : selected.add(oid);
        try {
          ({ contract } = await api('/options', { method: 'PATCH', body: { selected_options: [...selected] } }));
          onChange();
        } catch (e) { toast(e.message, 'error'); }
      },
    });
    return h('label', { class: 'prop-prod optional' },
      cb, h('div', { class: 'pp-text' }, name, desc), h('span', { style: 'flex:1' }), priceTag);
  });
  return h('div', { class: 'prop-section' },
    h('div', { class: 'prop-section-label', dir: s.title_dir || dir, html: s.title_html || '' }),
    h('div', { class: 'prop-section-body' + (s.cols === 2 ? ' cols2' : '') }, ...lines,
      hasAddon ? h('div', { class: 'pp-addon-hint no-print' }, t.addonHint) : null));
}

function fieldRows(flds, signed) {
  return flds.map(f => {
    if (signed || !f.client_editable) {
      return h('div', { class: 'prop-field' }, h('span', { class: 'muted' }, `${f.label}: `), h('b', {}, f.value || '—'));
    }
    const inp = h('input', { type: 'text', value: f.value || '', dataset: { key: f.key } });
    inp.addEventListener('change', saveFields);
    return h('label', { class: 'field' }, h('span', {}, f.label), inp);
  });
}

// a 'fields' section: optional side title + its own fill-in fields (two-column)
function fieldsSection(s, signed) {
  const flds = (s.fields || []).filter(f => f.client_editable || (f.value !== '' && f.value != null));
  if (!flds.length && !s.title_html) return null;
  return h('div', { class: 'prop-section' },
    h('div', { class: 'prop-section-label', dir: s.title_dir || dir, html: s.title_html || '' }),
    h('div', { class: 'prop-section-body' }, ...fieldRows(flds, signed)));
}

// legacy fallback for very old contracts with no 'fields' section
function fieldsBlock(signed) {
  const fields = (contract.client_fields || []).filter(f => f.client_editable || (f.value !== '' && f.value != null));
  if (!fields.length) return null;
  return h('div', { class: 'card mt' }, h('h3', {}, `📝 ${t.details}`), ...fieldRows(fields, signed));
}

async function saveFields() {
  const values = {};
  root.querySelectorAll('input[data-key]').forEach(i => { values[i.dataset.key] = i.value; });
  try { ({ contract } = await api('/fields', { method: 'PATCH', body: { values } })); toast(t.saved, 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

function signatureBlock(signed, reqSig, afterSign) {
  const card = h('div', { class: 'card mt' }, h('h3', {}, `✍️ ${t.signatures}`));
  const mgmtSigs = contract.management_signatures
    || (contract.management_signature ? [contract.management_signature] : []);
  const rowMgmt = h('div', {},
    h('p', { class: 'muted' }, t.band),
    mgmtSigs.length
      ? h('div', { class: 'sig-list' }, ...mgmtSigs.map(s => h('div', { class: 'sig-one' },
        h('img', { class: 'sig-img', src: s.image_data, alt: s.name || t.band }),
        s.name ? h('div', { class: 'muted', style: 'font-size:12px' }, s.name) : null)))
      : h('p', { class: 'muted' }, t.willSign));

  if (signed) {
    card.append(h('div', { class: 'grid-2' }, rowMgmt,
      h('div', {},
        h('p', { class: 'muted' }, `${t.client} · ${contract.client_signer_name || ''} · ${dfmt(contract.client_signed_at)}`),
        contract.client_signature
          ? h('img', { class: 'sig-img', src: contract.client_signature, alt: t.client })
          : h('p', { style: 'color:var(--ok);font-weight:700' }, '✔'))),
      h('p', { style: 'color:var(--ok);font-weight:700' }, t.approved));
    return card;
  }

  const nameInput = h('input', { type: 'text', placeholder: t.namePh });
  const controls = h('div', { class: 'no-print' });
  let pad = null;
  if (reqSig) {
    pad = signaturePad();
    controls.append(h('p', { class: 'muted' }, t.signHint), pad.el,
      h('div', { class: 'flex mt sig-row' }, nameInput,
        h('button', { class: 'btn sm', onclick: () => pad.clear() }, t.clear)));
  } else {
    controls.append(h('p', { class: 'muted' }, t.approveHint), nameInput);
  }
  card.append(h('div', { class: 'grid-2' }, rowMgmt, controls),
    h('button', {
      class: 'btn primary mt no-print', style: 'width:100%;font-size:17px;padding:12px',
      onclick: async () => {
        if (!nameInput.value.trim()) { toast(t.needName, 'error'); return; }
        if (reqSig && pad.isEmpty()) { toast(t.needSign, 'error'); return; }
        try {
          ({ contract } = await api('/sign', { method: 'POST', body: { signature: reqSig ? pad.dataUrl() : undefined, signer_name: nameInput.value.trim() } }));
          toast(reqSig ? t.signedMsg : t.approvedMsg, 'success');
          draw(); afterSign();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, `${reqSig ? t.sign : t.approve} · ${fmtMoney((contract.price || {}).total ?? contract.final_price)}`));
  return card;
}

function downloadPdf() {
  const el = document.getElementById('proposal-doc');
  if (!el || !window.html2pdf) { toast('לא ניתן ליצור PDF במכשיר זה', 'error'); return; }
  window.html2pdf().set({
    margin: [8, 8, 8, 8],
    filename: `${contract.language === 'en' ? 'Proposal' : 'הצעת מחיר'} - ${contract.lead?.name || 'KOLOT'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', ignoreElements: (n) => n.classList?.contains('no-print') },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] },
  }).from(el).save();
}

// floating "+ add section here" control (preview/edit mode only)
function addPoint(index) {
  if (!editMode) return null;
  const menu = h('div', { class: 'edit-add-menu' },
    ...[['title', '🔠 כותרת'], ['text', '📝 טקסט'], ['side', '📑 כותרת צדדית + טקסט'],
      ['product', '🎼 כותרת + מוצרים'], ['fields', '📝 שדות למילוי']].map(([type, lbl]) =>
      h('button', {
        class: 'btn sm',
        onmousedown: (e) => {
          e.preventDefault();
          window.parent?.postMessage({ source: 'zooglot-preview', action: 'add-section', token, index, sectionType: type }, location.origin);
          menu.classList.remove('open');
        },
      }, lbl)));
  const btn = h('button', { class: 'edit-add-btn', title: 'הוספת סקשן כאן', onclick: () => menu.classList.toggle('open') }, '➕');
  return h('div', { class: 'edit-add no-print' }, btn, menu);
}

function draw() {
  root.innerHTML = '';
  const signed = !!contract.client_signed_at;
  const reqSig = contract.require_client_signature !== false;

  const priceSummary = priceSection();
  const onChange = () => draw();

  const secs = contract.resolved_sections || [];
  const hasFieldsSection = secs.some(s => s.type === 'fields');
  // legacy: if a fields section has no fields of its own, seed the first one from
  // the old global fields so nothing is lost until the band re-saves the contract
  if ((contract.client_fields || []).length) {
    const firstEmpty = secs.find(s => s.type === 'fields' && !(s.fields || []).length);
    if (firstEmpty) firstEmpty.fields = contract.client_fields;
  }
  const secEls = [addPoint(0)];
  secs.forEach((s, i) => {
    const el = renderSection(s, signed, onChange);
    if (el) {
      el.dataset.sid = s.id;
      if (editMode) {
        el.classList.add('edit-clickable');
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('input, button, a, label, select, textarea, .edit-add')) return;
          window.parent?.postMessage({ source: 'zooglot-preview', action: 'focus-section', token, id: s.id }, location.origin);
        });
      }
    }
    secEls.push(el, addPoint(i + 1));
  });

  const doc = h('div', { class: 'contract-paper proposal', id: 'proposal-doc', dir },
    headerBand(),
    ...secEls,
    hasFieldsSection ? null : fieldsBlock(signed), // legacy fallback: before the price
    priceSummary,
    // legacy fallback for very old contracts that only had body_html
    (!(contract.resolved_sections || []).length && contract.rendered_body)
      ? h('div', { class: 'prop-textblock', html: contract.rendered_body }) : null,
    signatureBlock(signed, reqSig, () => setTimeout(downloadPdf, 400)));

  // spread, don't pass null: Element.append(null) would render the text "null"
  root.append(doc,
    ...(signed ? [h('button', { class: 'btn primary mt no-print', style: 'width:100%', onclick: downloadPdf }, t.download)] : []),
    h('p', { class: 'muted no-print', style: 'text-align:center;margin-top:24px' }, 'להקת קולות · KOLOT · 055-5081080'));
}

// The TOTAL box: a breakdown (subtotal / discount / VAT) above the grand total.
// With a discount the pre-discount subtotal is struck through. VAT shows as a
// line when added on top, or as a "incl. VAT" note when the price already has it.
function priceSection() {
  const p = contract.price || { subtotal: contract.final_price, discount_amount: 0, vat_mode: 'none', total: contract.final_price };
  const hasDiscount = (p.discount_amount || 0) > 0;
  const lines = [];

  if (hasDiscount) {
    const dLabel = p.discount_type === 'percent' ? `${t.discountL} ${p.discount_value}%` : t.discountL;
    lines.push(h('div', { class: 'pp-total-row' },
      h('span', {}, t.subtotal),
      h('s', { class: 'pp-strike' }, fmtMoney(p.subtotal))));
    lines.push(h('div', { class: 'pp-total-row' },
      h('span', {}, dLabel),
      h('span', { class: 'pp-discount' }, `−${fmtMoney(p.discount_amount)}`)));
  }
  if (p.vat_mode === 'added') {
    lines.push(h('div', { class: 'pp-total-row' },
      h('span', {}, `${t.vatL} ${p.vat_rate}%`),
      h('span', {}, `+${fmtMoney(p.vat_amount)}`)));
  }

  const totalRow = h('div', { class: 'prop-price' },
    h('span', {}, t.total),
    h('span', {}, fmtMoney(p.total)));
  const vatNote = p.vat_mode === 'included'
    ? h('div', { class: 'pp-vat-note' }, `${t.inclVat} ${p.vat_rate}% · ${fmtMoney(p.vat_amount)}`)
    : null;

  return h('div', { class: 'pp-total-wrap' },
    lines.length ? h('div', { class: 'pp-total-lines' }, ...lines) : null,
    totalRow, vatNote);
}

(async () => {
  if (!token) { root.innerHTML = '<div class="empty-state"><div class="big">🔒</div><p>קישור לא תקין</p></div>'; return; }
  try {
    ({ contract } = await api(''));
    t = STR[contract.language === 'en' ? 'en' : 'he'];
    dir = contract.direction === 'ltr' ? 'ltr' : 'rtl';
    document.documentElement.dir = dir;
    document.title = `${contract.title} — KOLOT`;
    draw();
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><div class="big">😕</div><p>${e.message}</p></div>`;
  }
})();
