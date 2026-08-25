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

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
const WINDOW_DAYS = 90;
const MAX_EVENTS = 300; // sanity cap, not a display cap

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
    .map((e) => ({
      venue: label,
      title: e.name,
      date: e.dates?.start?.localDate || '',
      time: e.dates?.start?.localTime || '',
      url: e.url || fallbackUrl,
    }));
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

const sources = [
  () => ticketmasterVenue({ keyword: 'Climate Pledge Arena', venueMatch: 'climate pledge', label: 'Climate Pledge Arena', fallbackUrl: 'https://climatepledgearena.com/events/' }),
  mccawHallRss,
  () => ticketmasterVenue({ keyword: 'Seattle Center', venueMatch: 'seattle center', label: 'Seattle Center', fallbackUrl: 'https://www.seattlecenter.com/events/event-calendar' }),
];

let all = [];
for (const src of sources) {
  try { all = all.concat(await src()); }
  catch (err) { console.error('Source failed:', err.message); }
}

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
