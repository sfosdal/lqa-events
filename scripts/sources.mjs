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
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
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
  if (t.includes('Exhibition Hall')) return 'expo'; // home, gem, bridal, record shows, craft fairs
  if (t.includes('Concerts')) return 'concert';
  if (t.includes('Sports & Fitness')) return 'sports';
  if (t.some((x) => /^(Festivals|Walks & Runs|Fundraisers & Auctions)$/.test(x))) return 'community';
  if (t.includes('Arts')) return 'arts';
  return '';
}

// Convention Center: the Momentus (Ungerboeck) calendar behind
// seattlecc.com/upcoming-events — api/event/getCalendarEvents rows. Type
// codes: CTS conventions & trade shows, CNS consumer shows, CTC/CCC/CCO
// conferences, TRS trade shows → expo; BNQ banquets/galas and SPE special
// events → community; 1STP/1STEX one-day private meetings and TOU tours
// are skipped (staff offsites, client tours — nothing to go to). A run is
// one all-day event per day (capped) so it reads as a series on the site.
const SCC_EXPO = new Set(['CTS', 'CNS', 'CTC', 'CCC', 'CCO', 'TRS']);
const SCC_SKIP_TYPE = new Set(['1STP', '1STEX']);
export function mapSccEvents(rows, venueLabel, maxDays = 7) {
  const out = [];
  for (const r of rows || []) {
    if (!r.title || !r.start) continue;
    if (SCC_SKIP_TYPE.has(r.type) || r.class === 'TOU' || String(r.private) === 'true') continue;
    const start = r.start.slice(0, 10), end = (r.end || r.start).slice(0, 10);
    const url = r.webAddress || `https://seattlecc.com/upcoming-events/?eventid=${r.eventId}`;
    const type = SCC_EXPO.has(r.type) ? 'expo' : 'community';
    let d = new Date(`${start}T12:00:00Z`);
    for (let i = 0; i < maxDays; i++) {
      const date = d.toISOString().slice(0, 10);
      if (date > end) break;
      const ev = { venue: venueLabel, title: r.title, date, time: '', url, type };
      if (r.venue) ev.building = r.venue; // Arch / Summit
      out.push(ev);
      d = new Date(d.getTime() + 86400e3);
    }
  }
  return out;
}

// McCaw Hall's RSS: one item per production with the venue's own detail
// page — used as a title → URL map for the Seattle Center sweep's McCaw
// performances (which carry every date and time, but link to seattlecenter.com)
export function mccawUrlMap(xml) {
  const map = new Map();
  for (const it of String(xml).match(/<item>[\s\S]*?<\/item>/g) || []) {
    const t = it.match(/<title>([\s\S]*?)<\/title>/), l = it.match(/<link>([\s\S]*?)<\/link>/);
    if (t && l) map.set(decodeEntities(t[1]).toLowerCase(), l[1].trim());
  }
  return map;
}

// ---- the campus neighbors that aren't on Seattle Center's calendar -------

// "Friday, October 2" on a page for pageYear/pageMonth (1-12) → YYYY-MM-DD;
// a month grid shows a few days of the neighbouring months, so the year
// rolls when the day's month is far from the page's.
function gridDate(text, pageYear, pageMonth) {
  const m = String(text).match(/([A-Za-z]+)\s+(\d{1,2})\s*$/);
  const mon = m && MONTHS[m[1].toLowerCase()];
  if (!mon) return '';
  let year = pageYear;
  if (mon - pageMonth > 6) year--; else if (pageMonth - mon > 6) year++;
  return `${year}-${pad(mon)}-${pad(Number(m[2]))}`;
}

// Seattle Children's Theatre: sct.org/tickets-shows/calendar/YYYY/month — a
// month grid; each day carries its full date and a list of entries typed
// SHOW (mainstage), EVENT, or CLASS (skipped: enrolment, not an outing).
export function parseSctCalendar(html, pageYear, pageMonth) {
  const out = [];
  const days = String(html).split(/<div class="day-of-the-month-full">/).slice(1);
  for (const seg of days) {
    const date = gridDate((seg.match(/^([^<]+)</) || [, ''])[1], pageYear, pageMonth);
    if (!date) continue;
    const body = seg.split(/<li id="\d+"/)[0]; // up to the next day cell
    for (const li of body.match(/<li class="event">[\s\S]*?<\/li>/g) || []) {
      const kind = (li.match(/<span class="(mainstage|event|sct-class)">/) || [])[1];
      if (!kind || kind === 'sct-class') continue;
      const a = li.match(/<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
      if (!a) continue;
      out.push({
        title: decodeEntities(a[2]), date,
        time: parseClockTime((li.match(/event-time">\s*([^<]*?)\s*</) || [, ''])[1].replace(/\s+/g, ' ')),
        url: a[1], type: kind === 'mainstage' ? 'arts' : 'community',
      });
    }
  }
  return out;
}

// MoPOP: mopop.org/events carries a hidden Webflow list feeding its
// calendar — one item per event-day with the date, title and detail link;
// no times on the list, so these are all-day.
export function parseMopopCalendar(html) {
  const out = [];
  const re = /<div data-text="[^"]*" data-date="([^"]*)" data-title="([^"]*)" class="calendar-dot-item">[\s\S]*?href="([^"]*)" class="calendar-dot-link"/g;
  for (let m; (m = re.exec(String(html))); ) {
    const d = m[1].match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    const mon = d && MONTHS[d[1].toLowerCase()];
    if (!mon) continue;
    out.push({ title: decodeEntities(m[2]), date: `${d[3]}-${pad(mon)}-${pad(Number(d[2]))}`, time: '', url: new URL(m[3], 'https://www.mopop.org/').href });
  }
  return out;
}

// Pacific Science Center: pacificsciencecenter.org/events, a short list of
// teaser cards (title link, "September 9, 2026", optional Free).
export function parsePacsciEvents(html) {
  const out = [];
  for (const card of String(html).match(/<article class="event-teaser"[\s\S]*?<\/article>/g) || []) {
    const a = card.match(/<h2><a href="([^"]+)">([\s\S]*?)<\/a><\/h2>/);
    const d = card.match(/teaser__date">\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    const mon = d && MONTHS[d[1].toLowerCase()];
    if (!a || !mon) continue;
    const ev = { title: decodeEntities(a[2]), date: `${d[3]}-${pad(mon)}-${pad(Number(d[2]))}`, time: '', url: a[1] };
    if (/teaser__cost">\s*Free\s*</.test(card)) ev.free = true;
    out.push(ev);
  }
  return out;
}

// KEXP: kexp.org/events/kexp-events/ — event articles whose Add-to-Calendar
// widget carries "MM/DD/YYYY HH:MM" start/end; the location line says
// whether it's at the station (Gathering Space, studio) or somewhere else.
export function parseKexpEvents(html) {
  const out = [];
  for (const art of String(html).match(/<article class="[^"]*EventItem[^"]*">[\s\S]*?<\/article>/g) || []) {
    const a = art.match(/<h3[^>]*><a href="([^"]+)">([\s\S]*?)<\/a><\/h3>/);
    const start = art.match(/<span class="start">\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!a || !start) continue;
    const loc = (art.match(/maps\.google\.com[^>]*>\s*([\s\S]*?)\s*<\/a>/) || [, ''])[1].replace(/\s+/g, ' ');
    const ev = { title: decodeEntities(a[2]), date: `${start[3]}-${start[1]}-${start[2]}`, time: `${start[4]}:${start[5]}:00`, url: new URL(a[1], 'https://www.kexp.org/').href, location: loc };
    const end = art.match(/<span class="end">\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (end && `${end[3]}-${end[1]}-${end[2]}` === ev.date && `${end[4]}:${end[5]}:00` > ev.time) ev.end = `${end[4]}:${end[5]}:00`;
    out.push(ev);
  }
  return out;
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

/**
 * The Traveling Goat (a Lower Queen Anne bar) lists its events on a Wix
 * page: one repeater item per event — a date line ("Sep 7, 2026"), a title
 * that usually ends in the time ("Guess What? Trivia! @ 7p", "Piffle @
 * 730p"), and a blurb. Returns [{ title, date, time }]; the time is lifted
 * out of the title (all-day when there isn't one). Wix renders the list
 * server-side, so a plain fetch sees it.
 */
export function parseGoatEvents(html) {
  const out = [];
  const items = String(html).split(/<div role="listitem"/).slice(1);
  for (const item of items) {
    const lines = item.replace(/<[^>]+>/g, '\n').split('\n').map((l) => decodeEntities(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const di = lines.findIndex((l) => /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/.test(l));
    if (di < 0 || !lines[di + 1]) continue;
    const dm = lines[di].match(/^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/);
    const abbr = dm[1].slice(0, 3).toLowerCase(); // "Sep" / "Sept" / "September"
    const mon = MONTHS[Object.keys(MONTHS).find((k) => k.startsWith(abbr))];
    if (!mon) continue;
    const date = `${dm[3]}-${String(mon).padStart(2, '0')}-${String(dm[2]).padStart(2, '0')}`;
    let title = lines[di + 1];
    let time = '';
    // "@ 7p", "@730p", "7pm", "@ 7:30 pm" at the end of the title
    const tm = title.match(/\s*@?\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])\.?m?\.?\s*$/i);
    if (tm) {
      let h = Number(tm[1]);
      const m = tm[2] || '00';
      if (h <= 12 && Number(m) < 60) {
        if (tm[3].toLowerCase() === 'p' && h < 12) h += 12;
        if (tm[3].toLowerCase() === 'a' && h === 12) h = 0;
        time = `${String(h).padStart(2, '0')}:${m}:00`;
        title = title.slice(0, tm.index).replace(/[\s@]+$/, '');
      }
    }
    out.push({ title, date, time });
  }
  return out;
}
