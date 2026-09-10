// League schedules for the local teams. The leagues know a game's date or
// time is still floating (NFL flex weeks, doubleheader splits, postponements)
// before Ticketmaster does, so after the feed is assembled each team's home
// games are checked against its league's schedule and matching feed events
// pick up dateTbd.
//
// Every adapter yields the team's whole season, home and away — [{ date:
// 'YYYY-MM-DD' (Seattle local), time: 'HH:MM:SS' Seattle local or null,
// tbd: bool, home: bool, opp: { name, short, abbrev, logo, site }, venue,
// watch?: { tv: [...], radio: [...] } }] — and is best-effort: a blocked or
// reshaped API logs one line and that team is skipped for the run. The
// home games flag the feed (the Ticketmaster flag is never cleared here,
// only set); the full list is published as site/teams.json for the site's
// Teams view. `watch` is where to catch the game from Seattle — the
// home-market and national broadcasts the league lists, nothing hardcoded
// — and rides along onto the matching feed event for the pop-up.
import { TEAMS } from './badges.mjs';

const UA = 'Mozilla/5.0 (compatible; lqa-events/1.0; +https://fosdal.net/lqa-events/)';
const seattleDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const seattleTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// a club's site from its nickname: mlb.com/redsox, nhl.com/mapleleafs
const slugName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
// The window runs from well before today so the season's played games are
// in the list too (a schedule page shows the whole season).
// gameType: S spring, E exhibition, A all-star are left out; R regular; the
// rest (F wild card, D division, L league, W world series) are playoffs.
export function normalizeMlb(d, teamId) {
  return (d.dates || []).flatMap((day) => (day.games || [])
    .filter((g) => g.teams?.home?.team?.id === teamId || g.teams?.away?.team?.id === teamId)
    .filter((g) => !/^[SEA]$/.test(g.gameType || 'R'))
    .map((g) => {
      const home = g.teams.home.team.id === teamId;
      const o = (home ? g.teams.away : g.teams.home).team || {};
      const tbd = !!g.status?.startTimeTBD;
      return withWatch({
        date: g.officialDate || day.date, time: tbd || !g.gameDate ? null : seattleTime(g.gameDate), tbd, home,
        ...(g.gameType && g.gameType !== 'R' ? { playoff: true } : {}),
        opp: { name: o.name, short: o.teamName || o.clubName || o.name, abbrev: o.abbreviation,
          logo: o.id ? `https://www.mlbstatic.com/team-logos/${o.id}.svg` : undefined,
          site: o.teamName ? `https://www.mlb.com/${slugName(o.teamName)}` : undefined },
        venue: g.venue?.name,
      }, (g.broadcasts || []).filter((b) => !b.language || b.language === 'en').map((b) => ({
        kind: b.type === 'TV' ? 'tv' : 'radio', name: b.name, home: b.homeAway === 'home', national: !!b.isNational,
      })));
    }));
}
async function mlb(teamId) {
  const start = new Date(Date.now() - 240 * 86400e3).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 240 * 86400e3).toISOString().slice(0, 10);
  const d = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}&hydrate=broadcasts(all),team`);
  return normalizeMlb(d, teamId);
}

// NHL api-web — official; gameScheduleState is OK / TBD / PPD / SUSP / CNCL.
// tvBroadcasts carry a market: H (home), A (away), N (national). Each side
// comes with its crest and name parts; the club site is nhl.com/<nickname>.
// gameType: 1 preseason (left out), 2 regular season, 3 playoffs.
export function normalizeNhl(d, abbrev) {
  return (d.games || [])
    .filter((g) => g.homeTeam?.abbrev === abbrev || g.awayTeam?.abbrev === abbrev)
    .filter((g) => g.gameType !== 1)
    .map((g) => {
      const home = g.homeTeam?.abbrev === abbrev;
      const o = (home ? g.awayTeam : g.homeTeam) || {};
      const nick = o.commonName?.default, place = o.placeName?.default;
      const tbd = (g.gameScheduleState || 'OK') !== 'OK';
      return withWatch({
        date: g.gameDate, time: tbd || !g.startTimeUTC ? null : seattleTime(g.startTimeUTC), tbd, home,
        ...(g.gameType === 3 ? { playoff: true } : {}),
        opp: { name: [place, nick].filter(Boolean).join(' ') || o.abbrev, short: nick || o.abbrev, abbrev: o.abbrev,
          logo: o.logo, site: nick ? `https://www.nhl.com/${slugName(nick)}` : undefined },
        venue: g.venue?.default,
      }, (g.tvBroadcasts || []).map((b) => ({ kind: 'tv', name: b.network, home: b.market === 'H', national: b.market === 'N' })));
    });
}
async function nhl(abbrev) {
  const d = await getJson(`https://api-web.nhle.com/v1/club-schedule-season/${abbrev}/now`);
  return normalizeNhl(d, abbrev);
}

// ESPN's site API — undocumented but the only per-team schedule with a TBD
// marker for the NFL, WNBA, MLS and NWSL. timeValid:false is a flexed or
// unannounced kickoff. Some networks get an Akamai 403; that just skips.
// The opponent's "site" is its ESPN clubhouse page (the league sites have
// no single URL pattern across four leagues).
// season.type: 1 preseason (left out), 2 regular season, 3 postseason.
export function normalizeEspn(d, teamId) {
  const out = [];
  for (const e of d.events || []) {
    const c = e.competitions?.[0];
    const us = c?.competitors?.find((t) => String(t.team?.id) === String(teamId));
    if (!c || !us || e.season?.type === 1) continue;
    const home = us.homeAway === 'home';
    const o = (c.competitors.find((t) => t !== us) || {}).team || {};
    const detail = c.status?.type?.detail || '';
    const tbd = c.timeValid === false || /\bTB[AD]\b/i.test(detail);
    // broadcasts: [{ type: { shortName: 'TV' }, market: { type: 'National' | 'Home' }, media: { shortName } }]
    out.push(withWatch({
      date: seattleDate(e.date), time: tbd ? null : seattleTime(e.date), tbd, home,
      ...(e.season?.type === 3 ? { playoff: true } : {}),
      opp: { name: o.displayName, short: o.shortDisplayName || o.displayName, abbrev: o.abbreviation,
        logo: o.logos?.[0]?.href, site: (o.links || []).find((l) => (l.rel || []).includes('clubhouse'))?.href },
      venue: c.venue?.fullName,
    }, (c.broadcasts || []).map((b) => ({
      kind: /radio/i.test(b.type?.shortName || '') ? 'radio' : 'tv', name: b.media?.shortName || b.media?.name,
      home: /home/i.test(b.market?.type || ''), national: /national/i.test(b.market?.type || ''),
    }))));
  }
  return out;
}
async function espn(sport, league, teamId) {
  const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule`);
  return normalizeEspn(d, teamId);
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
// watch?}], ... } — HOME games only. Returns how many were flagged.
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

// Fetches every team's season, flags the feed from the home games, and
// returns the seasons — { mariners: [game, ...], ... }, teams that failed
// this run left out — for site/teams.json.
export async function applySchedules(events) {
  const bySlug = {}, seasons = {};
  const results = await Promise.allSettled(SOURCES.map((s) => s.fetch()));
  results.forEach((r, i) => {
    const slug = SOURCES[i].slug;
    if (r.status === 'fulfilled') {
      seasons[slug] = r.value;
      bySlug[slug] = r.value.filter((g) => g.home);
      const tbd = bySlug[slug].filter((g) => g.tbd).length;
      console.error(`schedules: ${slug} ${r.value.length} games, ${bySlug[slug].length} home, ${tbd} TBD`);
    } else {
      console.error(`schedules: ${slug} skipped — ${r.reason?.message || r.reason}`);
    }
  });
  const n = applyScheduleFlags(events, bySlug);
  const w = events.filter((e) => e.watch).length;
  console.error(`schedules: flagged ${n} feed event${n === 1 ? '' : 's'} as date TBD, ${w} with broadcasts`);
  return seasons;
}
