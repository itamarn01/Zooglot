// Live change feed. Three people work this board at once; without this, seeing
// a colleague's edit means refreshing.
//
// Read over fetch rather than with EventSource: EventSource cannot set headers,
// which would mean putting the auth token in the URL where it lands in proxy and
// server logs. The cost is reconnecting by hand, which is the loop below.
import { getToken } from './api.js';

const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__) || '';
const subscribers = new Set();

let running = false;
let controller = null;
let backoff = 1000;

export function onLive(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function emit(ev) {
  for (const fn of [...subscribers]) {
    try { fn(ev); } catch { /* one bad listener must not kill the feed */ }
  }
}

export function startLive() {
  if (running) return;
  running = true;
  loop();
  // A phone suspends the connection when the app is backgrounded; coming back
  // to a silently dead socket is the classic way "live" quietly stops being live.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running && !controller) loop();
  });
}

export function stopLive() {
  running = false;
  controller?.abort();
  controller = null;
}

async function loop() {
  while (running) {
    try {
      await connect();
      backoff = 1000;           // a clean close means the server is reachable
    } catch {
      // fall through to the backoff below
    }
    if (!running) return;
    await new Promise(r => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 30000);
  }
}

async function connect() {
  const token = getToken();
  if (!token) throw new Error('no token');
  controller = new AbortController();
  try {
    const rsp = await fetch(`${API_BASE}/api/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!rsp.ok || !rsp.body) throw new Error(`stream ${rsp.status}`);

    const reader = rsp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; ": ping" comments have no
      // data field and fall out on their own
      let sep;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try { emit(JSON.parse(line.slice(5).trim())); } catch { /* ignore junk */ }
        }
      }
    }
  } finally {
    controller = null;
  }
}
