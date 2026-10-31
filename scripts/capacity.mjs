// Each Ticketmaster event's own house size (Steve, 2026-10-19: "determine
// capacity once, when the event was first found … not require actual chrome,
// but work from github actions"). city.js holds one capacity per venue, but a
// room's size changes with its setup: Climate Pledge Arena sells 16,061 for
// hockey, 15,288 for an all-seated end-stage show, 16,412 with a standing
// floor. Ticketmaster's seat map reads a static manifest of every section and
// its seat count (standing areas flagged `ga`, in blocks of up to 500) from
// pubapi.ticketmaster.com — a plain S3 file behind their CDN, CORS open, no
// bot wall (the event page itself answers 401 to anything but a browser).
// Its total is the house Ticketmaster sells: suites sold elsewhere are not in
// it. Not a documented API, so a missing or changed file just means no
// capacity, and the page falls back to city.js.

export const MANIFEST_URL = (id) => `https://pubapi.ticketmaster.com/sdk/static/manifest/v1/${id}`;

export function tmEventId(url) { // Ticketmaster's 16-hex event id, or null
  const m = (url || '').match(/ticketmaster\.[a-z.]+\/(?:[^?#]*\/)?event\/([0-9A-F]{16})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// the manifest's total: every section's seats, standing areas included; null
// when it lists nothing
export function manifestTotal(m) {
  const sections = (m && m.manifestSections) || [];
  const total = sections.reduce((n, s) => n + (Number(s.numSeats) || 0), 0);
  return total > 0 ? total : null;
}

// add-on listings carry a placeholder house (a "Fan Pass" of 5,000, a
// grounds pass of 75,000), never the night's: no capacity for those
const ADD_ON = /fan pass|court pass|\bvip\b|grounds admission|club fee|replica|upgrade|parking|package/i;

// Ticketmaster's edge rate-limits the manifest host: a burst (four at once,
// or one a second for ten) answers 403 {"response":"dynamic_block"} for a
// little while; one request every three seconds stayed clear (2026-10-19). So
// the reads are paced, a block ends the run (the rest wait for the next
// build — never worked around), and one build asks at most MAX_READS, the
// soonest events first: the first build fills the next weeks, later ones
// only the newly announced. A missing manifest is S3's own XML AccessDenied.
export const PACE_MS = 3000;
export const MAX_READS = 120;

// Stamps `capacity` on every upcoming Ticketmaster event: carried forward from
// the previous feed when it was read before (0 = looked, no manifest — not
// asked again), read otherwise. A read that fails (network, 5xx) or is not
// reached leaves the event without one, so a later build asks again.
// `seed` (id → capacity) is scripts/data/capacity.json, read from a Mac by
// scripts/capacity-seed.mjs: Ticketmaster blocks GitHub's runners on the
// first read (2026-10-19), so until a server of Steve's reads them the seed
// is where an Actions build gets its capacities.
// `fallbackFetch`: when the plain read is blocked, the same read once more through it (chromeManifestFetch below,
// a Chrome TLS fingerprint) — and, if that answers, the rest of the build's reads too (Steve, 2026-10-30:
// "capacities … from something that runs while you're offline").
export async function stampCapacity(events, previous, { today, seed = {}, fetchImpl = fetch, fallbackFetch = null, userAgent, paceMs = PACE_MS, maxReads = MAX_READS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const known = new Map(Object.entries(seed).filter(([, c]) => Number.isInteger(c)));
  for (const e of previous || []) { const id = tmEventId(e.url); if (id && Number.isInteger(e.capacity)) known.set(id, e.capacity); }
  const todo = new Map(); // id → events still without one, soonest first
  let carried = 0;
  for (const e of [...events].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const id = tmEventId(e.url);
    if (!id || (today && e.date < today) || ADD_ON.test(e.title || '')) continue;
    if (known.has(id)) { e.capacity = known.get(id); carried++; continue; }
    if (!todo.has(id)) todo.set(id, []);
    todo.get(id).push(e);
  }
  let fetched = 0, none = 0, failed = 0, reads = 0, blocked = false, switched = false;
  for (const [id, list] of todo) {
    if (reads >= maxReads) break;
    if (reads) await sleep(paceMs);
    reads++;
    let cap;
    try {
      for (;;) {
        const r = await fetchImpl(MANIFEST_URL(id), { headers: userAgent ? { 'user-agent': userAgent } : {} });
        if (r.ok) { cap = manifestTotal(await r.json()) || 0; break; }
        const body = await r.text().catch(() => '');
        if (r.status === 403 && /AccessDenied/.test(body)) { cap = 0; break; } // S3: no manifest for this listing
        if (r.status === 403 || r.status === 429) { // the rate limiter: try the fallback once, else stop and the rest wait
          if (fallbackFetch && fetchImpl !== fallbackFetch) { fetchImpl = fallbackFetch; switched = true; continue; }
          blocked = true; break;
        }
        throw new Error(`HTTP ${r.status}`);
      }
    } catch { failed++; continue; }
    if (blocked) break;
    if (cap) fetched++; else none++;
    for (const e of list) e.capacity = cap;
  }
  const waiting = [...todo.values()].filter((l) => l[0].capacity === undefined).length - failed;
  return { carried, fetched, none, failed, waiting, blocked, switched };
}

// One manifest read through scripts/cffi-fetch.py (curl_cffi, Chrome's TLS handshake), shaped like a fetch
// Response: Ticketmaster's edge blocks GitHub's runners' plain reads from the first one (2026-10-19).
export async function chromeManifestFetch(url) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('uv', ['run', '--quiet', new URL('./cffi-fetch.py', import.meta.url).pathname, url], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error || r.status !== 0) throw new Error(`cffi-fetch.py: ${r.error ? r.error.message : `exit ${r.status}`}`);
  const v = JSON.parse(r.stdout)[url];
  if (typeof v === 'string') return { ok: true, status: 200, json: async () => JSON.parse(v), text: async () => v };
  const status = Number((/HTTP (\d{3})/.exec(v.error) || [])[1]);
  if (!status) throw new Error(v.error);
  return { ok: false, status, text: async () => v.body || '' };
}
