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
  const cardRe = /event-list__time">\s*([^<]*?)\s*<[\s\S]{0,800}?event-list__title">\s*<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/g;
  return [...html.matchAll(cardRe)].map((m) => ({
    title: decodeEntities(m[3]),
    time: parseClockTime(m[1]),
    url: new URL(m[2], 'https://www.seattlecenter.com/').href,
  }));
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
 * Map a DICE events-api response ({data: [...]}) to feed events, converting
 * each UTC instant to its venue-local date and time.
 */
export function mapDiceEvents(data, venueLabel) {
  return (data?.data || [])
    .filter((e) => e.name && e.date && e.status !== 'cancelled' && e.status !== 'postponed')
    .map((e) => {
      const local = new Intl.DateTimeFormat('sv-SE', {
        timeZone: e.timezone || 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(e.date)); // sv-SE → "2026-08-25 20:00:00"
      const [date, time] = local.split(' ');
      return { venue: venueLabel, title: e.name, date, time, url: e.url || '' };
    });
}
