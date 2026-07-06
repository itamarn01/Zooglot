// Tab 6 — הגדרות: profile, integrations (Google Calendar, webhook),
// management signatures (draw/upload), team invitations, form builder.
import { get, post, patch, del, setToken } from '../api.js';
import { h, toast, modal, confirmModal, signaturePad, fileToDataUrl, initialsAvatar, passwordField, withBusy, skeletonCards, ICONS } from '../ui.js';

export async function renderSettingsTab(view, state) {
  view.append(h('h2', {}, 'הגדרות'));
  const skel = h('div', {}, skeletonCards(4));
  view.append(skel);

  const [{ signatures }, integrations, { forms }, bindable] = await Promise.all([
    get('/settings/signatures'), get('/settings/integrations'), get('/forms'), get('/forms/bindable-fields'),
  ]);
  let calStatus = { configured: false, connected: false };
  try { calStatus = await get('/calendar/status'); } catch { /* not critical */ }

  skel.remove();
  const grid = h('div', { class: 'grid-2', style: 'align-items:start' });
  view.append(grid);

  // ================= profile =================
  const nameInput = h('input', { type: 'text', value: state.user.full_name || '' });
  const curPassF = passwordField({ autocomplete: 'current-password' });
  const newPassF = passwordField({ autocomplete: 'new-password', minlength: 8 });
  const curPass = curPassF.input, newPass = newPassF.input;
  const avatarFile = h('input', { type: 'file', accept: 'image/*' });
  const avatarPreview = h('div', {}, initialsAvatar(state.user.full_name, state.user.avatar_url));
  let avatarData;

  avatarFile.addEventListener('change', async () => {
    if (!avatarFile.files[0]) return;
    avatarData = await fileToDataUrl(avatarFile.files[0], 240);
    avatarPreview.innerHTML = '';
    avatarPreview.append(h('img', { class: 'avatar-circle', style: 'width:56px;height:56px', src: avatarData }));
  });

  grid.append(h('div', { class: 'card' },
    h('h3', {}, '👤 פרופיל'),
    h('div', { class: 'flex' }, avatarPreview, avatarFile),
    h('label', { class: 'field mt' }, h('span', {}, 'שם מלא'), nameInput),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', {}, 'סיסמה נוכחית'), curPassF.wrap),
      h('label', { class: 'field' }, h('span', {}, 'סיסמה חדשה (אופציונלי)'), newPassF.wrap)),
    h('button', {
      class: 'btn primary', onclick: withBusy(async () => {
        try {
          const body = { full_name: nameInput.value };
          if (avatarData) body.avatar_url = avatarData;
          if (newPass.value) { body.new_password = newPass.value; body.current_password = curPass.value; }
          const { user } = await patch('/settings/profile', body);
          Object.assign(state.user, user);
          curPass.value = newPass.value = '';
          toast('הפרופיל עודכן ✓', 'success');
        } catch (e) { toast(e.message, 'error'); }
      }),
    }, '💾 שמירת פרופיל')));

  // ================= integrations =================
  const statusDot = (ok) => h('span', { class: 'badge-dot', style: `background:${ok ? 'var(--ok)' : 'var(--danger)'}` });
  grid.append(h('div', { class: 'card' },
    h('h3', {}, '🔌 אינטגרציות'),
    h('p', {}, statusDot(!integrations.mock_db), ` בסיס נתונים: ${integrations.mock_db ? 'מצב Mock מקומי (הזן מפתחות Supabase ב-.env)' : 'Supabase מחובר'}`),
    h('p', {}, statusDot(integrations.resend), ` Resend (מיילים): ${integrations.resend ? 'פעיל' : 'לא מוגדר — מיילים מודפסים לקונסול'}`),
    h('p', {}, statusDot(integrations.openai), ` OpenAI (ניתוח הקלטות): ${integrations.openai ? 'פעיל' : 'לא מוגדר — מצב דמו'}`),
    h('p', {}, statusDot(integrations.whatsapp), ` וואטסאפ (OpenWA · 055-5081080): ${integrations.whatsapp ? 'פעיל' : 'כבוי (ENABLE_WHATSAPP=true להפעלה)'}`),
    h('hr', { style: 'border-color:var(--line)' }),
    h('h4', {}, '📅 Google Calendar'),
    calStatus.connected
      ? h('div', {},
        h('p', {}, statusDot(true), ` מחובר: ${calStatus.google_email || ''}`),
        h('div', { class: 'flex' },
          h('button', {
            class: 'btn', onclick: async () => {
              try {
                const r = await post('/calendar/sync-all', {});
                toast(`סונכרנו ${r.pushed} אירועים ליומן, ${r.pulled} עודכנו חזרה ✓`, 'success');
              } catch (e) { toast(e.message, 'error'); }
            },
          }, '🔄 סנכרון דו-כיווני עכשיו'),
          h('button', {
            class: 'btn danger', onclick: async () => {
              await del('/calendar/disconnect');
              toast('היומן נותק', 'success');
            },
          }, 'ניתוק')))
      : h('button', {
        class: 'btn primary', onclick: async () => {
          try {
            const { url } = await get('/calendar/connect');
            location.href = url;
          } catch (e) { toast(e.message, 'error'); }
        },
      }, '🔗 חיבור יומן Google'),
    h('hr', { style: 'border-color:var(--line)' }),
    h('h4', {}, '🌐 Webhook לאתר (מחליף את Monday)'),
    h('p', { class: 'muted' }, 'כוונו את טפסי האתר (כולל טפסי ה-wkf הקיימים) לכתובת הזו בשיטת POST (JSON):'),
    h('div', { class: 'code-box' }, integrations.webhook_url)));

  // ================= management signatures =================
  const sigList = h('div', {});
  const renderSigs = (items) => {
    sigList.innerHTML = '';
    if (!items.length) sigList.append(h('p', { class: 'muted' }, 'אין חתימות שמורות עדיין.'));
    for (const s of items) {
      sigList.append(h('div', { class: 'pkg-item' },
        h('img', { src: s.image_data, alt: s.name, style: 'height:44px;background:#fff;border-radius:6px;padding:2px 8px' }),
        h('b', {}, s.name),
        h('span', { style: 'flex:1' }),
        h('button', {
          class: 'icon-btn', onclick: async () => {
            if (!await confirmModal('מחיקת חתימה', `למחוק את החתימה "${s.name}"?`)) return;
            await del(`/settings/signatures/${s.id}`);
            const { signatures: fresh } = await get('/settings/signatures');
            renderSigs(fresh);
          },
        }, '🗑️')));
    }
  };
  renderSigs(signatures);

  grid.append(h('div', { class: 'card' },
    h('h3', {}, '🖋️ חתימות הנהלה'),
    h('p', { class: 'muted' }, 'חתימות רשמיות של הלהקה לשימוש בחוזים.'),
    sigList,
    h('button', {
      class: 'btn primary mt', onclick: () => {
        const name = h('input', { type: 'text', placeholder: 'למשל: יניב — מנהל הלהקה' });
        const pad = signaturePad();
        const file = h('input', { type: 'file', accept: 'image/*' });
        let uploaded;
        file.addEventListener('change', async () => {
          if (file.files[0]) { uploaded = await fileToDataUrl(file.files[0], 600); toast('קובץ חתימה נטען ✓', 'success'); }
        });
        modal('חתימה חדשה', h('div', {},
          h('label', { class: 'field' }, h('span', {}, 'שם החתימה *'), name),
          h('p', { class: 'muted' }, 'ציירו חתימה:'), pad.el,
          h('div', { class: 'flex mt' },
            h('button', { class: 'btn sm', onclick: () => pad.clear() }, 'ניקוי'),
            h('span', { class: 'muted' }, 'או העלאת קובץ:'), file)), {
          actions: [{
            label: 'שמירה', kind: 'primary', onclick: async (close) => {
              const image = uploaded || (!pad.isEmpty() ? pad.dataUrl() : null);
              if (!name.value.trim() || !image) { toast('נדרשים שם וחתימה (ציור או קובץ)', 'error'); return false; }
              await post('/settings/signatures', { name: name.value, image_data: image });
              close();
              const { signatures: fresh } = await get('/settings/signatures');
              renderSigs(fresh);
              toast('החתימה נשמרה ✓', 'success');
            },
          }, { label: 'ביטול', onclick: (close) => close() }],
        });
      },
    }, '+ חתימה חדשה')));

  // ================= team & invitations =================
  const teamCard = h('div', { class: 'card' }, h('h3', {}, '👥 צוות והזמנות'));
  teamCard.append(...state.team.map(m => h('div', { class: 'pkg-item' },
    initialsAvatar(m.full_name, m.avatar_url), h('b', {}, m.full_name || m.email),
    h('span', { class: 'muted' }, m.email),
    m.role === 'admin' ? h('span', { class: 'chip stage' }, 'אדמין') : '')));

  if (state.user.role === 'admin') {
    const invEmail = h('input', { type: 'email', dir: 'ltr', placeholder: 'email@example.com' });
    teamCard.append(
      h('h4', { class: 'mt' }, 'הזמנת איש צוות (בהזמנה בלבד)'),
      h('div', { class: 'flex' }, invEmail,
        h('button', {
          class: 'btn primary', onclick: withBusy(async () => {
            try {
              const { link } = await post('/settings/invitations', { email: invEmail.value });
              navigator.clipboard?.writeText(link);
              toast('ההזמנה נשלחה במייל והקישור הועתק ✓', 'success');
              invEmail.value = '';
            } catch (e) { toast(e.message, 'error'); }
          }),
        }, 'שליחת הזמנה')));
  } else {
    teamCard.append(h('p', { class: 'muted' }, 'הזמנת אנשי צוות חדשים זמינה לאדמין בלבד.'));
  }
  grid.append(teamCard);

  // ================= form builder =================
  view.append(formBuilderSection(forms, bindable.fields));

  // ================= sign out =================
  view.append(h('div', { class: 'card mt', style: 'text-align:center' },
    h('p', { class: 'muted' }, `מחובר/ת כ-${state.user.email}`),
    h('button', {
      class: 'btn danger', onclick: () => {
        setToken(null);
        location.hash = '';
        location.reload();
      },
    }, h('span', { class: 'tab-ico', style: 'width:16px;height:16px', html: ICONS.signout }), 'התנתקות')));
}

// ---------------- form builder ----------------
function formBuilderSection(forms, bindableFields) {
  const section = h('div', { class: 'card mt' });
  const list = h('div', {});

  const renderList = (items) => {
    list.innerHTML = '';
    if (!items.length) list.append(h('p', { class: 'muted' }, 'אין טפסים עדיין — צרו טופס לידים ראשון.'));
    for (const f of items) {
      const publicUrl = `${location.origin}/form.html?f=${f.slug}`;
      list.append(h('div', { class: 'pkg-item', style: 'flex-wrap:wrap' },
        h('b', {}, f.name),
        h('span', { class: 'chip source' }, f.language === 'en' ? 'EN' : 'עברית'),
        h('span', { class: 'muted' }, `${(f.fields || []).length} שדות`),
        h('span', { style: 'flex:1' }),
        h('a', { class: 'btn sm', href: publicUrl, target: '_blank' }, '👁️ צפייה'),
        h('button', {
          class: 'btn sm', onclick: () => {
            const embed = `<iframe src="${publicUrl}" style="width:100%;min-height:640px;border:0;border-radius:12px;" title="${f.name}"></iframe>`;
            modal(`הטמעה — ${f.name}`, h('div', {},
              h('p', { class: 'muted' }, 'קוד הטמעה לאתר (iframe):'),
              h('div', { class: 'code-box' }, embed),
              h('p', { class: 'muted mt' }, 'או Webhook ישיר (POST JSON):'),
              h('div', { class: 'code-box' }, `${location.origin}/api/public/forms/${f.slug}/submit`)), {
              actions: [{ label: 'העתקת קוד ההטמעה', kind: 'primary', onclick: (close) => { navigator.clipboard?.writeText(embed); toast('הועתק ✓', 'success'); close(); } }],
            });
          },
        }, '</> הטמעה'),
        h('button', { class: 'btn sm', onclick: () => openBuilder(f) }, '✏️ עריכה'),
        h('button', {
          class: 'icon-btn', onclick: async () => {
            if (!await confirmModal('מחיקת טופס', `למחוק את "${f.name}"?`)) return;
            await del(`/forms/${f.id}`);
            const { forms: fresh } = await get('/forms');
            renderList(fresh);
          },
        }, '🗑️')));
    }
  };
  renderList(forms);

  function openBuilder(existing) {
    const isNew = !existing;
    const f = existing || {
      name: '', intro_html: '', logo_url: '', language: 'he',
      colors: { primary: '#87cedf', bg: '#0e1b20', text: '#eef7fa' },
      fields: [],
    };
    const name = h('input', { type: 'text', value: f.name, placeholder: 'למשל: טופס לידים — עברית' });
    const intro = h('textarea', { rows: 3, placeholder: 'טקסט פתיחה חופשי (מוצג מעל הטופס)' }, f.intro_html || '');
    const lang = h('select', {},
      h('option', { value: 'he', selected: f.language !== 'en' }, 'עברית (RTL)'),
      h('option', { value: 'en', selected: f.language === 'en' }, 'English (LTR)'));
    const cPrimary = h('input', { type: 'color', value: f.colors?.primary || '#87cedf', style: 'width:52px;padding:2px' });
    const cBg = h('input', { type: 'color', value: f.colors?.bg || '#0e1b20', style: 'width:52px;padding:2px' });
    const logoFile = h('input', { type: 'file', accept: 'image/*' });
    let logoData = f.logo_url || '';
    logoFile.addEventListener('change', async () => {
      if (logoFile.files[0]) { logoData = await fileToDataUrl(logoFile.files[0], 400); toast('לוגו נטען ✓', 'success'); }
    });

    // field picker from מעקב זוגות columns
    const chosen = new Map((f.fields || []).map(x => [x.key, x]));
    const fieldRows = h('div', {},
      ...bindableFields.map(bf => {
        const cb = h('input', { type: 'checkbox', checked: chosen.has(bf.key), style: 'width:auto' });
        const req = h('input', { type: 'checkbox', checked: chosen.get(bf.key)?.required || false, style: 'width:auto', title: 'שדה חובה' });
        const label = h('input', { type: 'text', value: chosen.get(bf.key)?.label || bf.label, style: 'max-width:200px' });
        const sync = () => {
          if (cb.checked) chosen.set(bf.key, { key: bf.key, label: label.value, type: bf.type, options: bf.options, required: req.checked });
          else chosen.delete(bf.key);
        };
        cb.addEventListener('change', sync);
        req.addEventListener('change', sync);
        label.addEventListener('change', sync);
        return h('div', { class: 'pkg-item' }, cb, label,
          h('span', { class: 'muted' }, `(${bf.type})`), h('span', { style: 'flex:1' }),
          h('label', { class: 'flex', style: 'gap:4px' }, req, h('span', { class: 'muted' }, 'חובה')));
      }));

    modal(isNew ? 'טופס לידים חדש' : `עריכת טופס — ${f.name}`, h('div', {},
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'שם הטופס *'), name),
        h('label', { class: 'field' }, h('span', {}, 'שפה'), lang)),
      h('label', { class: 'field' }, h('span', {}, 'טקסט פתיחה'), intro),
      h('div', { class: 'flex', style: 'flex-wrap:wrap' },
        h('label', { class: 'flex' }, h('span', { class: 'muted' }, 'צבע ראשי'), cPrimary),
        h('label', { class: 'flex' }, h('span', { class: 'muted' }, 'צבע רקע'), cBg),
        h('label', { class: 'flex' }, h('span', { class: 'muted' }, 'לוגו'), logoFile)),
      h('h4', { class: 'mt' }, 'בחירת שדות (מתוך עמודות מעקב זוגות)'),
      fieldRows), {
      wide: true,
      actions: [{
        label: isNew ? 'יצירת טופס' : '💾 שמירה', kind: 'primary', onclick: async (close) => {
          if (!name.value.trim()) { toast('שם הטופס חובה', 'error'); return false; }
          if (!chosen.size) { toast('בחרו לפחות שדה אחד', 'error'); return false; }
          const body = {
            name: name.value, intro_html: intro.value, language: lang.value,
            logo_url: logoData || null,
            colors: { primary: cPrimary.value, bg: cBg.value, text: '#eef7fa' },
            fields: [...chosen.values()],
          };
          const rsp = isNew ? await post('/forms', body) : await patch(`/forms/${f.id}`, body);
          close();
          const { forms: fresh } = await get('/forms');
          renderList(fresh);
          if (isNew) {
            modal('הטופס נוצר ✓', h('div', {},
              h('p', {}, 'כתובת ציבורית:'),
              h('div', { class: 'code-box' }, rsp.public_url),
              h('p', { class: 'mt' }, 'קוד הטמעה:'),
              h('div', { class: 'code-box' }, rsp.embed_code)));
          }
        },
      }, { label: 'ביטול', onclick: (close) => close() }],
    });
  }

  section.append(
    h('div', { class: 'flex between' },
      h('h3', { style: 'margin:0' }, '🧾 מחולל טפסי לידים'),
      h('button', { class: 'btn primary', onclick: () => openBuilder(null) }, '+ טופס חדש')),
    h('p', { class: 'muted' }, 'צרו טפסי לידים ממותגים, קבלו קוד הטמעה או Webhook — והחליפו את החיבור למאנדיי.'),
    list);
  return section;
}
