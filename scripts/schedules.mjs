// League schedules for the local teams. The leagues know a game's date or
// time is still floating (NFL flex weeks, doubleheader splits, postponements)
// before Ticketmaster does, so after the feed is assembled each team's home
// games are checked against its league's schedule and matching feed events
// pick up dateTbd.
//
// Every adapter yields [{ date: 'YYYY-MM-DD' (Seattle local), tbd: bool,
// watch?: { tv: [...], radio: [...] } }] for the team's HOME games and is
// best-effort: a blocked or reshaped API logs one line and that team is
// skipped for the run. The Ticketmaster flag is never cleared here, only
// set. `watch` is where to catch the game from Seattle — the home-market
// and national broadcasts the league lists, nothing hardcoded — and rides
// along onto the matching feed event for the pop-up.
import { TEAMS } from './badges.mjs';

const UA = 'Mozilla/5.0 (compatible; lqa-events/1.0; +https://fosdal.net/lqa-events/)';
const seattleDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// From a league's broadcast list — normalized to { kind: 'tv'|'radio',
// name, home: bool, national: bool } — the ones a Seattle viewer can use:
// national first, then the home market; each name once; away-market and
// non-English feeds dropped. Returns undefined when there's nothing.
export function pickBroadcasts(list) {
  const out = { tv: [], radio: [] };
  const usable = (list || []).filter((b) => b && b.name && (b.national || b.home));
  for (const b of [...usable.filter((b) => b.national), ...usable.filter((b) => !b.national)]) {
    const arr = out[b.kind];
    if (arr && !arr.includes(b.name)) arr.push(b.name);
  }
  if (!out.tv.length) delete out.tv;
  if (!out.radio.length) delete out.radio;
  return Object.keys(out).length ? out : undefined;
}
const withWatch = (game, list) => { const w = pickBroadcasts(list); return w ? { ...game, watch: w } : game; };

// MLB Stats API — official; startTimeTBD is the floating-time marker.
// hydrate=broadcasts lists each game's TV / radio with homeAway + isNational.
async function mlb(teamId) {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 200 * 86400e3).toISOString().slice(0, 10);
  const d = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}&hydrate=broadcasts(all)`);
  return (d.dates || []).flatMap((day) => (day.games || [])
    .filter((g) => g.teams?.home?.team?.id === teamId)
    .map((g) => withWatch({ date: g.officialDate || day.date, tbd: !!g.status?.startTimeTBD },
      (g.broadcasts || []).filter((b) => !b.language || b.language === 'en').map((b) => ({
        kind: b.type === 'TV' ? 'tv' : 'radio', name: b.name, home: b.homeAway === 'home', national: !!b.isNational,
      })))));
}

// NHL api-web — official; gameScheduleState is OK / TBD / PPD / SUSP / CNCL.
// tvBroadcasts carry a market: H (home), A (away), N (national).
async function nhl(abbrev) {
  const d = await getJson(`https://api-web.nhle.com/v1/club-schedule-season/${abbrev}/now`);
  return (d.games || [])
    .filter((g) => g.homeTeam?.abbrev === abbrev)
    .map((g) => withWatch({ date: g.gameDate, tbd: (g.gameScheduleState || 'OK') !== 'OK' },
      (g.tvBroadcasts || []).map((b) => ({ kind: 'tv', name: b.network, home: b.market === 'H', national: b.market === 'N' }))));
}

// ESPN's site API — undocumented but the only per-team schedule with a TBD
// marker for the NFL, WNBA, MLS and NWSL. timeValid:false is a flexed or
// unannounced kickoff. Some networks get an Akamai 403; that just skips.
async function espn(sport, league, teamId) {
  const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule`);
  const out = [];
  for (const e of d.events || []) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((t) => t.homeAway === 'home');
    if (!c || String(home?.team?.id) !== String(teamId)) continue;
    const detail = c.status?.type?.detail || '';
    // broadcasts: [{ type: { shortName: 'TV' }, market: { type: 'National' | 'Home' }, media: { shortName } }]
    out.push(withWatch({ date: seattleDate(e.date), tbd: c.timeValid === false || /\bTB[AD]\b/i.test(detail) },
      (c.broadcasts || []).map((b) => ({
        kind: /radio/i.test(b.type?.shortName || '') ? 'radio' : 'tv', name: b.media?.shortName || b.media?.name,
        home: /home/i.test(b.market?.type || ''), national: /national/i.test(b.market?.type || ''),
      }))));
  }
  return out;
}

export const SOURCES = [
  { slug: 'mariners', fetch: () => mlb(136) },
  { slug: 'kraken', fetch: () => nhl('SEA') },
  { slug: 'seahawks', fetch: () => espn('football', 'nfl', 26) },
  { slug: 'storm', fetch: () => espn('basketball', 'wnba', 14) },
  { slug: 'sounders', fetch: () => espn('soccer', 'usa.1', 9726) },
  { slug: 'reign', fetch: () => espn('soccer', 'usa.nwsl', 15363) },
];

// Marks feed events whose team's league lists that home date as TBD, and
// copies the game's broadcasts onto them. bySlug: { mariners: [{date, tbd,
// watch?}], ... }. Returns how many were flagged.
export function applyScheduleFlags(events, bySlug) {
  let flagged = 0;
  for (const e of events) {
    const team = TEAMS.find((t) => t.re.test(e.title || ''));
    const sched = team && bySlug[team.slug];
    if (!sched) continue;
    const game = sched.find((g) => g.date === e.date);
    if (!game) continue;
    if (game.tbd && !e.dateTbd) { e.dateTbd = true; flagged++; }
    if (game.watch) e.watch = game.watch;
  }
  return flagged;
}

export async function applySchedules(events) {
  const bySlug = {};
  const results = await Promise.allSettled(SOURCES.map((s) => s.fetch()));
  results.forEach((r, i) => {
    const slug = SOURCES[i].slug;
    if (r.status === 'fulfilled') {
      bySlug[slug] = r.value;
      const tbd = r.value.filter((g) => g.tbd).length;
      console.error(`schedules: ${slug} ${r.value.length} home games, ${tbd} TBD`);
    } else {
      console.error(`schedules: ${slug} skipped — ${r.reason?.message || r.reason}`);
    }
  });
  const n = applyScheduleFlags(events, bySlug);
  const w = events.filter((e) => e.watch).length;
  console.error(`schedules: flagged ${n} feed event${n === 1 ? '' : 's'} as date TBD, ${w} with broadcasts`);
  return n;
}
