// Zooglot.DB — SPA bootstrap and tab router.
import { get, getToken, setToken } from './api.js';
import { h, initialsAvatar, toast } from './ui.js';
import { renderAuth, verifyBanner } from './auth.js';
import { renderLeadsTab } from './tabs/leads.js';
import { renderProductsTab } from './tabs/products.js';
import { renderPackagesTab } from './tabs/packages.js';
import { renderContractsTab } from './tabs/contracts.js';
import { renderDashboardTab } from './tabs/dashboard.js';
import { renderSettingsTab } from './tabs/settings.js';

const TABS = [
  { id: 'leads', label: 'מעקב זוגות', render: renderLeadsTab },
  { id: 'products', label: 'מוצרים', render: renderProductsTab },
  { id: 'packages', label: 'חבילות', render: renderPackagesTab },
  { id: 'contracts', label: 'חוזים', render: renderContractsTab },
  { id: 'dashboard', label: 'דשבורד', render: renderDashboardTab },
  { id: 'settings', label: 'הגדרות', render: renderSettingsTab },
];

export const state = { user: null, team: [] };

function currentTab() {
  const hash = new URLSearchParams(location.hash.slice(1));
  return TABS.find(t => t.id === hash.get('tab')) || TABS[0];
}

export function gotoTab(id, extra = {}) {
  const p = new URLSearchParams({ tab: id, ...extra });
  location.hash = p.toString();
}

async function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const tab = currentTab();
  const nav = h('nav', { class: 'tabs', role: 'tablist' },
    ...TABS.map(t => h('button', {
      class: t.id === tab.id ? 'active' : '', role: 'tab',
      'aria-selected': t.id === tab.id ? 'true' : 'false',
      onclick: () => gotoTab(t.id),
    }, t.label)));

  const topbar = h('header', { class: 'topbar' },
    h('img', { class: 'logo', src: '/assets/logo.svg', alt: 'KOLOT' }),
    h('span', { class: 'app-name' }, 'Zooglot.DB'),
    h('span', { class: 'muted', style: 'font-size:12px' }, 'CRM · להקת קולות'),
    h('span', { class: 'spacer' }),
    h('div', {
      class: 'user-chip', title: 'התנתקות', onclick: () => {
        setToken(null);
        location.hash = '';
        location.reload();
      },
    },
      initialsAvatar(state.user.full_name, state.user.avatar_url),
      h('span', {}, state.user.full_name || state.user.email),
      h('span', { class: 'muted' }, '⏻')));

  const view = h('main', { id: 'view' });
  app.append(topbar, nav, view);

  const banner = verifyBanner(state.user, (u) => { state.user = u; renderApp(); });
  if (banner) view.append(banner);

  try {
    await tab.render(view, state);
  } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '😵'), h('p', {}, e.message)));
  }
}

async function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!getToken() || hash.get('invite') || hash.get('reset')) {
    renderAuth(async (user) => { state.user = user; await loadTeam(); renderApp(); });
    return;
  }
  try {
    const { user } = await get('/auth/me');
    state.user = user;
    await loadTeam();
    renderApp();
  } catch {
    setToken(null);
    renderAuth(async (user) => { state.user = user; await loadTeam(); renderApp(); });
  }
}

async function loadTeam() {
  try {
    const { team } = await get('/settings/team');
    state.team = team;
  } catch { state.team = []; }
}

window.addEventListener('hashchange', () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('calendar') === 'connected') toast('יומן Google חובר בהצלחה ✓', 'success');
  if (hash.get('calendar') === 'error') toast(`שגיאה בחיבור היומן: ${hash.get('msg') || ''}`, 'error');
  if (state.user) renderApp();
});

boot();
