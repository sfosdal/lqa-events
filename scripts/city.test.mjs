// Lower Queen Anne's own cases: the ones that read this city's teams, venues
// and share-code registry. They lived in the shared test files behind a
// `skip: LQA` guard until the shared files moved to here-core (2026-11-05),
// where the same cases run against the made-up Twin Peaks instead. This file
// is lqa's own: the sync never writes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../site/city.js';
import '../site/filter.js';
import { TEAMS } from './badges.mjs';
import { applyScheduleFlags, wikiTitle } from './schedules.mjs';

const F = globalThis.LQAFilter;
const { findSeries } = F;

test('team matchers hit real game titles, not concerts', () => {
  const match = (title) => TEAMS.filter((t) => t.re.test(title)).map((t) => t.slug);
  assert.deepEqual(match('Seattle Kraken vs. Vancouver Canucks'), ['kraken']);
  assert.deepEqual(match('Seattle Mariners vs. Houston Astros'), ['mariners']);
  assert.deepEqual(match('Seattle Storm vs. Las Vegas Aces'), ['storm']);
  assert.deepEqual(match('Seattle Reign FC vs. Portland Thorns'), ['reign']);
  assert.deepEqual(match('Seattle Sounders FC vs. LAFC'), ['sounders']);
  assert.deepEqual(match('Seattle Seahawks vs. San Francisco 49ers'), ['seahawks']);
  // bare "storm"/"reign" in a show title must not match
  assert.deepEqual(match('Storm Large: Holiday Ordeal'), []);
  assert.deepEqual(match('Purple Reign — The Prince Tribute Show'), []);
});

const game = { venue: 'T-Mobile Park', type: 'sports', title: 'Mariners vs Astros', date: '2026-04-10' };
test('a team row names the game exactly, so it beats its venue either way', () => {
  assert.equal(F.matchesFilter(game, { teamMode: { mariners: 'in' }, venueMode: { 'T-Mobile Park': 'ex' } }), true);
  assert.equal(F.matchesFilter(game, { teamMode: { mariners: 'ex' }, venueMode: { 'T-Mobile Park': 'in' } }), false);
});

test('share codes: nine digits since the music rooms around town (2026-10-05); the new venues round-trip and an old eight-digit code still parses', () => {
  const m = { venueMode: { 'The Crocodile': 'ex', 'Paramount Theatre': 'in', 'Showbox SoDo': 'in' }, badgeMode: {}, teamMode: {}, capMode: {} };
  const code = F.encodeFilterCode(m);
  assert.equal(code.split('.')[0].length, 9);
  assert.deepEqual(F.parseFilterCode(code).venueMode, m.venueMode);
  assert.equal(F.parseFilterCode('00000001').venueMode['Climate Pledge Arena'], 'ex'); // bit 0, as every code since the first
});

const day = (n) => { const d = new Date(2026, 8, 1 + n); return d.toISOString().slice(0, 10); };
const range = (n) => Array.from({ length: n }, (_, i) => i);
test('a festival\'s sets are not a series of their own: the day rows count, the sets carry no n of N', () => {
  const days = range(3).map((i) => ({ venue: 'Capitol Hill Block Party', title: 'Headliners ' + i, date: day(i), time: '14:35' }));
  const sets = range(3).flatMap((i) => [{ venue: 'Capitol Hill Block Party', title: 'Act A', date: day(i), time: '15:15', stage: 'Main Stage', set: true }, { venue: 'Capitol Hill Block Party', title: 'Act B', date: day(i), time: '16:15', stage: 'Main Stage', set: true }]);
  const s = findSeries([...days, ...sets]);
  assert.equal(s.length, 1);
  assert.deepEqual(days.map((d) => d.series.total), [3, 3, 3]);
  assert.ok(sets.every((x) => !x.series));
});

const feed = () => [
  { venue: 'Lumen Field', title: 'Seattle Seahawks vs. Dallas Cowboys', date: '2026-12-07', time: '17:15:00' },
  { venue: 'Lumen Field', title: 'Seattle Seahawks vs. Los Angeles Rams', date: '2026-12-25', time: '17:15:00' },
  { venue: 'T-Mobile Park', title: 'Seattle Mariners vs. Athletics', date: '2026-12-07', time: '18:40:00' },
  { venue: 'Climate Pledge Arena', title: 'Tame Impala - The Deadbeat Tour', date: '2026-12-07', time: '19:00:00' },
];
test('a league TBD on the matching home date flags that game only', () => {
  const events = feed();
  const n = applyScheduleFlags(events, { seahawks: [{ date: '2026-12-07', tbd: true }, { date: '2026-12-25', tbd: false }] });
  assert.equal(n, 1);
  assert.equal(events[0].dateTbd, true);
  assert.equal(events[1].dateTbd, undefined);
  assert.equal(events[2].dateTbd, undefined, 'same date, other team');
  assert.equal(events[3].dateTbd, undefined, 'same date, not a game');
});

test('a game\'s broadcasts land on the matching feed event only', () => {
  const events = feed();
  applyScheduleFlags(events, { mariners: [{ date: '2026-12-07', tbd: false, watch: { tv: ['Mariners.TV'], radio: ['Seattle Sports (710 AM)'] } }] });
  assert.deepEqual(events[2].watch, { tv: ['Mariners.TV'], radio: ['Seattle Sports (710 AM)'] });
  assert.equal(events[0].watch, undefined, 'same date, other team');
  assert.equal(events[3].watch, undefined, 'same date, not a game');
});

test('wikiTitle: one year for a summer season, en-dash span for one that straddles the new year, null with nothing', () => {
  assert.equal(wikiTitle('mariners', [{ date: '2026-03-26' }, { date: '2026-09-27' }]), '2026 Seattle Mariners season');
  assert.equal(wikiTitle('kraken', [{ date: '2026-10-01' }, { date: '2027-04-10' }]), '2026–27 Seattle Kraken season');
  assert.equal(wikiTitle('torrent', [{ date: '2025-11-21' }, { date: '2026-04-25' }]), '2025–26 Seattle Torrent season');
  assert.equal(wikiTitle('seahawks', [{ date: '2026-09-09' }, { date: '2027-01-09' }]), '2026 Seattle Seahawks season'); // the NFL names a season by its first year
  assert.equal(wikiTitle('seawolves', [{ date: '2026-04-03' }, { date: '2026-06-14' }]), '2026 Seattle Seawolves season');
  assert.equal(wikiTitle('kraken', []), null);
});
