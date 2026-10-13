import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTribeEvents, tribeType, feedSources, emptyListGate } from './feeds.mjs';

const room = 'Field Arts &#038; Events Hall &#8211; Donna M. Morris Theater';
const row = (title, start, extra = {}) => ({ title, start_date: start, status: 'publish', all_day: false, venue: { venue: room }, categories: [], ...extra });

test('a Tribe row becomes a feed event: local date and time, the ticket link, the type from its categories', () => {
  const rows = [row('Afro-Cuban All Stars', '2026-10-16 20:00:00', { website: 'https://bit.ly/4uqyjSk', url: 'https://fieldhallevents.org/event/afro-cuban-all-stars/2026-10-16/', categories: [{ name: 'Field Hall Presents' }, { name: 'Live Music' }] })];
  assert.deepEqual(mapTribeEvents(rows, 'Field Arts & Events Hall'), [
    { venue: 'Field Arts & Events Hall', title: 'Afro-Cuban All Stars', date: '2026-10-16', time: '20:00', url: 'https://bit.ly/4uqyjSk', type: 'concert' },
  ]);
});

test('entities in titles are decoded and the event page stands in when there is no ticket link', () => {
  const [ev] = mapTribeEvents([row('Hot Damn Scandal &#8211; Heebie &#038; the Jeebies', '2026-10-31 20:00:00', { url: 'https://x.org/event/hds/' })], 'Field Hall');
  assert.equal(ev.title, 'Hot Damn Scandal – Heebie & the Jeebies');
  assert.equal(ev.url, 'https://x.org/event/hds/');
});

test('a title repeated on more dates than maxRepeat is a daily row and is left out; drop takes titles by name', () => {
  const rows = [];
  for (let d = 1; d <= 12; d++) rows.push(row('Box Office Open', `2026-11-${String(d).padStart(2, '0')} 10:00:00`));
  for (let d = 1; d <= 3; d++) rows.push(row('Afro-Cuban All Stars', `2026-10-1${5 + d} 20:00:00`));
  rows.push(row('Volunteer Orientation', '2026-11-02 18:00:00'));
  const out = mapTribeEvents(rows, 'Hall', { drop: /volunteer/i });
  assert.deepEqual(out.map((e) => e.title), ['Afro-Cuban All Stars', 'Afro-Cuban All Stars', 'Afro-Cuban All Stars']);
});

test('an all-day row has no time; a hidden or draft row is skipped', () => {
  const out = mapTribeEvents([
    row('Fair Day', '2026-08-01 00:00:00', { all_day: true }),
    row('Secret', '2026-08-02 19:00:00', { hide_from_listings: true }),
    row('Draft', '2026-08-03 19:00:00', { status: 'draft' }),
  ], 'Hall');
  assert.deepEqual(out.map((e) => [e.title, e.time]), [['Fair Day', '']]);
});

test('films are a movie where the city lists that type, arts where it does not; the venue default fills the rest', () => {
  const film = [{ name: 'Films at Field Hall' }, { name: 'Family Friendly' }];
  assert.equal(tribeType(film, new Set(['concert', 'movie'])), 'movie');
  assert.equal(tribeType(film, new Set(['concert', 'arts'])), 'arts');
  assert.equal(tribeType([{ name: 'Guest Presenter' }], new Set(['concert'])), null);
  const [ev] = mapTribeEvents([row('Mystery Night', '2026-12-01 19:00:00', { categories: [{ name: 'Guest Presenter' }] })], 'Hall', { types: ['concert', 'arts'], defaultType: 'arts' });
  assert.equal(ev.type, 'arts');
});

test('feedSources makes one source per venue with a feed and names an unknown kind', () => {
  const city = { types: [{ key: 'arts' }], venues: { A: { tm: { id: 'x' } }, B: { feed: { kind: 'tribe', url: 'https://x/wp-json/tribe/events/v1/events' } }, C: { feed: { kind: 'nope', url: 'https://x/' } } } };
  const srcs = feedSources(city, 'ua');
  assert.equal(srcs.length, 2);
  assert.deepEqual(srcs[1](), []); // unknown kind: an empty source, logged
});

test('the empty-list gate stops a build whose own pull has nothing upcoming, unless allowed', () => {
  const today = '2026-10-13';
  assert.equal(emptyListGate([{ date: '2026-10-20' }], today, 6, {}), true);
  assert.equal(emptyListGate([{ date: '2026-09-01' }], today, 6, {}), false);
  assert.equal(emptyListGate([], today, 6, { ALLOW_EMPTY_LIST: '1' }), true);
  assert.equal(emptyListGate([], today, 0, {}), true); // nothing configured: nothing to judge
});
