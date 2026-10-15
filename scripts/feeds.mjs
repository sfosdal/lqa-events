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
 *   ics        — The Events Calendar's iCal export (`<list url>?ical=1`) for a site that has shut
 *                its REST API (Field Arts & Events Hall answered 401 to every /wp-json call from
 *                2026-10-14; the export still served). The list view exports the month that
 *                holds `tribe-bar-date`, from that date on, at most 30 events — so the fetch
 *                walks month by month for a year, and again from the day after the last
 *                event when a month came back full. Rows are reshaped like REST rows and mapped
 *                the same way; URL is the event page, LOCATION's first part the room,
 *                CATEGORIES the type.
 *   jsonld     — any page that marks its events up as schema.org Event (eticket.mx's city and
 *                venue listings): name, startDate as the wall clock, url, location.name, the
 *                offers' availability (every one SoldOut = sold out), eventStatus. `at` keeps only
 *                the events whose location matches. The page's charset is honoured (eticket
 *                serves ISO-8859-15, decoded as windows-1252).
 *   ticketera  — ticketera.com (Puerto Rico's ticketer): the rooms' own listing pages, each event's
 *                page for its showings and clock, the category pages for its type — fetched through
 *                scripts/cffi-fetch.py (a Chrome TLS fingerprint, via uv), since its edge refuses
 *                plain clients (San Juan, 2026-10-14).
 *
 * Also here: the empty-list gate every build runs (`emptyListGate`) — a
 * fresh pull with zero upcoming events is a scouting failure or an outage,
 * never a fact about the town, so the build says so loudly and stops
 * (ALLOW_EMPTY_LIST=1 lets a genuinely empty town through on purpose).
 */

const decode = (s) => String(s || '')
  .replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
  .replace(/&#038;|&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([A-Za-z]+);/g, (m, n) => LATIN[n] || m) // the accented letters a Spanish listing spells as entities (Ticketera: "La &Uacute;ltima Noche")
  .replace(/\s+/g, ' ').trim();
const LATIN = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iquest: '¿', iexcl: '¡', ccedil: 'ç', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

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
 * exhibition's run) — are left out, as is anything `drop` matches. A venue
 * feed names its room (`venueLabel`); a city-wide feed (`venueLabel` null —
 * a resort's calendar covering several rooms) takes each row's own venue
 * name, for the aliases to fold, and `rooms` (a regex on that name) keeps
 * only the rooms wanted from it.
 * Returns [{ venue, title, date, time, url, type? }].
 */
export function mapTribeEvents(rows, venueLabel, opts = {}) {
  const { drop, maxRepeat = 8, types, defaultType, rooms, label = venueLabel || 'feed' } = opts;
  const allowed = types ? new Set(types) : null;
  const rowVenue = (e) => decode(e.venue?.venue || e.venue?.name || '');
  const list = (Array.isArray(rows) ? rows : rows?.events || []).filter((e) => e && e.title && e.start_date && e.status !== 'draft' && !e.hide_from_listings)
    .filter((e) => !rooms || rooms.test(rowVenue(e)));
  const dates = new Map();
  for (const e of list) { const t = decode(e.title); if (!dates.has(t)) dates.set(t, new Set()); dates.get(t).add(e.start_date.slice(0, 10)); }
  const out = [];
  let daily = 0;
  for (const e of list) {
    const title = decode(e.title);
    if (drop && drop.test(title)) continue;
    if (dates.get(title).size > maxRepeat) { daily++; continue; }
    const [date, clock] = e.start_date.split(' ');
    const ev = { venue: venueLabel || rowVenue(e), title, date, time: e.all_day || !clock ? '' : clock.slice(0, 5), url: e.website || e.url || '' };
    const type = tribeType(e.categories, allowed) || defaultType;
    if (type) ev.type = type;
    out.push(ev);
  }
  if (daily) console.log(`${label}: ${daily} daily rows (hours, exhibitions) left out`);
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
  const evs = mapTribeEvents(all, opts.venue, { ...opts, label });
  console.log(`${label} (Events Calendar): ${evs.length} events from ${all.length} rows`);
  return evs;
}

// ---- The Events Calendar's iCal export ----
/**
 * A minimal iCalendar reader: folded lines joined, VEVENTs as { PROP: { value, params } }
 * with the text escapes (\, \; \\ \n) undone. Enough for a Tribe export; not a full RFC 5545.
 */
export function parseIcs(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    cur[name] = { value, params: Object.fromEntries(params.map((q) => q.split('='))) };
  }
  return out;
}

/** Tribe iCal VEVENTs as rows shaped like its REST rows, for mapTribeEvents. */
export function icsToTribeRows(text) {
  return parseIcs(text).map((v) => {
    const dt = v.DTSTART;
    if (!v.SUMMARY || !dt) return null;
    const m = dt.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) return null;
    const allDay = dt.params.VALUE === 'DATE' || !m[4];
    return {
      title: decode(v.SUMMARY.value), start_date: `${m[1]}-${m[2]}-${m[3]} ${allDay ? '00:00' : `${m[4]}:${m[5]}`}:00`,
      all_day: allDay, status: 'publish', url: (v.URL || {}).value || '',
      venue: { venue: decode(((v.LOCATION || {}).value || '').split(',')[0]) },
      categories: ((v.CATEGORIES || {}).value || '').split(',').map((n) => n.trim()).filter(Boolean).map((name) => ({ name })),
      uid: (v.UID || {}).value || '',
    };
  }).filter(Boolean);
}

const ICS_PAGE = 30; // the export's cap per call
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nextMonth = (ymd) => { const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
async function fetchIcs(url, ua, label, opts) {
  const today = new Date().toISOString().slice(0, 10);
  const until = nextMonth(addDays(today, 365)); // a year out, the build's horizon (fetch-events WINDOW_DAYS)
  const rows = [];
  const seen = new Set();
  let bar = today;
  for (let call = 1; call <= 30 && bar < until; call++) {
    const u = new URL(url);
    u.searchParams.set('ical', '1'); u.searchParams.set('tribe-bar-date', bar);
    const res = await fetch(u, { headers: { 'User-Agent': ua, Accept: 'text/calendar,*/*' } });
    if (!res.ok) { console.error(`${label} from ${bar} HTTP ${res.status}`); break; }
    const batch = icsToTribeRows(await res.text()).filter((r) => r.start_date >= today);
    let last = bar;
    for (const r of batch) {
      const k = r.uid || `${r.title}|${r.start_date}`;
      if (seen.has(k)) continue;
      seen.add(k); rows.push(r);
      if (r.start_date.slice(0, 10) > last) last = r.start_date.slice(0, 10);
    }
    // a full page may have cut the month short: go on from the day after its last event; else the next month
    bar = batch.length >= ICS_PAGE && last > bar ? addDays(last, 1) : nextMonth(bar);
  }
  const evs = mapTribeEvents(rows, opts.venue, { ...opts, label });
  console.log(`${label} (iCal): ${evs.length} events from ${rows.length} rows`);
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

// ---- Ticketera (ticketera.com, Puerto Rico's ticketer) ----
/**
 * Ticketera's pages are server-rendered (the Carbonhouse platform), but its
 * Fastly edge answers Node, curl and any "Mozilla" client with HTTP 406 or a
 * "Client Challenge" page, and serves the same URL in full to a Chrome TLS
 * handshake — so the pages come through scripts/cffi-fetch.py (curl_cffi,
 * run by uv, one process per batch); `uv` has to be on PATH where a city
 * configures this kind (its workflow installs it). Without uv the fetch
 * falls back to plain fetch, which may be refused — the build says so.
 *
 *   feeds: [{ kind: 'ticketera', label: 'Ticketera', url: 'https://www.ticketera.com',
 *             pages: ['/events/venue/coliseo-de-puerto-rico', …],  // the rooms' own listings (a category page lists the island)
 *             rooms: /coliseo|music hall/i,   // optional: keep only listings at these rooms (a category page's filter)
 *             drop: /abonados/i }]            // optional: season-ticket packages and the like
 *
 * Each listing names its room (the `location` line), so it folds onto a
 * venue row by alias like TusBoletos's. Dates on the listing are Spanish or
 * English month abbreviations ("oct. 16, 2026", "oct. 30 - nov. 1, 2026",
 * "Sep. 17, 2026 - Oct. 25, 2026"); the clock and the per-date showings
 * are on the event page (a multi-day run lists one showing per date and
 * time; a single date carries "Inicio del Evento 8:30 p. m."). The category
 * pages (/events/category/conciertos …) give each event its type.
 */
const TK_MONTHS = { ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, aug: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11, dec: 11 };
const tkIso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** A listing's date text → [start, end] as ISO ("oct. 22 - 23, 2026" → ['2026-10-22', '2026-10-23']); [] when unreadable. */
export function ticketeraDates(text, today = new Date().toISOString().slice(0, 10)) {
  const toks = [];
  let mo = null;
  for (const m of strip(text).matchAll(/(?:([a-z]{3})[a-z]*\.?\s+)?\b(\d{1,2})\b(?:\s*,\s*(\d{4}))?/g)) {
    if (m[1] !== undefined) { if (!(m[1] in TK_MONTHS)) continue; mo = TK_MONTHS[m[1]]; }
    if (mo === null) continue;
    toks.push({ mo, day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  if (!toks.length) return [];
  const [a, b = a] = [toks[0], toks[toks.length - 1]];
  if (b.year === null) { // no year anywhere: the next one from today
    b.year = Number(today.slice(0, 4));
    if (tkIso(b.year, b.mo, b.day) < new Date(Date.parse(today + 'T12:00:00Z') - 31 * 86400e3).toISOString().slice(0, 10)) b.year++;
  }
  if (a.year === null) a.year = a.mo > b.mo ? b.year - 1 : b.year; // "dic. 30 - ene. 2, 2027" starts the year before
  const start = tkIso(a.year, a.mo, a.day), end = tkIso(b.year, b.mo, b.day);
  return end >= start ? [start, end] : [start, start];
}
/** A listing page → cards [{ title, room, dateText, href }] (the Vue search templates on the page are skipped). */
export function parseTicketeraList(html, base = 'https://www.ticketera.com') {
  const pick = (c, re) => { const m = re.exec(c); return m ? decode(m[1]) : ''; };
  const out = [];
  for (const c of String(html || '').split(/<div class="eventItem/).slice(1)) {
    if (/v-html=|v-text=/.test(c.slice(0, 400))) continue; // the search result template, not a listing
    const href = pick(c, /class="title[^"]*">\s*<a href="([^"]+)"/);
    if (!href) continue;
    const dateText = pick(c, /class="date">([\s\S]*?)<\/div>/).replace(/<[^>]+>/g, '');
    out.push({ title: pick(c, /class="title[^"]*">\s*<a href="[^"]+"[^>]*>([\s\S]*?)<\/a>/), room: pick(c, /class="location\s*">([\s\S]*?)<\/div>/), dateText: decode(dateText), href: new URL(href, base).href });
  }
  return out;
}
const tk24 = (h, m, ap) => { let hh = Number(h) % 12; if (/p/i.test(ap)) hh += 12; return `${String(hh).padStart(2, '0')}:${m || '00'}`; };
/**
 * An event page → { showings: [{ date, time, soldOut? }], time } — the showings list (one row
 * per date and time, "viernes, oct. 30 · 8:00 PM"), years inferred from `start` (a month
 * before the start's rolls into the next year), and the sidebar clock for a page with no list.
 */
export function parseTicketeraDetail(html, start) {
  const h = String(html || '');
  const y0 = Number((start || '').slice(0, 4)) || new Date().getFullYear(), m0 = Number((start || '').slice(5, 7)) - 1;
  const showings = [];
  for (const row of h.split(/id="showing_\d+"/).slice(1)) {
    const cell = row; // up to the next showing: its date, clock, ticket link and offers
    const md = /m-date__month">\s*([a-záé]+)\.?\s*<\/span><span class="m-date__day">\s*(\d{1,2})/i.exec(cell);
    const t = /class="time cell">\s*(\d{1,2})(?::(\d{2}))?\s*([AP])M/i.exec(cell);
    if (!md) continue;
    const mo = TK_MONTHS[strip(md[1]).slice(0, 3)];
    if (mo === undefined) continue;
    const y = start && mo < m0 ? y0 + 1 : y0;
    const s = { date: tkIso(y, mo, Number(md[2])), time: t ? tk24(t[1], t[2], t[3]) : '' };
    if (/agotado|sold\s*out/i.test(cell)) s.soldOut = true;
    showings.push(s);
  }
  const st = /sidebar_event_starts[\s\S]*?<span>\s*(\d{1,2})(?::(\d{2}))?\s*<span data-time="([ap])/i.exec(h);
  return { showings, time: st ? tk24(st[1], st[2], st[3]) : '' };
}
/** The room a listing page belongs to: the name most of its cards carry ('' for a category page, which mixes rooms). */
export function pageRoom(cards) {
  const n = new Map();
  for (const c of cards) if (c.room) n.set(c.room, (n.get(c.room) || 0) + 1);
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] * 2 > cards.length ? top[0] : '';
}
const TK_CATEGORY = { conciertos: 'concert', deportes: 'sports', teatros: 'arts', familia: 'community', gastronomico: 'community', conferencias: 'community' };
/** Pages fetched through the Chrome-fingerprint helper (scripts/cffi-fetch.py via uv), url → text; a failure is logged and the URL left out. */
const chromeCache = new Map(); // one fetch of a page per build, however many feed rows ask for it
async function chromeFetch(urls, label) {
  const out = new Map();
  for (const u of urls) if (chromeCache.has(u)) out.set(u, chromeCache.get(u));
  const want = [...new Set(urls.filter((u) => !chromeCache.has(u)))];
  if (!want.length) return out;
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./cffi-fetch.py', import.meta.url);
  const r = spawnSync('uv', ['run', '--quiet', script.pathname, ...want], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.error || r.status !== 0) {
    console.error(`${label}: cffi-fetch.py did not run (${r.error ? r.error.message : `exit ${r.status}: ${(r.stderr || '').trim().slice(-300)}`}) — plain fetch instead, which the site may refuse`);
    for (const u of want) { try { out.set(u, await fetchText(u, '')); chromeCache.set(u, out.get(u)); } catch (err) { console.error(`${label}: ${u} ${err.message}`); } }
    return out;
  }
  for (const [u, v] of Object.entries(JSON.parse(r.stdout))) { if (typeof v === 'string') { out.set(u, v); chromeCache.set(u, v); } else console.error(`${label}: ${u} ${v.error}`); }
  return out;
}
async function fetchTicketera(url, ua, label, opts) {
  const { feed = {}, venue, types } = opts;
  const base = url.replace(/\/$/, '');
  const abs = (p) => new URL(p, base + '/').href;
  const pages = (feed.pages || ['/events']).map(abs);
  const catPages = Object.keys(TK_CATEGORY).map((c) => abs(`/events/category/${c}`));
  const html = await chromeFetch([...pages, ...catPages], label);
  const typeOf = new Map(); // event page → type, from the category listings
  for (const c of Object.keys(TK_CATEGORY)) for (const card of parseTicketeraList(html.get(abs(`/events/category/${c}`)) || '', base)) typeOf.set(card.href, TK_CATEGORY[c]);
  const cards = new Map();
  for (const p of pages) {
    const list = parseTicketeraList(html.get(p) || '', base);
    const room = pageRoom(list); // a room's own page lists the odd event with no location line: it is that room's
    for (const card of list) if (!cards.has(card.href)) cards.set(card.href, card.room || !room ? card : { ...card, room });
  }
  const allowed = types ? new Set(types) : null;
  const keep = [...cards.values()].filter((c) => (!feed.rooms || feed.rooms.test(c.room)) && !(feed.drop && feed.drop.test(c.title)));
  const details = await chromeFetch(keep.map((c) => c.href), label);
  const out = [];
  for (const c of keep) {
    let [start, end] = ticketeraDates(c.dateText);
    if (!start) { const d = spanishDates(c.dateText); if (d.length) [start, end] = [d[0], d[d.length - 1]]; } // the odd listing written out ("4 al 6 de diciembre del 2026")
    if (!start) { console.error(`${label}: no date in "${c.dateText}" (${c.title})`); continue; }
    const d = parseTicketeraDetail(details.get(c.href) || '', start);
    let shows = d.showings.filter((s) => s.date >= start && s.date <= end);
    if (!shows.length) { // no showings list: every day of a short run, the first day of a season-long one
      const days = [];
      for (let t = Date.parse(start + 'T12:00:00Z'); t <= Date.parse(end + 'T12:00:00Z'); t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));
      shows = (days.length <= 14 ? days : [start]).map((date) => ({ date, time: d.time }));
    }
    const type = typeOf.get(c.href);
    for (const s of shows) {
      const ev = { venue: venue || c.room, title: c.title, date: s.date, time: s.time, url: c.href };
      if (s.soldOut) ev.soldOut = true;
      if (type && (!allowed || allowed.has(type))) ev.type = type;
      out.push(ev);
    }
  }
  console.log(`${label} (Ticketera): ${out.length} listings from ${keep.length} events on ${pages.length} pages, ${details.size} event pages read`);
  return out;
}

const KINDS = { tribe: fetchTribe, ics: fetchIcs, tusboletos: fetchTusboletos, jsonld: fetchJsonLd, ticketera: fetchTicketera };

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
    return fn(feed.url, ua, label, { drop: feed.drop, maxRepeat: feed.maxRepeat, rooms: feed.rooms, types, defaultType: venue ? city.venues[venue].type : feed.type, feed, venue });
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
