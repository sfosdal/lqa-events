import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWithArchive } from './merge.mjs';

const TODAY = '2026-08-24';
const CUTOFF = '2025-08-24';
const ev = (date, title, extra) => ({ venue: 'V', title, date, time: '19:00:00', url: 'u', ...extra });

test('archived past events are kept alongside fresh ones', () => {
  const fresh = [ev('2026-08-25', 'Tomorrow Show')];
  const archived = [ev('2026-08-20', 'Last Week Show')];
  const out = mergeWithArchive(fresh, archived, TODAY, CUTOFF);
  assert.deepEqual(out.map((e) => e.title), ['Last Week Show', 'Tomorrow Show']);
});

test('archived FUTURE events not in fresh are dropped (cancellations)', () => {
  const fresh = [ev('2026-08-25', 'Still On')];
  const archived = [ev('2026-08-26', 'Cancelled Show'), ev('2026-08-25', 'Still On')];
  const out = mergeWithArchive(fresh, archived, TODAY, CUTOFF);
  assert.deepEqual(out.map((e) => e.title), ['Still On']);
});

test('past events older than the cutoff age out', () => {
  const archived = [ev('2025-08-23', 'Ancient'), ev('2025-08-24', 'Exactly A Year')];
  const out = mergeWithArchive([], archived, TODAY, CUTOFF);
  assert.deepEqual(out.map((e) => e.title), ['Exactly A Year']);
});

test('fresh data wins when a past event is still listed by a source', () => {
  const fresh = [ev('2026-08-20', 'Last Week Show', { url: 'fresh-url' })];
  const archived = [ev('2026-08-20', 'Last Week Show', { url: 'stale-url' })];
  const out = mergeWithArchive(fresh, archived, TODAY, CUTOFF);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'fresh-url');
});

test('result is sorted by date then time', () => {
  const fresh = [ev('2026-08-25', 'B'), { ...ev('2026-08-25', 'A'), time: '10:00:00' }];
  const archived = [ev('2026-08-01', 'Old')];
  const out = mergeWithArchive(fresh, archived, TODAY, CUTOFF);
  assert.deepEqual(out.map((e) => e.title), ['Old', 'A', 'B']);
});
