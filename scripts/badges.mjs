/**
 * Badge predicates and feed-file naming shared by the build. The site's
 * app.js mirrors these rules in browser JS — keep the two in sync.
 */

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The source's real end time, else start + 3h; '' when unknown or the
// estimate crosses midnight.
export function endEstimate(e) {
  if (e.end) return e.end;
  if (!e.time) return '';
  const h = Number(e.time.slice(0, 2)) + 3;
  return h >= 24 ? '' : `${String(h).padStart(2, '0')}:${e.time.slice(3, 5)}:00`;
}

export function isDay(e) {
  const end = endEstimate(e);
  return !!end && end <= '16:00:00';
}

// Local pro teams, matched on the event title no matter what the venue.
// Storm and Reign need the fuller name — bare "storm"/"reign" shows up in
// concert titles.
export const TEAMS = [
  { slug: 'mariners', label: 'Mariners', re: /mariners/i },
  { slug: 'storm', label: 'Storm', re: /seattle storm/i },
  { slug: 'seahawks', label: 'Seahawks', re: /seahawks/i },
  { slug: 'reign', label: 'Reign', re: /reign fc|seattle reign/i },
  { slug: 'sounders', label: 'Sounders', re: /sounders/i },
  { slug: 'kraken', label: 'Kraken', re: /kraken/i },
];

// key → [label for the calendar name, predicate]
export const BADGE_FEEDS = {
  '21plus': ['21+', (e) => !!e.age21],
  'day': ['daytime', isDay],
  'soldout': ['sold out', (e) => !!e.soldOut],
  'free': ['free', (e) => !!e.free],
  'movie': ['SIFF movies', (e) => !!e.movie],
  'siffevent': ['SIFF events', (e) => e.venue === 'SIFF Cinema Uptown' && !e.movie],
};
