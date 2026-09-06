/**
 * Merge freshly fetched events with the previously published feed so past
 * events survive: sources only list upcoming shows, and the deploy keeps no
 * other state — the live feed IS the archive.
 *
 * Rules: archived events strictly before `todayStr` (and not older than
 * `cutoffStr`) are carried forward; archived events on/after today that the
 * sources no longer list are dropped (a quiet removal) — unless the archive
 * already knows the show is cancelled/postponed, in which case it stays in
 * its slot, marked, until its date passes; on a key collision the fresh
 * event wins, but a status first seen on an earlier run keeps its
 * `statusSince` (when the cancellation was first detected, ISO time) —
 * a status seen for the first time is stamped `nowISO`.
 */
const key = (e) => `${e.venue}|${e.title}|${e.date}`;

export function mergeWithArchive(fresh, archived, todayStr, cutoffStr, nowISO = new Date().toISOString()) {
  const freshKeys = new Set(fresh.map(key));
  const byKey = new Map(archived.map((e) => [key(e), e]));
  const past = archived.filter((e) =>
    e.date && e.date < todayStr && e.date >= cutoffStr && !freshKeys.has(key(e)));
  const knownOff = archived.filter((e) =>
    e.date && e.date >= todayStr && e.status && !freshKeys.has(key(e)));
  const stamped = fresh.map((e) => {
    if (!e.status) return e;
    const prev = byKey.get(key(e));
    const since = prev && prev.status === e.status && prev.statusSince ? prev.statusSince : nowISO;
    return { ...e, statusSince: since };
  });
  return [...past, ...knownOff, ...stamped]
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
