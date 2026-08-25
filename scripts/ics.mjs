/**
 * iCalendar (RFC 5545) generation for the LQA events feed.
 *
 * Events are { venue, title, date: 'YYYY-MM-DD', time: 'HH:MM[:SS]'|'', url }.
 * Timed events are emitted in America/Los_Angeles with a 3-hour default
 * duration; time-less events become all-day entries. UIDs hash
 * venue|title|date so subscribers' calendars update in place instead of
 * accumulating duplicates when the feed refreshes.
 */
import { createHash } from 'node:crypto';

const TZID = 'America/Los_Angeles';
const DEFAULT_DURATION_H = 3;

// Rolling tz definition so clients that ignore IANA names still get PST/PDT.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export function eventUid(e) {
  const hash = createHash('sha1').update(`${e.venue}|${e.title}|${e.date}`).digest('hex');
  return `${hash}@fosdal.net`;
}

export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1: lines over 75 octets fold onto a continuation line that
// starts with a space. Split on character boundaries, counting octets.
export function foldLine(line) {
  const out = [];
  let cur = '';
  let curBytes = 0;
  const limit = () => (out.length === 0 ? 75 : 74); // continuation lines lose 1 octet to the leading space
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (curBytes + b > limit()) {
      out.push(cur);
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n');
}

const pad = (n) => String(n).padStart(2, '0');

function dateDigits(date) {
  return date.replaceAll('-', '');
}

// Local wall-clock arithmetic: add hours to a date+time and return the new
// Y/M/D/H/M components. Date handles day/month rollover for us; the host
// timezone doesn't matter because we construct and read in the same one.
function addHours(date, time, hours) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const t = new Date(y, mo - 1, d, h + hours, mi || 0);
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}T${pad(t.getHours())}${pad(t.getMinutes())}00`;
}

function eventLines(e, dtstamp) {
  const lines = ['BEGIN:VEVENT', `UID:${eventUid(e)}`, `DTSTAMP:${dtstamp}`];
  if (e.time) {
    const [h, m] = e.time.split(':');
    lines.push(`DTSTART;TZID=${TZID}:${dateDigits(e.date)}T${pad(h)}${pad(m)}00`);
    lines.push(`DTEND;TZID=${TZID}:${addHours(e.date, e.time, DEFAULT_DURATION_H)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateDigits(e.date)}`);
    lines.push(`DTEND;VALUE=DATE:${addHours(e.date, '00:00', 24).slice(0, 8)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  lines.push(`LOCATION:${escapeText(e.venue)}`);
  if (e.url) lines.push(`URL:${escapeText(e.url)}`);
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(events, now = new Date()) {
  const dtstamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//fosdal.net//lqa-events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Lower Queen Anne Events',
    'X-WR-CALDESC:Upcoming events around Seattle Center — Climate Pledge Arena\\, McCaw Hall\\, Seattle Center',
    `X-WR-TIMEZONE:${TZID}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    ...VTIMEZONE,
    ...events.flatMap((e) => eventLines(e, dtstamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
