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
import { cleanMarks } from './marks.mjs';
import { addClips } from './highlights.mjs';
import { readFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; lqa-events/1.0; +https://fosdal.net/lqa-events/)';
const seattleDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const seattleTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// MLB's team-logos/<id>.svg files are the caps' on-dark variants; all keep
// their colours but the Rockies' (115), whose purple is drawn as black (no
// fill), so it reads grey on the cards — ESPN's mark stands in for it.
const MLB_LOGO_FIX = { 115: 'https://a.espncdn.com/i/teamlogos/mlb/500/col.png' };
// a club's site from its nickname: mlb.com/redsox, nhl.com/mapleleafs
const slugName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ESPN's site API answers a browser user-agent with 403 (verified
// 2026-09-10: 200 with none, 403 with Chrome's), so it gets a bare fetch.
async function getJson(url, bare) {
  const r = await fetch(url, { headers: bare ? { accept: 'application/json' } : { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// From a league's broadcast list — normalized to { kind: 'tv'|'radio',
// name, home: bool, national: bool } — the ones a Seattle viewer can use:
// national first, then our own market (the home feeds for a home game, the
// away feeds when we're the visitors); each name once; the other side's
// market and non-English feeds dropped. Returns undefined when there's nothing.
export function pickBroadcasts(list, ours = true) {
  const out = { tv: [], radio: [] };
  const usable = (list || []).filter((b) => b && b.name && (b.national || b.home === ours));
  for (const b of [...usable.filter((b) => b.national), ...usable.filter((b) => !b.national)]) {
    const arr = out[b.kind];
    if (arr && !arr.includes(b.name)) arr.push(b.name);
  }
  if (!out.tv.length) delete out.tv;
  if (!out.radio.length) delete out.radio;
  return Object.keys(out).length ? out : undefined;
}
const withWatch = (game, list) => { const w = pickBroadcasts(list, game.home); return w ? { ...game, watch: w } : game; };
// a played game's line: { us, them, won, ot?: 'OT'|'SO' } — a draw is
// won:false with equal scores; nothing at all until the game is final
const withResult = (game, res) => (res ? { ...game, res } : game);

// MLB Stats API — official; startTimeTBD is the floating-time marker.
// hydrate=broadcasts lists each game's TV / radio with homeAway + isNational.
// The window runs from well before today so the season's played games are
// in the list too (a schedule page shows the whole season).
// gameType: S spring training (kept, flagged pre); E exhibition and A
// all-star left out; R regular; the rest (F wild card, D division, L
// league, W world series) are playoffs.
export function normalizeMlb(d, teamId) {
  return (d.dates || []).flatMap((day) => (day.games || [])
    .filter((g) => g.teams?.home?.team?.id === teamId || g.teams?.away?.team?.id === teamId)
    .filter((g) => !/^[EA]$/.test(g.gameType || 'R'))
    .map((g) => {
      const home = g.teams.home.team.id === teamId;
      const o = (home ? g.teams.away : g.teams.home).team || {};
      const tbd = !!g.status?.startTimeTBD;
      const us = home ? g.teams.home : g.teams.away, them = home ? g.teams.away : g.teams.home;
      const final = g.status?.abstractGameState === 'Final' && us.score != null && them.score != null;
      return withResult(withWatch({
        date: g.officialDate || day.date, time: tbd || !g.gameDate ? null : seattleTime(g.gameDate), tbd, home,
        ...(g.gamePk ? { id: String(g.gamePk) } : {}), // MLB's game id: the page fetches the game's highlights by it
        ...(g.gameType === 'S' ? { pre: true } : g.gameType && g.gameType !== 'R' ? { playoff: true } : {}),
        opp: { name: o.name, short: o.teamName || o.clubName || o.name, abbrev: o.abbreviation,
          logo: o.id ? (MLB_LOGO_FIX[o.id] || `https://www.mlbstatic.com/team-logos/${o.id}.svg`) : undefined,
          site: o.teamName ? `https://www.mlb.com/${slugName(o.teamName)}` : undefined },
        venue: g.venue?.name,
      }, (g.broadcasts || []).filter((b) => !b.language || b.language === 'en').map((b) => ({
        kind: b.type === 'TV' ? 'tv' : 'radio', name: b.name, home: b.homeAway === 'home', national: !!b.isNational,
      }))), final ? { us: us.score, them: them.score, won: !!us.isWinner } : null);
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
// gameType: 1 preseason (kept, flagged pre), 2 regular season, 3 playoffs.
export function normalizeNhl(d, abbrev) {
  return (d.games || [])
    .filter((g) => g.homeTeam?.abbrev === abbrev || g.awayTeam?.abbrev === abbrev)
    .map((g) => {
      const home = g.homeTeam?.abbrev === abbrev;
      const o = (home ? g.awayTeam : g.homeTeam) || {};
      const nick = o.commonName?.default, place = o.placeName?.default;
      const tbd = (g.gameScheduleState || 'OK') !== 'OK';
      const us = home ? g.homeTeam : g.awayTeam, them = home ? g.awayTeam : g.homeTeam;
      const final = /^(OFF|FINAL)$/.test(g.gameState || '') && us?.score != null && them?.score != null;
      const ot = g.gameOutcome?.lastPeriodType; // REG, OT or SO
      return withResult(withWatch({
        date: g.gameDate, time: tbd || !g.startTimeUTC ? null : seattleTime(g.startTimeUTC), tbd, home, ...(g.id ? { id: String(g.id) } : {}), // the gamecenter id, for the game's clips (scripts/highlights.mjs)
        ...(g.gameType === 3 ? { playoff: true } : g.gameType === 1 ? { pre: true } : {}),
        opp: { name: [place, nick].filter(Boolean).join(' ') || o.abbrev, short: nick || o.abbrev, abbrev: o.abbrev,
          logo: o.logo, site: nick ? `https://www.nhl.com/${slugName(nick)}` : undefined },
        venue: g.venue?.default,
      }, (g.tvBroadcasts || []).map((b) => ({ kind: 'tv', name: b.network, home: b.market === 'H', national: b.market === 'N' }))),
      final ? { us: us.score, them: them.score, won: us.score > them.score, ...(ot && ot !== 'REG' ? { ot } : {}) } : null);
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
// season.type: 1 preseason (kept, flagged pre), 2 regular season, 3 postseason.
export function normalizeEspn(d, teamId, keepWeek, forcePre) { // forcePre: the whole list is the preseason (ESPN's ?seasontype=1 call carries no season.type) // keepWeek: the NFL's week and season year, which name nfl.com's game page (scripts/highlights.mjs)
  const out = [];
  for (const e of d.events || []) {
    const c = e.competitions?.[0];
    const us = c?.competitors?.find((t) => String(t.team?.id) === String(teamId));
    if (!c || !us) continue;
    const home = us.homeAway === 'home';
    const o = (c.competitors.find((t) => t !== us) || {}).team || {};
    const detail = c.status?.type?.detail || '';
    const tbd = c.timeValid === false || /\bTB[AD]\b/i.test(detail);
    const them = c.competitors.find((t) => t !== us);
    const score = (t) => { const v = t?.score?.displayValue ?? t?.score?.value ?? t?.score; return v == null || v === '' ? null : Number(v); };
    const final = !!c.status?.type?.completed && score(us) != null && score(them) != null;
    // broadcasts: [{ type: { shortName: 'TV' }, market: { type: 'National' | 'Home' }, media: { shortName } }]
    out.push(withResult(withWatch({
      date: seattleDate(e.date), time: tbd ? null : seattleTime(e.date), tbd, home,
      ...(e.season?.type === 3 ? { playoff: true } : forcePre || e.season?.type === 1 ? { pre: true } : {}),
      ...(keepWeek && e.week?.number != null && e.season?.year ? { week: e.week.number, season: e.season.year } : {}),
      opp: { name: o.displayName, short: o.shortDisplayName || o.displayName, abbrev: o.abbreviation,
        logo: o.logos?.[0]?.href, site: (o.links || []).find((l) => (l.rel || []).includes('clubhouse'))?.href },
      venue: c.venue?.fullName,
    }, (c.broadcasts || []).map((b) => ({
      kind: /radio/i.test(b.type?.shortName || '') ? 'radio' : 'tv', name: b.media?.shortName || b.media?.name,
      home: /home/i.test(b.market?.type || ''), national: /national/i.test(b.market?.type || ''),
    }))), final ? { us: score(us), them: score(them), won: !!us.winner } : null));
  }
  return out;
}
async function espn(sport, league, teamId) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule`;
  const games = normalizeEspn(await getJson(base, true), teamId, sport === 'football');
  if (sport === 'football') { // the NFL's preseason is a season type of its own (the plain call is the regular season): fetched apart, flagged pre
    try {
      const seen = new Set(games.map((g) => g.date));
      for (const g of normalizeEspn(await getJson(base + '?seasontype=1', true), teamId, true, true)) if (!seen.has(g.date)) games.push(g);
      games.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    } catch (e) { console.error(`schedules: ${league} preseason skipped — ${e.message}`); }
  }
  // soccer schedules come in two halves: the plain call is results only,
  // ?fixture=true the matches still to play — take both, de-duped by day
  if (sport === 'soccer') {
    const seen = new Set(games.map((g) => g.date + '|' + g.opp.name));
    for (const g of normalizeEspn(await getJson(base + '?fixture=true', true), teamId)) {
      if (!seen.has(g.date + '|' + g.opp.name)) { seen.add(g.date + '|' + g.opp.name); games.push(g); }
    }
    games.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  }
  return games;
}

// The PWHL publishes through HockeyTech's stat feed (the key and client
// code are the ones thepwhl.com's own pages carry). Seasons are separate
// ids — "2025-26 Regular Season", "2026 Playoffs", preseasons — so the
// newest regular season plus any playoffs after it make the schedule, and a
// new season is picked up the run it appears. Times come with the venue's
// timezone in GameDateISO8601; crests are the league's own at
// assets.leaguestat.com. No broadcast data in the feed.
const PWHL = 'https://lscluster.hockeytech.com/feed/index.php?feed=modulekit&key=446521baf8c38984&fmt=json&client_code=pwhl&lang=en';
const pwhlSlug = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function normalizePwhl(games, teamId, playoff, pre) {
  return (games || []).filter((g) => g.home_team === String(teamId) || g.visiting_team === String(teamId)).map((g) => {
    const home = g.home_team === String(teamId);
    const oid = home ? g.visiting_team : g.home_team;
    const oname = home ? g.visiting_team_name : g.home_team_name;
    const onick = home ? g.visiting_team_nickname : g.home_team_nickname;
    const tbd = g.time_tbd === '1' || g.date_tbd === '1';
    const usG = Number(home ? g.home_goal_count : g.visiting_goal_count), themG = Number(home ? g.visiting_goal_count : g.home_goal_count);
    const final = g.final === '1' && Number.isFinite(usG) && Number.isFinite(themG);
    const ot = /\bSO\b/.test(g.game_status || '') ? 'SO' : /\bOT\b/.test(g.game_status || '') ? 'OT' : null;
    return withResult({
      date: g.date_played, time: tbd || !g.GameDateISO8601 ? null : seattleTime(g.GameDateISO8601), tbd, home,
      ...(playoff ? { playoff: true } : pre ? { pre: true } : {}),
      opp: { name: oname, short: onick || oname, abbrev: home ? g.visiting_team_code : g.home_team_code,
        logo: `https://assets.leaguestat.com/pwhl/logos/${oid}.png`, site: `https://www.thepwhl.com/en/teams/${pwhlSlug(oname)}` },
      venue: String(g.venue_name || '').split('|')[0].trim(),
    }, final ? { us: usG, them: themG, won: usG > themG, ...(ot ? { ot } : {}) } : null);
  });
}
async function pwhl(teamId) {
  const seasons = (await getJson(`${PWHL}&view=seasons`)).SiteKit.Seasons.map((x) => ({ id: Number(x.season_id), name: x.season_name }))
    .sort((a, b) => b.id - a.id);
  const reg = seasons.find((x) => /regular season/i.test(x.name));
  if (!reg) throw new Error('no regular season listed');
  // the playoffs after it, and the preseason of that season or of the next (the same year in the name, or a newer id)
  const runs = [reg, ...seasons.filter((x) => (/playoffs/i.test(x.name) && x.id > reg.id) || (/pre-?season/i.test(x.name) && (x.id > reg.id || x.name.slice(0, 4) === reg.name.slice(0, 4))))];
  const out = [];
  for (const r of runs) {
    const d = await getJson(`${PWHL}&view=schedule&season_id=${r.id}&team_id=${teamId}`);
    out.push(...normalizePwhl(d.SiteKit?.Schedule, teamId, /playoffs/i.test(r.name), /pre-?season/i.test(r.name)));
  }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

// Where each club stands: { record: 'W-L', standing: '3rd in AL West',
// home?: 'W-L' }. ESPN's team endpoint carries a record summary and a
// standing line for every league but the PWHL, whose standings come from
// the same HockeyTech feed as its schedule (PWHL records read RW-OTW-OTL-L).
async function espnForm(sport, league, teamId, name, slug) {
  const [t, news, prev] = await Promise.all([
    getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}`, true).then((d) => d.team || {}),
    clubNews(slug, name, espnNews(sport, league, teamId, name).catch((e) => { console.error(`news: ${league}/${teamId} skipped — ${e.message}`); return []; })),
    espnPrev(sport, league, teamId).catch((e) => { console.error(`prev: ${league}/${teamId} skipped — ${e.message}`); return null; }),
  ]);
  const items = t.record?.items || [];
  const total = items.find((i) => i.type === 'total') || items[0];
  const home = items.find((i) => i.type === 'home');
  return { record: total?.summary, standing: t.standingSummary, ...(home?.summary ? { home: home.summary } : {}), ...(news.length ? { news } : {}), ...(prev ? { prev } : {}) };
}
// ESPN names a season by the year it starts in; hockey and football seasons
// start in the autumn, so from January to June the season in progress is
// last year's number. The previous season is the one before that.
export function seasonStartYear(sport, date = new Date()) {
  const y = date.getFullYear();
  return /^(hockey|football)$/.test(sport) && date.getMonth() < 6 ? y - 1 : y;
}
// Last season's line: { season: '2025' | '2025–26', record, seed?, rank? }.
// The core API's record has the summary and a playoff seed; the soccer
// leagues have no record there, so their standings table gives rank and
// W-L-D instead.
async function espnPrev(sport, league, teamId) {
  const start = seasonStartYear(sport) - 1;
  const season = /^(hockey|football)$/.test(sport) && sport === 'hockey' ? `${start}–${String(start + 1).slice(2)}` : String(start);
  const d = await getJson(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/${start}/types/2/teams/${teamId}/record`, true);
  const total = (d.items || []).find((i) => i.type === 'total') || (d.items || [])[0];
  if (total?.summary) {
    const seed = (total.stats || []).find((x) => x.name === 'playoffSeed')?.value;
    return { season, record: total.summary, ...(seed ? { seed: Number(seed) } : {}) };
  }
  if (sport !== 'soccer') throw new Error('no record');
  const st = await getJson(`https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings?season=${start}`, true);
  const groups = st.children?.length ? st.children.flatMap((c) => c.standings?.entries || []) : (st.standings?.entries || []);
  const e = groups.find((x) => String(x.team?.id) === String(teamId));
  if (!e) throw new Error('not in standings');
  const stat = (n) => (e.stats || []).find((x) => x.name === n)?.value;
  const rank = stat('rank');
  return { season, record: [stat('wins'), stat('losses'), stat('ties')].map((v) => (v == null ? 0 : v)).join('-'), ...(rank ? { rank: Number(rank) } : {}) };
}
// ESPN's news feed tagged with the team: the latest few written pieces
// (stories, recaps, previews, headline news — video clips left out), the
// ones that name the club first, newest first. [{ date, headline, text, url }]
// Eight: the page shows three and folds the rest behind an arrow.
export function pickNews(articles, name, n = 8) {
  const re = new RegExp(String(name || '').split(/\s+/).pop() || '.', 'i');
  return (articles || [])
    .filter((a) => a && a.headline && a.links?.web?.href && !/^(Media|Video)$/i.test(a.type || ''))
    .sort((a, b) => (re.test(b.headline + ' ' + (b.description || '')) - re.test(a.headline + ' ' + (a.description || ''))) || String(b.published || '').localeCompare(String(a.published || '')))
    .slice(0, n)
    .map((a) => ({ date: a.published ? seattleDate(a.published) : '', headline: a.headline, text: a.description || '', url: a.links.web.href, source: 'ESPN', at: a.published || '' }));
}
async function espnNews(sport, league, teamId, name) {
  const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/news?team=${teamId}&limit=12`, true);
  return pickNews(d.articles, name);
}
// The other outlets' feeds — RSS 2.0 (the Seattle Times, MLB.com,
// seahawks.com, Sound Of Hockey, Sounder at Heart) or Atom (SB Nation's
// Lookout Landing and Field Gulls) — read with one tolerant parser: an
// <item> or <entry>; the title and summary CDATA or entity-escaped, tags
// stripped; the link as text or as an href; the date as pubDate or
// published, filed under its Seattle day. [{ date, headline, text, url, source }]
const unent = (x) => String(x || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, c) => String.fromCodePoint(c[0] === 'x' || c[0] === 'X' ? parseInt(c.slice(1), 16) : Number(c)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|hellip|rsquo|lsquo|rdquo|ldquo|ndash|mdash);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' })[e])
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function parseFeed(xml, source, n = 8) {
  const out = [];
  for (const m of String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const it = m[2], tag = (t) => (it.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)) || [])[1];
    const headline = unent(tag('title'));
    const url = unent(tag('link')) || (it.match(/<link[^>]*\shref="([^"]+)"/) || [])[1];
    if (!headline || !url) continue;
    const when = new Date(unent(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')));
    const text = unent(tag('description') || tag('summary') || tag('content:encoded') || tag('content'));
    out.push({ date: isNaN(when) ? '' : seattleDate(when.toISOString()), headline, text: text.length > 240 ? text.slice(0, 237).replace(/\s+\S*$/, '') + '…' : text, url: url.replace(/[?&]utm_[^&#]*/g, '').replace(/\?$/, ''), source, at: isNaN(when) ? '' : when.toISOString() });
  }
  return out.slice(0, n);
}
async function feedNews(url, source) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseFeed(await r.text(), source);
}
// the outlets per club, beside ESPN (seattlesports.com refuses scripts — 403)
const ST = (path) => [`https://www.seattletimes.com/sports/${path}/feed/`, 'Seattle Times'];
const FEEDS = {
  mariners: [ST('mariners'), ['https://www.mlb.com/mariners/feeds/news/rss.xml', 'MLB.com'], ['https://www.lookoutlanding.com/rss/current.xml', 'Lookout Landing']],
  kraken: [ST('kraken'), ['https://soundofhockey.com/feed/', 'Sound Of Hockey'], ['https://www.davyjoneslockerroom.com/rss/current.xml', "Davy Jones' Locker Room"]],
  seahawks: [ST('seahawks'), ['https://www.seahawks.com/rss/news', 'Seahawks.com'], ['https://www.fieldgulls.com/rss/current.xml', 'Field Gulls']],
  storm: [ST('storm')],
  sounders: [ST('sounders'), ['https://www.sounderatheart.com/feed', 'Sounder at Heart']],
  reign: [ST('reign')],
  torrent: [ST('torrent')],
};
// Every source's pieces in one list, newest first by the time of posting
// (`at`, dropped from the output; a tie keeps the order given), each URL
// once, and only the significant ones: a piece has to name the club (the
// nickname, in the headline or the summary) and not be league-wide
// filler — trackers, power rankings, photo galleries, podcasts, charts.
// Eight at most: the page shows what fits beside the game and folds the
// rest behind the arrow.
const FILLER = /^(photos?|video|watch|podcast|listen|gallery)\b|\btracker\b|power rankings|\bchart\b|\bpodcast\b|\bmailbag\b|\bopen thread\b|\bgame thread\b|\bcooler guild\b/i;
export function mergeNews(lists, name, n = 8) {
  const club = new RegExp(String(name || '').split(/\s+/).pop() || '.', 'i');
  const seen = new Set(), all = [];
  for (const a of lists.flat()) {
    const k = a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (seen.has(k) || FILLER.test(a.headline) || !club.test(a.headline + ' ' + (a.text || ''))) continue;
    seen.add(k); all.push(a);
  }
  return all.sort((a, b) => (b.at || b.date).localeCompare(a.at || a.date) || b.date.localeCompare(a.date)).slice(0, n).map(({ at, ...a }) => a);
}
async function clubNews(slug, name, espn) {
  const lists = await Promise.all([espn, ...(FEEDS[slug] || []).map(([url, source]) => feedNews(url, source).catch((e) => { console.error(`news: ${source} (${slug}) skipped — ${e.message}`); return []; }))]);
  return mergeNews(lists, name);
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
async function pwhlForm(teamId) {
  const seasons = (await getJson(`${PWHL}&view=seasons`)).SiteKit.Seasons.map((x) => ({ id: Number(x.season_id), name: x.season_name })).sort((a, b) => b.id - a.id);
  const reg = seasons.find((x) => /regular season/i.test(x.name));
  if (!reg) throw new Error('no regular season listed');
  const rows = (await getJson(`${PWHL}&view=statviewtype&type=standings&stat=conference&season_id=${reg.id}`)).SiteKit?.Statviewtype || [];
  const r = rows.find((x) => String(x.team_id) === String(teamId));
  if (!r) throw new Error('team not in standings');
  const n = Number(r.rank || r.overall_rank);
  const news = await clubNews('torrent', 'Torrent', Promise.resolve([]));
  return { record: [r.regulation_wins, r.non_reg_wins, r.non_reg_losses, r.losses].join('-'), standing: n ? `${ordinal(n)} in the PWHL` : undefined, ...(news.length ? { news } : {}) };
}
// The season's Wikipedia page, whose lead paragraph is the form block's
// summary (CC BY-SA — the site links the page). One page per season:
// "2026 Seattle Mariners season", or "2026–27 Seattle Kraken season" for a
// season that straddles the year end — the years come from the schedule.
// (NFL seasons are titled by the year they start in, though they run into
// January.)
const WIKI = { mariners: 'Seattle Mariners', kraken: 'Seattle Kraken', seahawks: 'Seattle Seahawks', storm: 'Seattle Storm',
  reign: 'Seattle Reign FC', sounders: 'Seattle Sounders FC', torrent: 'Seattle Torrent', seawolves: 'Seattle Seawolves' };
const WIKI_START_YEAR = { seahawks: true };
const WIKI_CLUB = {}; // clubs with no season pages: their own article instead
export function wikiTitle(slug, games) {
  if (WIKI_CLUB[slug]) return WIKI_CLUB[slug];
  if (!WIKI[slug] || !games?.length) return null;
  const y1 = games[0].date.slice(0, 4), y2 = games[games.length - 1].date.slice(0, 4);
  return `${y1 === y2 || WIKI_START_YEAR[slug] ? y1 : `${y1}–${y2.slice(2)}`} ${WIKI[slug]} season`;
}
async function wikiSummary(title) {
  const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.type !== 'standard' || !d.extract) throw new Error(d.type || 'no extract');
  return { title, text: d.extract, url: d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
}

// The Seawolves' news page (Next.js, server-rendered): each post is an
// <a href="/news/…"> holding a tag, "SEP 1, 2026", an <h2> headline and a
// line of summary. The latest eight, newest first.
export function parseSeawolvesNews(html, n = 8) {
  const out = [];
  for (const m of String(html).replace(/<!--\s*-->/g, '').matchAll(/<a href="(\/news\/[^"]+)">([\s\S]*?)<\/a>/g)) {
    const inner = m[2];
    const headline = (inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    const date = (inner.match(/>\s*([A-Z]{3} \d{1,2}, \d{4})\s*</) || [])[1];
    const text = (inner.match(/<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    if (!headline) continue;
    const d = date ? new Date(date.replace(/^(\w{3})/, (x) => x[0] + x.slice(1).toLowerCase()) + ' UTC') : null;
    const clean = (x) => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|’/g, "'").replace(/\s+/g, ' ').trim();
    if (out.some((o) => o.url.endsWith(m[1]))) continue;
    out.push({ date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : '', headline: clean(headline), text: clean(text), url: 'https://www.seawolves.rugby' + m[1], source: 'Seawolves' });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
}
async function seawolvesForm() {
  const r = await fetch('https://www.seawolves.rugby/news', { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const news = parseSeawolvesNews(await r.text());
  return news.length ? { news } : {};
}

export const FORM = [
  { slug: 'mariners', fetch: () => espnForm('baseball', 'mlb', 12, 'Mariners', 'mariners') },
  { slug: 'kraken', fetch: () => espnForm('hockey', 'nhl', 124292, 'Kraken', 'kraken') },
  { slug: 'seahawks', fetch: () => espnForm('football', 'nfl', 26, 'Seahawks', 'seahawks') },
  { slug: 'storm', fetch: () => espnForm('basketball', 'wnba', 14, 'Storm', 'storm') },
  { slug: 'sounders', fetch: () => espnForm('soccer', 'usa.1', 9726, 'Sounders', 'sounders') },
  { slug: 'reign', fetch: () => espnForm('soccer', 'usa.nwsl', 15363, 'Reign', 'reign') },
  { slug: 'torrent', fetch: () => pwhlForm(8) },
  { slug: 'seawolves', fetch: () => seawolvesForm() },
];

// Seattle Seawolves (Major League Rugby, seawolves.rugby): the schedule
// page is server-rendered — an "Upcoming Matches" list of the season's
// fixtures (one card each: Round N, the two clubs' crests with title="…",
// the ground or "Away", "Sat, Mar 28", "4:00 PM PT") and a "Previous
// Matches" list of results ("34 - 43", Win/Loss). The home side's crest
// comes first. Round 0 is the preseason friendly, kept and flagged pre
// like every other league's preseason. The year is the page's heading.
const SEAWOLVES_URL = 'https://www.seawolves.rugby/schedule';
const SEAWOLVES_HOME = 'Starfire Stadium';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// The MLR clubs of 2026 — six — each with its own site and the crest the
// Seawolves' site carries for it; the names the schedule page uses vary
// ("CA Legion" / "California Legion"), so they are matched loosely.
const MLR_CLUBS = [
  { match: /legion/i, name: 'California Legion', short: 'Legion', abbrev: 'CAL', site: 'https://legion.rugby/', logo: 'https://www.seawolves.rugby/images/teams/legions.png' },
  { match: /hounds/i, name: 'Chicago Hounds', short: 'Hounds', abbrev: 'CHI', site: 'https://chicagohounds.com/', logo: 'https://www.seawolves.rugby/images/teams/Hounds.png' },
  { match: /free jacks|freejacks/i, name: 'New England Free Jacks', short: 'Free Jacks', abbrev: 'NE', site: 'https://freejacks.com/', logo: 'https://www.seawolves.rugby/images/teams/freejacks.png' },
  { match: /old glory/i, name: 'Old Glory DC', short: 'Old Glory', abbrev: 'DC', site: 'https://oldglorydc.com/', logo: 'https://www.seawolves.rugby/images/teams/og.png' },
  { match: /anthem/i, name: 'Anthem Rugby Carolina', short: 'Anthem', abbrev: 'ANT', site: 'https://anthemrc.com/', logo: 'https://www.seawolves.rugby/images/teams/anthem.webp' },
];
export function mlrOpp(name, logo) { // the club for a name the schedule page prints, or a best effort for one not on the list
  const c = MLR_CLUBS.find((x) => x.match.test(name || ''));
  if (c) return { name: c.name, short: c.short, abbrev: c.abbrev, logo: logo || c.logo, site: c.site };
  const opp = String(name || '');
  return { name: opp, short: opp.replace(/^(New England|Old Glory|Anthem Rugby|Anthem|Chicago|California|CA|Hartford)\s+/, '') || opp, abbrev: opp.replace(/[^A-Za-z ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(), ...(logo ? { logo } : {}), site: `https://www.majorleague.rugby/teams/${mlrSlug(opp)}` };
}
const mlrSlug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function parseSeawolves(html) {
  const h = String(html).replace(/<!--\s*-->/g, '');
  const year = Number((h.match(/<h1[^>]*>\s*(\d{4})\s*Seawolves/) || [])[1]) || new Date().getFullYear();
  const cards = h.split(/<div class="\s*relative mb-4 p-4 shadow-sm rounded-md[^"]*"/).slice(1);
  // the page carries each section twice (once more for hydration): a card
  // belongs to the nearest heading above it, and fixtures are de-duplicated
  const heads = [...h.matchAll(/(Upcoming|Previous) Matches/g)].map((m) => [m.index, m[1]]);
  const sectionAt = (p) => { let t = 'Upcoming'; for (const [i, k] of heads) { if (i < p) t = k; else break; } return t; };
  const dateOf = (l) => { const m = l.match(/^[A-Z][a-z]{2}, ([A-Z][a-z]{2}) (\d{1,2})$/); if (!m || MONTHS[m[1].toLowerCase()] == null) return null; return `${year}-${String(MONTHS[m[1].toLowerCase()] + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; };
  const timeOf = (l) => { const m = l.match(/^(\d{1,2}):(\d{2}) ([AP])M/); if (!m) return null; let hr = Number(m[1]) % 12; if (m[3] === 'P') hr += 12; return `${String(hr).padStart(2, '0')}:${m[2]}:00`; };
  let pos = 0;
  const games = [], results = {}, played = [];
  for (const c of cards) {
    pos = h.indexOf(c, pos); const previous = sectionAt(pos) === 'Previous';
    const round = Number((c.match(/Round\s*(\d+)/) || [])[1]);
    const teams = [...c.matchAll(/<img title="([^"]+)"/g)].map((m) => m[1].trim());
    const spans = [...c.matchAll(/<(?:span|p)[^>]*>([^<]+)<\/(?:span|p)>/g)].map((m) => m[1].trim()).filter(Boolean);
    const date = spans.map(dateOf).find(Boolean), time = spans.map(timeOf).find(Boolean);
    if (teams.length < 2 || !date) continue;
    const home = /seawolves/i.test(teams[0]);
    const opp = teams.find((t) => !/seawolves/i.test(t)) || '?';
    const venue = spans.find((x) => x !== 'Away' && !/^VS\.?$/i.test(x) && !dateOf(x) && !timeOf(x) && !/^Round/.test(x) && !/^(Win|Loss|Draw)$/.test(x) && !/^\d+ - \d+$/.test(x)) || (home ? SEAWOLVES_HOME : opp);
    if (previous) { // a result: the score reads home - away
      const sc = spans.find((x) => /^\d+ - \d+$/.test(x));
      if (sc) { const [a, b] = sc.split(' - ').map(Number); results[date] = { us: home ? a : b, them: home ? b : a, won: (home ? a : b) > (home ? b : a) }; }
      if (!played.some((p) => p.date === date)) played.push({ date, time: time || null, home, opp, venue, round });
      continue;
    }
    if (games.some((g) => g.date === date && g.opp.name === opp)) continue; // the hydration copy
    games.push({
      date, time: time || null, tbd: !time, home, ...(round === 0 ? { pre: true } : {}),
      opp: mlrOpp(opp, (c.match(/<img title="(?:[^"]+)" src="([^"]+)"[^>]*>\s*<p[^>]*>VS\.<\/p>\s*<img title="[^"]+" src="([^"]+)"/) || [])[home ? 2 : 1]),
      venue,
    });
  }
  // a played match with no fixture in the list (the playoffs are only ever
  // in the results) is a game too, flagged as a playoff when it follows the
  // last listed fixture
  const lastFixture = games.map((g) => g.date).sort().pop() || '';
  played.filter((p) => !games.some((g) => g.date === p.date)).forEach((p) => games.push({
    date: p.date, time: p.time, tbd: !p.time, home: p.home, ...(p.round === 0 ? { pre: true } : p.date > lastFixture ? { playoff: true } : {}),
    opp: mlrOpp(p.opp, p.logo),
    venue: p.venue,
  }));
  games.forEach((g) => { if (results[g.date]) g.res = results[g.date]; });
  games.forEach((g) => { if (g.opp.logo && g.opp.logo.startsWith('/')) g.opp.logo = 'https://www.seawolves.rugby' + g.opp.logo; });
  return games.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
async function seawolves() {
  const r = await fetch(SEAWOLVES_URL, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const games = parseSeawolves(await r.text());
  if (!games.length) throw new Error('no matches parsed');
  return games;
}

export const SOURCES = [
  { slug: 'mariners', fetch: () => mlb(136) },
  { slug: 'kraken', fetch: () => nhl('SEA') },
  { slug: 'seahawks', fetch: () => espn('football', 'nfl', 26) },
  { slug: 'storm', fetch: () => espn('basketball', 'wnba', 14) },
  { slug: 'sounders', fetch: () => espn('soccer', 'usa.1', 9726) },
  { slug: 'reign', fetch: () => espn('soccer', 'usa.nwsl', 15363) },
  { slug: 'torrent', fetch: () => pwhl(8) },
  { slug: 'seawolves', fetch: () => seawolves() },
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
// returns { teams: { mariners: [game, ...], ... }, form: { mariners: {
// record, standing }, ... } } — teams that failed this run left out of
// either map — for site/teams.json.
export async function applySchedules(events) {
  const bySlug = {}, seasons = {}, form = {};
  const [results, forms] = await Promise.all([
    Promise.allSettled(SOURCES.map((s) => s.fetch())),
    Promise.allSettled(FORM.map((s) => s.fetch())),
  ]);
  forms.forEach((r, i) => {
    if (r.status === 'fulfilled' && (r.value.record || r.value.standing || (r.value.news && r.value.news.length))) form[FORM[i].slug] = r.value;
    else console.error(`form: ${FORM[i].slug} skipped — ${r.status === 'rejected' ? (r.reason?.message || r.reason) : 'empty'}`);
  });
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
  await cleanMarks(seasons); // the opponents' crests, served locally without their ™ (scripts/marks.mjs)
  // the recent games' highlight clips (scripts/highlights.mjs); the ones on
  // the published file are carried forward, so the last run's stand in
  let prev = {};
  try { prev = JSON.parse(readFileSync(new URL('../site/teams.json', import.meta.url), 'utf8')).teams || {}; } catch (e) { /* first run */ }
  try { await addClips(seasons, prev); } catch (e) { console.error(`clips: skipped — ${e.message}`); }
  // the season's Wikipedia lead, for every team whose season came through
  const slugs = Object.keys(seasons).filter((k) => wikiTitle(k, seasons[k]));
  const wikis = await Promise.allSettled(slugs.map((k) => wikiSummary(wikiTitle(k, seasons[k])).catch((e) => {
    if (WIKI[k] && !WIKI_CLUB[k]) return wikiSummary(WIKI[k]); // no page for the season yet: the club's own article
    throw e;
  })));
  wikis.forEach((r, i) => {
    if (r.status === 'fulfilled') form[slugs[i]] = { ...(form[slugs[i]] || {}), wiki: r.value };
    else console.error(`wiki: ${slugs[i]} skipped — ${r.reason?.message || r.reason}`);
  });
  const n = applyScheduleFlags(events, bySlug);
  const w = events.filter((e) => e.watch).length;
  console.error(`schedules: flagged ${n} feed event${n === 1 ? '' : 's'} as date TBD, ${w} with broadcasts`);
  return { teams: seasons, form };
}
