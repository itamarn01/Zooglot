// Zooglot.DB — SPA bootstrap and tab router.
import { get, getToken, setToken } from './api.js';
import { h, initialsAvatar, toast, showSplash, ICONS } from './ui.js';
import { renderAuth, verifyBanner } from './auth.js';
import { renderLeadsTab, openVoiceModal } from './tabs/leads.js';
import { renderProductsTab } from './tabs/products.js';
import { renderPackagesTab } from './tabs/packages.js';
import { renderContractsTab } from './tabs/contracts.js';
import { renderDashboardTab } from './tabs/dashboard.js';
import { renderSettingsTab } from './tabs/settings.js';

// Main navigation tabs — shown in the top bar (desktop) and bottom bar (mobile).
// Dashboard and settings are reached from the user chip / settings page instead.
const TABS = [
  { id: 'leads', label: 'מעקב זוגות', icon: ICONS.leads, render: renderLeadsTab },
  { id: 'products', label: 'מוצרים', icon: ICONS.products, render: renderProductsTab },
  { id: 'packages', label: 'חבילות', icon: ICONS.packages, render: renderPackagesTab },
  { id: 'contracts', label: 'חוזים', icon: ICONS.contracts, render: renderContractsTab },
];
const DASHBOARD_TAB = { id: 'dashboard', label: 'דשבורד', render: renderDashboardTab };
const SETTINGS_TAB = { id: 'settings', label: 'הגדרות', render: renderSettingsTab };
const ALL_TABS = [...TABS, DASHBOARD_TAB, SETTINGS_TAB];

export const state = { user: null, team: [] };

function currentTab() {
  const hash = new URLSearchParams(location.hash.slice(1));
  return ALL_TABS.find(t => t.id === hash.get('tab')) || TABS[0];
}

export function gotoTab(id, extra = {}) {
  const p = new URLSearchParams({ tab: id, ...extra });
  location.hash = p.toString();
}

function bottomTabBtn(t, activeTab) {
  return h('button', {
    class: t.id === activeTab.id ? 'active' : '',
    onclick: () => gotoTab(t.id),
  }, h('span', { class: 'tab-ico', html: t.icon }), h('span', { class: 'bt-label' }, t.label));
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
    }, t.icon ? h('span', { class: 'tab-ico', html: t.icon }) : null, t.label)));

  const topbar = h('header', { class: 'topbar' },
    h('img', { class: 'logo', src: '/assets/logo.svg', alt: 'KOLOT' }),
    h('span', { class: 'app-name' }, 'Zooglot.DB'),
    h('span', { class: 'muted brand-sub', style: 'font-size:12px' }, 'CRM · להקת קולות'),
    h('span', { class: 'spacer' }),
    h('div', {
      class: `user-chip${tab.id === 'settings' ? ' active' : ''}`, title: 'הגדרות',
      onclick: () => gotoTab('settings'),
    },
      initialsAvatar(state.user.full_name, state.user.avatar_url),
      h('span', {}, state.user.full_name || state.user.email),
      h('span', { class: 'tab-ico', style: 'width:16px;height:16px', html: ICONS.settings })));

  // app-style bottom bar for mobile (CSS hides it on desktop) — same tabs
  // as the top nav, plus a raised center FAB for voice-lead capture from anywhere
  const bottomNav = h('nav', { class: 'bottom-tabs', role: 'tablist' },
    ...TABS.slice(0, 2).map(t => bottomTabBtn(t, tab)),
    h('button', { class: 'fab', title: 'ליד חדש מהקלטה', onclick: () => openVoiceModal() },
      h('span', { class: 'tab-ico', html: ICONS.mic }), h('span', { class: 'bt-label' }, 'הקלטה')),
    ...TABS.slice(2).map(t => bottomTabBtn(t, tab)));

  const view = h('main', { id: 'view' });
  app.append(topbar, nav, bottomNav, view);

  const banner = verifyBanner(state.user, (u) => { state.user = u; renderApp(); });
  if (banner) view.append(banner);

  try {
    await tab.render(view, state);
  } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '😵'), h('p', {}, e.message)));
  }
}

// After a successful login: play the splash, then enter the app.
async function enterApp(user) {
  state.user = user;
  showSplash(`שלום, ${(user.full_name || '').split(' ')[0] || 'ברוך הבא'} 👋`);
  await loadTeam();
  renderApp();
  // a note shared while logged out waits in the cache until login finishes
  takeSharedAudio();
}

async function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!getToken() || hash.get('invite') || hash.get('reset')) {
    renderAuth(enterApp);
    return;
  }
  showSplash();
  try {
    const { user } = await get('/auth/me');
    state.user = user;
    await loadTeam();
    renderApp();
    takeSharedAudio();
  } catch {
    setToken(null);
    renderAuth(enterApp);
  }
}

async function loadTeam() {
  try {
    const { team } = await get('/settings/team');
    state.team = team;
  } catch { state.team = []; }
}

// ---------------- shared voice notes (WhatsApp → share sheet → here) --------
// The service worker parks the shared file in the Cache API and redirects here
// with #shared-voice=1, because a redirect cannot carry a file body.
const SHARE_CACHE = 'zooglot-shared-audio';
const SHARE_KEY = '/__shared-audio';

async function takeSharedAudio() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const flag = hash.get('shared-voice');
  if (!flag) return;

  // clear the marker first, so a refresh never re-opens the same capture
  hash.delete('shared-voice');
  history.replaceState(null, '', location.pathname + (hash.toString() ? '#' + hash : ''));

  if (flag === 'empty') return toast('לא התקבל קובץ אודיו מהשיתוף', 'error');
  if (flag === 'error') return toast('השיתוף נכשל — נסו שוב', 'error');
  try {
    const cache = await caches.open(SHARE_CACHE);
    const rsp = await cache.match(SHARE_KEY);
    if (!rsp) return;
    const blob = await rsp.blob();
    const name = decodeURIComponent(rsp.headers.get('X-Shared-Name') || 'shared.ogg');
    await cache.delete(SHARE_KEY); // one shot — never replay an old note
    openVoiceModal(null, { blob, name });
  } catch {
    toast('לא הצלחתי לקרוא את ההקלטה ששותפה', 'error');
  }
}

// Registered only to enable the share target — sw.js caches nothing.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.addEventListener('hashchange', () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('calendar') === 'connected') toast('יומן Google חובר בהצלחה ✓', 'success');
  if (hash.get('calendar') === 'error') toast(`שגיאה בחיבור היומן: ${hash.get('msg') || ''}`, 'error');
  if (state.user) renderApp();
  // an already-running standalone window gets the share as a hash change
  if (state.user && hash.get('shared-voice')) takeSharedAudio();
});

registerServiceWorker();
boot();
