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

/**
 * Parse the event cards out of seattlecenter.com/events/event-calendar HTML.
 * The listing's date headers omit the year (and the list includes past
 * events), so dates come from each card's detail page instead — see
 * parseScDetailDate. Returns [{ title, time, url }].
 */
export function parseScCards(html) {
  return String(html).split(/event-list__time">/).slice(1).map((seg) => {
    const time = seg.match(/^\s*([^<]*?)\s*</);
    const a = seg.match(/event-list__title">\s*<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    if (!a) return null;
    return {
      title: decodeEntities(a[2]),
      time: parseClockTime(time ? time[1] : ''),
      url: new URL(a[1], 'https://www.seattlecenter.com/').href,
      free: /event-list__price">[\s\S]{0,120}?Free Event/.test(seg),
    };
  }).filter(Boolean);
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
    .filter((e) => e.name && e.date && e.status !== 'cancelled' && e.status !== 'postponed')
    .map((e) => {
      const tz = e.timezone || 'America/Los_Angeles';
      const [date, time] = fmt(e.date, tz).split(' ');
      const ev = { venue: venueLabel, title: e.name, date, time, url: e.url || '' };
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
