// Thin API client — token persisted in localStorage, JSON in/out.
const TOKEN_KEY = 'zooglot_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export async function api(path, { method = 'GET', body, formData } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const rsp = await fetch(`/api${path}`, {
    method, headers,
    body: formData ? formData : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await rsp.json(); } catch { /* empty body */ }
  if (!rsp.ok) {
    if (rsp.status === 401 && !path.startsWith('/auth')) {
      setToken(null);
      location.reload();
      return new Promise(() => {}); // halt callers during reload
    }
    throw new Error(data?.error || `שגיאה ${rsp.status}`);
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const upload = (p, formData) => api(p, { method: 'POST', formData });
