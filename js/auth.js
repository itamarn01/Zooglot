// Auth screens: password login, OTP (magic code), invite registration,
// forgot/reset password, email verification.
import { post, setToken } from './api.js';
import { h, toast } from './ui.js';

const logoHead = (subtitle) => [
  h('img', { class: 'logo', src: '/assets/logo.svg', alt: 'KOLOT — להקת קולות' }),
  h('h1', {}, 'Zooglot.DB'),
  h('p', { class: 'muted' }, subtitle),
];

function screen(...content) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card card' }, ...content)));
}

const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);

export function renderAuth(onLogin) {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('invite')) return renderRegister(hash.get('invite'), onLogin);
  if (hash.get('reset')) return renderReset(hash.get('reset'), hash.get('email'), onLogin);
  renderLogin(onLogin);
}

function renderLogin(onLogin) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const form = h('form', {},
    field('אימייל', email),
    field('סיסמה', password),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'התחברות'),
    h('div', { class: 'auth-links' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderForgot(onLogin); } }, 'שכחתי סיסמה'),
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderOtp(onLogin); } }, 'התחברות עם קוד למייל')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { token, user } = await post('/auth/login', { email: email.value, password: password.value });
      setToken(token);
      onLogin(user);
    } catch (err) { toast(err.message, 'error'); }
  });
  screen(...logoHead('מערכת ניהול הלקוחות של להקת קולות'), form,
    h('p', { class: 'muted', style: 'margin-top:16px' }, 'הצטרפות למערכת בהזמנה בלבד — פנו למנהל המערכת.'));
}

function renderOtp(onLogin) {
  const email = h('input', { type: 'email', required: true, dir: 'ltr' });
  const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, dir: 'ltr', placeholder: '······', style: 'letter-spacing:6px;text-align:center;font-size:20px' });
  let sent = false;
  const submitBtn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'שליחת קוד למייל');
  const codeField = field('קוד בן 6 ספרות מהמייל', code);
  codeField.style.display = 'none';

  const form = h('form', {}, field('אימייל', email), codeField, submitBtn,
    h('div', { class: 'auth-links' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderLogin(onLogin); } }, '→ חזרה להתחברות עם סיסמה')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (!sent) {
        await post('/auth/otp/request', { email: email.value });
        sent = true;
        codeField.style.display = '';
        submitBtn.textContent = 'התחברות';
        toast('אם המייל קיים במערכת — נשלח אליו קוד התחברות', 'success');
        code.focus();
      } else {
        const { token, user } = await post('/auth/otp/verify', { email: email.value, code: code.value });
        setToken(token);
        onLogin(user);
      }
    } catch (err) { toast(err.message, 'error'); }
  });
  screen(...logoHead('התחברות ללא סיסמה'), form);
}

function renderForgot(onLogin) {
  const email = h('input', { type: 'email', required: true, dir: 'ltr' });
  const form = h('form', {}, field('אימייל', email),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'שליחת קישור לאיפוס'),
    h('div', { class: 'auth-links' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderLogin(onLogin); } }, '→ חזרה להתחברות')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await post('/auth/forgot', { email: email.value });
    toast('אם המייל קיים במערכת — נשלח אליו קישור לאיפוס סיסמה', 'success');
  });
  screen(...logoHead('איפוס סיסמה'), form);
}

function renderReset(token, emailAddr, onLogin) {
  const password = h('input', { type: 'password', required: true, dir: 'ltr', minlength: 8 });
  const form = h('form', {},
    field(`סיסמה חדשה עבור ${emailAddr || ''}`, password),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'עדכון סיסמה'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/auth/reset', { email: emailAddr, token, password: password.value });
      toast('הסיסמה עודכנה — התחבר/י מחדש', 'success');
      history.replaceState(null, '', location.pathname);
      renderLogin(onLogin);
    } catch (err) { toast(err.message, 'error'); }
  });
  screen(...logoHead('בחירת סיסמה חדשה'), form);
}

function renderRegister(inviteToken, onLogin) {
  const name = h('input', { type: 'text', required: true, autocomplete: 'name' });
  const password = h('input', { type: 'password', required: true, minlength: 8, dir: 'ltr', autocomplete: 'new-password' });
  const form = h('form', {},
    field('שם מלא', name),
    field('סיסמה (8 תווים לפחות)', password),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'יצירת חשבון'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { token, user } = await post('/auth/register', {
        invite_token: inviteToken, full_name: name.value, password: password.value,
      });
      setToken(token);
      history.replaceState(null, '', location.pathname);
      toast('נשלח קוד אימות למייל שלך', 'success');
      onLogin(user);
    } catch (err) { toast(err.message, 'error'); }
  });
  screen(...logoHead('הוזמנת להצטרף לצוות 🎉'), form);
}

// verification prompt shown inside the app until the email is verified
export function verifyBanner(user, onVerified) {
  if (user.email_verified) return null;
  const code = h('input', { type: 'text', maxlength: 6, dir: 'ltr', placeholder: 'קוד מהמייל', style: 'max-width:130px;text-align:center' });
  return h('div', { class: 'card', style: 'border-color:var(--warn);margin-bottom:16px' },
    h('div', { class: 'flex between', style: 'flex-wrap:wrap' },
      h('span', {}, '📧 המייל שלך טרם אומת — הזן את הקוד שנשלח אליך:'),
      h('div', { class: 'flex' },
        code,
        h('button', {
          class: 'btn primary sm', onclick: async () => {
            try {
              const { user: u } = await post('/auth/verify-email', { code: code.value });
              toast('המייל אומת בהצלחה ✓', 'success');
              onVerified(u);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, 'אימות'),
        h('button', {
          class: 'btn sm', onclick: async () => {
            await post('/auth/resend-verification', {});
            toast('קוד חדש נשלח למייל', 'success');
          },
        }, 'שליחה חוזרת'))));
}
