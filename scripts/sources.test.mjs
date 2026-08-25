import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScCards, parseScDetailDate, parseScVenueCats, parseClockTime, mapDiceEvents } from './sources.mjs';

// --- Seattle Center calendar HTML (event cards; dates live on detail pages) ---

function card(time, href, title) {
  return `<div class="event-list__time">\n${time} </div>
    <div class="event-list__details"><h2 class="event-list__title">
    <a href="${href}"    >\n\t\t${title}\n\t</a></h2></div>`;
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
  });
  assert.equal(cards[1].time, '14:00:00');
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
      date: '2026-08-26T03:00:00Z', // 2026-08-25 20:00 in Los Angeles
      timezone: 'America/Los_Angeles',
      status: 'on-sale',
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

test('DICE UTC instants become local Seattle date/time', () => {
  const evs = mapDiceEvents(diceData, 'The Vera Project');
  assert.equal(evs.length, 1); // cancelled filtered out
  assert.deepEqual(evs[0], {
    venue: 'The Vera Project',
    title: 'Cool Show',
    date: '2026-08-25',
    time: '20:00:00',
    url: 'https://link.dice.fm/abc',
  });
});
