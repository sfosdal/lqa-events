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
import { parseScCards, parseScDetailDate, parseScVenueCats, mapDiceEvents, parseSiffScreenings, mapOtbEvents } from './sources.mjs';
import { mergeWithArchive } from './merge.mjs';
import { slugify, BADGE_FEEDS, TEAMS } from './badges.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year each way: venues announce whole seasons ahead, and past events
// are kept for a year (carried forward from the previously published feed —
// see mergeWithArchive).
const WINDOW_DAYS = 365;
const FEED_URL = process.env.FEED_URL || 'https://fosdal.net/lqa-events/events.json';
const MAX_EVENTS = 1200; // sanity cap, not a display cap

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

// --- Ticketmaster Discovery API (keyword search, filtered by venue name) ---
async function ticketmasterVenue({ keyword, venueMatch, label, fallbackUrl, exclude }) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) { console.warn('No TICKETMASTER_API_KEY set — skipping Ticketmaster.'); return []; }
  const params = new URLSearchParams({ apikey: key, keyword, city: 'Seattle', sort: 'date,asc', size: '100' });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  if (!res.ok) { console.error(`Ticketmaster ${label} HTTP ${res.status}`); return []; }
  const data = await res.json();
  return (data?._embedded?.events || [])
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
      // Flex-scheduled games (NFL weekends especially) carry TM's TBD flag:
      // the listed date is a placeholder the league may still move.
      if (e.dates?.start?.dateTBD || e.dates?.start?.dateTBA) ev.dateTbd = true;
      return ev;
    });
}

// --- McCaw Hall: the venue's own RSS feed (full calendar, incl. opera/ballet) ---
async function mccawHallRss() {
  const res = await fetch('https://www.mccawhall.com/events/rss');
  if (!res.ok) { console.error('McCaw Hall RSS HTTP', res.status); return []; }
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    const grab = (re) => { const m = it.match(re); return m ? m[1].trim() : ''; };
    return {
      venue: 'McCaw Hall',
      title: decodeEntities(grab(/<title>([\s\S]*?)<\/title>/)),
      date: grab(/<ev:startdate>([\s\S]*?)<\/ev:startdate>/).slice(0, 10),
      time: '',
      url: grab(/<link>([\s\S]*?)<\/link>/) || 'https://www.mccawhall.com/events',
    };
  }).filter((e) => e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
}

// --- Seattle Center's own calendar: sweep EVERY venue category the filter
//     offers (discovered at runtime, nothing hardcoded). Venues already
//     covered by a dedicated source above are skipped so the same show isn't
//     listed twice under slightly different titles. The listing's date
//     headers omit the year and include past events, so each card's real
//     date comes from its detail page (fetched once per unique event). ---
const SC_CAL = 'https://www.seattlecenter.com/events/event-calendar';

async function seattleCenterSweep(existingVenues) {
  const res = await fetch(SC_CAL, { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) { console.error(`Seattle Center calendar HTTP ${res.status}`); return []; }
  const cats = parseScVenueCats(await res.text());
  if (!cats.length) { console.error('Seattle Center: no venue categories found — page layout changed?'); return []; }

  const covered = (label) => existingVenues.some((v) => {
    const a = v.toLowerCase(), b = label.toLowerCase();
    return a.includes(b) || b.includes(a);
  });

  const byUrl = new Map();
  for (const cat of cats) {
    if (covered(cat.label)) { console.log(`Seattle Center: skipping ${cat.label} (dedicated source)`); continue; }
    try {
      const r = await fetch(`${SC_CAL}?cats=${cat.id}`, { headers: { 'user-agent': BROWSER_UA } });
      if (!r.ok) { console.error(`Seattle Center cats=${cat.id} HTTP ${r.status}`); continue; }
      for (const card of parseScCards(await r.text())) {
        if (!byUrl.has(card.url)) byUrl.set(card.url, { ...card, venue: cat.label });
      }
    } catch (err) {
      console.error(`Seattle Center ${cat.label} failed:`, err.message);
    }
  }

  const cards = [...byUrl.values()];
  const events = [];
  const POOL = 6;
  for (let i = 0; i < cards.length; i += POOL) {
    await Promise.all(cards.slice(i, i + POOL).map(async (card) => {
      try {
        const detail = await fetch(card.url, { headers: { 'user-agent': BROWSER_UA } });
        if (!detail.ok) { console.error(`Seattle Center detail HTTP ${detail.status}: ${card.url}`); return; }
        const date = parseScDetailDate(await detail.text());
        if (!date) { console.error(`No date found on ${card.url}`); return; }
        const ev = { venue: card.venue, title: card.title, date, time: card.time, url: card.url };
        if (card.free) ev.free = true;
        events.push(ev);
      } catch (err) {
        console.error(`Seattle Center detail failed (${card.url}):`, err.message);
      }
    }));
  }
  console.log(`Seattle Center sweep: ${events.length} events from ${cards.length} cards`);
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

// Dedicated per-venue sources run first (better times and ticket links)...
const sources = [
  () => ticketmasterVenue({ keyword: 'Climate Pledge Arena', venueMatch: 'climate pledge', label: 'Climate Pledge Arena', fallbackUrl: 'https://climatepledgearena.com/events/', exclude: /arena tours?|all access pass/i }),
  // The SoDo stadiums: not Seattle Center, but big enough to move the whole city.
  () => ticketmasterVenue({ keyword: 'T-Mobile Park', venueMatch: 't-mobile park', label: 'T-Mobile Park', fallbackUrl: 'https://www.mlb.com/mariners', exclude: /ballpark tour|flex membership/i }),
  () => ticketmasterVenue({ keyword: 'Lumen Field', venueMatch: 'lumen field', label: 'Lumen Field', fallbackUrl: 'https://www.lumenfield.com/events', exclude: /stadium tour|notification list/i }),
  mccawHallRss,
  veraProjectDice,
  siffUptown,
  onTheBoards,
];

let all = [];
for (const src of sources) {
  try { all = all.concat(await src()); }
  catch (err) { console.error('Source failed:', err.message); }
}

// ...then the campus-wide sweep fills in every other venue.
try { all = all.concat(await seattleCenterSweep([...new Set(all.map((e) => e.venue))])); }
catch (err) { console.error('Seattle Center sweep failed:', err.message); }

// Collapse the campus's micro-locations (courtyards, lawns, festival stages —
// whatever sub-spots the sweep discovers) into one "Seattle Center" venue.
// A dozen filter chips for the same lawn helps nobody; only venues with an
// identity of their own keep their name.
const CANONICAL_VENUES = new Set([
  'Climate Pledge Arena', 'T-Mobile Park', 'Lumen Field',
  'McCaw Hall', 'The Vera Project', 'Cornish Playhouse', 'Seattle Center',
  'SIFF Cinema Uptown', 'On the Boards',
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
