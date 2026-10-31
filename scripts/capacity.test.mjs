import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmEventId, manifestTotal, stampCapacity as stamp, MANIFEST_URL } from './capacity.mjs';

const stampCapacity = (events, prev, opts) => stamp(events, prev, { paceMs: 0, sleep: async () => {}, ...opts }); // no waiting in tests

// a fetch that answers from a table of id → manifest (or HTTP status), and records what it was asked
function fakeFetch(table) {
  const asked = [];
  const impl = async (url) => {
    const id = url.split('/').pop(); asked.push(id);
    const v = table[id];
    if (v === undefined) return { ok: false, status: 403, text: async () => '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>' }; // S3: no such manifest
    if (v === 'block') return { ok: false, status: 403, text: async () => '{"response":"dynamic_block"}' }; // the rate limiter
    if (typeof v === 'number') return { ok: false, status: v, text: async () => '' };
    if (v instanceof Error) throw v;
    return { ok: true, status: 200, json: async () => v };
  };
  return { impl, asked };
}
const manifest = (...sections) => ({ eventId: 'X', manifestSections: sections });
const ev = (id, extra = {}) => ({ venue: 'Climate Pledge Arena', title: 'Seattle Kraken vs. Utah Mammoth', date: '2026-10-22', url: `https://www.ticketmaster.com/seattle-kraken-vs-utah-mammoth-seattle-washington-10-22-2026/event/${id}`, ...extra });

test('tmEventId reads the 16-hex id from both URL shapes and ignores other hosts', () => {
  assert.equal(tmEventId('https://www.ticketmaster.com/event/0f0064c4a045a24c'), '0F0064C4A045A24C');
  assert.equal(tmEventId('https://www.ticketmaster.com/x-tickets/event/0F0064C4A045A24C?irgwc=1'), '0F0064C4A045A24C');
  assert.equal(tmEventId('https://www.ticketweb.com/event/x-tickets/14788903'), null);
  assert.equal(tmEventId('https://www.ticketmaster.com/event/Z7r9jZ1A7j8Ko'), null); // a Discovery id is not a page id
  assert.equal(tmEventId(undefined), null);
});

test('manifestTotal adds every section, standing areas included', () => {
  assert.equal(manifestTotal(manifest({ name: '01', numSeats: 512 }, { name: '02', numSeats: 389 }, { name: 'SNCLUB', numSeats: 300, ga: true })), 1201);
  assert.equal(manifestTotal(manifest()), null);
  assert.equal(manifestTotal(null), null);
});

test('stampCapacity fetches an event once, then carries it forward without asking', async () => {
  const id = '0F0064C4A045A24C';
  const first = fakeFetch({ [id]: manifest({ name: '01', numSeats: 15761 }, { name: 'SNCLUB', numSeats: 300, ga: true }) });
  const a = [ev(id)];
  const r1 = await stampCapacity(a, [], { today: '2026-10-19', fetchImpl: first.impl });
  assert.equal(a[0].capacity, 16061);
  assert.deepEqual(r1, { carried: 0, fetched: 1, none: 0, failed: 0, waiting: 0, blocked: false, switched: false });
  assert.deepEqual(first.asked, [id]);
  assert.equal(MANIFEST_URL(id), `https://pubapi.ticketmaster.com/sdk/static/manifest/v1/${id}`);

  const second = fakeFetch({});
  const b = [ev(id)];
  const r2 = await stampCapacity(b, a, { today: '2026-10-19', fetchImpl: second.impl });
  assert.equal(b[0].capacity, 16061);
  assert.equal(r2.carried, 1);
  assert.deepEqual(second.asked, []);
});

test('no manifest is remembered as 0 (not asked again); a failed fetch is left for the next build', async () => {
  const f = fakeFetch({ BBBBBBBBBBBBBBBB: 503, CCCCCCCCCCCCCCCC: new Error('socket hang up') });
  const list = [ev('AAAAAAAAAAAAAAAA'), ev('BBBBBBBBBBBBBBBB'), ev('CCCCCCCCCCCCCCCC'), ev('DDDDDDDDDDDDDDDD')];
  const r = await stampCapacity(list, [], { today: '2026-10-19', fetchImpl: f.impl });
  assert.deepEqual(list.map((e) => e.capacity), [0, undefined, undefined, 0]); // A, D: S3's AccessDenied for a key it lacks
  assert.deepEqual(r, { carried: 0, fetched: 0, none: 2, failed: 2, waiting: 0, blocked: false, switched: false });
  const again = fakeFetch({});
  await stampCapacity([ev('AAAAAAAAAAAAAAAA')], list, { today: '2026-10-19', fetchImpl: again.impl });
  assert.deepEqual(again.asked, []);
});

test('past events, add-on listings and non-Ticketmaster events are left alone', async () => {
  const f = fakeFetch({ EEEEEEEEEEEEEEEE: manifest({ name: 'GA', numSeats: 5000, ga: true }) });
  const list = [
    ev('EEEEEEEEEEEEEEEE', { date: '2026-10-01' }),
    ev('EEEEEEEEEEEEEEEE', { title: 'Ultimate Fan Pass: 30-min Exclusive On-court Access' }),
    ev('EEEEEEEEEEEEEEEE', { title: 'Harlem Globetrotters - CPA Club Fee' }),
    { venue: 'The Crocodile', title: 'Kishi Bashi', date: '2026-10-22', url: 'https://www.ticketweb.com/event/kishi-bashi-tickets/14788903' },
  ];
  await stampCapacity(list, [], { today: '2026-10-19', fetchImpl: f.impl });
  assert.deepEqual(f.asked, []);
  assert.ok(list.every((e) => e.capacity === undefined));
});

test('two listings of one event share one fetch', async () => {
  const f = fakeFetch({ FFFFFFFFFFFFFFFF: manifest({ name: '01', numSeats: 100 }) });
  const list = [ev('FFFFFFFFFFFFFFFF'), ev('FFFFFFFFFFFFFFFF', { title: 'Seattle Kraken vs. Utah Mammoth (Pride Night)' })];
  await stampCapacity(list, [], { today: '2026-10-19', fetchImpl: f.impl });
  assert.deepEqual(f.asked, ['FFFFFFFFFFFFFFFF']);
  assert.deepEqual(list.map((e) => e.capacity), [100, 100]);
});

test('the rate limiter (403 dynamic_block) ends the run; the rest wait for the next build', async () => {
  const f = fakeFetch({ A000000000000001: manifest({ name: '01', numSeats: 10 }), A000000000000002: 'block', A000000000000003: manifest({ name: '01', numSeats: 30 }) });
  const list = [ev('A000000000000001', { date: '2026-10-20' }), ev('A000000000000002', { date: '2026-10-21' }), ev('A000000000000003', { date: '2026-10-22' })];
  const r = await stampCapacity(list, [], { today: '2026-10-19', fetchImpl: f.impl });
  assert.deepEqual(f.asked, ['A000000000000001', 'A000000000000002']);
  assert.deepEqual(list.map((e) => e.capacity), [10, undefined, undefined]);
  assert.equal(r.blocked, true);
  assert.equal(r.waiting, 2);
});

test('one build reads at most maxReads, soonest first, paced between reads', async () => {
  const f = fakeFetch({ B000000000000001: manifest({ name: '01', numSeats: 1 }), B000000000000002: manifest({ name: '01', numSeats: 2 }), B000000000000003: manifest({ name: '01', numSeats: 3 }) });
  const list = [ev('B000000000000003', { date: '2026-12-01' }), ev('B000000000000001', { date: '2026-10-20' }), ev('B000000000000002', { date: '2026-11-01' })];
  const waits = [];
  const r = await stamp(list, [], { today: '2026-10-19', fetchImpl: f.impl, maxReads: 2, paceMs: 3000, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(f.asked, ['B000000000000001', 'B000000000000002']);
  assert.deepEqual(waits, [3000]); // no wait before the first read
  assert.equal(r.waiting, 1);
});

test('a seed (the Mac-read capacity.json) counts as known: no read', async () => {
  const f = fakeFetch({});
  const list = [ev('C000000000000001')];
  const r = await stampCapacity(list, [], { today: '2026-10-19', fetchImpl: f.impl, seed: { C000000000000001: 16061 } });
  assert.equal(list[0].capacity, 16061);
  assert.equal(r.carried, 1);
  assert.deepEqual(f.asked, []);
});

test('a blocked plain read is asked once more through the fallback, which then reads the rest', async () => {
  const plain = fakeFetch({ AAAAAAAAAAAAAAAA: 'block', BBBBBBBBBBBBBBBB: 'block' });
  const chrome = fakeFetch({ AAAAAAAAAAAAAAAA: manifest({ numSeats: 100 }), BBBBBBBBBBBBBBBB: manifest({ numSeats: 50 }) });
  const list = [ev('AAAAAAAAAAAAAAAA'), ev('BBBBBBBBBBBBBBBB', { date: '2026-10-23' })];
  const r = await stampCapacity(list, [], { today: '2026-10-19', fetchImpl: plain.impl, fallbackFetch: chrome.impl });
  assert.deepEqual(list.map((e) => e.capacity), [100, 50]); assert.equal(r.switched, true); assert.equal(r.blocked, false);
  assert.deepEqual(plain.asked, ['AAAAAAAAAAAAAAAA'], 'the plain fetch is not asked again once switched');
  const both = fakeFetch({ AAAAAAAAAAAAAAAA: 'block' }), r2 = await stampCapacity([ev('AAAAAAAAAAAAAAAA')], [], { today: '2026-10-19', fetchImpl: both.impl, fallbackFetch: fakeFetch({ AAAAAAAAAAAAAAAA: 'block' }).impl });
  assert.equal(r2.blocked, true); assert.equal(r2.failed, 0);
});
