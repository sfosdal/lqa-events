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
export async function stampCapacity(events, previous, { today, fetchImpl = fetch, userAgent, paceMs = PACE_MS, maxReads = MAX_READS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const known = new Map();
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
  let fetched = 0, none = 0, failed = 0, reads = 0, blocked = false;
  for (const [id, list] of todo) {
    if (reads >= maxReads) break;
    if (reads) await sleep(paceMs);
    reads++;
    let cap;
    try {
      const r = await fetchImpl(MANIFEST_URL(id), { headers: userAgent ? { 'user-agent': userAgent } : {} });
      if (r.ok) cap = manifestTotal(await r.json()) || 0;
      else {
        const body = await r.text().catch(() => '');
        if (r.status === 403 && /AccessDenied/.test(body)) cap = 0; // S3: no manifest for this listing
        else if (r.status === 403 || r.status === 429) { blocked = true; break; } // the rate limiter: stop, the rest wait
        else throw new Error(`HTTP ${r.status}`);
      }
    } catch { failed++; continue; }
    if (cap) fetched++; else none++;
    for (const e of list) e.capacity = cap;
  }
  const waiting = [...todo.values()].filter((l) => l[0].capacity === undefined).length - failed;
  return { carried, fetched, none, failed, waiting, blocked };
}
