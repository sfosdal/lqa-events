import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeHandler } from './index.mjs';

// the Lambda reads a site over HTTPS; here it reads this repo's own site/ for
// one host and a renamed copy of it for another, so the per-site contexts can
// be told apart
// events.json is the build's output (git-ignored, absent when CI runs the tests), so a 40-row cut of the live
// feed stands in for it: Kraken games and sold-out shows included
const site = (f) => readFileSync(new URL(f === 'events.json' ? './fixture-events.json' : `../site/${f}`, import.meta.url), 'utf8');
const fetched = [];
const fetchText = async (url) => {
  fetched.push(url);
  const [, host, file] = url.match(/^https:\/\/([^/]+)\/(.+)$/);
  if (host === 'other.here.events' && file === 'city.js') return site(file).replace("short: 'LQA Events'", "short: 'Other Events'");
  if (host === 'down.here.events') throw new Error('offline');
  return site(file);
};
let clock = 0;
const handler = makeHandler({ fetchText, now: () => clock });
const call = (qs) => handler({ queryStringParameters: qs });
const total = JSON.parse(site('events.json')).events.length;
const vevents = (res) => (res.body.match(/BEGIN:VEVENT/g) || []).length;

test('no filter code: the whole feed, as text/calendar', async () => {
  const res = await call({ site: 'lqa.seattle.here.events' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/calendar/);
  assert.match(res.headers['cache-control'], /max-age=3600/);
  assert.equal(vevents(res), total);
  assert.match(res.body, /X-WR-CALNAME:LQA Events — filtered/);
});

test('a filter code narrows the feed with the site\'s own rule', async () => {
  const kraken = (await call({ site: 'lqa.seattle.here.events', s: '' })).body.match(/SUMMARY:.*Kraken/g).length;
  assert.ok(kraken > 0, 'the fixture has Kraken games');
  const F = globalThis.LQAFilter || (await import('../site/city.js'), await import('../site/filter.js'), globalThis.LQAFilter);
  const noKraken = F.encodeFilterCode({ teamMode: { kraken: 'ex' } });
  const res = await call({ site: 'lqa.seattle.here.events', f: noKraken });
  assert.equal(vevents(res), total - kraken);
  assert.doesNotMatch(res.body, /SUMMARY:.*Kraken/);
  const onlyKraken = F.encodeFilterCode({ teamMode: { kraken: 'in' } });
  assert.equal(vevents(await call({ site: 'lqa.seattle.here.events', f: onlyKraken })), kraken);
});

test('search and the sold-out switch travel too', async () => {
  const F = globalThis.LQAFilter;
  const res = await call({ site: 'lqa.seattle.here.events', s: F.encodeSearch('kraken') });
  assert.ok(vevents(res) > 0);
  assert.equal(vevents(res), (res.body.match(/SUMMARY:.*Kraken/g) || []).length);
  const sold = await call({ site: 'lqa.seattle.here.events', so: '1' });
  assert.ok(vevents(sold) < total);
});

test('a bad host or code is refused; a site that will not answer is a 502', async () => {
  assert.equal((await call({})).statusCode, 400);
  assert.equal((await call({ site: 'evil.example.com' })).statusCode, 400);
  assert.equal((await call({ site: 'lqa.seattle.here.events', f: '!!' })).statusCode, 400);
  assert.equal((await call({ site: 'down.here.events' })).statusCode, 502);
});

test('each site has its own city: the calendar name follows the host', async () => {
  const res = await call({ site: 'other.here.events' });
  assert.match(res.body, /X-WR-CALNAME:Other Events — filtered/);
  assert.match((await call({ site: 'lqa.seattle.here.events' })).body, /X-WR-CALNAME:LQA Events — filtered/);
});

test('a site\'s files are fetched once an hour, not per request', async () => {
  const before = fetched.length;
  await call({ site: 'lqa.seattle.here.events' });
  assert.equal(fetched.length, before);
  clock += 61 * 60 * 1000;
  await call({ site: 'lqa.seattle.here.events' });
  assert.equal(fetched.length, before + 3);
});
