/**
 * Generic venue feeds, keyed from city.js — the non-Ticketmaster counterpart
 * of a venue's `tm` block (shared across the sister sites; lqa-events is the
 * source of truth, copy from there). A venue row carries
 *
 *   feed: { kind: 'tribe', url: 'https://<site>/wp-json/tribe/events/v1/events',
 *           drop: /box office open/i,   // optional: titles that are hours, not events
 *           maxRepeat: 8 }              // optional: a title on more dates than this is a daily row (default 8)
 *
 * and fetch-events.mjs adds `feedSources(CITY, ua)` to its source list; a
 * missed room is then a line in city.js and a rebuild, not a new parser
 * (Steve, 2026-10-13, after Field Arts & Events Hall was missed in Port
 * Angeles: "do 1, 2 & 3").
 *
 * Kinds:
 *   tribe — WordPress + The Events Calendar's REST API (/wp-json/tribe/events/v1/events).
 *           start_date is the venue's wall clock ("YYYY-MM-DD HH:MM:SS"); `website` is the
 *           ticket link when the venue sets one, else the event page; categories give the type.
 *
 * Also here: the empty-list gate every build runs (`emptyListGate`) — a
 * fresh pull with zero upcoming events is a scouting failure or an outage,
 * never a fact about the town, so the build says so loudly and stops
 * (ALLOW_EMPTY_LIST=1 lets a genuinely empty town through on purpose).
 */

const decode = (s) => String(s || '')
  .replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
  .replace(/&#038;|&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

// The Events Calendar's categories → the site's event types. Films are a
// 'movie' only where the city lists that type (lqa does; a town with no
// cinema folds them into arts).
const TRIBE_TYPE = [
  [/sport|game|match/i, 'sports'],
  [/film|movie|cinema/i, 'movie'],
  [/comedy|theat|dance|ballet|opera|musical|drama|storytell|humanities|lecture|talk|science|gallery|art\b|arts\b/i, 'arts'],
  [/music|jazz|concert|rock|country|folk|blues|bluegrass|world|band|singer|open mic/i, 'concert'],
  [/fair|festival|market|community|family|fundrais|food|drink|party|holiday/i, 'community'],
];
export function tribeType(categories, allowed) {
  const names = (categories || []).map((c) => decode(c.name || c)).join(' | ');
  for (const [re, type] of TRIBE_TYPE) {
    if (!re.test(names)) continue;
    if (type === 'movie' && allowed && !allowed.has('movie')) return allowed.has('arts') ? 'arts' : null;
    if (!allowed || allowed.has(type)) return type;
  }
  return null;
}

/**
 * Map The Events Calendar's REST rows to feed events. Daily rows — a title
 * the venue repeats on more than `maxRepeat` dates (box-office hours, an
 * exhibition's run) — are left out, as is anything `drop` matches.
 * Returns [{ venue, title, date, time, url, type? }].
 */
export function mapTribeEvents(rows, venueLabel, opts = {}) {
  const { drop, maxRepeat = 8, types, defaultType } = opts;
  const allowed = types ? new Set(types) : null;
  const list = (Array.isArray(rows) ? rows : rows?.events || []).filter((e) => e && e.title && e.start_date && e.status !== 'draft' && !e.hide_from_listings);
  const dates = new Map();
  for (const e of list) { const t = decode(e.title); if (!dates.has(t)) dates.set(t, new Set()); dates.get(t).add(e.start_date.slice(0, 10)); }
  const out = [];
  let daily = 0;
  for (const e of list) {
    const title = decode(e.title);
    if (drop && drop.test(title)) continue;
    if (dates.get(title).size > maxRepeat) { daily++; continue; }
    const [date, clock] = e.start_date.split(' ');
    const ev = { venue: venueLabel, title, date, time: e.all_day || !clock ? '' : clock.slice(0, 5), url: e.website || e.url || '' };
    const type = tribeType(e.categories, allowed) || defaultType;
    if (type) ev.type = type;
    out.push(ev);
  }
  if (daily) console.log(`${venueLabel}: ${daily} daily rows (hours, exhibitions) left out`);
  return out;
}

async function fetchTribe(url, ua, label, opts) {
  const today = new Date().toISOString().slice(0, 10);
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const u = new URL(url);
    u.searchParams.set('per_page', '50'); u.searchParams.set('page', String(page)); u.searchParams.set('start_date', today);
    const res = await fetch(u, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
    if (!res.ok) { if (page === 1 || res.status !== 400) console.error(`${label} page ${page} HTTP ${res.status}`); break; } // Tribe answers 400 past the last page
    const data = await res.json();
    all.push(...(data.events || []));
    if (page >= (data.total_pages || 1)) break;
  }
  const evs = mapTribeEvents(all, label, opts);
  console.log(`${label} (Events Calendar): ${evs.length} events from ${all.length} rows`);
  return evs;
}

const KINDS = { tribe: fetchTribe };

/** One source thunk per city.js venue with a `feed`, for fetch-events.mjs's source list. */
export function feedSources(city, ua) {
  const types = (city.types || []).map((t) => t.key);
  return Object.entries(city.venues || {}).filter(([, v]) => v.feed).map(([label, v]) => () => {
    const run = KINDS[v.feed.kind];
    if (!run) { console.error(`${label}: unknown feed kind "${v.feed.kind}"`); return []; }
    return run(v.feed.url, ua, label, { drop: v.feed.drop, maxRepeat: v.feed.maxRepeat, types, defaultType: v.type });
  });
}

/**
 * The empty-list gate. `fresh` is this build's own pull (not the archive);
 * with sources configured and nothing upcoming among them the build is not
 * a picture of the town — a room was missed in scouting, or every source is
 * down — so it stops rather than publish an empty calendar. Returns true
 * when the build may go on.
 */
export function emptyListGate(fresh, today, nSources, env = process.env) {
  const upcoming = fresh.filter((e) => e.date >= today).length;
  if (upcoming > 0 || nSources === 0) return true;
  const line = '!'.repeat(72);
  console.error(`\n${line}\nEMPTY LIST: ${nSources} sources, 0 upcoming events.\nThat is a scouting failure or an outage, not a fact about the town — the\ncity is not done, and not deployed, until Steve has seen this number.\nALLOW_EMPTY_LIST=1 publishes anyway.\n${line}\n`);
  return !!env.ALLOW_EMPTY_LIST;
}
