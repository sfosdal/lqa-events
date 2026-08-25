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
import { writeFileSync } from 'node:fs';
import { buildIcs } from './ics.mjs';
import { parseScCards, parseScDetailDate, parseScVenueCats, mapDiceEvents } from './sources.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year: Cornish Playhouse and McCaw Hall announce whole seasons ahead.
const WINDOW_DAYS = 365;
const MAX_EVENTS = 500; // sanity cap, not a display cap

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
async function ticketmasterVenue({ keyword, venueMatch, label, fallbackUrl }) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) { console.warn('No TICKETMASTER_API_KEY set — skipping Ticketmaster.'); return []; }
  const params = new URLSearchParams({ apikey: key, keyword, city: 'Seattle', sort: 'date,asc', size: '100' });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  if (!res.ok) { console.error(`Ticketmaster ${label} HTTP ${res.status}`); return []; }
  const data = await res.json();
  return (data?._embedded?.events || [])
    .filter((e) => (e._embedded?.venues?.[0]?.name || '').toLowerCase().includes(venueMatch))
    .map((e) => {
      const ev = {
        venue: label,
        title: e.name,
        date: e.dates?.start?.localDate || '',
        time: e.dates?.start?.localTime || '',
        url: e.url || fallbackUrl,
      };
      if (e.ageRestrictions?.legalAgeEnforced) ev.age21 = true;
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

// Dedicated per-venue sources run first (better times and ticket links)...
const sources = [
  () => ticketmasterVenue({ keyword: 'Climate Pledge Arena', venueMatch: 'climate pledge', label: 'Climate Pledge Arena', fallbackUrl: 'https://climatepledgearena.com/events/' }),
  mccawHallRss,
  veraProjectDice,
];

let all = [];
for (const src of sources) {
  try { all = all.concat(await src()); }
  catch (err) { console.error('Source failed:', err.message); }
}

// ...then the campus-wide sweep fills in every other venue.
try { all = all.concat(await seattleCenterSweep([...new Set(all.map((e) => e.venue))])); }
catch (err) { console.error('Seattle Center sweep failed:', err.message); }

// window, de-dupe, sort
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const seen = new Set();
const merged = all
  .filter((e) => e.date && e.date >= today && e.date <= horizon)
  .filter((e) => { const k = `${e.venue}|${e.title}|${e.date}`; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
  .slice(0, MAX_EVENTS);

writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), events: merged }, null, 2) + '\n');
writeFileSync(ICS_OUT, buildIcs(merged));
console.log(`Wrote ${merged.length} events to events.json and events.ics`);
