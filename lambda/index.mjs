// The filtered calendar feed — https://cal.here.events/?site=<host>&f=<code>[&s=<search>][&so=1]
//
// GitHub Pages can only serve the feeds the build wrote, so "Add To My
// Calendar" offered a ready-made file for four filter shapes and the whole
// feed for everything else (Steve, 2026-10-10, backlog; built 2026-10-22).
// This function serves any filter: it fetches the named site's events.json,
// city.js and filter.js, runs the site's own filter rule on the site's own
// city (a fresh VM context per site, so two cities never share a global),
// and writes the calendar with scripts/ics.mjs — the writer the build uses,
// closed over that city. One function serves every city; a new city needs
// nothing here. The site's files are cached for an hour per warm instance
// and the response carries max-age=3600, which CloudFront honours.
import vm from 'node:vm';
import { icsBuilder } from '../scripts/ics.mjs'; // the zip mirrors the repo: lambda/, scripts/, site/city.js (deploy.sh)

const TTL_MS = 60 * 60 * 1000;
const HOST_RE = /^(?:[a-z0-9-]+\.)+here\.events$/; // lqa.seattle.here.events, chicago.here.events, …
const OTHER_HOSTS = new Set(['curling.events']); // the sites on their own domain
const siteCache = new Map(); // host -> { at, promise }

function okHost(host) { return HOST_RE.test(host) || OTHER_HOSTS.has(host); }

const defaultFetchText = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'here.events calendar feed' } });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
};

// The site's rule and data: city.js + filter.js evaluated in their own
// context (filter.js only touches the DOM inside drawSeriesGraph, which the
// feed never calls), the events parsed, the ICS writer bound to that city.
async function loadSite(host, fetchText) {
  const base = `https://${host}/`;
  const [cityJs, filterJs, eventsJson] = await Promise.all([
    fetchText(base + 'city.js'), fetchText(base + 'filter.js'), fetchText(base + 'events.json'),
  ]);
  const ctx = vm.createContext({ console, atob, btoa }); // a fresh context has the language, not Node's web globals — the search code needs base64
  vm.runInContext(`${cityJs}\n${filterJs}`, ctx, { filename: `${host}/city+filter.js` });
  if (!ctx.LQACity || !ctx.LQAFilter) throw new Error(`${host}: city.js/filter.js did not load`);
  const data = JSON.parse(eventsJson);
  return { CITY: ctx.LQACity, F: ctx.LQAFilter, events: Array.isArray(data) ? data : data.events || [], ics: icsBuilder(ctx.LQACity) };
}

function getSite(host, fetchText, now) {
  const hit = siteCache.get(host);
  if (hit && now - hit.at < TTL_MS) return hit.promise;
  const promise = loadSite(host, fetchText).catch((err) => { siteCache.delete(host); throw err; });
  siteCache.set(host, { at: now, promise });
  return promise;
}

const text = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', ...extra },
  body,
});

export function makeHandler({ fetchText = defaultFetchText, now = () => Date.now() } = {}) {
  return async function handler(event) {
    const q = event.queryStringParameters || {};
    const host = String(q.site || '').toLowerCase();
    if (!okHost(host)) return text(400, 'site: a here.events host, e.g. ?site=lqa.seattle.here.events\n');
    let site;
    try { site = await getSite(host, fetchText, now()); }
    catch (err) { console.error(err); return text(502, `${host}: could not read the site's feed\n`); }
    const { CITY, F, events, ics } = site;
    const mode = F.parseFilterCode(q.f || '0');
    if (!mode) return text(400, 'f: a filter code from the site\'s Copy Filter Link\n');
    mode.soldOnly = q.so === '1';
    const search = q.s ? F.decodeSearch(q.s).trim() : '';
    const picked = events.filter((e) => F.matchesFilter(e, mode) && F.matchesSearch(e, search));
    const body = ics.buildIcs(picked, new Date(now()), { calname: `${CITY.ics.short} — filtered` });
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="events.ics"',
        'cache-control': 'public, max-age=3600', // the sites rebuild once a day; CloudFront keeps the hour
        'access-control-allow-origin': '*',
        'x-events': String(picked.length),
      },
      body,
    };
  };
}

export const handler = makeHandler();
