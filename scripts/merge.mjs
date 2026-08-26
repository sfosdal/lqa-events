/**
 * Merge freshly fetched events with the previously published feed so past
 * events survive: sources only list upcoming shows, and the deploy keeps no
 * other state — the live feed IS the archive.
 *
 * Rules: archived events strictly before `todayStr` (and not older than
 * `cutoffStr`) are carried forward; archived events on/after today that the
 * sources no longer list are dropped (that's what a cancellation looks
 * like); on a key collision the fresh event wins.
 */
const key = (e) => `${e.venue}|${e.title}|${e.date}`;

export function mergeWithArchive(fresh, archived, todayStr, cutoffStr) {
  const freshKeys = new Set(fresh.map(key));
  const past = archived.filter((e) =>
    e.date && e.date < todayStr && e.date >= cutoffStr && !freshKeys.has(key(e)));
  return [...past, ...fresh]
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
