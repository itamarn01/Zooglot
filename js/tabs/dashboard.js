// Tab 5 — דשבורד: high-level CRM metrics, conversion, per-user sales,
// monthly trend, sources & lost reasons — rendered with lightweight CSS bars.
import { get } from '../api.js';
import { h, fmtMoney, skeletonCards } from '../ui.js';

export async function renderDashboardTab(view) {
  const skel = h('div', {}, h('h2', {}, 'דשבורד אנליטיקה'), skeletonCards(4), h('div', { class: 'mt' }, skeletonCards(2)));
  view.append(skel);
  const data = await get('/dashboard');
  const t = data.totals;
  skel.remove();

  const tile = (num, lbl, color) => h('div', { class: 'card stat-tile' },
    h('div', { class: 'num', style: color ? `color:${color}` : '' }, num),
    h('div', { class: 'lbl' }, lbl));

  const bars = (title, obj, unit = '') => {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return h('div', { class: 'card' },
      h('h3', {}, title),
      entries.length ? entries.map(([k, v]) => h('div', { class: 'bar-row' },
        h('span', { class: 'bar-label', title: k }, k),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(v / max) * 100}%` })),
        h('span', { class: 'bar-val' }, `${v}${unit}`)))
        : h('p', { class: 'muted' }, 'אין נתונים עדיין'));
  };

  // monthly sparkline
  const maxMonthly = Math.max(1, ...data.monthly.map(m => m.new_leads));
  const monthlyCard = h('div', { class: 'card' },
    h('h3', {}, '📈 לידים חדשים לפי חודש (12 חודשים)'),
    h('div', { class: 'spark' },
      ...data.monthly.map(m => h('div', { class: 'col' },
        h('div', { class: 'stick', style: `height:${Math.max(3, (m.new_leads / maxMonthly) * 95)}px`, title: `${m.month}: ${m.new_leads} לידים, ${m.wins} סגירות` }),
        h('span', { class: 'm' }, m.month.slice(2).replace('-', '/'))))));

  const usersCard = h('div', { class: 'card' },
    h('h3', {}, '🏆 ביצועי מכירות לפי אנשי צוות'),
    data.per_user.length ? h('table', { class: 'simple' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'איש צוות'), h('th', {}, 'לידים'), h('th', {}, 'פתוחים'),
        h('th', {}, 'WIN'), h('th', {}, 'LOST'), h('th', {}, 'המרה'), h('th', {}, 'הכנסות חתומות'))),
      h('tbody', {}, ...data.per_user.map(u => h('tr', {},
        h('td', {}, h('b', {}, u.name)), h('td', {}, u.leads), h('td', {}, u.open),
        h('td', { style: 'color:var(--win);font-weight:700' }, u.win),
        h('td', { style: 'color:var(--lost)' }, u.lost),
        h('td', {}, u.conversion === null ? '—' : `${u.conversion}%`),
        h('td', {}, fmtMoney(u.revenue))))))
      : h('p', { class: 'muted' }, 'אין נתוני צוות עדיין'));

  view.append(
    h('h2', {}, 'דשבורד אנליטיקה'),
    h('div', { class: 'grid-4' },
      tile(t.leads, 'סה"כ לידים'),
      tile(t.open, 'בצינור הראשי', 'var(--warn)'),
      tile(t.win, 'WIN', 'var(--win)'),
      tile(t.lost, 'LOST', 'var(--lost)')),
    h('div', { class: 'grid-3 mt' },
      tile(t.conversion === null ? '—' : `${t.conversion}%`, 'אחוז המרה (מתוך שהוכרעו)'),
      tile(fmtMoney(t.signed_revenue), 'הכנסות מחוזים חתומים', 'var(--win)'),
      tile(fmtMoney(t.proposed_pipeline), 'שווי הצעות בצינור')),
    h('div', { class: 'grid-2 mt' }, monthlyCard, usersCard),
    h('div', { class: 'grid-2 mt' },
      bars('📣 איך שמעו עלינו', data.hear_about_us),
      bars('🔌 מקורות לידים', Object.fromEntries(Object.entries(data.sources).map(([k, v]) =>
        [{ manual: 'ידני', form: 'טופס', webhook: 'אתר (Webhook)', whatsapp: 'וואטסאפ', voice: 'הקלטה' }[k] || k, v])))),
    h('div', { class: 'grid-2 mt' },
      bars('❌ סיבות הפסד', data.lost_reasons),
      bars('🥊 מתחרים שזכו', data.lost_competitors)));
}
