// Sold-out status for the Ticketmaster venues — a LOCAL job, not part of the
// Actions build. Ticketmaster's public APIs carry no availability (the
// Inventory Status API needs an entitlement this key lacks), and the calls
// the event pages make (the "facets" call on offeradapter.ticketmaster.com or
// services.ticketmaster.com — two hosts, one API) are bot-walled
// for curl and headless browsers alike. A real Chrome gets through: this
// script launches a separate, headed Chrome with its own profile, drives it
// over the DevTools protocol, opens each event's page, and asks — from inside
// that page, as the page itself does — for the inventory facets. A facet is
// a block of tickets on sale (its inventory type "primary" from the box
// office, "resale" from other fans, with a count). No primary block while
// the event is on sale = sold out (resale only). Writes scripts/data/soldout.json;
// scripts/soldout-run.sh (launchd, every six hours) runs this through the
// Chromium container in docker/soldout-browser/ and commits the file, and the
// Actions build stamps each event's counts and soldOut flag onto the feed.
//
//   node scripts/soldout-check.mjs            # every on-sale event at the venues below
//   node scripts/soldout-check.mjs --limit 5  # a quick run
//   CDP_URL=http://127.0.0.1:9222 node scripts/soldout-check.mjs
//       # drive a Chrome that is already running with --remote-debugging-port
//       # (e.g. the Chromium-on-Xvfb container in docker/soldout-browser/)
//       # instead of launching one here
//
// Needs TICKETMASTER_API_KEY (.env) for the event list (Discovery API) and
// Google Chrome in /Applications. Takes a few seconds per event.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'scripts', 'data', 'soldout.json'); // committed — the build (fetch-events.mjs) stamps it onto the feed
const VENUES = [ // Discovery venue ids, as in fetch-events.mjs
  { id: 'KovZ917Ahkk', label: 'Climate Pledge Arena' },
  { id: 'KovZpZAEevAA', label: 'T-Mobile Park' },
  { id: 'KovZpZAEknnA', label: 'Lumen Field' },
];
const SKIP = /parking|parkwhiz|arena tours?|all access pass|stadium tour|ballpark tour|notification list|flex membership/i;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'lqa-events-soldout'); // its own profile: never the everyday one
const PORT = 9333;
const CDP_URL = (process.env.CDP_URL || '').replace(/\/$/, ''); // an already-running browser's DevTools endpoint; empty = launch our own
const PAGE_WAIT_MS = 20000;
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || (process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0);

if (!process.env.TICKETMASTER_API_KEY) {
  try { const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^TICKETMASTER_API_KEY=(.+)$/m); if (m) process.env.TICKETMASTER_API_KEY = m[1].trim(); } catch { /* no .env */ }
}
const KEY = process.env.TICKETMASTER_API_KEY;
if (!KEY) { console.error('No TICKETMASTER_API_KEY'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the events to check: on sale now, by the public (Discovery) ----
async function listEvents() {
  const out = [];
  const now = Date.now();
  for (const v of VENUES) {
    for (let page = 0; page < 5; page++) {
      const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${KEY}&venueId=${v.id}&sort=date,asc&size=200&page=${page}`);
      if (!res.ok) { console.warn(v.label, 'discovery', res.status); break; }
      const data = await res.json();
      const evs = (data._embedded && data._embedded.events) || [];
      for (const e of evs) {
        const m = (e.url || '').match(/\/event\/([0-9A-F]{16})/i);
        if (!m || SKIP.test(e.name)) continue;
        const status = e.dates && e.dates.status && e.dates.status.code;
        const start = e.sales && e.sales.public && e.sales.public.startDateTime;
        const onsale = status === 'onsale' && start && Date.parse(start) <= now;
        out.push({ id: m[1].toUpperCase(), url: e.url, name: e.name, date: e.dates.start.localDate, venue: v.label, status, onsale });
      }
      if (!data.page || page + 1 >= data.page.totalPages) break;
    }
  }
  return out;
}

// ---- Chrome over the DevTools protocol (no packages: Node's own WebSocket) ----
function launchChrome() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1200,900', '--window-position=1400,80', 'about:blank',
  ], { env: { HOME: os.homedir(), PATH: '/usr/bin:/bin', TMPDIR: os.tmpdir() }, stdio: 'ignore', detached: false }); // a clean environment: nothing of this shell's leaks into the browser
  return child;
}
async function connect() {
  let targets = null;
  const base = CDP_URL || `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`${base}/json`)).json(); } catch { await sleep(500); } }
  if (!targets) throw new Error('Chrome did not answer at ' + base);
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || { error: d.error }); pending.delete(d.id); return; }
    listeners.forEach((fn) => fn(d));
  };
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Network.enable'); await send('Page.enable');
  // the page's own facets response is read as it arrives (Fetch domain, response stage) — surer than asking again from inside the page
  await send('Fetch.enable', { patterns: [{ urlPattern: '*.ticketmaster.com/api/ismds/event/*/facets*', requestStage: 'Response' }] }); // the same call comes from offeradapter.ticketmaster.com on some pages and services.ticketmaster.com on others
  return { send, on: (fn) => listeners.push(fn), off: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }, close: () => ws.close() };
}

// ---- one event: its page, then its facets, asked from inside the page ----
async function checkEvent(cdp, ev) {
  let body = null, facetsUrl = null;
  const want = new RegExp('/event/' + ev.id + '/facets\\?.*by=inventorytypes%20offertypes', 'i'); // this event's own inventory call (a late one from the page before is not it)
  const seen = async (d) => {
    if (d.method !== 'Fetch.requestPaused') return;
    const p = d.params;
    if (p.responseStatusCode && p.request.method === 'GET' && want.test(p.request.url) && !body) { // the CORS preflight (OPTIONS) answers first, with no body worth reading
      facetsUrl = p.request.url;
      const r = await cdp.send('Fetch.getResponseBody', { requestId: p.requestId });
      if (r && r.body) body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    }
    cdp.send('Fetch.continueRequest', { requestId: p.requestId });
  };
  cdp.on(seen);
  const t0 = Date.now();
  try {
    await cdp.send('Page.navigate', { url: ev.url });
    while (Date.now() - t0 < PAGE_WAIT_MS && !body) await sleep(250);
  } finally { cdp.off(seen); }
  if (!body && facetsUrl) { // seen but not read: ask again from inside the page, as the page itself does
    const r = await cdp.send('Runtime.evaluate', { expression: `fetch(${JSON.stringify(facetsUrl)}, { headers: { accept: 'application/json' } }).then((r) => r.text().then((t) => r.status + ' ' + t)).catch((e) => 'ERR ' + e)`, awaitPromise: true, returnByValue: true });
    const text = (r.result && r.result.value) || '';
    if (text.slice(0, 3) === '200') body = text.slice(4); else return { status: 'unknown', note: 'facets ' + text.slice(0, 80) };
  }
  if (!body) { // no inventory call (an older page layout lists tickets without it): read the list — box-office rows ("Standard Admission … $50.55"), resale rows, or Ticketmaster's own "sold out" wording
    const r = await cdp.send('Runtime.evaluate', { expression: '(document.body && document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 60000)', returnByValue: true });
    const text = (r.result && r.result.value) || '';
    const prices = (re) => [...text.matchAll(re)].map((m) => Number(m[1].replace(/,/g, '')));
    const std = prices(/(?:Standard Admission|Official Platinum|General Admission)[^$]{0,80}?\$([\d,]+(?:\.\d+)?)/g);
    const rs = prices(/Verified Resale[^$]{0,80}?\$([\d,]+(?:\.\d+)?)/g);
    if (std.length) return { status: 'available', primary: null, resale: 0, fromPrimary: Math.min(...std), note: `${std.length} box-office listed on the page, no count` };
    if (rs.length) return { status: 'soldout', primary: 0, resale: 0, fromResale: Math.min(...rs), note: `${rs.length} resale listed on the page` };
    if (/tickets are sold out now|sold out/i.test(text)) return { status: 'soldout', primary: 0, resale: 0, note: 'page says sold out' };
    if (/on sale (soon|starts)|presale/i.test(text) && !/find tickets|standard admission|verified resale/i.test(text)) return { status: 'presale', note: 'page says not on sale yet' };
    return { status: 'unknown', note: 'no inventory call' };
  }
  let j; try { j = JSON.parse(body); } catch { return { status: 'unknown', note: 'facets unparsable' }; }
  const facets = j.facets || [];
  const sum = (type) => facets.filter((f) => (f.inventoryTypes || []).includes(type)).reduce((n, f) => n + (f.count || 0), 0);
  const primary = sum('primary'), resale = sum('resale');
  const price = (type) => facets.filter((f) => (f.inventoryTypes || []).includes(type)).flatMap((f) => f.listPriceRange || []).reduce((m, p) => (m == null || p.min < m ? p.min : m), null);
  if (primary === 0 && resale === 0) {
    // the inventory call counted nothing, yet the page may still list resale
    // (the NHL and NFL games do: their resale comes through another channel)
    // — a box office with nothing left and fans reselling is sold out; a
    // listing with nothing at all is 'none'
    // the inventory answer lands before the page has drawn its list — give it a moment, twice
    let text = '';
    for (let i = 0; i < 3 && !/Verified Resale Ticket|Standard Admission|sold out/i.test(text); i++) {
      await sleep(2500);
      const r = await cdp.send('Runtime.evaluate', { expression: '(document.body && document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 60000)', returnByValue: true });
      text = (r.result && r.result.value) || '';
    }
    const prices = (re) => [...text.matchAll(re)].map((m) => Number(m[1].replace(/,/g, '')));
    const std = prices(/(?:Standard Admission|Official Platinum|General Admission)[^$]{0,80}?\$([\d,]+(?:\.\d+)?)/g);
    const rs = prices(/Verified Resale[^$]{0,80}?\$([\d,]+(?:\.\d+)?)/g);
    if (std.length) return { status: 'available', primary: null, resale: 0, fromPrimary: Math.min(...std), note: `${std.length} box-office listed on the page, no count` };
    if (rs.length) return { status: 'soldout', primary: 0, resale: 0, fromResale: Math.min(...rs), note: `${rs.length} resale listed on the page` };
    if (/tickets are sold out now|sold out/i.test(text)) return { status: 'soldout', primary: 0, resale: 0, note: 'page says sold out' };
  }
  return { status: primary > 0 ? 'available' : resale > 0 ? 'soldout' : 'none', primary, resale, fromPrimary: price('primary'), fromResale: price('resale') };
}

const events = await listEvents();
const todo = events.filter((e) => e.onsale).slice(0, limit || undefined);
console.log(`${events.length} events at ${VENUES.length} venues, ${events.filter((e) => e.onsale).length} on sale, checking ${todo.length}`);
const chrome = CDP_URL ? null : launchChrome();
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).events || {} : {};
const results = {};
try {
  const cdp = await connect();
  for (const ev of todo) {
    const t0 = Date.now();
    let res;
    try { res = await checkEvent(cdp, ev); } catch (e) { res = { status: 'unknown', note: String(e).slice(0, 80) }; }
    // a run that saw nothing (the page gave no answer, or nothing either way)
    // doesn't erase a real answer from the run before: keep it, with its own
    // check time, so the site's "checked Sep 15" stays honest (Steve, 2026-09-15)
    const last = prev[ev.id];
    if (/^(none|unknown)$/.test(res.status) && last && /^(available|soldout)$/.test(last.status)) {
      res = { ...last, note: `kept from ${last.checked.slice(0, 10)}: this run ${res.status}${res.note ? ' (' + res.note + ')' : ''}` };
      results[ev.id] = { ...res, name: ev.name, date: ev.date, venue: ev.venue };
    } else {
      results[ev.id] = { ...res, name: ev.name, date: ev.date, venue: ev.venue, checked: new Date().toISOString() };
    }
    console.log(`${ev.date}  ${ev.name.slice(0, 44).padEnd(44)}  ${res.status.padEnd(9)} primary ${String(res.primary ?? '-').padStart(5)}  resale ${String(res.resale ?? '-').padStart(5)}  ${res.note || ''}  (${Date.now() - t0}ms)`);
  }
  cdp.close();
} finally {
  if (chrome) chrome.kill();
}
for (const ev of events) if (!ev.onsale) results[ev.id] = { status: 'presale', name: ev.name, date: ev.date, venue: ev.venue, checked: new Date().toISOString() }; // not yet on public sale: nothing to be sold out of
if (limit) for (const k of Object.keys(prev)) if (!results[k]) results[k] = prev[k]; // a partial run keeps the rest of the last one
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), _: 'scripts/soldout-check.mjs (a local run — Ticketmaster inventory as a real Chrome sees it; committed by scripts/soldout-run.sh). status: available = box-office tickets on sale; soldout = only resale left; none = the inventory call and the page both showed nothing (not treated as sold out); presale = public sale not started; unknown = the page gave no answer; a none/unknown run keeps the last real answer, its own checked time, note says so.', events: results }, null, 1) + '\n');
const tally = {}; for (const r of Object.values(results)) tally[r.status] = (tally[r.status] || 0) + 1;
console.log('wrote', path.relative(ROOT, OUT), JSON.stringify(tally));
