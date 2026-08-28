import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScCards, parseScDetailDate, parseScVenueCats, parseClockTime, mapDiceEvents, parseSiffScreenings } from './sources.mjs';

// --- Seattle Center calendar HTML (event cards; dates live on detail pages) ---

function card(time, href, title, free) {
  return `<div class="event-list__time">\n${time} </div>
    <div class="event-list__details"><h2 class="event-list__title">
    <a href="${href}"    >\n\t\t${title}\n\t</a></h2>
    <div class="event-list__price"><span>${free ? ' Free Event' : '$25'}</span></div></div>`;
}

test('parses listing cards with absolute URLs and 24h times', () => {
  const html = card('8:00 p.m.', 'events/event-calendar/gypsy', 'Gypsy: A Musical Fable')
    + card('2:00 p.m.', 'events/event-calendar/gypsy-x2', 'Gypsy: A Musical Fable');
  const cards = parseScCards(html);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0], {
    title: 'Gypsy: A Musical Fable',
    time: '20:00:00',
    url: 'https://www.seattlecenter.com/events/event-calendar/gypsy',
    free: false,
  });
  assert.equal(cards[1].time, '14:00:00');
});

test('free events are flagged from the price span', () => {
  const html = card('11:00 a.m.', 'e/1', 'Lawn Festival', true) + card('8:00 p.m.', 'e/2', 'Paid Show', false);
  const cards = parseScCards(html);
  assert.equal(cards[0].free, true);
  assert.equal(cards[1].free, false);
});

test('HTML entities in titles are decoded', () => {
  const html = card('8:00 p.m.', 'e/1', 'Creative Works WEST &#039;26');
  assert.equal(parseScCards(html)[0].title, "Creative Works WEST '26");
});

test('noon/midnight and a.m. times parse; unparseable time becomes all-day', () => {
  assert.equal(parseClockTime('12:00 p.m.'), '12:00:00');
  assert.equal(parseClockTime('12:30 a.m.'), '00:30:00');
  assert.equal(parseClockTime('11:00 a.m.'), '11:00:00');
  assert.equal(parseClockTime('All Day'), '');
});

test('detail page yields the first full date as YYYY-MM-DD', () => {
  const html = '<p>Cornish Playhouse</p><div class="event-date">April 17, 2026 | 8:00 p.m.</div>'
    + '<footer>© 2026 Seattle Center — next show May 3, 2027</footer>';
  assert.equal(parseScDetailDate(html), '2026-04-17');
});

test('detail page with no full date yields empty string', () => {
  assert.equal(parseScDetailDate('<p>© 2026 Seattle Center</p>'), '');
});

test('venue categories come from the Facility/Venue fieldset only', () => {
  const html = `
    <span class="fieldset__legend-text">Event Type</span>
    <input name="cats" value="195"><label for="edit-checkboxes-195">Arts</label>
    <input name="cats" value="45"><label for="edit-checkboxes-45">Concerts</label>
    <span class="fieldset__legend-text">Facility/Venue</span>
    <input name="cats" value="128"><label for="edit-checkboxes-128">Armory Food &amp; Event Hall</label>
    <input name="cats" value="105"><label for="edit-checkboxes-105">Climate Pledge Arena</label>`;
  assert.deepEqual(parseScVenueCats(html), [
    { id: '128', label: 'Armory Food & Event Hall' },
    { id: '105', label: 'Climate Pledge Arena' },
  ]);
});

test('no Facility/Venue fieldset yields no categories (not the type list)', () => {
  const html = `<span class="fieldset__legend-text">Event Type</span>
    <input name="cats" value="195"><label>Arts</label>`;
  assert.deepEqual(parseScVenueCats(html), []);
});

// --- DICE API mapping ---

const diceData = {
  data: [
    {
      name: 'Cool Show',
      date: '2026-08-26T03:00:00Z',     // 2026-08-25 20:00 in Los Angeles
      date_end: '2026-08-26T06:00:00Z', // 23:00 same local day
      timezone: 'America/Los_Angeles',
      status: 'on-sale',
      sold_out: true,
      age_limit: 'This is a 21+ event.',
      url: 'https://link.dice.fm/abc',
    },
    {
      name: 'Cancelled Show',
      date: '2026-08-27T03:00:00Z',
      timezone: 'America/Los_Angeles',
      status: 'cancelled',
      url: 'https://link.dice.fm/def',
    },
  ],
};

test('DICE UTC instants become local Seattle date/time with end, 21+, sold-out', () => {
  const evs = mapDiceEvents(diceData, 'The Vera Project');
  assert.equal(evs.length, 1); // cancelled filtered out
  assert.deepEqual(evs[0], {
    venue: 'The Vera Project',
    title: 'Cool Show',
    date: '2026-08-25',
    time: '20:00:00',
    end: '23:00:00',
    age21: true,
    soldOut: true,
    url: 'https://link.dice.fm/abc',
  });
});

test('all-ages DICE events carry no age21/soldOut/end extras', () => {
  const evs = mapDiceEvents({ data: [{
    name: 'Teen Show', date: '2026-08-26T03:00:00Z', timezone: 'America/Los_Angeles',
    status: 'on-sale', sold_out: false, age_limit: 'This is an All Ages event. ',
    url: 'x',
  }] }, 'The Vera Project');
  assert.equal(evs[0].age21, undefined);
  assert.equal(evs[0].soldOut, undefined);
  assert.equal(evs[0].end, undefined);
});

test('an end past local midnight is dropped (overnight shows fall back to estimates)', () => {
  const evs = mapDiceEvents({ data: [{
    name: 'Late Show', date: '2026-08-26T05:00:00Z', date_end: '2026-08-26T09:00:00Z', // 22:00 → 02:00 next day
    timezone: 'America/Los_Angeles', status: 'on-sale', url: 'x',
  }] }, 'The Vera Project');
  assert.equal(evs[0].time, '22:00:00');
  assert.equal(evs[0].end, undefined);
});

// ---- SIFF calendar ----
// Blob shape lifted from siff.net/calendar: JSON in a data-screening
// attribute, quotes entity-escaped, Showtime as a /Date(ms)/ UTC instant.
function siffBtn(name, venue, startUtcMs, endUtcMs) {
  const blob = JSON.stringify({
    EventName: name, Showtime: `/Date(${startUtcMs})/`,
    ShowtimeEnd: `/Date(${endUtcMs})/`, VenueName: venue,
  }).replace(/"/g, '&quot;');
  return `<a class="elevent button on" href="javascript:;" data-screening="${blob}">7:00 PM</a>`;
}

test('SIFF screenings: Uptown only, earliest showtime per film-day, local time', () => {
  const seven = Date.UTC(2026, 7, 29, 2, 0);   // 2026-08-28 19:00 PDT
  const four = Date.UTC(2026, 7, 28, 23, 0);   // 2026-08-28 16:00 PDT
  const html = `
    <h3><a href="/cinema/in-theaters/the-samurai-and-the-prisoner">The Samurai and the Prisoner</a></h3>
    ${siffBtn('The Samurai and the Prisoner', 'SIFF Cinema Uptown House 3', seven, seven + 147 * 60000)}
    ${siffBtn('The Samurai and the Prisoner', 'SIFF Cinema Uptown House 1', four, four + 147 * 60000)}
    <h3><a href="/cinema/in-theaters/other-film">Other Film</a></h3>
    ${siffBtn('Other Film', 'SIFF Cinema Downtown', seven, seven + 90 * 60000)}`;
  const evs = parseSiffScreenings(html);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].title, 'The Samurai and the Prisoner');
  assert.equal(evs[0].date, '2026-08-28');
  assert.equal(evs[0].time, '16:00:00');
  assert.equal(evs[0].end, '18:27:00');
  assert.equal(evs[0].url, 'https://www.siff.net/cinema/in-theaters/the-samurai-and-the-prisoner');
  assert.equal(evs[0].movie, true);
});

test('SIFF screenings: a listing linked outside in-theaters is an event, not a movie', () => {
  const seven = Date.UTC(2026, 7, 29, 2, 0);
  const html = `
    <h3><a href="/events/siff-quiz-night">SIFF Quiz Night</a></h3>
    ${siffBtn('SIFF Quiz Night', 'SIFF Cinema Uptown', seven, seven + 90 * 60000)}`;
  const evs = parseSiffScreenings(html);
  assert.equal(evs[0].movie, undefined);
  assert.equal(evs[0].url, 'https://www.siff.net/events/siff-quiz-night');
});

test('SIFF screenings: special programming links attach but stay unflagged', () => {
  const evening = Date.UTC(2026, 8, 15, 1, 30);  // 2026-09-14 18:30 PDT
  const html = `
    <h3><a href="/programs-and-events/siff-movie-club/serial-mom">SIFF Movie Club: Serial Mom</a></h3>
    ${siffBtn('Serial Mom', 'SIFF Cinema Uptown House 1', evening, evening + 93 * 60000)}`;
  const evs = parseSiffScreenings(html);
  assert.equal(evs[0].movie, undefined);
  assert.equal(evs[0].url, 'https://www.siff.net/programs-and-events/siff-movie-club/serial-mom');
});

test('SIFF screenings: an end past local midnight is dropped', () => {
  const late = Date.UTC(2026, 7, 29, 6, 0);    // 2026-08-28 23:00 PDT
  const html = siffBtn('Midnight Movie', 'SIFF Cinema Uptown', late, late + 120 * 60000);
  const evs = parseSiffScreenings(html);
  assert.equal(evs[0].time, '23:00:00');
  assert.equal(evs[0].end, undefined);
  assert.equal(evs[0].url, 'https://www.siff.net/calendar'); // no film link in the doc
  assert.equal(evs[0].movie, undefined);
});
