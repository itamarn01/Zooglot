// Stale-while-revalidate cache for tab data.
//
// Every tab used to fetch from scratch on entry, so switching contracts →
// מעקב זוגות re-downloaded the whole board and showed skeletons again for data
// the browser already had. Now a tab paints immediately from the last copy and
// checks the server in the background, replacing the view only if something
// actually changed.
//
// Deliberately in memory only: a CRM three people edit at once should never show
// yesterday's board from localStorage after a cold start.
const entries = new Map(); // key -> { data, at, sig }

export const peek = (key) => entries.get(key)?.data;
export const cachedAt = (key) => entries.get(key)?.at || 0;
export const drop = (key) => entries.delete(key);
export const dropAll = () => entries.clear();

export function put(key, data, sig) {
  entries.set(key, { data, at: Date.now(), sig });
}

// Cheap change detection. Comparing whole payloads means stringifying megabytes
// on every revalidation, so callers pass something small that still moves when
// the data does (row count + newest updated_at covers add/remove/edit).
export function rowsSig(rows) {
  if (!Array.isArray(rows)) return String(rows && Object.keys(rows).length);
  let newest = '';
  for (const r of rows) {
    const t = r?.updated_at || r?.created_at || '';
    if (t > newest) newest = t;
  }
  return `${rows.length}|${newest}`;
}

/**
 * Render-now-verify-after.
 *
 * @param key      cache key
 * @param fetcher  () => Promise<data>
 * @param render   (data, fromCache) => void — called at most twice: once with
 *                 the cached copy, and again only if the server disagrees
 * @param sigOf    (data) => string — cheap signature, defaults to rowsSig
 * @returns true when it painted from cache (so the caller can skip its skeleton)
 */
export async function swr(key, fetcher, render, sigOf = rowsSig) {
  const hit = entries.get(key);
  if (hit) {
    render(hit.data, true);
    // revalidate without blocking the paint; a failure here is not the user's
    // problem — they are already looking at usable data
    fetcher().then((fresh) => {
      const sig = sigOf(fresh);
      put(key, fresh, sig);
      if (sig !== hit.sig) render(fresh, false);
    }).catch(() => { });
    return true;
  }
  const data = await fetcher();
  put(key, data, sigOf(data));
  render(data, false);
  return false;
}
