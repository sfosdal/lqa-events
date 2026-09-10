import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScheduleFlags, pickBroadcasts, normalizeMlb, normalizeNhl, normalizeEspn } from './schedules.mjs';

const feed = () => [
  { venue: 'Lumen Field', title: 'Seattle Seahawks vs. Dallas Cowboys', date: '2026-12-07', time: '17:15:00' },
  { venue: 'Lumen Field', title: 'Seattle Seahawks vs. Los Angeles Rams', date: '2026-12-25', time: '17:15:00' },
  { venue: 'T-Mobile Park', title: 'Seattle Mariners vs. Athletics', date: '2026-12-07', time: '18:40:00' },
  { venue: 'Climate Pledge Arena', title: 'Tame Impala - The Deadbeat Tour', date: '2026-12-07', time: '19:00:00' },
];

test('a league TBD on the matching home date flags that game only', () => {
  const events = feed();
  const n = applyScheduleFlags(events, { seahawks: [{ date: '2026-12-07', tbd: true }, { date: '2026-12-25', tbd: false }] });
  assert.equal(n, 1);
  assert.equal(events[0].dateTbd, true);
  assert.equal(events[1].dateTbd, undefined);
  assert.equal(events[2].dateTbd, undefined, 'same date, other team');
  assert.equal(events[3].dateTbd, undefined, 'same date, not a game');
});

test('teams with no schedule this run are left alone; an existing flag is kept', () => {
  const events = feed();
  events[1].dateTbd = true;
  const n = applyScheduleFlags(events, { mariners: [{ date: '2026-12-07', tbd: false }] });
  assert.equal(n, 0);
  assert.equal(events[1].dateTbd, true);
  assert.equal(events[2].dateTbd, undefined);
});

test('broadcasts: national first, then the home market; away feeds dropped; names once', () => {
  const w = pickBroadcasts([
    { kind: 'tv', name: 'Rangers Sports Network', home: false, national: false },
    { kind: 'tv', name: 'Mariners.TV', home: true, national: false },
    { kind: 'radio', name: 'Seattle Sports (710 AM)', home: true, national: false },
    { kind: 'tv', name: 'FOX', home: false, national: true },
    { kind: 'tv', name: 'Mariners.TV', home: true, national: false },
    { kind: 'radio', name: '105.3 The Fan', home: false, national: false },
  ]);
  assert.deepEqual(w, { tv: ['FOX', 'Mariners.TV'], radio: ['Seattle Sports (710 AM)'] });
});

test('broadcasts: nothing usable means no watch at all, and a missing kind is left out', () => {
  assert.equal(pickBroadcasts([]), undefined);
  assert.equal(pickBroadcasts([{ kind: 'tv', name: 'NBCSCA', home: false, national: false }]), undefined);
  assert.deepEqual(pickBroadcasts([{ kind: 'tv', name: 'KING 5', home: true, national: false }]), { tv: ['KING 5'] });
});

test('a game\'s broadcasts land on the matching feed event only', () => {
  const events = feed();
  applyScheduleFlags(events, { mariners: [{ date: '2026-12-07', tbd: false, watch: { tv: ['Mariners.TV'], radio: ['Seattle Sports (710 AM)'] } }] });
  assert.deepEqual(events[2].watch, { tv: ['Mariners.TV'], radio: ['Seattle Sports (710 AM)'] });
  assert.equal(events[0].watch, undefined, 'same date, other team');
  assert.equal(events[3].watch, undefined, 'same date, not a game');
});

// ---- the season normalizers: one home and one away game per league ----
test('MLB: home and away games, Seattle times, the opponent\'s crest and club site', () => {
  const sea = { id: 136, name: 'Seattle Mariners', teamName: 'Mariners', abbreviation: 'SEA' };
  const bos = { id: 111, name: 'Boston Red Sox', teamName: 'Red Sox', abbreviation: 'BOS' };
  const games = normalizeMlb({ dates: [
    { date: '2026-09-01', games: [{ gameDate: '2026-09-01T22:45:00Z', officialDate: '2026-09-01', venue: { name: 'Fenway Park' },
      status: { startTimeTBD: false }, teams: { away: { team: sea }, home: { team: bos } } }] },
    { date: '2026-09-11', games: [{ gameDate: '2026-09-12T01:40:00Z', officialDate: '2026-09-11', venue: { name: 'T-Mobile Park' },
      status: { startTimeTBD: true }, teams: { away: { team: bos }, home: { team: sea } },
      broadcasts: [{ type: 'TV', name: 'Mariners.TV', homeAway: 'home', isNational: false, language: 'en' }] }] },
    { date: '2026-09-12', games: [{ gameDate: '2026-09-12T20:00:00Z', officialDate: '2026-09-12', teams: { away: { team: bos }, home: { team: { id: 147 } } } }] },
    { date: '2026-03-01', games: [{ gameDate: '2026-03-01T20:00:00Z', officialDate: '2026-03-01', gameType: 'S', teams: { away: { team: bos }, home: { team: sea } } }] },
    { date: '2026-10-01', games: [{ gameDate: '2026-10-02T02:00:00Z', officialDate: '2026-10-01', gameType: 'F', teams: { away: { team: bos }, home: { team: sea } } }] },
  ] }, 136);
  assert.equal(games.length, 3, 'only our games, spring training left out');
  assert.equal(games[2].playoff, true, 'a wild-card game is a playoff');
  assert.equal(games[0].playoff, undefined);
  assert.deepEqual(games[0], { date: '2026-09-01', time: '15:45:00', tbd: false, home: false, venue: 'Fenway Park',
    opp: { name: 'Boston Red Sox', short: 'Red Sox', abbrev: 'BOS', logo: 'https://www.mlbstatic.com/team-logos/111.svg', site: 'https://www.mlb.com/redsox' } });
  assert.equal(games[1].home, true);
  assert.equal(games[1].date, '2026-09-11', 'the official (local) date, not the UTC one');
  assert.equal(games[1].time, null, 'a TBD start has no time');
  assert.deepEqual(games[1].watch, { tv: ['Mariners.TV'] });
});

test('NHL: home and away, opponent from place + nickname, nhl.com/<nickname>', () => {
  const games = normalizeNhl({ games: [
    { gameDate: '2026-10-08', startTimeUTC: '2026-10-09T02:00:00Z', gameScheduleState: 'OK', venue: { default: 'Rogers Arena' },
      awayTeam: { abbrev: 'SEA', commonName: { default: 'Kraken' }, placeName: { default: 'Seattle' } },
      homeTeam: { abbrev: 'VAN', commonName: { default: 'Canucks' }, placeName: { default: 'Vancouver' }, logo: 'https://assets.nhle.com/logos/nhl/svg/VAN_light.svg' } },
    { gameDate: '2026-10-11', startTimeUTC: '2026-10-12T00:00:00Z', gameScheduleState: 'TBD', venue: { default: 'Climate Pledge Arena' },
      homeTeam: { abbrev: 'SEA' }, awayTeam: { abbrev: 'TOR', commonName: { default: 'Maple Leafs' }, placeName: { default: 'Toronto' } },
      tvBroadcasts: [{ network: 'KING 5', market: 'H' }] },
    { gameDate: '2026-09-25', gameType: 1, startTimeUTC: '2026-09-26T02:00:00Z', homeTeam: { abbrev: 'SEA' }, awayTeam: { abbrev: 'VAN' } },
    { gameDate: '2027-04-20', gameType: 3, startTimeUTC: '2027-04-21T02:00:00Z', homeTeam: { abbrev: 'SEA' }, awayTeam: { abbrev: 'VAN' } },
  ] }, 'SEA');
  assert.equal(games.length, 3, 'preseason left out');
  assert.equal(games[2].playoff, true);
  assert.deepEqual(games[0], { date: '2026-10-08', time: '19:00:00', tbd: false, home: false, venue: 'Rogers Arena',
    opp: { name: 'Vancouver Canucks', short: 'Canucks', abbrev: 'VAN', logo: 'https://assets.nhle.com/logos/nhl/svg/VAN_light.svg', site: 'https://www.nhl.com/canucks' } });
  assert.equal(games[1].home, true);
  assert.equal(games[1].tbd, true);
  assert.equal(games[1].time, null);
  assert.equal(games[1].opp.site, 'https://www.nhl.com/mapleleafs');
  assert.deepEqual(games[1].watch, { tv: ['KING 5'] });
});

test('ESPN: home and away from homeAway, opponent crest + clubhouse link, flexed kickoff is TBD', () => {
  const sea = { id: '26', displayName: 'Seattle Seahawks', shortDisplayName: 'Seahawks', abbreviation: 'SEA' };
  const ne = { id: '17', displayName: 'New England Patriots', shortDisplayName: 'Patriots', abbreviation: 'NE',
    logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png' }],
    links: [{ rel: ['roster', 'desktop'], href: 'https://www.espn.com/nfl/team/roster/_/name/ne' }, { rel: ['clubhouse', 'desktop', 'team'], href: 'https://www.espn.com/nfl/team/_/name/ne/new-england-patriots' }] };
  const games = normalizeEspn({ events: [
    { date: '2026-09-10T00:20Z', competitions: [{ venue: { fullName: 'Lumen Field' }, timeValid: true, status: { type: { detail: 'Wed, September 9th at 8:20 PM EDT' } },
      competitors: [{ homeAway: 'home', team: sea }, { homeAway: 'away', team: ne }] }] },
    { date: '2026-12-20T18:00Z', competitions: [{ venue: { fullName: 'Gillette Stadium' }, timeValid: false, status: { type: { detail: 'TBD' } },
      competitors: [{ homeAway: 'home', team: ne }, { homeAway: 'away', team: sea }] }] },
    { date: '2026-08-10T00:00Z', season: { type: 1 }, competitions: [{ competitors: [{ homeAway: 'home', team: ne }, { homeAway: 'away', team: sea }] }] },
    { date: '2027-01-10T00:00Z', season: { type: 3 }, competitions: [{ competitors: [{ homeAway: 'home', team: ne }, { homeAway: 'away', team: sea }] }] },
  ] }, 26);
  assert.equal(games.length, 3, 'preseason left out');
  assert.equal(games[2].playoff, true);
  assert.deepEqual(games[0], { date: '2026-09-09', time: '17:20:00', tbd: false, home: true, venue: 'Lumen Field',
    opp: { name: 'New England Patriots', short: 'Patriots', abbrev: 'NE', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png', site: 'https://www.espn.com/nfl/team/_/name/ne/new-england-patriots' } });
  assert.equal(games[1].home, false);
  assert.equal(games[1].tbd, true);
  assert.equal(games[1].time, null);
  assert.equal(games[1].venue, 'Gillette Stadium');
});
