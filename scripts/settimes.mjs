// Festival set times, merged onto the festival's day events at build time.
// The Capitol Hill Block Party's website lists the acts only; the stage and
// set times are posters on its Instagram, read by eye once a year into
// scripts/data/chbp-settimes.json (Steve, 2026-10-05: "switching to the
// detailed line up"). With the table a day's event gets `sets` — one entry
// per stage, the acts in order with their times — its time becomes the
// first set's start; the title (the day's headliners) stays. A day the
// table doesn't know keeps what the website gave it.

// "14:35" → "2:35", "close" → "close": the short clock used in text
export function shortClock(t) {
  if (!/^\d\d?:\d\d$/.test(t || '')) return t || '';
  const [h, m] = t.split(':').map(Number);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0');
}

// { "Main Stage": [[start, end, act], …], … } → [{ stage, acts: [{ act, start, end }] }]
export function stagesFrom(day) {
  return Object.entries(day || {}).map(([stage, rows]) => ({
    stage,
    acts: (rows || []).map(([start, end, act]) => ({ act, start, end })),
  })).filter((s) => s.acts.length);
}

export function applySetTimes(events, table, festivalVenue = 'Capitol Hill Block Party') {
  const days = (table && table.days) || {};
  return events.map((e) => {
    if (e.venue !== festivalVenue || !days[e.date]) return e;
    const sets = stagesFrom(days[e.date]);
    if (!sets.length) return e;
    const starts = sets.flatMap((s) => s.acts.map((a) => a.start)).filter((t) => /^\d\d:\d\d$/.test(t)).sort();
    return { ...e, time: starts[0] || e.time, sets };
  });
}

// The grid as text, for the calendar feed's description: one line per stage
export function setTimesText(sets) {
  return (sets || []).map((s) => s.stage + ': ' + s.acts.map((a) => shortClock(a.start) + ' ' + a.act).join(', ')).join('\n');
}
