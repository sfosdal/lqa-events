import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScheduleFlags, pickBroadcasts } from './schedules.mjs';

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

test('teams with no schedule this run are left alone; an existing flag is kept', () => {
  const events = feed();
  events[1].dateTbd = true;
  const n = applyScheduleFlags(events, { mariners: [{ date: '2026-12-07', tbd: false }] });
  assert.equal(n, 0);
  assert.equal(events[1].dateTbd, true);
  assert.equal(events[2].dateTbd, undefined);
});

test('broadcasts: national first, then the home market; away feeds dropped; names once', () => {
  const w = pickBroadcasts([
    { kind: 'tv', name: 'Rangers Sports Network', home: false, national: false },
    { kind: 'tv', name: 'Mariners.TV', home: true, national: false },
    { kind: 'radio', name: 'Seattle Sports (710 AM)', home: true, national: false },
    { kind: 'tv', name: 'FOX', home: false, national: true },
    { kind: 'tv', name: 'Mariners.TV', home: true, national: false },
    { kind: 'radio', name: '105.3 The Fan', home: false, national: false },
  ]);
  assert.deepEqual(w, { tv: ['FOX', 'Mariners.TV'], radio: ['Seattle Sports (710 AM)'] });
});

test('broadcasts: nothing usable means no watch at all, and a missing kind is left out', () => {
  assert.equal(pickBroadcasts([]), undefined);
  assert.equal(pickBroadcasts([{ kind: 'tv', name: 'NBCSCA', home: false, national: false }]), undefined);
  assert.deepEqual(pickBroadcasts([{ kind: 'tv', name: 'KING 5', home: true, national: false }]), { tv: ['KING 5'] });
});

test('a game\'s broadcasts land on the matching feed event only', () => {
  const events = feed();
  applyScheduleFlags(events, { mariners: [{ date: '2026-12-07', tbd: false, watch: { tv: ['Mariners.TV'], radio: ['Seattle Sports (710 AM)'] } }] });
  assert.deepEqual(events[2].watch, { tv: ['Mariners.TV'], radio: ['Seattle Sports (710 AM)'] });
  assert.equal(events[0].watch, undefined, 'same date, other team');
  assert.equal(events[3].watch, undefined, 'same date, not a game');
});
