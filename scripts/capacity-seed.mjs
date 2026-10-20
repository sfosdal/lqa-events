// Reads each upcoming Ticketmaster event's capacity from this Mac into
// scripts/data/capacity.json (committed), which the Actions build reads as a
// seed: Ticketmaster's edge blocks GitHub's runners on the first manifest
// read (2026-10-19), but answers a home connection. Paced like the build (3 s
// apart), no cap, stops at the first block; entries already in the file are
// not asked again. Run after new shows are announced, until a server takes
// this over (Steve: "I will eventually get my own server"):
//
//   node scripts/capacity-seed.mjs          # events from the live feed
//   FEED=site/events.json node scripts/capacity-seed.mjs   # a local build's
import { readFileSync, writeFileSync } from 'node:fs';
import { stampCapacity, tmEventId } from './capacity.mjs';
import { CITY } from './badges.mjs';

const OUT = new URL('./data/capacity.json', import.meta.url);
const FEED = process.env.FEED || 'https://lqa.seattle.here.events/events.json';
const today = new Date().toISOString().slice(0, 10);
let file = { events: {} };
try { file = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
const feed = /^https?:/.test(FEED) ? await (await fetch(FEED, { cache: 'no-store' })).json() : JSON.parse(readFileSync(FEED, 'utf8'));
const events = (feed.events || []).map((e) => ({ ...e, capacity: undefined }));
const c = await stampCapacity(events, [], { today, seed: file.events, userAgent: CITY.userAgent, maxReads: Infinity });
for (const e of events) { const id = tmEventId(e.url); if (id && Number.isInteger(e.capacity)) file.events[id] = e.capacity; }
const sorted = Object.fromEntries(Object.entries(file.events).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, JSON.stringify({ _: 'scripts/capacity-seed.mjs — each Ticketmaster event id → its house from the seat-map manifest (0 = no manifest), read from a Mac; the build seeds capacities from it', generated: new Date().toISOString(), events: sorted }, null, 1) + '\n');
console.log(`capacity seed: ${c.carried} already known, ${c.fetched} read, ${c.none} no manifest, ${c.failed} failed, ${c.waiting} not reached${c.blocked ? ' (rate-limited — run again in a few minutes)' : ''}; ${Object.keys(sorted).length} in the file`);
