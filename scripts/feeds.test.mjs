import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTribeEvents, tribeType, feedSources, emptyListGate, spanishDates, parseTusboletosList, tusboletosTimes, decodeBody, parseJsonLdEvents } from './feeds.mjs';

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
  const wide = feedSources({ types: [], venues: {}, feeds: [{ kind: 'tusboletos', url: 'https://x/eventos', label: 'TusBoletos' }, { kind: 'nope', url: 'https://x/' }] }, 'ua');
  assert.equal(wide.length, 2); // city-wide feeds (cancun-events) make a source each too
  assert.deepEqual(wide[1](), []);
});

// ---- TusBoletos (cancun-events, 2026-10-13) ----
const CARD = (title, city, room, date, tag, slug) => `<div class="thumbnail"><img class="imgevento" src="/x.jpg" alt="${title}">
  <div class="intro caption line-bottom"><h4>${title}</h4><p>…</p></div>
  <div class="detail caption">  <p><i class="fa fa-star"></i>&nbsp; <b>${city}</b></p>
    <p class="hidden-xs">&nbsp;<i class="fa fa-map-marker"></i>&nbsp; ${room}</p> <!--<p class="hidden-xs"><i class="fa fa-tag"></i>&nbsp; ${tag}</p>-->
    <p class="fecha"><i class="fa fa-calendar"></i>&nbsp; ${date}</p><a class="btn btn-primary btn-block visible-xs" role="button" href="/evento/${slug}">Ver evento</a>
  </p></div></div>`;
const LIST = CARD('“Una Eva y Tres Galanes” - Cancún', 'Cancún, Quintana Roo', 'Teatro de Cancún', 'Jueves 15 de Octubre del 2026', '“Una Eva y Tres Galanes”', 'una-eva-y-tres-galanes-cancun')
  + CARD('Harlem Globetrotters - Mérida', 'Mérida, Yucatán', 'Poliforum Zamná', 'Miercoles 14 de Octubre del 2026', 'Deportes', 'harlem-globetrotters-merida')
  + CARD('Zenón y sus Amigos "Dance Party Tributo" - Playa de Carmen', 'Playa del Carmen, Quintana Roo', 'Teatro de la Ciudad', 'Martes 20 de Octubre del 2026', 'Concierto', 'zenon-playa-del-carmen')
  + CARD('Insite - Cancún', 'Cancún, Quintana Roo', 'Teatro Alamos Cancún', 'Viernes 09 de Octubre del 2026', 'Concierto', 'insite-cancun');
const CITIES = [{ match: /^canc[uú]n,/i }, { match: /^playa del carmen,/i, suffix: ', Playa del Carmen' }];

test('Spanish dates: a dated day, a range without a year (every day in it), a wrong month', () => {
  assert.deepEqual(spanishDates('Jueves 15 de Octubre del 2026'), ['2026-10-15']);
  assert.deepEqual(spanishDates('Sábado 07 de Noviembre del 2026'), ['2026-11-07']);
  assert.deepEqual(spanishDates('Del miercoles 28 de octubre al jueves 29 de octubre', '2026-10-13'), ['2026-10-28', '2026-10-29']);
  assert.deepEqual(spanishDates('Del viernes 27 de noviembre al domingo 29 de noviembre', '2026-10-13'), ['2026-11-27', '2026-11-28', '2026-11-29']);
  assert.deepEqual(spanishDates('Sábado 9 de enero', '2026-12-20'), ['2027-01-09']); // next January, not last
  assert.deepEqual(spanishDates('el 3 de brumario'), []);
});

test('the TusBoletos list: only the chosen towns, the city suffix off the title, the quotes off a quoted title, the room suffixed for the second town', () => {
  const cards = parseTusboletosList(LIST, { cities: CITIES });
  assert.deepEqual(cards.map((c) => [c.title, c.room, c.dateText, c.tag]), [
    ['Una Eva y Tres Galanes', 'Teatro de Cancún', 'Jueves 15 de Octubre del 2026', '“Una Eva y Tres Galanes”'],
    ['Zenón y sus Amigos "Dance Party Tributo"', 'Teatro de la Ciudad, Playa del Carmen', 'Martes 20 de Octubre del 2026', 'Concierto'],
    ['Insite', 'Teatro Alamos Cancún', 'Viernes 09 de Octubre del 2026', 'Concierto'],
  ]);
  assert.equal(cards[0].href, 'https://www.tusboletos.mx/evento/una-eva-y-tres-galanes-cancun');
  assert.equal(parseTusboletosList(LIST).length, 4); // no cities: every card
});

test('the event page clock: two showings, one, none', () => {
  const page = (t) => `<p><span style="color:#f68428"><i class="fa fa-clock-o"></i></span>&nbsp;\n   ${t}                                        </p>`;
  assert.deepEqual(tusboletosTimes(page('6:30 P.M. y 9:00 P.M.')), ['18:30', '21:00']);
  assert.deepEqual(tusboletosTimes(page('4:00 P.M  y 6:30 P.M')), ['16:00', '18:30']);
  assert.deepEqual(tusboletosTimes(page('8:00 P.M.')), ['20:00']);
  assert.deepEqual(tusboletosTimes(page('12:00 P.M.')), ['12:00']);
  assert.deepEqual(tusboletosTimes(page('11:00 A.M.')), ['11:00']);
  assert.deepEqual(tusboletosTimes('<p>no clock</p>'), []);
});

// ---- schema.org Event markup (eticket.mx) ----
test('a page in ISO-8859-15 is decoded by its declared charset; UTF-8 is the default', () => {
  const latin = new Uint8Array([...new TextEncoder().encode('<meta charset="iso-8859-15"><p>Canc'), 0xfa, ...new TextEncoder().encode('n</p>')]);
  assert.equal(decodeBody(latin.buffer).slice(-13), '<p>Cancún</p>');
  assert.equal(decodeBody(new TextEncoder().encode('<p>Cancún</p>').buffer, 'text/html; charset=utf-8'), '<p>Cancún</p>');
  assert.equal(decodeBody(new TextEncoder().encode('<p>Cancún</p>').buffer), '<p>Cancún</p>');
});

test('schema.org events: the wall-clock start, the room, sold out when every offer is, a cancelled status, the `at` filter', () => {
  const ev = (name, start, loc, avail, status) => ({ '@context': 'https://schema.org', '@type': 'Event', name, startDate: start, endDate: start.slice(0, 10), url: 'https://www.eticket.mx/masinformacion.aspx?idevento=1', eventStatus: status || 'https://schema.org/EventScheduled', location: { '@type': 'Place', name: loc }, offers: avail.map((a) => ({ '@type': 'Offer', availability: 'https://schema.org/' + a })) });
  const html = `<html><script type="application/ld+json"> {"@type":"Organization","name":"eticket"} </script><script type="application/ld+json"> ${JSON.stringify([
    ev('PANTEÓN ROCOCÓ', '2026-11-14T20:30:00-05:00', 'Plaza de Toros Cancún', ['InStock', 'InStock']),
    ev('YURIDIA', '2026-11-26T21:00:00-05:00', 'Plaza de Toros Cancún', ['SoldOut', 'SoldOut']),
    ev('FERIA', '2026-12-02', 'Foro Mérida', ['InStock'], 'https://schema.org/EventCancelled'),
  ])} </script></html>`;
  const out = parseJsonLdEvents(html);
  assert.deepEqual(out.map((e) => [e.title, e.date, e.time, e.venue, !!e.soldOut, e.status || '']), [
    ['PANTEÓN ROCOCÓ', '2026-11-14', '20:30', 'Plaza de Toros Cancún', false, ''],
    ['YURIDIA', '2026-11-26', '21:00', 'Plaza de Toros Cancún', true, ''],
    ['FERIA', '2026-12-02', '', 'Foro Mérida', false, 'cancelled'],
  ]);
  assert.equal(parseJsonLdEvents(html, { at: /canc[uú]n/i }).length, 2);
  assert.equal(parseJsonLdEvents(html, { venue: 'Plaza de Toros Cancún' })[2].venue, 'Plaza de Toros Cancún'); // a per-venue feed pins the row
});

test('the empty-list gate stops a build whose own pull has nothing upcoming, unless allowed', () => {
  const today = '2026-10-13';
  assert.equal(emptyListGate([{ date: '2026-10-20' }], today, 6, {}), true);
  assert.equal(emptyListGate([{ date: '2026-09-01' }], today, 6, {}), false);
  assert.equal(emptyListGate([], today, 6, { ALLOW_EMPTY_LIST: '1' }), true);
  assert.equal(emptyListGate([], today, 0, {}), true); // nothing configured: nothing to judge
});
