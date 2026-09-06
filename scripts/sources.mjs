/**
 * Pure parsers for event sources that need more than a fetch+map:
 * Seattle Center's server-rendered calendar HTML and DICE's events API.
 * Kept side-effect free so they're testable (sources.test.mjs).
 */

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad = (n) => String(n).padStart(2, '0');

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&(?:#0?39|apos|rsquo|lsquo);/g, "'")
    .replace(/&(?:#8211|ndash|#45);/g, '-').replace(/&(?:#8212|mdash);/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/\s+/g, ' ').trim();
}

// "8:00 p.m." → "20:00:00"; anything unparseable → '' (all-day)
export function parseClockTime(s) {
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return `${pad(h)}:${m[2]}:00`;
}

// ---- event type from what the source itself says -------------------------
// The feed's optional `type` (concert | sports | arts | movie | community) is
// the source's own classification; the site's title rules (filter.js
// eventType) are the fallback when a source has none. Teams/"vs" still win
// in filter.js, so a mis-tagged game can't be filed under a class.

// Ticketmaster Discovery: classifications[0].segment.name
export function tmType(classification) {
  const seg = (classification?.segment?.name || '').toLowerCase();
  if (seg === 'music') return 'concert';
  if (seg === 'sports') return 'sports';
  if (seg.startsWith('arts')) return 'arts'; // "Arts & Theatre"
  if (seg === 'film') return 'movie';
  return ''; // "Miscellaneous"/"Undefined": tours, passes — say nothing
}

// DICE: type_tags like "music:gig", "culture:workshop", "culture:film"
export function diceType(typeTags) {
  const tags = (typeTags || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => t.startsWith('music:'))) return 'concert';
  if (tags.some((t) => /^culture:(comedy|theatre|theater|dance|performance)/.test(t))) return 'arts';
  if (tags.some((t) => t === 'culture:film')) return 'movie';
  if (tags.some((t) => /^culture:(workshop|talk|class)/.test(t))) return 'community';
  return '';
}

// Seattle Center card tags: the facility is the reliable part (a booking in
// one of the theatres is a play); of the type tags only a few can be trusted
// — "Classes & Workshops" sits on Kraken games and "Movies/Films" on charity
// walks in the live calendar, so those are ignored.
// (exact labels: the Dingwall Courtyard *at* Cornish Playhouse hosts craft fairs)
const SC_THEATRES = new Set(['Bagley Wright Theatre', 'Bagley Wright Theatre Poncho Forum', 'Leo Kreielsheimer Theatre', 'Cornish Playhouse']);
export function scType(tags) {
  const t = (tags || []).map(String);
  if (t.some((x) => SC_THEATRES.has(x))) return 'arts';
  if (t.includes('Concerts')) return 'concert';
  if (t.includes('Sports & Fitness')) return 'sports';
  if (t.some((x) => /^(Festivals|Walks & Runs|Fundraisers & Auctions)$/.test(x))) return 'community';
  if (t.includes('Arts')) return 'arts';
  return '';
}

/**
 * Parse the event cards out of seattlecenter.com/events/event-calendar HTML.
 * Returns [{ title, time, url, free, tags }]; tags are the card's footer
 * labels — an event type ("Festivals", "Arts") and/or the facility it is
 * booked in ("Fisher Pavilion"), matched against parseScVenueCats by the
 * caller. Dates are not on the card: see parseScListing.
 */
export function parseScCards(html) {
  return String(html).split(/event-list__time">/).slice(1).map((seg) => {
    const time = seg.match(/^\s*([^<]*?)\s*</);
    const a = seg.match(/event-list__title">\s*<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    if (!a) return null;
    const tg = seg.match(/event-list__tags">([\s\S]*?)<\/div>/);
    return {
      title: decodeEntities(a[2]),
      time: parseClockTime(time ? time[1] : ''),
      url: new URL(a[1], 'https://www.seattlecenter.com/').href,
      free: /event-list__price">[\s\S]{0,120}?Free Event/.test(seg),
      tags: tg ? [...tg[1].matchAll(/<span>\s*([^<]*?)\s*<\/span>/g)].map((m) => decodeEntities(m[1])).filter(Boolean) : [],
    };
  }).filter(Boolean);
}

/**
 * The listing groups its cards under "September 05" date bars (no year).
 * Returns every card on the page with the bar it sits under as monthDay
 * ('' for a card with no bar above it) — feed the accumulated pages to
 * scListingDates for real dates.
 */
export function parseScListing(html) {
  return String(html).split(/date-bar__date">/).flatMap((seg, i) => {
    const monthDay = i === 0 ? '' : decodeEntities((seg.match(/^\s*([^<]*?)\s*</) || [, ''])[1]);
    return parseScCards(seg).map((c) => ({ ...c, monthDay }));
  });
}

/**
 * Give listing cards (in page order, which is date order from today on)
 * their YYYY-MM-DD: the year starts as today's and rolls over when the
 * month/day drops back a long way (December → January). A small step back
 * — an ongoing run that started yesterday listed at the top — is not a new
 * year. Cards with no parseable date bar get date ''.
 */
export function scListingDates(cards, todayISO) {
  let year = Number(todayISO.slice(0, 4));
  let prev = Number(todayISO.slice(5, 7)) * 31 + Number(todayISO.slice(8, 10));
  return cards.map((c) => {
    const m = String(c.monthDay).match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/);
    const mon = m && MONTHS[m[1].toLowerCase()];
    if (!mon) return { ...c, date: '' };
    const cur = mon * 31 + Number(m[2]);
    if (prev - cur > 180) year++;
    prev = cur;
    return { ...c, date: `${year}-${pad(mon)}-${pad(Number(m[2]))}` };
  });
}

/**
 * Discover the venue filter categories on the calendar page: the checkboxes
 * under the "Facility/Venue" fieldset (the "Event Type" fieldset above it is
 * ignored). Returns [{ id, label }].
 */
export function parseScVenueCats(html) {
  const at = String(html).search(/fieldset__legend[^>]*>[^<]*Facility\/Venue|>\s*Facility\/Venue\s*</);
  if (at === -1) return [];
  const cats = [];
  const re = /name="cats" value="(\d+)"[^>]*>\s*<label[^>]*>\s*([^<]+?)\s*<\/label>/g;
  re.lastIndex = at;
  for (let m; (m = re.exec(html)); ) cats.push({ id: m[1], label: decodeEntities(m[2]) });
  return cats;
}

/**
 * Pull the first full "Month D, YYYY" date out of an event detail page.
 * Returns 'YYYY-MM-DD', or '' if none is found.
 */
export function parseScDetailDate(html) {
  const m = String(html).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (!m) return '';
  return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`;
}

/**
 * Parse SIFF's server-rendered /calendar?date=YYYY-MM-DD HTML. Every showtime
 * button carries a data-screening attribute with a JSON blob (EventName,
 * Showtime/ShowtimeEnd as "/Date(ms)/" UTC instants, VenueName like
 * "SIFF Cinema Uptown House 3"). A film screens several times a day across
 * houses; collapse to one event per film per local date at its earliest
 * showtime, keeping only venues matching venueRe. Each screening's URL is the
 * nearest preceding detail link in the document; a /cinema/in-theaters/ link
 * (a regular film run) marks it movie: true, while special programming —
 * /programs-and-events/ (Movie Club, quiz nights), /events/, /festival/ —
 * stays unflagged and reads as a SIFF event.
 * Returns [{ title, date, time, end?, url, movie? }].
 */
export function parseSiffScreenings(html, venueRe = /^SIFF Cinema Uptown/) {
  const s = String(html);
  const links = [];
  for (const m of s.matchAll(/href="(\/(?:cinema\/in-theaters|programs-and-events|events|festival)\/[^"#?]+)"/g)) {
    links.push({ at: m.index, url: m[1] });
  }
  const fmt = (ms) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(ms));
  const best = new Map();
  for (const m of s.matchAll(/data-screening="([^"]+)"/g)) {
    let d;
    try { d = JSON.parse(decodeEntities(m[1])); } catch { continue; }
    if (!d.EventName || !venueRe.test(d.VenueName || '')) continue;
    const ms = Number((String(d.Showtime || '').match(/\d+/) || [])[0]);
    if (!ms) continue;
    const [date, time] = fmt(ms).split(' ');
    let link = '';
    for (const l of links) { if (l.at < m.index) link = l.url; else break; }
    const ev = {
      title: decodeEntities(d.EventName),
      date, time,
      url: link ? `https://www.siff.net${link}` : 'https://www.siff.net/calendar',
    };
    if (link.startsWith('/cinema/in-theaters/')) ev.movie = true;
    const endMs = Number((String(d.ShowtimeEnd || '').match(/\d+/) || [])[0]);
    if (endMs) {
      // same-local-day ends only, as with DICE — overnight ends would lie
      const [endDate, endTime] = fmt(endMs).split(' ');
      if (endDate === date && endTime > time) ev.end = endTime;
    }
    const k = `${ev.title}|${date}`;
    if (!best.has(k) || time < best.get(k).time) best.set(k, ev);
  }
  return [...best.values()];
}

/**
 * Map On the Boards' Squarespace events JSON (/events?format=json) to feed
 * events. Each upcoming item is a performance run: startDate is the first
 * night's curtain as a UTC-ms instant and endDate lands somewhere in the
 * last night (sometimes its start, sometimes its end) — expand the run to
 * one event per local night at the opening's local time, capped at 6 nights
 * so a mis-entered range can't flood the feed.
 * Returns [{ venue, title, date, time, url }].
 */
export function mapOtbEvents(data, venueLabel = 'On the Boards') {
  const fmt = (ms) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(ms));
  const nextDay = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  const out = [];
  for (const it of data?.upcoming || []) {
    if (!it.title || !it.startDate) continue;
    const [first, time] = fmt(it.startDate).split(' ');
    const last = it.endDate > it.startDate ? fmt(it.endDate).split(' ')[0] : first;
    const url = it.fullUrl ? `https://ontheboards.org${it.fullUrl}` : 'https://ontheboards.org/events';
    for (let d = first, i = 0; d <= last && i < 6; d = nextDay(d), i++) {
      out.push({ venue: venueLabel, title: decodeEntities(it.title), date: d, time, url });
    }
  }
  return out;
}

/**
 * Map a DICE events-api response ({data: [...]}) to feed events, converting
 * each UTC instant to its venue-local date and time.
 */
export function mapDiceEvents(data, venueLabel) {
  const fmt = (iso, tz) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso)); // sv-SE → "2026-08-25 20:00:00"
  return (data?.data || [])
    .filter((e) => e.name && e.date)
    .map((e) => {
      const tz = e.timezone || 'America/Los_Angeles';
      const [date, time] = fmt(e.date, tz).split(' ');
      const ev = { venue: venueLabel, title: e.name, date, time, url: e.url || '' };
      // kept, flagged: someone who saw it listed should see it's off
      if (e.status === 'cancelled' || e.status === 'postponed') ev.status = e.status;
      const type = diceType(e.type_tags);
      if (type) ev.type = type;
      if (e.date_end) {
        // keep the end only when the show wraps up the same local day —
        // overnight ends would make "done by" logic lie
        const [endDate, endTime] = fmt(e.date_end, tz).split(' ');
        if (endDate === date && endTime > time) ev.end = endTime;
      }
      if (/\b21\s*(\+|and (over|up))|\b21\+/i.test(String(e.age_limit || ''))) ev.age21 = true;
      if (e.sold_out) ev.soldOut = true;
      return ev;
    });
}
