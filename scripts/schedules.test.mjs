import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScheduleFlags } from './schedules.mjs';

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
