import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScCards, parseScListing, scListingDates, parseScDetailDate, parseScVenueCats, parseClockTime, tmType, diceType, scType, mapSccEvents, mccawUrlMap, parseSctCalendar, parseMopopCalendar, parsePacsciEvents, parseKexpEvents, mapDiceEvents, parseSiffScreenings, mapOtbEvents, parseGoatEvents } from './sources.mjs';

// --- Seattle Center calendar HTML (event cards; dates live on detail pages) ---

function card(time, href, title, free, tags = []) {
  const tagHtml = tags.length ? `<div class="event-list__tags">${tags.map((t) => `<span> ${t} </span>`).join('')}</div>` : '';
  return `<div class="event-list__time">\n${time} </div>
    <div class="event-list__details"><h2 class="event-list__title">
    <a href="${href}"    >\n\t\t${title}\n\t</a></h2>
    <div class="event-list__price"><span>${free ? ' Free Event' : '$25'}</span></div>${tagHtml}
    <div class="event-list__text">blurb</div></div>`;
}
const dateBar = (md) => `<div class="date-bar"><p class="date-bar__date">\n${md}\n</p></div>`;

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
    tags: [],
  });
  assert.equal(cards[1].time, '14:00:00');
});

test('card tags are read (entities decoded); type-only tags leave no venue to match', () => {
  const html = card('All Day', 'e/b', 'Bumbershoot 2026', false, ['Festivals', 'Grounds / Public Space'])
    + card('7:00 p.m.', 'e/k', 'Kraken vs Flames', false, ['Classes &amp; Workshops', 'Climate Pledge Arena'])
    + card('All Day', 'e/m', 'Christmas Market', false, ['Other']);
  const cards = parseScCards(html);
  assert.deepEqual(cards[0].tags, ['Festivals', 'Grounds / Public Space']);
  assert.deepEqual(cards[1].tags, ['Classes & Workshops', 'Climate Pledge Arena']);
  assert.deepEqual(cards[2].tags, ['Other']);
});

test('listing cards carry the date bar they sit under', () => {
  const html = dateBar('September 05') + card('All Day', 'e/1', 'Bumbershoot 2026') + card('8:00 p.m.', 'e/2', 'Late Show')
    + dateBar('September 06') + card('All Day', 'e/3', 'Bumbershoot 2026');
  const cards = parseScListing(html);
  assert.deepEqual(cards.map((c) => [c.title, c.monthDay]), [
    ['Bumbershoot 2026', 'September 05'], ['Late Show', 'September 05'], ['Bumbershoot 2026', 'September 06'],
  ]);
});

test('listing dates start in the current year and roll over at the December → January step', () => {
  const cards = ['September 05', 'September 06', 'December 31', 'January 03', 'March 06'].map((monthDay) => ({ monthDay }));
  assert.deepEqual(scListingDates(cards, '2026-09-05').map((c) => c.date),
    ['2026-09-05', '2026-09-06', '2026-12-31', '2027-01-03', '2027-03-06']);
});

test('a small step back (an ongoing run listed first) is not a new year; unparseable bars give no date', () => {
  const cards = ['September 04', 'September 05', 'Sometime', ''].map((monthDay) => ({ monthDay }));
  assert.deepEqual(scListingDates(cards, '2026-09-05').map((c) => c.date), ['2026-09-04', '2026-09-05', '', '']);
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
      type_tags: ['music:gig'],
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

test('event types from what each source says', () => {
  assert.equal(tmType({ segment: { name: 'Music' }, genre: { name: 'Pop' } }), 'concert');
  assert.equal(tmType({ segment: { name: 'Sports' } }), 'sports');
  assert.equal(tmType({ segment: { name: 'Arts & Theatre' } }), 'arts');
  assert.equal(tmType({ segment: { name: 'Film' } }), 'movie');
  assert.equal(tmType({ segment: { name: 'Miscellaneous' } }), '', 'tours and passes say nothing');
  assert.equal(tmType(undefined), '');
  assert.equal(diceType(['music:gig']), 'concert');
  assert.equal(diceType(['culture:workshop']), 'community');
  assert.equal(diceType(['culture:film']), 'movie');
  assert.equal(diceType(['culture:comedy']), 'arts');
  assert.equal(diceType([]), '');
  assert.equal(scType(['Bagley Wright Theatre']), 'arts', 'a booking in a theatre is a play');
  assert.equal(scType(['Arts', 'Festivals', 'Other', 'Grounds / Public Space']), 'community', 'festival programming');
  assert.equal(scType(['Classes & Workshops', 'Climate Pledge Arena']), '', 'the mis-used class tag is ignored');
  assert.equal(scType(['Movies/Films', 'Grounds / Public Space']), '', 'so is the mis-used film tag');
  assert.equal(scType(['Concerts', 'Mural Amphitheatre']), 'concert');
  assert.equal(scType(['Walks & Runs']), 'community');
  assert.equal(scType(['Other', 'Fisher Pavilion']), '');
  assert.equal(scType(['Dingwall Courtyard at Cornish Playhouse', 'Exhibition Hall']), 'expo', 'the courtyard is not the playhouse; the hall is a show floor');
  assert.equal(scType(['Bagley Wright Theatre Poncho Forum']), 'arts');
  assert.equal(scType(['Other', 'Exhibition Hall']), 'expo', 'Exhibition Hall bookings are shows and fairs');
});

test('Convention Center bookings: one all-day event per day, typed, private meetings skipped', () => {
  const rows = [
    { eventId: '1', title: 'PAX West 2026', start: '2026-09-04T06:00:00', end: '2026-09-07T23:00:00', type: 'CTS', class: 'CUL', venue: 'Arch & Summit Buildings', webAddress: 'https://west.paxsite.com/', private: 'false' },
    { eventId: '2', title: 'Chief Seattle Club Gala', start: '2026-11-14T06:00:00', end: '2026-11-14T23:30:00', type: 'BNQ', class: 'FR', venue: 'Summit Building', webAddress: '', private: 'false' },
    { eventId: '3', title: 'P&G Team Offsite', start: '2026-09-16T06:00:00', end: '2026-09-16T18:00:00', type: '1STP', class: 'TBC', venue: 'Arch Building', private: 'false' },
    { eventId: '4', title: 'Client Tour', start: '2026-09-11T10:00:00', end: '2026-09-11T12:00:00', type: '1STEX', class: 'TOU', venue: 'Summit Building', private: 'false' },
    { eventId: '5', title: 'Very Long Show', start: '2026-10-01T06:00:00', end: '2026-10-30T18:00:00', type: 'CNS', class: 'HOB', venue: 'Arch Building', private: 'false' },
  ];
  const evs = mapSccEvents(rows, 'Convention Center');
  const pax = evs.filter((e) => e.title === 'PAX West 2026');
  assert.deepEqual(pax.map((e) => e.date), ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
  assert.equal(pax[0].type, 'expo');
  assert.equal(pax[0].url, 'https://west.paxsite.com/');
  assert.equal(pax[0].time, '');
  assert.equal(pax[0].building, 'Arch & Summit Buildings');
  const gala = evs.filter((e) => e.title === 'Chief Seattle Club Gala');
  assert.equal(gala.length, 1);
  assert.equal(gala[0].type, 'community');
  assert.equal(gala[0].url, 'https://seattlecc.com/upcoming-events/?eventid=2');
  assert.ok(!evs.some((e) => /Offsite|Tour/.test(e.title)), 'one-day private meetings and tours are skipped');
  assert.equal(evs.filter((e) => e.title === 'Very Long Show').length, 7, 'runs cap at a week');
});

test("Children's Theatre month grid: shows and events, classes skipped, neighbouring-month days dated right", () => {
  const entry = (kind, label, title, time, href) => `<div class="js-filterable-event"><li class="event"><div class="event-name"><div class="event-type"><span class="${kind}">${label}</span></div><a href="${href}"> ${title} </a></div><div class="event-time">${time}</div></li></div>`;
  const html = '<li id="1"><div class="day-indicator">31</div><div class="day-of-the-month-full">Thursday, December 31</div><ul>'
    + entry('mainstage', 'SHOW', 'Leonardo!', '6:00 PM', 'https://www.sct.org/onstage/productions/leonardo-2026/')
    + entry('sct-class', 'CLASS', 'Drama Camp', '\n   Saturdays', 'https://www.sct.org/classes/x/') + '</ul></li>'
    + '<li id="2"><div class="day-indicator">1</div><div class="day-of-the-month-full">Friday, January 1</div><ul>'
    + entry('event', 'EVENT', 'Sensory-Friendly Day', '11:00 AM', 'https://www.sct.org/events/sfd/') + '</ul></li>';
  const evs = parseSctCalendar(html, 2027, 1); // the January page shows Dec 31
  assert.deepEqual(evs.map((e) => [e.title, e.date, e.time, e.type]), [
    ['Leonardo!', '2026-12-31', '18:00:00', 'arts'],
    ['Sensory-Friendly Day', '2027-01-01', '11:00:00', 'community'],
  ]);
  assert.equal(parseSctCalendar(html, 2026, 12)[0].date, '2026-12-31', 'and the December page agrees');
  assert.equal(parseSctCalendar(html, 2026, 12)[1].date, '2027-01-01');
});

test('MoPOP calendar items: date, title, absolute link, all-day', () => {
  const html = '<div data-text="x" data-date="September 5, 2026" data-title="Star Trek Supper Fan Club" class="calendar-dot-item"><div>x</div><a aria-hidden="true" href="/events/supper-fan-club-star-trek" class="calendar-dot-link">Text Link</a></div>'
    + '<div data-text="" data-date="December 9, 2026" data-title="Tea &amp; Trivia" class="calendar-dot-item"><a aria-hidden="true" href="/events/tea" class="calendar-dot-link">Text Link</a></div>';
  assert.deepEqual(parseMopopCalendar(html), [
    { title: 'Star Trek Supper Fan Club', date: '2026-09-05', time: '', url: 'https://www.mopop.org/events/supper-fan-club-star-trek' },
    { title: 'Tea & Trivia', date: '2026-12-09', time: '', url: 'https://www.mopop.org/events/tea' },
  ]);
});

test('Pacific Science Center teasers: title, date, free flag', () => {
  const html = '<article class="event-teaser" role="article"><h2><a href="https://pacificsciencecenter.org/events/signal-modular/">SIGNAL: Modular on the Spot</a></h2><div class="teaser__footer"><span class="teaser__meta teaser__date">September 12, 2026</span><span class="teaser__meta teaser__cost">Free</span></div></article>'
    + '<article class="event-teaser" role="article"><h2><a href="https://pacificsciencecenter.org/events/blood-drive/">Blood Drive</a></h2><div class="teaser__footer"><span class="teaser__meta teaser__date">September 9, 2026</span><span class="teaser__meta teaser__location">PacSci Courtyard</span></div></article>';
  const evs = parsePacsciEvents(html);
  assert.deepEqual(evs.map((e) => [e.title, e.date, !!e.free]), [['SIGNAL: Modular on the Spot', '2026-09-12', true], ['Blood Drive', '2026-09-09', false]]);
});

test('KEXP event items: start/end from the add-to-calendar widget, location kept for filtering', () => {
  const html = '<article class="aldryn-events-article events-upcoming EventItem u-mb1"><div class="EventItem-body"><h3 class="u-mb0"><a href="/events/kexp-events/dcfc/">Death Cab for Cutie LIVE on KEXP</a></h3><div><a href="https://maps.google.com?q=kexp" target="_blank"> KEXP Studio (NW Rooms) </a></div></div><p><a href="#" class="addeventatc">Add <span class="start"> 09/07/2026 11:00 </span> <span class="end"> 09/07/2026 11:30 </span></a></p></article>'
    + '<article class="EventItem"><h3><a href="/events/kexp-events/bay/">Bay Area Show</a></h3><a href="https://maps.google.com?q=sf"> The Chapel, San Francisco </a><span class="start"> 10/01/2026 20:00 </span><span class="end"> 10/02/2026 01:00 </span></article>';
  const evs = parseKexpEvents(html);
  assert.deepEqual(evs[0], { title: 'Death Cab for Cutie LIVE on KEXP', date: '2026-09-07', time: '11:00:00', url: 'https://www.kexp.org/events/kexp-events/dcfc/', location: 'KEXP Studio (NW Rooms)', end: '11:30:00' });
  assert.equal(evs[1].location, 'The Chapel, San Francisco');
  assert.equal(evs[1].end, undefined, 'an end past midnight is dropped');
});

test('McCaw RSS becomes a title → detail-page map', () => {
  const xml = '<item><title>La boh&#232;me</title><link>https://www.mccawhall.com/events/detail/la-boheme</link></item>'
    + '<item><title>Serenade</title><link> https://www.mccawhall.com/events/detail/serenade </link></item>';
  const m = mccawUrlMap(xml);
  assert.equal(m.get('serenade'), 'https://www.mccawhall.com/events/detail/serenade');
  assert.equal(m.get('la bohème'), 'https://www.mccawhall.com/events/detail/la-boheme');
});

test('DICE UTC instants become local Seattle date/time with end, 21+, sold-out', () => {
  const evs = mapDiceEvents(diceData, 'The Vera Project');
  assert.equal(evs.length, 2);
  assert.equal(evs[1].status, 'cancelled', 'a cancelled show stays listed, flagged');
  assert.equal(evs[1].title, 'Cancelled Show');
  assert.deepEqual(evs[0], {
    venue: 'The Vera Project',
    title: 'Cool Show',
    date: '2026-08-25',
    time: '20:00:00',
    end: '23:00:00',
    age21: true,
    soldOut: true,
    url: 'https://link.dice.fm/abc',
    type: 'concert',
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

// ---- On the Boards (Squarespace events JSON) ----

test('OtB runs expand to one event per local night at curtain time', () => {
  const data = {
    upcoming: [
      // Sep 18 02:30 UTC = Sep 17 7:30 PM PDT; end lands in the Sep 19 show
      { title: 'Clayton Lee &amp; Friends', fullUrl: '/events/26-27/goldberg-variations', startDate: 1789698600424, endDate: 1789876800424 },
      // single night: endDate === startDate
      { title: 'ILVS STRAUSS', fullUrl: '/events/26-27/manifesto', startDate: 1789698600424, endDate: 1789698600424 },
    ],
    past: [{ title: 'Old Show', fullUrl: '/events/old', startDate: 1, endDate: 1 }],
  };
  const evs = mapOtbEvents(data);
  assert.deepEqual(evs.map((e) => [e.title, e.date, e.time]), [
    ['Clayton Lee & Friends', '2026-09-17', '19:30:00'],
    ['Clayton Lee & Friends', '2026-09-18', '19:30:00'],
    ['Clayton Lee & Friends', '2026-09-19', '19:30:00'],
    ['ILVS STRAUSS', '2026-09-17', '19:30:00'],
  ]);
  assert.equal(evs[0].venue, 'On the Boards');
  assert.equal(evs[0].url, 'https://ontheboards.org/events/26-27/goldberg-variations');
});

test('OtB runaway date ranges cap at six nights', () => {
  const yearLater = 1789698600424 + 365 * 86400e3;
  const evs = mapOtbEvents({ upcoming: [{ title: 'Broken', fullUrl: '/e', startDate: 1789698600424, endDate: yearLater }] });
  assert.equal(evs.length, 6);
});

// --- The Traveling Goat (Wix repeater: date line, title with the time, blurb) ---

const goatItem = (date, title, blurb = 'blurb') =>
  `<div role="listitem" class="_FiCX"><div class="wixui-repeater__item"><p class="font_8"><span>${date}</span></p>` +
  `<h2 class="font_2"><span><span>${title}</span></span></h2><p class="font_8"><span>${blurb}</span></p></div></div>`;

test('parses Traveling Goat items, lifting the time out of the title', () => {
  const html = '<div role="list">' + goatItem('Sep 7, 2026', 'Guess What? Trivia! @ 7p')
    + goatItem('Sep 10, 2026', 'The Traveling Goat Presents: Piffle @ 730p')
    + goatItem('Oct 12, 2026', 'Guess What? Trivia! 7p')
    + goatItem('Sep 20, 2026', 'It&#x27;s Negroni Week! Sept 21-27') + '</div>';
  assert.deepEqual(parseGoatEvents(html), [
    { title: 'Guess What? Trivia!', date: '2026-09-07', time: '19:00:00' },
    { title: 'The Traveling Goat Presents: Piffle', date: '2026-09-10', time: '19:30:00' },
    { title: 'Guess What? Trivia!', date: '2026-10-12', time: '19:00:00' },
    { title: "It's Negroni Week! Sept 21-27", date: '2026-09-20', time: '' },
  ]);
});

test('Traveling Goat: 12 noon / midnight and a.m. times, items without a date skipped', () => {
  const html = goatItem('Dec 31, 2026', 'NYE Party @ 12a') + goatItem('Jan 1, 2027', 'Brunch @ 11:30 am')
    + '<div role="listitem"><h2>No date here</h2></div>';
  assert.deepEqual(parseGoatEvents(html).map((e) => [e.date, e.time, e.title]), [
    ['2026-12-31', '00:00:00', 'NYE Party'], ['2027-01-01', '11:30:00', 'Brunch'],
  ]);
});
