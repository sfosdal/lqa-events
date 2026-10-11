// The city — every fact that makes this calendar Lower Queen Anne's rather
// than another town's, in one place (2026-10-10). The browser (filter.js,
// app.js) and the build (scripts/*.mjs) both read it; nothing else names a
// venue or a team. A sister site is this file, its own index.html and
// styles.css, and its own source scrapers — see README "Another city".
//
// Loaded before filter.js (a plain script, so the river site and the tests
// can share it): it sets globalThis.LQACity.
(function (global) {
  'use strict';

  // The home teams, matched on the event title whatever the venue. Order =
  // the Teams strip, left to right (Steve, 2026-09-10; Sounders were not
  // on his list and sit last rather than being dropped). Per team:
  //   re        the title match (Storm and Reign need the fuller name —
  //             bare "storm"/"reign" shows up in concert titles)
  //   venue     the home building; schedule = the club's own schedule page
  //   sport     keys the strip icon (app.js SPORT_ICONS), the game clock,
  //             the leader categories
  //   colors    [primary, accent] — the season calendar's home cells and
  //             card frames
  //   name/abbr the club's full name and scoreboard abbreviation as its
  //             league lists them, for a first paint before teams.json
  //             arrives (the feed's own values take precedence)
  //   espn      the club on ESPN's scoreboard, for the live game block
  //             (the PWHL feed refuses browser requests, so the Torrent
  //             have none)
  //   season    where the build reads the season schedule (schedules.mjs:
  //             mlb, nhl, espn, pwhl, seawolves); form the record/standing
  //   club      the club's name on Ticketmaster, for the away-game
  //             sold-out checks; news the outlets beside ESPN; wiki the
  //             season page; youtube the club's and league's channels;
  //             opens when the season usually starts; division the
  //             rivals a record is kept against
  // Nothing here assumes a club is Seattle's: the Huskies are Washington
  // (WASH), the Seawolves play in Tukwila.
  var ST = function (path) { return ['https://www.seattletimes.com/sports/' + path + '/feed/', 'Seattle Times']; };
  var TEAMS = [
    { slug: 'seahawks', label: 'Seahawks', re: /seahawks/i, sport: 'football', venue: 'Lumen Field', colors: ['#002244', '#69be28'],
      espn: { sport: 'football', league: 'nfl', id: '26' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', schedule: 'https://www.seahawks.com/schedule/',
      club: 'Seattle Seahawks', opens: 'September', wiki: { title: 'Seattle Seahawks', startYear: true },
      news: [ST('seahawks'), ['https://www.seahawks.com/rss/news', 'Seahawks.com'], ['https://www.fieldgulls.com/rss/current.xml', 'Field Gulls']],
      youtube: ['UCzkFCRiMcOBeef8xcaqipmw', 'UCDVYQ4Zhbm3S2dlz7P1GBDg'] }, // @Seahawks, @NFL
    { slug: 'mariners', label: 'Mariners', re: /mariners/i, sport: 'baseball', venue: 'T-Mobile Park', colors: ['#0c2c56', '#005c5c'],
      espn: { sport: 'baseball', league: 'mlb', id: '12' }, season: { kind: 'mlb', id: 136 }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png', schedule: 'https://www.mlb.com/mariners/schedule',
      club: 'Seattle Mariners', opens: 'late March', wiki: { title: 'Seattle Mariners' },
      division: ['HOU', 'LAA', 'ATH', 'TEX'], // AL West, by the abbreviations the schedule carries (ATH since the Athletics left Oakland)
      news: [ST('mariners'), ['https://www.mlb.com/mariners/feeds/news/rss.xml', 'MLB.com'], ['https://www.lookoutlanding.com/rss/current.xml', 'Lookout Landing']],
      youtube: ['UCWWLs-O8JGYYcNea7AgumAA'] }, // @mariners (MLB's clips come from statsapi)
    { slug: 'kraken', label: 'Kraken', re: /kraken/i, sport: 'hockey', venue: 'Climate Pledge Arena', colors: ['#001628', '#99d9d9'],
      espn: { sport: 'hockey', league: 'nhl', id: '124292' }, season: { kind: 'nhl', abbrev: 'SEA' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png', schedule: 'https://www.nhl.com/kraken/schedule',
      club: 'Seattle Kraken', opens: 'early October', wiki: { title: 'Seattle Kraken' },
      news: [ST('kraken'), ['https://soundofhockey.com/feed/', 'Sound Of Hockey'], ['https://www.davyjoneslockerroom.com/rss/current.xml', "Davy Jones' Locker Room"]],
      youtube: ['UCxspiBq2xf5pLjz9_NMjoyw'] }, // @seattlekraken (the NHL's clips come from api-web)
    { slug: 'storm', label: 'Storm', re: /seattle storm/i, sport: 'basketball', venue: 'Climate Pledge Arena', colors: ['#2c5234', '#fee11a'],
      espn: { sport: 'basketball', league: 'wnba', id: '14' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/wnba/500/sea.png', schedule: 'https://storm.wnba.com/schedule/',
      club: 'Seattle Storm', opens: 'May', wiki: { title: 'Seattle Storm' },
      news: [ST('storm')],
      youtube: ['UCv4xLXLA_aElluuaTWXN1jA', 'UCO9a_ryN_l7DIDS-VIt-zmw'] }, // @SeattleStormOfficial, @WNBA
    { slug: 'reign', label: 'Reign', re: /reign fc|seattle reign/i, sport: 'soccer', venue: 'Lumen Field', colors: ['#0a2240', '#c5a05a'],
      espn: { sport: 'soccer', league: 'usa.nwsl', id: '15363' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/15363.png', schedule: 'https://www.reignfc.com/schedule',
      club: 'Seattle Reign', opens: 'March', wiki: { title: 'Seattle Reign FC' },
      news: [ST('reign')],
      youtube: ['UCokzki4ovbASTy0MGok5DpQ', 'UCL4xu08EDu0ZFZsBJUB0chw'] }, // @reignfc, @nwslsoccer
    // PWHL, first season 2025-26. The crest is the league's stat-feed copy;
    // the league site has no per-team schedule URL — the team page holds it.
    { slug: 'torrent', label: 'Torrent', re: /seattle torrent/i, sport: 'hockey', venue: 'Climate Pledge Arena', colors: ['#0b2340', '#3fb6c4'],
      season: { kind: 'pwhl', id: 8 }, form: { kind: 'pwhl', id: 8 },
      logo: 'https://assets.leaguestat.com/pwhl/logos/8.png', schedule: 'https://www.thepwhl.com/en/teams/seattle-torrent',
      club: 'Seattle Torrent', opens: 'late November', wiki: { title: 'Seattle Torrent' },
      news: [ST('torrent')],
      youtube: ['UC3NYPPud40AIuTNrV9uU6Fw', 'UCuocIhnQvPAhk6eOopf0CfA'] }, // @PWHL__Seattle, @thepwhlofficial
    // Seattle Seawolves: Major League Rugby (since 2018), Starfire Stadium in Tukwila; no ESPN coverage
    { slug: 'seawolves', label: 'Seawolves', re: /seawolves/i, sport: 'rugby', venue: 'Starfire Stadium', colors: ['#003057', '#6cbe45'],
      season: { kind: 'seawolves' }, form: { kind: 'seawolves' },
      inject: { name: 'Seattle Seawolves', url: 'https://tickets.seawolves.rugby/events' }, // no ticket feed for Starfire: the home matches enter the listing from the schedule, linked to the club's ticket page
      logo: 'https://www.seawolves.rugby/images/seawolves-logo.png', schedule: 'https://www.seawolves.rugby/schedule',
      club: 'Seattle Seawolves', opens: 'March', wiki: { title: 'Seattle Seawolves' },
      youtube: ['UCPcMc2KfvSO0YGfxzrbzy3w', 'UCIynwDVqRK7KTUy72_kSBhA'] }, // @seattleseawolvesrugby, @USMLR
    // Washington Huskies football (Big Ten), Husky Stadium on Montlake; ESPN's college-football feeds cover them like a pro club
    { slug: 'huskies', label: 'Huskies', name: 'Washington Huskies', abbr: 'WASH', re: /huskies/i, sport: 'football', venue: 'Husky Stadium', colors: ['#4b2e83', '#b7a57a'],
      espn: { sport: 'football', league: 'college-football', id: '264' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      inject: { url: 'https://gohuskies.com/sports/football/tickets' }, // likewise, no ticket feed for Husky Stadium
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/264.png', schedule: 'https://gohuskies.com/sports/football/schedule',
      club: 'Washington Huskies', wiki: { title: 'Washington Huskies football', teamPage: true }, // college seasons are titled "2026 Washington Huskies football team", not "… season"
      news: [ST('uw-husky-football'), ['https://www.uwdawgpound.com/rss/current.xml', 'UW Dawg Pound']] },
    { slug: 'sounders', label: 'Sounders', re: /sounders/i, sport: 'soccer', venue: 'Lumen Field', colors: ['#236192', '#5d9741'],
      espn: { sport: 'soccer', league: 'usa.1', id: '9726' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png', schedule: 'https://www.soundersfc.com/schedule/',
      club: 'Seattle Sounders', opens: 'late February', wiki: { title: 'Seattle Sounders FC' },
      news: [ST('sounders'), ['https://www.sounderatheart.com/feed', 'Sounder at Heart']],
      youtube: ['UCVhbRUhe_hfmgi-UN1gcQzw', 'UCSZbXT5TLLW_i-5W8FZpFsg'] }, // @SoundersFC, @MLS
  ];

  // The venues, one record each — the campus first by size, then the
  // places a bus ride away, then the festivals. Per venue:
  //   capacity how many people the place holds, the one measure of an
  //            event's size the sources agree on (none report attendance
  //            or sell-outs except DICE): the arena's concert
  //            configuration, a theatre's house, a festival's day crowd
  //   area     'town' for the bus rides — the stadiums and the Convention
  //            Center listed for their size, the music rooms downtown, in
  //            SoDo and Belltown for their nights out; absent = campus
  //   festival its rows go in the panel's Festivals group whatever the
  //            area; its days are one series
  //   type     the event type when the title decides nothing (non-game
  //            stadium bookings are shows; SIFF specials are festival
  //            programming; Ticketmaster's own segment comes first)
  //   cssVar   the hue styles.css sets for it (dark block --v-*); color
  //            the same hue as a value, for the series graph; a venue with
  //            neither gets a hue hashed from its name
  //   url      the venue's own events listing — not a ticket vendor
  //   icon     a mark for listings without a team crest: the site's icon
  //            via Google's favicon service where it serves 100px+, the
  //            site's own file where that's sharper, a line-art logo under
  //            site/marks/ for a bar (McCaw Hall only publishes 16px, so
  //            none)
  //   tm       its Ticketmaster Discovery listing (fetch-events.mjs);
  //            soldOut 'tm' = the checker reads the event pages in Chrome,
  //            'ticketweb' = a plain fetch of the TicketWeb pages
  var VENUES = {
    'Climate Pledge Arena': {
      capacity: 18100,
      type: 'concert',
      cssVar: '--v-cpa',
      color: '#4da3f0',
      url: 'https://climatepledgearena.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=climatepledgearena.com&sz=128',
      tm: { id: 'KovZ917Ahkk', match: 'climate pledge', fallbackUrl: 'https://climatepledgearena.com/events/', exclude: /arena tours?|all access pass/i },
      soldOut: 'tm',
    },
    'Seattle Center': {
      capacity: 10000,
      type: 'community',
      cssVar: '--v-seactr',
      color: '#6a72e6',
      url: 'https://www.seattlecenter.com/events/event-calendar',
      icon: 'https://www.seattlecenter.com/Dev/Logos/logobug.png',
    },
    'McCaw Hall': {
      capacity: 2900,
      type: 'arts',
      cssVar: '--v-mccaw',
      color: '#d158a7',
      url: 'https://www.mccawhall.com/events',
    },
    'Seattle Rep': {
      capacity: 850,
      type: 'arts',
      cssVar: '--v-rep',
      color: '#f0827a',
      url: 'https://www.seattlerep.org/plays/calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.seattlerep.org&sz=128',
    },
    MoPOP: {
      capacity: 800,
      type: 'community',
      cssVar: '--v-mopop',
      color: '#e88ad8',
      url: 'https://www.mopop.org/events',
    },
    'Children\'s Theatre': {
      capacity: 480,
      type: 'arts',
      cssVar: '--v-sct',
      color: '#6cc9db',
      url: 'https://www.sct.org/tickets-shows/calendar/',
    },
    'Cornish Playhouse': {
      capacity: 460,
      type: 'arts',
      cssVar: '--v-cornish',
      color: '#3ecf97',
      url: 'https://www.seattlecenter.com/events/event-calendar?cats=173',
      icon: 'https://www.google.com/s2/favicons?domain=www.cornish.edu&sz=128',
    },
    'SIFF Cinema Uptown': {
      capacity: 450,
      type: 'community',
      cssVar: '--v-siff',
      color: '#b596e0',
      url: 'https://www.siff.net/calendar',
      icon: 'https://www.siff.net/images/SIFF_favicon_03.png',
    },
    'Pacific Science Center': {
      capacity: 400,
      type: 'community',
      cssVar: '--v-pacsci',
      color: '#62b8f7',
      url: 'https://pacificsciencecenter.org/events/',
    },
    'The Vera Project': {
      capacity: 300,
      type: 'concert',
      cssVar: '--v-vera',
      color: '#a26be6',
      url: 'https://theveraproject.org/events/',
      icon: 'https://www.google.com/s2/favicons?domain=theveraproject.org&sz=128',
    },
    'On the Boards': {
      capacity: 300,
      type: 'arts',
      cssVar: '--v-otb',
      color: '#e07ae0',
      url: 'https://ontheboards.org/events',
      icon: 'https://www.google.com/s2/favicons?domain=ontheboards.org&sz=128',
    },
    KEXP: {
      capacity: 200,
      type: 'concert',
      cssVar: '--v-kexp',
      color: '#b48cf5',
      url: 'https://www.kexp.org/events/kexp-events/',
    },
    'The Traveling Goat': {
      cssVar: '--v-goat',
      color: '#5fb3a1',
      url: 'https://www.travelinggoatseattle.com/events',
      icon: 'marks/traveling-goat.png',
    },
    'T-Mobile Park': {
      capacity: 47900,
      area: 'town',
      type: 'concert',
      cssVar: '--v-tmobile',
      color: '#8ad8e0',
      url: 'https://www.mlb.com/mariners/ballpark/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.mlb.com&sz=128',
      tm: { id: 'KovZpZAEevAA', match: 't-mobile park', fallbackUrl: 'https://www.mlb.com/mariners', exclude: /ballpark tour|flex membership/i },
      soldOut: 'tm',
    },
    'Lumen Field': {
      capacity: 68700,
      area: 'town',
      type: 'concert',
      cssVar: '--v-lumen',
      color: '#8b8fe8',
      url: 'https://www.lumenfield.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.lumenfield.com&sz=128',
      tm: { id: 'KovZpZAEknnA', match: 'lumen field', fallbackUrl: 'https://www.lumenfield.com/events', exclude: /stadium tour|notification list/i },
      soldOut: 'tm',
    },
    'Husky Stadium': {
      capacity: 70000,
      area: 'town',
      type: 'concert',
      cssVar: '--v-husky',
      color: '#c4a0f0',
      url: 'https://gohuskies.com/sports/football/schedule',
      icon: 'https://www.google.com/s2/favicons?domain=gohuskies.com&sz=128',
    },
    'Convention Center': {
      capacity: 20000,
      area: 'town',
      type: 'expo',
      cssVar: '--v-scc',
      color: '#7fa7cc',
      url: 'https://seattlecc.com/upcoming-events/',
    },
    'Starfire Stadium': {
      capacity: 4500,
      area: 'town',
    },
    'Paramount Theatre': {
      capacity: 2800,
      area: 'town',
      type: 'concert',
      cssVar: '--v-paramount',
      color: '#e39a6e',
      url: 'https://www.stgpresents.org/stg-venues/paramount-theatre/',
      icon: 'https://www.google.com/s2/favicons?domain=www.stgpresents.org&sz=128',
      tm: { id: 'KovZpZAFkvEA', match: 'paramount', fallbackUrl: 'https://www.stgpresents.org/stg-venues/paramount-theatre/', exclude: /theatre tours?/i },
      soldOut: 'tm',
    },
    'Showbox at the Market': {
      capacity: 1150,
      area: 'town',
      type: 'concert',
      cssVar: '--v-showbox',
      color: '#e8c45a',
      url: 'https://www.showboxpresents.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.showboxpresents.com&sz=128',
    },
    'Showbox SoDo': {
      capacity: 1800,
      area: 'town',
      type: 'concert',
      cssVar: '--v-sodo',
      color: '#aab8d6',
      url: 'https://www.showboxpresents.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.showboxpresents.com&sz=128',
    },
    'The Crocodile': {
      capacity: 750,
      area: 'town',
      type: 'concert',
      cssVar: '--v-croc',
      color: '#7ed67f',
      url: 'https://calendar.thecrocodile.com/',
      icon: 'https://www.google.com/s2/favicons?domain=www.thecrocodile.com&sz=128',
      tm: { id: 'KovZpZA1vFtA', match: 'crocodile', fallbackUrl: 'https://calendar.thecrocodile.com/' },
      soldOut: 'ticketweb',
    },
    Bumbershoot: {
      capacity: 25000,
      festival: true,
      cssVar: '--v-bumber',
      color: '#e8a35a',
      url: 'https://bumbershoot.com/schedule',
      icon: 'https://www.google.com/s2/favicons?domain=bumbershoot.com&sz=128',
    },
    'Northwest Folklife': {
      capacity: 50000,
      festival: true,
      cssVar: '--v-folklife',
      color: '#8fc26a',
      url: 'https://www.nwfolklife.org/festival/',
      icon: 'https://www.google.com/s2/favicons?domain=nwfolklife.org&sz=128',
    },
    PrideFest: {
      capacity: 50000,
      festival: true,
      cssVar: '--v-pride',
      color: '#e07bb5',
      url: 'https://www.seattlepridefest.org/schedule',
      icon: 'https://www.google.com/s2/favicons?domain=www.seattlepridefest.org&sz=128',
    },
    'Capitol Hill Block Party': {
      capacity: 30000,
      area: 'town',
      festival: true,
      cssVar: '--v-chbp',
      color: '#a6b85a',
      url: 'https://www.capitolhillblockparty.com/artists',
      icon: 'https://www.google.com/s2/favicons?domain=www.capitolhillblockparty.com&sz=128',
    },
  };

  // The usual view (Steve's pick, 2026-09-10): the big rooms — the arena,
  // the Seattle Center grounds, McCaw Hall and the two stadiums — with
  // Movies off; every other venue starts unchecked (the Convention Center
  // included, for all its size). Seattle Rep is on too: its shows were
  // part of the grounds' calendar until the Rep's own feed took them over
  // (2026-09-15). The campus festivals show by default; the Block Party
  // and the music rooms around town start off like the other bus rides.
  var DEFAULT_ON = ['Climate Pledge Arena', 'Seattle Center', 'McCaw Hall', 'Lumen Field', 'T-Mobile Park', 'Seattle Rep'];
  var DEFAULT_OFF = ['MoPOP', "Children's Theatre", 'Cornish Playhouse', 'SIFF Cinema Uptown', 'Pacific Science Center',
    'The Vera Project', 'On the Boards', 'KEXP', 'Convention Center', 'Starfire Stadium', 'Husky Stadium',
    'Capitol Hill Block Party', 'Paramount Theatre', 'Showbox at the Market', 'Showbox SoDo', 'The Crocodile'];
  // the first default-off venue that saved prefs had to be told about
  // (prefs record `known` since 2026-10-05, with the Block Party)
  var PREFS_KNOWN_FROM = 'Capitol Hill Block Party';

  // Event types: every event lands in exactly one, from its flags, title,
  // then venue. The rows the panel shows, in order; 'community' (grounds
  // events, walks, classes, SIFF specials) has no row since 2026-10-05 —
  // the festivals got rows of their own ("festivals doesn't need to be in
  // event type anymore") — the type still exists on events and in the
  // share code, it just can't be switched. 'movie' survives from the badge
  // era so the saved movies-hidden default and the no-movies feed carry.
  var TYPES = [
    { key: 'concert', label: 'Concerts', title: 'Live music — arena tours to Vera Project shows' },
    { key: 'sports', label: 'Sports', title: 'Pro and college games' },
    { key: 'arts', label: 'Arts & Theater', title: 'Opera, ballet, plays, comedy, dance' },
    { key: 'movie', label: 'Movies', title: 'Film screenings at SIFF Cinema Uptown — unchecked by default' },
    { key: 'expo', label: 'Conventions', title: 'Conventions, conferences, trade and consumer shows — the Convention Center, Exhibition Hall, Fisher Pavilion' },
    { key: 'bar', label: 'Neighborhood', title: 'Trivia, live music, watch parties and specials at neighborhood bars — The Traveling Goat so far' },
  ];
  var MOVIE_VENUE = 'SIFF Cinema Uptown'; // the cinema: a view of only its movies is the "movies" view, not a venue view

  // Share codes (?f=CODE): REGISTRY is every filterable key in a fixed
  // order and a code is a bitmask over it, so the list is APPEND-ONLY —
  // adding an entry adds a bit and every existing code keeps meaning what
  // it meant; removing or reordering one changes every link out there.
  // Nine base-36 digits hold 46 bits (6 → 7 on 2026-09-20 for Starfire and
  // the Seawolves, 7 → 8 on 2026-09-22 for the capacity bands, 8 → 9 on
  // 2026-10-05 when the music rooms took it past 41). A venue the feed
  // turns up that isn't listed here can't be encoded and drops out of the
  // link. Another city starts its own list from scratch.
  var CODE_LENGTH = 9;
  var REGISTRY = [
    ['venue', 'Climate Pledge Arena'], ['venue', 'McCaw Hall'], ['venue', 'Seattle Center'],
    ['venue', 'Cornish Playhouse'], ['venue', 'The Vera Project'], ['venue', 'SIFF Cinema Uptown'],
    ['venue', 'On the Boards'], ['venue', 'T-Mobile Park'], ['venue', 'Lumen Field'],
    ['badge', 'concert'], ['badge', 'sports'], ['badge', 'arts'], ['badge', 'movie'], ['badge', 'community'],
    ['team', 'mariners'], ['team', 'storm'], ['team', 'seahawks'], ['team', 'reign'],
    ['team', 'sounders'], ['team', 'kraken'], ['team', 'torrent'],
    // appended later (the registry is append-only so old share links keep working)
    ['badge', 'expo'], ['venue', 'Convention Center'],
    ['venue', "Children's Theatre"], ['venue', 'MoPOP'], ['venue', 'Pacific Science Center'], ['venue', 'KEXP'],
    ['badge', 'bar'],
    ['venue', 'Husky Stadium'], ['team', 'huskies'],
    ['venue', 'Seattle Rep'],
    ['venue', 'Starfire Stadium'], ['team', 'seawolves'],
    ['cap', 'stadium'], ['cap', 'arena'], ['cap', 'hall'], ['cap', 'room'],
    ['venue', 'Capitol Hill Block Party'], // 2026-10-05, the Block Party (named 'Capitol Hill' for a few hours, never deployed)
    ['venue', 'Bumbershoot'], ['venue', 'Northwest Folklife'], ['venue', 'PrideFest'], // 2026-10-05, the Festivals group
    ['venue', 'Paramount Theatre'], ['venue', 'Showbox at the Market'], ['venue', 'Showbox SoDo'], ['venue', 'The Crocodile'], // 2026-10-05, Around Town's music rooms
  ];

  // The words the page uses for the place
  var WORDS = {
    teamCity: 'Seattle', // the board drops it from the clubs' names ("Seattle Kraken" → Kraken)
    presetDefault: 'The big rooms — ' + DEFAULT_ON.join(', ') + ' — every team and type except Movies',
    presetNeighborhood: 'Just Lower Queen Anne — no stadiums or Convention Center',
    presetBig: 'Only the places that hold 2,000 or more — the stadiums, the arena, McCaw Hall',
    phrases: { all: 'Showing everything.', none: 'Showing nothing yet — open Filter and pick some venues.', neighborhood: 'Showing the neighborhood only, no stadiums.', big: 'Showing the big rooms only — the arena, the stadiums, McCaw Hall.' },
  };

  global.LQACity = {
    key: 'lqa',
    name: 'Lower Queen Anne',
    site: 'https://lqa.here.events/',
    userAgent: 'Mozilla/5.0 (compatible; lqa-events/1.0; +https://lqa.here.events/)',
    // the calendar feed's header; the UID domain and PRODID never change
    // (changing them re-creates every event in subscribers' calendars)
    ics: { name: 'Lower Queen Anne Events', short: 'LQA Events', teams: 'Seattle home teams — every season', prodid: '-//fosdal.net//lqa-events//EN', uidDomain: 'fosdal.net',
      desc: 'Upcoming events around Seattle Center — Climate Pledge Arena\\, McCaw Hall\\, Seattle Center' },
    teams: TEAMS,
    venues: VENUES,
    defaultOn: DEFAULT_ON,
    defaultOff: DEFAULT_OFF,
    prefsKnownFrom: PREFS_KNOWN_FROM,
    types: TYPES,
    movieVenue: MOVIE_VENUE,
    groundsVenue: 'Seattle Center', // where the sweep's unnamed sub-spots (lawns, courtyards, stages) are filed
    codeLength: CODE_LENGTH,
    registry: REGISTRY,
    words: WORDS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
