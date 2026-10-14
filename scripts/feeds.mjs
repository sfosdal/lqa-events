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
 * A ticketer that lists a whole town (TusBoletos, eticket in Cancún) is a
 * city-wide feed instead: city.js `feeds: [{ kind, url, label, … }]`, where
 * each listing keeps the room the ticketer names and fetch-events.mjs folds
 * it onto a venue row by `alias`, or into `groundsVenue` (cancun-events,
 * 2026-10-13, the first city without Ticketmaster).
 *
 * Kinds:
 *   tribe      — WordPress + The Events Calendar's REST API (/wp-json/tribe/events/v1/events).
 *                start_date is the venue's wall clock ("YYYY-MM-DD HH:MM:SS"); `website` is the
 *                ticket link when the venue sets one, else the event page; categories give the type.
 *   tusboletos — tusboletos.mx (the Yucatán peninsula's ticketer): the server-rendered /eventos
 *                list, one card per event with the title, the city ("Cancún, Quintana Roo"), the
 *                room, a Spanish date and a commented-out category; the clock sits on the event
 *                page ("6:30 P.M. y 9:00 P.M." = two showings, one listing each). `cities` picks
 *                the towns to keep, each with an optional suffix for its room names.
 *   jsonld     — any page that marks its events up as schema.org Event (eticket.mx's city and
 *                venue listings): name, startDate as the wall clock, url, location.name, the
 *                offers' availability (every one SoldOut = sold out), eventStatus. `at` keeps only
 *                the events whose location matches. The page's charset is honoured (eticket
 *                serves ISO-8859-15, decoded as windows-1252).
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

// ---- tusboletos.mx ----
const strip = (str) => String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/**
 * A Spanish date to ISO: "Jueves 15 de Octubre del 2026" → "2026-10-15". A range ("Del miercoles 28
 * de octubre al jueves 29 de octubre", no year) gives every day in it; a date with no year is the
 * next one from `today` (this year, or next once it is more than a month past).
 */
export function spanishDates(text, today = new Date().toISOString().slice(0, 10)) {
  const out = [];
  for (const m of strip(text).matchAll(/(\d{1,2})\s+de\s+([a-z]+)(?:\s+del?\s+(\d{4}))?/g)) {
    const mo = ES_MONTHS.indexOf(m[2]); if (mo < 0) continue;
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    const iso = (yy) => `${yy}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!m[3] && iso(y) < new Date(Date.parse(today + 'T12:00:00Z') - 31 * 86400e3).toISOString().slice(0, 10)) y++;
    out.push(iso(y));
  }
  if (out.length === 2 && out[0] < out[1] && /\bal\b/.test(strip(text))) { // a range: every day in it
    const days = []; for (let t = Date.parse(out[0] + 'T12:00:00Z'); t <= Date.parse(out[1] + 'T12:00:00Z'); t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));
    return days.length <= 14 ? days : [out[0]]; // a season-long run is one listing, not a hundred
  }
  return out.slice(0, 1);
}
const TUS_TYPE = [[/deporte|lucha|box\b|futbol|beisbol/i, 'sports'], [/concierto|musica|festival de rock/i, 'concert'], [/teatro|ballet|danza|comedia|stand ?up|monolog|opera|circo|magia/i, 'arts'], [/infantil|familiar|feria|expo\b|festival/i, 'community']];
/** The /eventos list → cards [{ title, city, room, dateText, tag, href }] (`cities` filters and suffixes the rooms). */
export function parseTusboletosList(html, { cities, base = 'https://www.tusboletos.mx' } = {}) {
  const pick = (c, re) => { const m = re.exec(c); return m ? decode(m[1]) : ''; };
  const out = [];
  for (const c of String(html || '').split('<div class="thumbnail">').slice(1)) {
    const city = pick(c, /<b>([^<]*)<\/b>/);
    const town = cities ? cities.find((t) => t.match.test(city)) : { suffix: '' };
    if (!town) continue;
    const href = pick(c, /href="(\/evento\/[^"]+)"/);
    if (!href) continue;
    let title = pick(c, /<h4>([^<]*)<\/h4>/).replace(/\s*[-–]\s*[^-–]*$/, (m) => strip(m).includes(strip(city.split(',')[0]).slice(0, 5)) ? '' : m); // the city suffix TusBoletos adds ("… - Cancún", "… - Playa de Carmen")
    title = title.replace(/^[“"]\s*(.*?)\s*[”"]$/, '$1').trim(); // a title quoted whole
    out.push({ title, city, room: pick(c, /fa-map-marker"><\/i>&nbsp;\s*([^<]*)<\/p>/) + (town.suffix || ''), dateText: pick(c, /fa-calendar"><\/i>&nbsp;\s*([^<]*)<\/p>/), tag: pick(c, /fa-tag"><\/i>&nbsp;\s*([^<]*)<\/p>/), href: new URL(href, base).href });
  }
  return out;
}
/** The event page's clock line → ['18:30', '21:00'] ("6:30 P.M. y 9:00 P.M."); [] when the page names none. */
export function tusboletosTimes(html) {
  const m = /fa-clock-o"><\/i><\/span>&nbsp;\s*([^<]*)</.exec(String(html || ''));
  if (!m) return [];
  const out = [];
  for (const t of m[1].matchAll(/(\d{1,2})(?::(\d{2}))?\s*([AP])\.?\s*M\b/gi)) {
    let h = Number(t[1]) % 12; if (/p/i.test(t[3])) h += 12;
    out.push(`${String(h).padStart(2, '0')}:${t[2] || '00'}`);
  }
  return out;
}
const listCache = new Map(); // one fetch of a ticketer's list per build, however many rows read it
async function fetchText(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'text/html,*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeBody(await res.arrayBuffer(), res.headers.get('content-type') || '');
}
/** A page's bytes as text, by its declared charset (eticket's ISO-8859-15 reads as windows-1252; everything else is UTF-8). */
export function decodeBody(buf, contentType = '') {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  const m = /charset=["']?([\w-]+)/i.exec(contentType) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  const cs = m ? m[1].toLowerCase() : 'utf-8';
  return new TextDecoder(/iso-8859|windows-125|latin/.test(cs) ? 'windows-1252' : 'utf-8').decode(buf);
}
async function fetchTusboletos(url, ua, label, opts) {
  const { feed = {}, venue, types } = opts;
  if (!listCache.has(url)) listCache.set(url, fetchText(url, ua));
  const cards = parseTusboletosList(await listCache.get(url), { cities: feed.cities });
  const allowed = types ? new Set(types) : null;
  const out = [];
  let pages = 0;
  for (const c of cards) {
    const dates = spanishDates(c.dateText);
    if (!dates.length) { console.error(`${label}: no date in "${c.dateText}" (${c.title})`); continue; }
    let times = [];
    try { await new Promise((r) => setTimeout(r, 250)); times = tusboletosTimes(await fetchText(c.href, ua)); pages++; } // the clock is on the event page only
    catch (err) { console.error(`${label}: ${c.href} ${err.message} — listed without a time`); }
    const type = (TUS_TYPE.find(([re]) => re.test(strip(c.tag))) || [])[1];
    for (const date of dates) for (const time of (times.length ? times : [''])) {
      const ev = { venue: venue || c.room, title: c.title, date, time, url: c.href };
      if (type && (!allowed || allowed.has(type))) ev.type = type;
      out.push(ev);
    }
  }
  console.log(`${label} (TusBoletos): ${out.length} listings from ${cards.length} cards, ${pages} event pages`);
  return out;
}

// ---- schema.org Event markup (eticket.mx) ----
/** Every schema.org Event in a page's ld+json → feed events; `at` keeps those whose location matches. */
export function parseJsonLdEvents(html, { venue, at, types } = {}) {
  const allowed = types ? new Set(types) : null;
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(j) ? j : j && j['@graph'] ? j['@graph'] : [j];
    for (const o of items) {
      if (!o || !/Event/.test(String(o['@type']))) continue;
      const loc = typeof o.location === 'object' ? o.location?.name : o.location;
      if (at && !at.test(loc || '')) continue;
      const sd = String(o.startDate || '');
      if (!/^\d{4}-\d{2}-\d{2}/.test(sd)) continue;
      const ev = { venue: venue || decode(loc) || '', title: decode(o.name), date: sd.slice(0, 10), time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(sd) ? sd.slice(11, 16) : '', url: String(o.url || '') };
      const offers = Array.isArray(o.offers) ? o.offers : o.offers ? [o.offers] : [];
      if (offers.length && offers.every((x) => /SoldOut/i.test(String(x.availability || '')))) ev.soldOut = true;
      const st = String(o.eventStatus || '');
      if (/Cancelled/i.test(st)) ev.status = 'cancelled'; else if (/Postponed|Rescheduled/i.test(st)) ev.status = 'postponed';
      if (o.offers && allowed) { /* the type comes from the row the venue folds onto */ }
      out.push(ev);
    }
  }
  return out;
}
async function fetchJsonLd(url, ua, label, opts) {
  const html = await fetchText(url, ua);
  const evs = parseJsonLdEvents(html, { venue: opts.venue, at: opts.feed?.at, types: opts.types });
  console.log(`${label} (schema.org events): ${evs.length} events`);
  return evs;
}

const KINDS = { tribe: fetchTribe, tusboletos: fetchTusboletos, jsonld: fetchJsonLd };

/**
 * One source thunk per city.js venue with a `feed` (its listings pinned to that row) and one per
 * entry of city.js `feeds` (city-wide: each listing keeps the room the feed names, for the aliases
 * and `groundsVenue` in fetch-events.mjs to fold), for fetch-events.mjs's source list.
 */
export function feedSources(city, ua) {
  const types = (city.types || []).map((t) => t.key);
  const run = (feed, label, venue) => () => {
    const fn = KINDS[feed.kind];
    if (!fn) { console.error(`${label}: unknown feed kind "${feed.kind}"`); return []; }
    return fn(feed.url, ua, label, { drop: feed.drop, maxRepeat: feed.maxRepeat, types, defaultType: venue ? city.venues[venue].type : undefined, feed, venue });
  };
  return [
    ...Object.entries(city.venues || {}).filter(([, v]) => v.feed).map(([label, v]) => run(v.feed, label, label)),
    ...(city.feeds || []).map((f) => run(f, f.label || f.kind, null)),
  ];
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
