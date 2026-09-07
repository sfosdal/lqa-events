#!/usr/bin/env node
/**
 * Aggregates upcoming events around Seattle Center into site/events.json and
 * site/events.ics. Runs in CI (see .github/workflows/events.yml) and locally
 * for preview.
 *
 * Each source returns [{ venue, title, date, time, url }]. Add more as venues
 * expose feeds/APIs. Ticketmaster needs a free Discovery API key in env
 * TICKETMASTER_API_KEY (repo secret of the same name); with no key it's skipped.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { buildIcs } from './ics.mjs';
import { parseScListing, scListingDates, parseScVenueCats, mapDiceEvents, parseSiffScreenings, mapOtbEvents, tmType, scType, mapSccEvents, mccawUrlMap, parseSctCalendar, parseMopopCalendar, parsePacsciEvents, parseKexpEvents, parseGoatEvents } from './sources.mjs';
import { mergeWithArchive } from './merge.mjs';
import { applySchedules } from './schedules.mjs';
import { slugify, BADGE_FEEDS, TEAMS } from './badges.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year each way: venues announce whole seasons ahead, and past events
// are kept for a year (carried forward from the previously published feed —
// see mergeWithArchive).
const WINDOW_DAYS = 365;
const FEED_URL = process.env.FEED_URL || 'https://fosdal.net/lqa-events/events.json';
const MAX_EVENTS = 4000; // sanity cap, not a display cap — a year back plus a year ahead across 14 venues runs ~2,500

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Local runs: when the environment doesn't provide TICKETMASTER_API_KEY (CI
// passes it as a repo secret), pick it up from an untracked repo-root .env so
// the localhost preview gets the arena and stadium listings too.
if (!process.env.TICKETMASTER_API_KEY) {
  try {
    const m = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^TICKETMASTER_API_KEY=(.+)$/m);
    if (m) process.env.TICKETMASTER_API_KEY = m[1].trim();
  } catch { /* no .env — Ticketmaster sources warn and skip */ }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&(?:#0?39|apos|rsquo|lsquo);/g, "'")
    .replace(/&(?:#8211|ndash|#45);/g, '-').replace(/&(?:#8212|mdash);/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/\s+/g, ' ').trim();
}

// --- Ticketmaster Discovery API, by venue id (a keyword search capped at
//     100 and silently dropped the arena's spring dates), every page ---
async function ticketmasterVenue({ venueId, venueMatch, label, fallbackUrl, exclude }) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) { console.warn('No TICKETMASTER_API_KEY set — skipping Ticketmaster.'); return []; }
  const all = [];
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ apikey: key, venueId, sort: 'date,asc', size: '200', page: String(page) });
    const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    if (!res.ok) { console.error(`Ticketmaster ${label} page ${page} HTTP ${res.status}`); break; }
    const data = await res.json();
    all.push(...(data?._embedded?.events || []));
    if (page + 1 >= (data?.page?.totalPages || 1)) break;
  }
  console.log(`Ticketmaster ${label}: ${all.length} events`);
  return all
    .filter((e) => (e._embedded?.venues?.[0]?.name || '').toLowerCase().includes(venueMatch))
    .filter((e) => !exclude || !exclude.test(e.name || ''))
    .map((e) => {
      const ev = {
        venue: label,
        title: e.name,
        date: e.dates?.start?.localDate || '',
        time: e.dates?.start?.localTime || '',
        url: e.url || fallbackUrl,
      };
      if (e.ageRestrictions?.legalAgeEnforced) ev.age21 = true;
      const type = tmType(e.classifications?.[0]);
      if (type) ev.type = type;
      // Flex-scheduled games (NFL weekends especially) carry TM's TBD flag:
      // the listed date is a placeholder the league may still move.
      if (e.dates?.start?.dateTBD || e.dates?.start?.dateTBA) ev.dateTbd = true;
      // Ticketmaster keeps a cancelled or postponed show in its listing for a
      // while, marked in dates.status — pass that on rather than list it as
      // if it were still happening (the merge step drops it once it vanishes)
      const code = e.dates?.status?.code;
      if (code === 'cancelled' || code === 'postponed') ev.status = code;
      return ev;
    });
}

// --- McCaw Hall: the venue's RSS lists each production once (one date), so
//     the performances themselves come from the Seattle Center sweep; the RSS
//     just maps a title to the venue's own detail page ---
async function mccawUrls() {
  try {
    const res = await fetch('https://www.mccawhall.com/events/rss');
    if (!res.ok) { console.error('McCaw Hall RSS HTTP', res.status); return new Map(); }
    return mccawUrlMap(await res.text());
  } catch (err) { console.error('McCaw Hall RSS failed:', err.message); return new Map(); }
}
// --- Seattle Center's own calendar, every page of the full listing (seven
//     cards a page, a year runs about a hundred pages), so campus-wide
//     events with no facility tag — Bumbershoot — are included and no venue
//     is capped at its first page. Each card's date comes from the listing's
//     date bars (year inferred: scListingDates) and its venue from the card's
//     facility tag, matched against the page's own Facility/Venue filter;
//     untagged events are "Seattle Center". Venues with a dedicated source
//     above are skipped so the same show isn't listed twice. ---
const SC_CAL = 'https://www.seattlecenter.com/events/event-calendar';
const SC_MAX_PAGES = 200;
// standing daily attractions the calendar lists as an event every single day
const SC_EXCLUDE = /sculpture walk/i;

// facility labels that are venues of their own on the site
const SC_VENUE_LABEL = { 'Marion Oliver McCaw Hall': 'McCaw Hall' };
async function seattleCenterSweep(existingVenues, mccawUrl) {
  const covered = (label) => existingVenues.some((v) => {
    const a = v.toLowerCase(), b = label.toLowerCase();
    return a.includes(b) || b.includes(a);
  });
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);

  let venueLabels = null;
  const seenUrl = new Set();
  let cards = [];
  let pages = 0;
  for (let page = 1; page <= SC_MAX_PAGES; page++) {
    const res = await fetch(`${SC_CAL}?page=${page}`, { headers: { 'user-agent': BROWSER_UA } });
    if (!res.ok) { console.error(`Seattle Center page ${page} HTTP ${res.status}`); break; }
    const html = await res.text();
    if (!venueLabels) {
      venueLabels = parseScVenueCats(html).map((c) => c.label);
      if (!venueLabels.length) console.error('Seattle Center: no venue categories found — page layout changed? (every event will read as "Seattle Center")');
    }
    // past the last page the site serves an empty list — or repeats the last one
    const found = parseScListing(html).filter((c) => !seenUrl.has(c.url));
    if (!found.length) break;
    pages++;
    found.forEach((c) => seenUrl.add(c.url));
    cards = cards.concat(found);
    const dated = scListingDates(cards, today);
    if (dated[dated.length - 1].date > horizon) break;
  }

  const events = [];
  let atOwnSource = 0, standing = 0;
  for (const c of scListingDates(cards, today)) {
    if (!c.date) { console.error(`No date bar for ${c.url}`); continue; }
    if (SC_EXCLUDE.test(c.title)) { standing++; continue; }
    const venueTag = c.tags.find((t) => venueLabels.includes(t));
    if (venueTag && covered(venueTag)) { atOwnSource++; continue; }
    const venue = SC_VENUE_LABEL[venueTag] || venueTag || 'Seattle Center';
    let url = c.url;
    if (venue === 'McCaw Hall' && mccawUrl) url = mccawUrl.get(c.title.toLowerCase()) || url;
    const ev = { venue, title: c.title, date: c.date, time: c.time, url };
    if (c.free) ev.free = true;
    const type = scType(c.tags);
    if (type) ev.type = type;
    events.push(ev);
  }
  console.log(`Seattle Center sweep: ${events.length} events from ${cards.length} cards over ${pages} pages (${atOwnSource} at venues with their own source, ${standing} standing attractions skipped)`);
  return events;
}

// --- The Vera Project: DICE ticketing API (the publishable widget key from
//     theveraproject.org/events — the same call their own embed makes) ---
async function veraProjectDice() {
  const params = new URLSearchParams({ 'page[size]': '100' });
  params.append('filter[venues][]', 'The Vera Project');
  const res = await fetch(`https://events-api.dice.fm/v1/events?${params}`, {
    headers: { 'x-api-key': 'zVXg21HmAF43lbgnB79QM5CUzcHYG0Gx5M6DjHdD' },
  });
  if (!res.ok) { console.error('DICE (Vera Project) HTTP', res.status); return []; }
  return mapDiceEvents(await res.json(), 'The Vera Project');
}

// --- SIFF Cinema Uptown (the LQA movie house on Queen Anne Ave): the
//     calendar page is server-rendered with a JSON blob per showtime, one
//     page per day — sweep the next few weeks. parseSiffScreenings collapses
//     a film's multiple daily showtimes to the earliest one. ---
async function siffUptown() {
  const DAYS = 28; // cinema schedules rarely publish further out
  const events = [];
  const seen = new Set();
  for (let i = 0; i < DAYS; i++) {
    const day = new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10);
    try {
      // view=list is explicit: future dates default to the grid view, whose
      // markup carries the screening blobs but not the detail-page links
      const res = await fetch(`https://www.siff.net/calendar?view=list&date=${day}`, { headers: { 'user-agent': BROWSER_UA } });
      if (!res.ok) { console.error(`SIFF calendar ${day} HTTP ${res.status}`); continue; }
      for (const ev of parseSiffScreenings(await res.text())) {
        const k = `${ev.title}|${ev.date}`;
        if (!seen.has(k)) { seen.add(k); events.push({ venue: 'SIFF Cinema Uptown', ...ev }); }
      }
    } catch (err) {
      console.error(`SIFF calendar ${day} failed:`, err.message);
    }
  }
  console.log(`SIFF Uptown: ${events.length} film-days`);
  return events;
}

// --- On the Boards (100 W Roy St, a block off the Center): Squarespace
//     events collection — ?format=json lists the upcoming performance runs;
//     mapOtbEvents expands each run to one event per night. ---
async function onTheBoards() {
  const res = await fetch('https://ontheboards.org/events?format=json', { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) { console.error('On the Boards HTTP', res.status); return []; }
  return mapOtbEvents(await res.json(), 'On the Boards');
}

// --- Convention Center (Arch + Summit, downtown): the Momentus
//     calendar behind seattlecc.com/upcoming-events, a year ahead ---
const SCC_TOKEN = '3fe87903-ad1d-49d8-b838-0ec814bf6aa1'; // the public widget token on the page
async function seattleConventionCenter() {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
  const params = new URLSearchParams({ fromDate: from, toDate: to, token: SCC_TOKEN });
  const res = await fetch(`https://calendar-us.ungerboeck.io/api/event/getCalendarEvents?${params}`, { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) { console.error('Convention Center HTTP', res.status); return []; }
  const data = await res.json();
  const rows = data?.events?.fields || (Array.isArray(data?.events) ? data.events : []); // {events:{fields:[…]}}
  const events = mapSccEvents(rows, 'Convention Center');
  console.log(`Convention Center: ${events.length} event-days from ${rows.length} bookings`);
  return events;
}

// --- The campus neighbours Seattle Center's calendar doesn't carry ---
const MONTH_SLUG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
async function pageText(url) {
  const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
// Children's Theatre (Charlotte Martin + Eve Alvord theatres, on the
// campus): twelve month grids
async function seattleChildrensTheatre() {
  const out = []; const seen = new Set();
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    try {
      for (const e of parseSctCalendar(await pageText(`https://www.sct.org/tickets-shows/calendar/${y}/${MONTH_SLUG[m - 1]}`), y, m)) {
        const k = `${e.title}|${e.date}|${e.time}`;
        if (!seen.has(k)) { seen.add(k); out.push({ venue: "Children's Theatre", ...e }); }
      }
    } catch (err) { console.error(`SCT ${y}-${m}:`, err.message); }
  }
  console.log(`Children's Theatre: ${out.length} performances`);
  return out;
}
async function mopop() {
  const evs = parseMopopCalendar(await pageText('https://www.mopop.org/events')).map((e) => ({ venue: 'MoPOP', ...e }));
  console.log(`MoPOP: ${evs.length} events`);
  return evs;
}
async function pacificScienceCenter() {
  const evs = parsePacsciEvents(await pageText('https://pacificsciencecenter.org/events/')).map((e) => ({ venue: 'Pacific Science Center', ...e }));
  console.log(`Pacific Science Center: ${evs.length} events`);
  return evs;
}
// KEXP (the station's home is on the campus): its own list, every page;
// only what happens at the station — KEXP also lists shows it presents
// elsewhere in town
async function kexp() {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const html = await pageText(`https://www.kexp.org/events/kexp-events/${page > 1 ? `?page=${page}` : ''}`);
    const evs = parseKexpEvents(html);
    if (!evs.length) break;
    for (const e of evs) {
      if (!/kexp|gathering space|seattle center/i.test(e.location)) continue;
      const { location, ...ev } = e;
      out.push({ venue: 'KEXP', ...ev });
    }
    if (!/[?&]page=${page + 1}\b/.test(html)) break;
  }
  console.log(`KEXP: ${out.length} events at the station`);
  return out;
}

// Neighborhood bars: their nights are typed 'bar' (the site's "Local bars"
// filter) and the venue stays out of the site's venue list — one type
// switch covers every bar. The Traveling Goat is the first; each carries
// its events page as the link, since the listings have none of their own.
const GOAT_URL = 'https://www.travelinggoatseattle.com/events';
async function travelingGoat() {
  const evs = parseGoatEvents(await pageText(GOAT_URL)).map((e) => ({ venue: 'The Traveling Goat', type: 'bar', url: GOAT_URL, ...e }));
  console.log(`Traveling Goat: ${evs.length} events`);
  return evs;
}

// Dedicated per-venue sources run first (better times and ticket links)...
const sources = [
  () => ticketmasterVenue({ venueId: 'KovZ917Ahkk', venueMatch: 'climate pledge', label: 'Climate Pledge Arena', fallbackUrl: 'https://climatepledgearena.com/events/', exclude: /arena tours?|all access pass/i }),
  // The SoDo stadiums: not Seattle Center, but big enough to move the whole city.
  () => ticketmasterVenue({ venueId: 'KovZpZAEevAA', venueMatch: 't-mobile park', label: 'T-Mobile Park', fallbackUrl: 'https://www.mlb.com/mariners', exclude: /ballpark tour|flex membership/i }),
  () => ticketmasterVenue({ venueId: 'KovZpZAEknnA', venueMatch: 'lumen field', label: 'Lumen Field', fallbackUrl: 'https://www.lumenfield.com/events', exclude: /stadium tour|notification list/i }),
  // McCaw Hall comes from the Seattle Center sweep below (every performance,
  // with times); its RSS only supplies the venue's own detail-page links.
  veraProjectDice,
  siffUptown,
  onTheBoards,
  seattleConventionCenter, // downtown, like the stadiums: big enough to matter
  seattleChildrensTheatre,
  mopop,
  pacificScienceCenter,
  kexp,
  travelingGoat,
];

let all = [];
for (const src of sources) {
  try { all = all.concat(await src()); }
  catch (err) { console.error('Source failed:', err.message); }
}

// ...then the campus-wide sweep fills in every other venue (McCaw Hall included).
try { all = all.concat(await seattleCenterSweep([...new Set(all.map((e) => e.venue))], await mccawUrls())); }
catch (err) { console.error('Seattle Center sweep failed:', err.message); }

// Collapse the campus's micro-locations (courtyards, lawns, festival stages —
// whatever sub-spots the sweep discovers) into one "Seattle Center" venue.
// A dozen filter chips for the same lawn helps nobody; only venues with an
// identity of their own keep their name.
const CANONICAL_VENUES = new Set([
  'Climate Pledge Arena', 'T-Mobile Park', 'Lumen Field',
  'McCaw Hall', 'The Vera Project', 'Cornish Playhouse', 'Seattle Center',
  'SIFF Cinema Uptown', 'On the Boards', 'Convention Center',
  "Children's Theatre", 'MoPOP', 'Pacific Science Center', 'KEXP',
  'The Traveling Goat',
]);
const normalizeVenue = (e) => (CANONICAL_VENUES.has(e.venue) ? e : { ...e, venue: 'Seattle Center' });
all = all.map(normalizeVenue);

// window, de-dupe, sort
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const seen = new Set();
const fresh = all
  .filter((e) => e.date && e.date >= cutoff && e.date <= horizon)
  .filter((e) => { const k = `${e.venue}|${e.title}|${e.date}`; if (seen.has(k)) return false; seen.add(k); return true; });

// carry past events forward from the previously published feed
let archived = [];
try {
  const r = await fetch(FEED_URL);
  // normalized too, so past events published under old micro-venue names
  // don't resurrect their filter chips
  if (r.ok) {
    const d = await r.json();
    archived = (Array.isArray(d) ? d : (d.events || [])).map(normalizeVenue)
      // backfill the movie flag on entries archived before it existed
      .map((e) => (!e.movie && e.url && e.url.includes('/cinema/in-theaters/') ? { ...e, movie: true } : e));
  }
  else console.error(`Archive fetch HTTP ${r.status} — past events not carried this run`);
} catch (err) { console.error('Archive fetch failed:', err.message); }

const merged = mergeWithArchive(fresh, archived, today, cutoff).slice(-MAX_EVENTS);

// League schedules flag floating dates Ticketmaster doesn't know yet
try { await applySchedules(merged); } catch (err) { console.error('Schedules step failed:', err.message); }

writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), events: merged }, null, 2) + '\n');
writeFileSync(ICS_OUT, buildIcs(merged));

// Filtered subscribe feeds, one per venue and one per badge, so the site's
// filter chips can offer a matching calendar subscription.
const siteDir = new URL('../site/', import.meta.url);
let nFeeds = 0;
for (const venue of new Set(merged.map((e) => e.venue))) {
  const evs = merged.filter((e) => e.venue === venue);
  writeFileSync(new URL(`events-venue-${slugify(venue)}.ics`, siteDir),
    buildIcs(evs, new Date(), { calname: `LQA Events — ${venue}` }));
  nFeeds++;
}
for (const [slug, [label, pred]] of Object.entries(BADGE_FEEDS)) {
  writeFileSync(new URL(`events-${slug}.ics`, siteDir),
    buildIcs(merged.filter(pred), new Date(), { calname: `LQA Events — ${label}` }));
  nFeeds++;
}
// The site hides SIFF's daily movie showings by default — publish the
// matching exclusion feed so a default-view subscription lines up.
writeFileSync(new URL('events-no-movies.ics', siteDir),
  buildIcs(merged.filter((e) => !e.movie), new Date(), { calname: 'LQA Events — no movies' }));
nFeeds++;
// Exclusion feeds, one per local team: everything except that team's games.
for (const t of TEAMS) {
  writeFileSync(new URL(`events-no-${t.slug}.ics`, siteDir),
    buildIcs(merged.filter((e) => !t.re.test(e.title || '')), new Date(), { calname: `LQA Events — no ${t.label}` }));
  nFeeds++;
}

const nPast = merged.filter((e) => e.date < today).length;
console.log(`Wrote ${merged.length} events (${nPast} past, ${merged.length - nPast} upcoming) + ${nFeeds} filtered feeds`);
