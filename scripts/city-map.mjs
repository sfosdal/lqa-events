// Writes site/city-map.json for a neighbourhood site — the rest of its city's
// rooms and their upcoming events, so the Map view shows the whole city, not
// just the neighbourhood's own rooms (Steve, 2026-10-25: "maps for
// neighborhoods should include events from the entire city"). Read from the
// city site's published feed and its city.js (`map.city` in site/city.js:
// { key, name, url }), once per build; the page fetches nothing off-site.
//
//   { city, url, venues: { <room>: { geo, color, url, n, next: [≤ 8 events] } } }
//
// A room the neighbourhood lists itself is left out (its own, filtered pin
// stands). CITY_MAP_LOCAL=1 reads the sister's files from this Mac instead
// (../<key>-events/repo/site beside this repo, or ~/Desktop/projects/…); a feed
// that cannot be read falls back to those too, and failing that the file is
// written empty and the build goes on — the map then shows the neighbourhood
// alone. Run: node scripts/city-map.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
globalThis.window = globalThis; createRequire(import.meta.url)(path.join(root, 'site', 'city.js'));
const CITY = globalThis.LQACity, C = CITY.map && CITY.map.city;
const out = path.join(root, 'site', 'city-map.json');
if (!C) { console.log('city.js has no map.city — nothing to read'); process.exit(0); }
const base = (C.url || `https://${C.key}.here.events/`).replace(/\/?$/, '/');
const UA = 'here.events neighbourhood build (reads the city site once per build)';
const KEEP = 8;

async function fromWeb() {
  const [f, s] = await Promise.all([fetch(base + 'events.json', { headers: { 'User-Agent': UA } }), fetch(base + 'city.js', { headers: { 'User-Agent': UA } })]);
  if (!f.ok || !s.ok) throw new Error(`HTTP ${f.status} / ${s.status}`);
  return { feed: await f.json(), src: await s.text(), from: base };
}
async function fromDisk() {
  const dirs = [path.join(root, '..', `${C.key}-events`, 'repo', 'site'), path.join(process.env.HOME || '', 'Desktop', 'projects', `${C.key}-events`, 'repo', 'site')];
  for (const d of dirs) {
    try { return { feed: JSON.parse(await readFile(path.join(d, 'events.json'), 'utf8')), src: await readFile(path.join(d, 'city.js'), 'utf8'), from: d }; } catch { /* not here */ }
  }
  throw new Error('no local copy of the city site');
}
let got = null, why = '';
if (process.env.CITY_MAP_LOCAL) { try { got = await fromDisk(); } catch (e) { why = e.message; } }
else {
  try { got = await fromWeb(); } catch (e) { why = e.message; console.log(`${C.key}: the city feed could not be read (${why}) — trying this Mac's copy`); try { got = await fromDisk(); } catch (e2) { why += '; ' + e2.message; } }
}
if (!got) {
  await writeFile(out, JSON.stringify({ city: C.name || C.key, url: base, venues: {}, note: `city site not read: ${why}` }));
  console.log(`${C.key}: not read (${why}) — city-map.json written empty, the map shows the neighbourhood alone`);
  process.exit(0);
}
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.runInNewContext(got.src, ctx);
const CV = ((ctx.LQACity || ctx.window.LQACity) || {}).venues || {};
const tz = CITY.tz || 'America/Los_Angeles', today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const events = (got.feed.events || got.feed).filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
const venues = {};
for (const [name, v] of Object.entries(CV)) {
  if (CITY.venues[name] || !v.geo) continue; // the neighbourhood's own rooms keep their own pins; a room with no geo has no pin anywhere
  const list = events.filter(e => e.venue === name);
  venues[name] = { geo: v.geo, color: v.color, url: v.url, n: list.length, next: list.slice(0, KEEP) };
  if (v.short) venues[name].short = v.short;
}
const result = { city: C.name || C.key, url: base, generated: today, venues };
await writeFile(out, JSON.stringify(result));
const n = Object.keys(venues).length, total = Object.values(venues).reduce((s, v) => s + v.n, 0);
console.log(`${C.key}: ${n} rooms beyond the neighbourhood, ${total} upcoming, from ${got.from} → city-map.json (${(Buffer.byteLength(JSON.stringify(result)) / 1024).toFixed(0)} KB)`);
