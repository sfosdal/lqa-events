#!/usr/bin/env node
/**
 * Aggregates upcoming events around Seattle Center into site/events.json and
 * site/events.ics. Runs in CI (see .github/workflows/events.yml) and locally
 * for preview. The build itself — Ticketmaster by venue id, the archive, the
 * window, team schedules, links and every file written — is scripts/build.mjs,
 * which every city shares (sync-shared.sh copies it); only the readers below,
 * the Seattle Center sweep and site/city.js are this site's.
 *
 * Each source returns [{ venue, title, date, time, url }]. Ticketmaster needs a
 * free Discovery API key in env TICKETMASTER_API_KEY (repo secret of the same
 * name; locally an untracked repo-root .env); with no key it's skipped.
 */
import './failures.mjs'; // first: every outside call retried, the ones still failing written to failures.json (Steve, 2026-10-29)
import { readFileSync } from 'node:fs';
import { parseScListing, scListingDates, parseScVenueCats, mapDiceEvents, parseSiffScreenings, mapOtbEvents, mapRepEvents, scType, mapSccEvents, mccawUrlMap, parseSctCalendar, parseMopopCalendar, parsePacsciEvents, parseKexpEvents, parseGoatEvents, parseBlockPartyArtists, parseBumbershootSchedule, mapPrideFestEvents, parseFolklifeDates, parseShowboxEvents, parseMarinersIndex, parseMarinersEvent } from './sources.mjs';
import { feedFailedVenues, chromeFetch } from './feeds.mjs';
import { applySetTimes } from './settimes.mjs';
import { CITY } from './badges.mjs';
import { stampCapacity, chromeManifestFetch } from './capacity.mjs';
import { build, BROWSER_UA, WINDOW_DAYS } from './build.mjs';

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&(?:#0?39|apos|rsquo|lsquo);/g, "'")
    .replace(/&(?:#8211|ndash|#45);/g, '-').replace(/&(?:#8212|mdash);/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/\s+/g, ' ').trim();
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
// A year's calendar runs about a year out (Bumbershoot, Folklife, the next
// season's bookings). Twice (2026-10-29 ~00:50 and ~22:00 UTC) the site
// served a list that ended in mid-January for a while — page 47 short, page
// 48 empty, like a real end — and McCaw lost half its nights. A list that
// ends nearer than this is named in the failure mail.
const SC_SHORT_DAYS = 240;
const SC_RETRY_MS = 3000;
// standing daily attractions the calendar lists as an event every single day
const SC_EXCLUDE = /sculpture walk/i;

// facility labels that are venues of their own on the site
const SC_VENUE_LABEL = { 'Marion Oliver McCaw Hall': 'McCaw Hall' };
// The calendar also lists Seattle Rep's performances, untagged (no
// facility, so they'd read as the grounds) and named the Rep's way with the
// night's flavour after a colon ("Eureka Day: Preview Performance"); the
// Rep's own feed supplies them, so a card whose title starts with a Rep
// show playing that day is that show, and skipped.
async function seattleCenterSweep(dedicated, mccawUrl) {
  const existingVenues = [...new Set(dedicated.map((e) => e.venue))];
  const covered = (label) => existingVenues.some((v) => {
    const a = v.toLowerCase(), b = label.toLowerCase();
    return a.includes(b) || b.includes(a);
  });
  const repByDate = new Map();
  for (const e of dedicated) {
    if (e.venue !== 'Seattle Rep') continue;
    const base = e.title.toLowerCase().split(':')[0].trim();
    if (!repByDate.has(e.date)) repByDate.set(e.date, new Set());
    repByDate.get(e.date).add(base);
  }
  const atRep = (c) => [...(repByDate.get(c.date) || [])].some((t) => c.title.toLowerCase().startsWith(t));
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);

  let venueLabels = null;
  const seenUrl = new Set();
  let cards = [];
  let pages = 0;
  let stop = `the ${SC_MAX_PAGES}-page cap`;
  const read = (page) => fetch(`${SC_CAL}?page=${page}`, { headers: { 'user-agent': BROWSER_UA } });
  for (let page = 1; page <= SC_MAX_PAGES; page++) {
    const res = await read(page);
    if (!res.ok) { console.error(`Seattle Center page ${page} HTTP ${res.status}`); stop = `HTTP ${res.status} on page ${page}`; break; }
    const html = await res.text();
    if (!venueLabels) {
      venueLabels = parseScVenueCats(html).map((c) => c.label);
      if (!venueLabels.length) console.error('Seattle Center: no venue categories found — page layout changed? (every event will read as "Seattle Center")');
    }
    // past the last page the site serves an empty list — or repeats the last one
    let found = parseScListing(html).filter((c) => !seenUrl.has(c.url));
    if (!found.length) {
      // a blip mid-list looks the same: ask once more before calling it the end
      await new Promise((r) => setTimeout(r, SC_RETRY_MS));
      const again = await read(page);
      if (again.ok) found = parseScListing(await again.text()).filter((c) => !seenUrl.has(c.url));
      if (!found.length) { stop = `no new cards on page ${page}, read twice`; break; }
      console.log(`Seattle Center page ${page}: empty, then ${found.length} cards on the second read`);
    }
    pages++;
    found.forEach((c) => seenUrl.add(c.url));
    cards = cards.concat(found);
    const dated = scListingDates(cards, today);
    if (dated[dated.length - 1].date > horizon) { stop = `the ${WINDOW_DAYS}-day horizon on page ${page}`; break; }
  }
  const lastDate = cards.length ? scListingDates(cards, today).at(-1).date : '';
  const shortOf = new Date(Date.now() + SC_SHORT_DAYS * 86400e3).toISOString().slice(0, 10);
  if (stop.startsWith('no new cards') && !(lastDate >= shortOf)) {
    console.error(`Seattle Center calendar cut short: the list ended after page ${pages} (the next one empty twice) with its last event on ${lastDate || 'no date'} (a full calendar runs past ${shortOf})`);
    globalThis[Symbol.for('here.events/recordFailure')]?.('Seattle Center calendar', 'cut short (the list ended months before a year out)');
  }

  const events = [];
  let atOwnSource = 0, standing = 0;
  for (const c of scListingDates(cards, today)) {
    if (!c.date) { console.error(`No date bar for ${c.url}`); continue; }
    if (SC_EXCLUDE.test(c.title)) { standing++; continue; }
    const venueTag = c.tags.find((t) => venueLabels.includes(t));
    if ((venueTag && covered(venueTag)) || atRep(c)) { atOwnSource++; continue; }
    const venue = SC_VENUE_LABEL[venueTag] || venueTag || 'Seattle Center';
    let url = c.url;
    if (venue === 'McCaw Hall' && mccawUrl) url = mccawUrl.get(c.title.toLowerCase()) || url;
    const ev = { venue, title: c.title, date: c.date, time: c.time, url };
    if (c.free) ev.free = true;
    const type = scType(c.tags);
    if (type) ev.type = type;
    events.push(ev);
  }
  console.log(`Seattle Center sweep: ${events.length} events from ${cards.length} cards over ${pages} pages (${atOwnSource} at venues with their own source, ${standing} standing attractions skipped); stopped by ${stop}; last event ${lastDate || 'none'}`);
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

// --- Seattle Rep (Bagley Wright + Leo K. theatres, on the campus): the
//     Tessitura performance feed its calendar page renders — one row per
//     performance, sold-out flag included; classes and auditions skipped. ---
async function seattleRep() {
  const res = await fetch('https://www.seattlerep.org/plays/json', { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) { console.error('Seattle Rep HTTP', res.status); return []; }
  const evs = mapRepEvents(await res.json(), 'Seattle Rep');
  console.log(`Seattle Rep: ${evs.length} performances`);
  return evs;
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

// Neighborhood bars: their nights are typed 'bar' (the site's "Local Bars"
// filter) and the venue stays out of the site's venue list — one type
// switch covers every bar. The Traveling Goat is the first; each carries
// its events page as the link, since the listings have none of their own.
const GOAT_URL = 'https://www.travelinggoatseattle.com/events';
async function travelingGoat() {
  const evs = parseGoatEvents(await pageText(GOAT_URL)).map((e) => ({ venue: 'The Traveling Goat', type: 'bar', url: GOAT_URL, ...e }));
  console.log(`Traveling Goat: ${evs.length} events`);
  return evs;
}

// ---- Festivals (the panel's Festivals group, 2026-10-05) -----------------
// A festival is its own venue, named for itself, with one event per
// festival day; the day's headliners are the title, the whole bill `lineup`
// (the calendar feed's description) and, where the festival publishes them,
// the set times `sets` — a stage, its acts in order (the site draws a line
// per stage on the card and the grid in the sheet). The campus festivals
// (Bumbershoot, Folklife, PrideFest) show by default; the Block Party is a
// bus ride away and starts off. Each page carries one year at a time —
// this year's until the next is announced.
// Capitol Hill Block Party: the festival's artists page (Squarespace; its
// JSON view is empty, so the HTML — parseBlockPartyArtists); the set times
// are posters on its Instagram, transcribed once a year into
// scripts/data/chbp-settimes.json (Steve, 2026-10-05: "build ig").
const CHBP_URL = 'https://www.capitolhillblockparty.com/artists';
async function capitolHillBlockParty() {
  const days = parseBlockPartyArtists(await pageText(CHBP_URL), new Date().toISOString().slice(0, 10))
    .map((e) => ({ venue: 'Capitol Hill Block Party', type: 'concert', url: CHBP_URL, ...e }));
  // the set-times grid (scripts/data/chbp-settimes.json, read off the festival's Instagram posters once a year):
  // each day it covers gets `sets` and the first set's start as its time, and an event per set after it (the act, its stage and times)
  let table = {};
  try { table = JSON.parse(readFileSync(new URL('./data/chbp-settimes.json', import.meta.url), 'utf8')); } catch (err) { console.error('chbp-settimes.json:', err.message); }
  const evs = applySetTimes(days, table);
  console.log(`Block Party: ${evs.filter((e) => !e.set).length} days, ${evs.filter((e) => e.sets).length} with set times, ${evs.filter((e) => e.set).length} sets`);
  return evs;
}
// Bumbershoot (Labor Day weekend on the campus): the schedule page, with
// every slot's stage and set time, and the music-lineup page for the
// billing order — parseBumbershootSchedule.
const BUMBERSHOOT_URL = 'https://bumbershoot.com/schedule';
async function bumbershoot() {
  const lineup = await pageText('https://bumbershoot.com/music-lineup').catch((err) => { console.error('Bumbershoot lineup:', err.message); return ''; });
  const evs = parseBumbershootSchedule(await pageText(BUMBERSHOOT_URL), lineup)
    .map((e) => ({ venue: 'Bumbershoot', type: 'concert', url: BUMBERSHOOT_URL, ...e }));
  console.log(`Bumbershoot: ${evs.length} days`);
  return evs;
}
// Seattle PrideFest (the last weekend of June: Capitol Hill on the Saturday,
// the campus on the Sunday; free): the Squarespace events collection's JSON
// — mapPrideFestEvents. The collection goes back years; last year on is kept.
const PRIDEFEST_URL = 'https://www.seattlepridefest.org/schedule';
async function prideFest() {
  const since = `${new Date().getFullYear() - 1}-01-01`;
  const evs = mapPrideFestEvents(JSON.parse(await pageText(PRIDEFEST_URL + '?format=json')))
    .filter((e) => e.date >= since)
    .map((e) => ({ venue: 'PrideFest', type: 'community', ...e }));
  console.log(`PrideFest: ${evs.length} days`);
  return evs;
}
// Northwest Folklife (Memorial Day weekend on the campus; free): the
// festival page's one date line — parseFolklifeDates.
const FOLKLIFE_URL = 'https://www.nwfolklife.org/festival/';
async function folklife() {
  const evs = parseFolklifeDates(await pageText(FOLKLIFE_URL)).map((e) => ({ venue: 'Northwest Folklife', type: 'concert', url: FOLKLIFE_URL, ...e }));
  console.log(`Folklife: ${evs.length} days`);
  return evs;
}

// T-Mobile Park's own events page (mlb.com/mariners/tickets/events): the
// non-baseball bookings the Mariners sell themselves — Banana Ball, whose
// lottery tickets never reach Ticketmaster (Steve, 2026-10-26). The index is
// a Next.js page whose data blob lists each event as a featured-content
// block; each event's page is read for its dates and ticket link
// (parseMarinersIndex / parseMarinersEvent). Home games come from the
// Teams view's schedule, not from here.
const MARINERS_EVENTS = 'https://www.mlb.com/mariners/tickets/events';
async function marinersEvents() {
  const index = parseMarinersIndex(await pageText(MARINERS_EVENTS));
  const out = [];
  for (const it of index) {
    try { out.push(...parseMarinersEvent(await pageText(it.url), it)); }
    catch (err) { console.error(`T-Mobile Park ${it.url}: ${err.message}`); }
  }
  console.log(`T-Mobile Park (Mariners events page): ${out.length} rows from ${index.length} events`);
  return out;
}

// Showbox at the Market + Showbox SoDo: AEG's whole Northwest listing on
// one server-rendered page, the two Seattle rooms kept — parseShowboxEvents.
// The page comes through the Chrome fingerprint (feeds.mjs chromeFetch): AEG's carbonhouse edge answers GitHub's
// runners 406 (every Seattle run since 2026-10-29); a failed read keeps both rooms' upcoming rows from the last feed.
const SHOWBOX_URL = 'https://www.showboxpresents.com/events/all';
async function showbox() {
  const html = (await chromeFetch([SHOWBOX_URL], 'Showbox Presents')).get(SHOWBOX_URL);
  if (html == null) { feedFailedVenues.add('Showbox at the Market').add('Showbox SoDo'); throw new Error(`Showbox Presents unreadable ${SHOWBOX_URL}`); }
  const evs = parseShowboxEvents(html);
  console.log(`Showbox: ${evs.length} shows (${evs.filter((e) => e.venue === 'Showbox SoDo').length} in SoDo)`);
  return evs;
}

// venue naming as this site has always done it: city.js `alias` first, then anything city.js doesn't list goes to
// the grounds venue (no venue read from a title, which the other cities do)
const CANONICAL_VENUES = new Set(Object.keys(CITY.venues));
const ALIASES = Object.entries(CITY.venues).filter(([, v]) => v.alias).map(([label, v]) => [label, v.alias]);
const aliasVenue = (name) => { const hit = ALIASES.find(([, re]) => re.test(name || '')); return hit ? hit[0] : name; };

await build({
  feedUrl: 'https://lqa.seattle.here.events/events.json',
  // lqa.here.events, the address from 2026-10-05 until neighbourhoods moved under their city (2026-10-11), kept alive by the redirect stub
  feedUrlOld: 'https://lqa.here.events/events.json',
  archiveUrl: 'https://raw.githubusercontent.com/sfosdal/lqa-events/archive/events-archive.json',
  church: false,
  // Dedicated per-venue sources run first (better times and ticket links): the Ticketmaster venues (city.js `tm`), in
  // the city's order, the venues' own calendars (city.js `feed`), then the readers above. Every venue is read from
  // Ticketmaster AND its own events site (Steve, 2026-10-26); one of the two leads and the other is SECONDARY (city.js
  // `tm.secondary` / `feed.secondary`), kept only where nothing already sits at that venue on that date with the same
  // clock or title. McCaw Hall comes from the Seattle Center sweep (every performance, with times); its RSS only
  // supplies the venue's own detail-page links.
  primary: (s) => [
    ...s.tmFirst,
    ...s.feedsFirst,
    marinersEvents,
    showbox,
    veraProjectDice,
    siffUptown,
    onTheBoards,
    seattleRep,
    seattleConventionCenter, // downtown, like the stadiums: big enough to matter
    seattleChildrensTheatre,
    mopop,
    pacificScienceCenter,
    kexp,
    travelingGoat,
    capitolHillBlockParty, bumbershoot, prideFest, folklife,
  ],
  // ...then the campus-wide sweep fills in every other venue (McCaw Hall included), reading the rows above under
  // their own venue names. After it, the campus's micro-locations (courtyards, lawns, festival stages) fold into the
  // one grounds venue: only the venues with an identity of their own (city.js) keep their name.
  afterPrimary: async (all) => {
    try { return all.concat(await seattleCenterSweep(all, await mccawUrls())); }
    catch (err) { console.error('Seattle Center sweep failed:', err.message); return all; }
  },
  normalizeVenue: (e) => { // a venue listed under other spellings (city.js `alias`) folds to its one name; any other goes to the grounds venue
    const venue = aliasVenue(e.venue);
    if (CITY.groundsVenue && !CANONICAL_VENUES.has(venue)) return { ...e, venue: CITY.groundsVenue };
    return venue === e.venue ? e : { ...e, venue };
  },
  // Seawolves matches archived before Starfire Stadium was a canonical venue (2026-09-17) had been renamed "Seattle
  // Center" on read-back, which also defeated the duplicate guard — 32 copies of each by the time it was caught. Put
  // them back so the union folds them onto the real entry; backfill the movie flag on entries archived before it existed.
  archiveRow: (e) => {
    const r = e.venue === 'Seattle Center' && /^Seattle Seawolves vs /.test(e.title) ? { ...e, venue: 'Starfire Stadium' } : e;
    return !r.movie && r.url && r.url.includes('/cinema/in-theaters/') ? { ...r, movie: true } : r;
  },
  // Each upcoming Ticketmaster event's own house size (scripts/capacity.mjs): read once from Ticketmaster's seat-map
  // manifest (paced, at most 120 a build), then carried forward from the previous feed, so a build only asks about
  // events it has not seen.
  afterInject: async (merged, { archived, today }) => {
    let seed = {};
    try { seed = JSON.parse(readFileSync(new URL('./data/capacity.json', import.meta.url), 'utf8')).events || {}; } catch {} // the Mac-read seed (scripts/capacity-seed.mjs), if any
    const c = await stampCapacity(merged, archived, { today, seed, userAgent: CITY.userAgent, fallbackFetch: chromeManifestFetch });
    console.log(`capacity: ${c.carried} carried forward, ${c.fetched} read from Ticketmaster, ${c.none} with no manifest, ${c.failed} failed, ${c.waiting} left for the next build${c.switched ? ' (plain reads blocked — read through cffi-fetch.py)' : ''}${c.blocked ? ' (rate-limited — stopped)' : ''}`);
  },
  // The site hides SIFF's daily movie showings by default — the matching exclusion feed, so a default-view subscription lines up
  moreFeeds: (merged) => [['events-no-movies.ics', merged.filter((e) => !e.movie), `${CITY.ics.short} — no movies`]],
});
