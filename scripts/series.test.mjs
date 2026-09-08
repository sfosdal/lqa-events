import test from 'node:test';
import assert from 'node:assert/strict';
import '../site/filter.js'; // attaches LQAFilter to globalThis outside a browser

const { findSeries, assignLanes } = globalThis.LQAFilter;
const nights = (title, dates, venue = 'Seattle Center') => dates.map((date) => ({ venue, title, date, time: '19:30:00' }));
const day = (n) => { const d = new Date(2026, 8, 1 + n); return d.toISOString().slice(0, 10); };
const range = (n) => Array.from({ length: n }, (_, i) => i);

test('short daily runs keep their lane: a three-game homestand, a week of nights', () => {
  const evs = [...nights('Mariners vs. Rangers', range(3).map(day), 'T-Mobile Park'), ...nights('PAX West', range(7).map(day))];
  const s = findSeries(evs);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => [x.events.length, x.lane]), [[3, true], [7, true]]);
});

test('a nightly run longer than a week gets no lane, dark Mondays or not', () => {
  const straight = nights('Winterfest', range(8).map(day));
  const darkMondays = nights('Eureka Day', range(35).filter((i) => new Date(2026, 8, 1 + i).getDay() !== 1).map(day));
  const s = findSeries([...straight, ...darkMondays]);
  assert.deepEqual(s.map((x) => [x.events[0].title, x.lane]), [['Winterfest', false], ['Eureka Day', false]]);
  assert.equal(darkMondays[3].series.total, darkMondays.length, 'the n of N label still counts the whole run');
});

test('a run with real gaps keeps its lane however long it is', () => {
  const everyOther = nights('Rep Night', range(11).map((i) => day(i * 2)));
  const s = findSeries(everyOther);
  assert.equal(s.length, 1);
  assert.equal(s[0].events.length, 11);
  assert.equal(s[0].lane, true);
});

test('lanes: first free lane, and past the cap the rest merge into the last lane', () => {
  const items = [{ from: 0, to: 4 }, { from: 1, to: 2 }, { from: 2, to: 6 }, { from: 5, to: 8 }, { from: 7, to: 9 }];
  const free = assignLanes(items.map((i) => ({ ...i })), 0);
  assert.equal(free.length, 3, 'uncapped: three concurrent at row 2');
  const its = items.map((i) => ({ ...i }));
  const capped = assignLanes(its, 2);
  assert.equal(capped.length, 2);
  assert.deepEqual(its.map((i) => [i.lane, !!i.merged]), [[0, false], [1, false], [1, true], [0, false], [1, false]]);
});
