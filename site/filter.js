// LQA Events — shared filter/classification logic.
//
// Single source of truth for "does this event survive the filter", used by
// the main calendar (app.js) and by other sites that render a filtered
// slice of the feed (e.g. the river site's Neighborhood section). Keeping
// this in one file means a change to team regexes or event-type rules can't
// silently drift between the sites that consume it.
//
// Filter state shape: { venueMode, badgeMode, teamMode } — each a map of
// key -> 'ex' for excluded; a key absent from the map means included. Venue
// keys are the raw venue name as it appears in events.json (e.g. "The Vera
// Project"); badge keys are the TYPE_LIST keys (concert/sports/arts/movie/
// community); team keys are TEAMS[].slug.
(function (global) {
  'use strict';

  // Local pro teams — matched on the title no matter what the venue.
  // Mirrors TEAMS in scripts/badges.mjs. venue = the team's home building;
  // schedule = the team's own schedule page (a game's link still goes to
  // wherever its tickets are sold).
  // Order = the Teams strip, left to right (Steve, 2026-09-10); Sounders
  // were not on his list and sit last rather than being dropped. sport keys
  // the little icon after the name in the strip (app.js SPORT_ICONS); colors =
  // [primary, accent] — the season calendar's home cells and card frames;
  // espn = the club on ESPN's scoreboard, for the live game block (the PWHL
  // feed refuses browser requests, so the Torrent have none).
  var TEAMS = [
    { slug: 'seahawks', espn: { sport: 'football', league: 'nfl', id: '26' }, colors: ['#002244', '#69be28'], sport: 'football', label: 'Seahawks', re: /seahawks/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', schedule: 'https://www.seahawks.com/schedule/' },
    { slug: 'mariners', espn: { sport: 'baseball', league: 'mlb', id: '12' }, colors: ['#0c2c56', '#005c5c'], sport: 'baseball', label: 'Mariners', re: /mariners/i, venue: 'T-Mobile Park', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png', schedule: 'https://www.mlb.com/mariners/schedule' },
    { slug: 'kraken', espn: { sport: 'hockey', league: 'nhl', id: '124292' }, colors: ['#001628', '#99d9d9'], sport: 'hockey', label: 'Kraken', re: /kraken/i, venue: 'Climate Pledge Arena', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png', schedule: 'https://www.nhl.com/kraken/schedule' },
    { slug: 'storm', espn: { sport: 'basketball', league: 'wnba', id: '14' }, colors: ['#2c5234', '#fee11a'], sport: 'basketball', label: 'Storm', re: /seattle storm/i, venue: 'Climate Pledge Arena', logo: 'https://a.espncdn.com/i/teamlogos/wnba/500/sea.png', schedule: 'https://storm.wnba.com/schedule/' },
    { slug: 'reign', espn: { sport: 'soccer', league: 'usa.nwsl', id: '15363' }, colors: ['#0a2240', '#c5a05a'], sport: 'soccer', label: 'Reign', re: /reign fc|seattle reign/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/15363.png', schedule: 'https://www.reignfc.com/schedule' },
    // PWHL, first season 2025-26. The crest is the league's stat-feed copy;
    // the league site has no per-team schedule URL — the team page holds it.
    { slug: 'torrent', colors: ['#0b2340', '#3fb6c4'], sport: 'hockey', label: 'Torrent', re: /seattle torrent/i, venue: 'Climate Pledge Arena', logo: 'https://assets.leaguestat.com/pwhl/logos/8.png', schedule: 'https://www.thepwhl.com/en/teams/seattle-torrent' },
    // Seattle Seawolves: Major League Rugby (since 2018), Starfire Stadium in Tukwila; no ESPN coverage
    { slug: 'seawolves', colors: ['#003057', '#6cbe45'], sport: 'rugby', label: 'Seawolves', re: /seawolves/i, venue: 'Starfire Stadium', logo: 'https://www.seawolves.rugby/images/seawolves-logo.png', schedule: 'https://www.seawolves.rugby/schedule' },
    { slug: 'sounders', espn: { sport: 'soccer', league: 'usa.1', id: '9726' }, colors: ['#236192', '#5d9741'], sport: 'soccer', label: 'Sounders', re: /sounders/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png', schedule: 'https://www.soundersfc.com/schedule/' },
  ];
  var TEAM_BY_SLUG = {};
  TEAMS.forEach(function (t) { TEAM_BY_SLUG[t.slug] = t; });

  var TYPE_VENUE_DEFAULT = {
    'Climate Pledge Arena': 'concert', 'The Vera Project': 'concert',
    'T-Mobile Park': 'concert', 'Lumen Field': 'concert', // non-game stadium bookings are shows
    'McCaw Hall': 'arts', 'Cornish Playhouse': 'arts', 'On the Boards': 'arts',
    'Seattle Center': 'community', 'SIFF Cinema Uptown': 'community', // SIFF specials = festival programming
    'Convention Center': 'expo',
    "Children's Theatre": 'arts', 'MoPOP': 'community', 'Pacific Science Center': 'community', 'KEXP': 'concert',
  };
  var TYPE_KEYS_OK = { concert: 1, sports: 1, arts: 1, movie: 1, community: 1, expo: 1, bar: 1 };
  // Order: the movie flag and a home team / "vs" are certain. Then the
  // source's own classification (feed `type`: Ticketmaster segment, DICE
  // type tags, Seattle Center facility/type tags — scripts/sources.mjs),
  // except that a source's "community" is coarse (Seattle Center tags all
  // of Winterfest "Festivals", movie nights and comedy included), so a
  // concrete movie/arts word in the title beats it. Then title rules, then
  // what the venue usually hosts.
  function eventType(e) {
    var title = e.title || '';
    if (e.type === 'bar') return 'bar'; // a bar's night is a bar night, trivia or watch party or band
    if (e.movie) return 'movie';
    if (TEAMS.some(function (t) { return t.re.test(title); }) || /\bvs\.?\s/i.test(title)) return 'sports';
    var src = e.type && TYPE_KEYS_OK[e.type] ? e.type : '';
    if (src && src !== 'community') return src;
    if (/movie night|\bfilm\b|screening/i.test(title)) return 'movie';
    if (/ballet|opera|symphon|orchestra|philharmon|theatre|theater|musical|broadway|shakespeare|comedy|stand-?up|improv|dance|cirque|on ice|preview performance|opening night|matinee|open caption|sensory-friendly|audio described/i.test(title)) return 'arts';
    if (src) return src;
    if (/convention|\bexpo\b|\bcon\b|trade ?show|home show|boat show|card show|record show|book fair|gem & jewelry|bridal|craft (fair|show|uprising)|comic ?con/i.test(title)) return 'expo';
    if (/workshop|\bclass(es)?\b|intro to|open session|\b[A-Z]{2}\s?\d{3}:|festival|fest[aá]l|\bfair\b|\bexpo\b|market|convention|summit|celebration|ceremony|\bwalk\b|\brun\b|parade/i.test(title)) return 'community';
    if (/concert|\btour\b|live music|\bdj\b|\blive\b/i.test(title)) return 'concert';
    return TYPE_VENUE_DEFAULT[e.venue] || 'community';
  }

  // Venue marks for listings without a team crest: the venue's site icon,
  // via Google's favicon service where it serves a 100px+ version and the
  // site's own file where that's sharper. McCaw Hall only publishes 16px,
  // so it has none.
  function favicon(domain) { return 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=128'; }
  var VENUE_ICON = {
    'Climate Pledge Arena': favicon('climatepledgearena.com'),
    'Seattle Center': 'https://www.seattlecenter.com/Dev/Logos/logobug.png',
    'Cornish Playhouse': favicon('www.cornish.edu'),
    'The Vera Project': favicon('theveraproject.org'),
    'SIFF Cinema Uptown': 'https://www.siff.net/images/SIFF_favicon_03.png',
    'On the Boards': favicon('ontheboards.org'),
    'T-Mobile Park': favicon('www.mlb.com'),
    'Lumen Field': favicon('www.lumenfield.com'),
    // local bars: the bar's logo reduced to line art (scripts/make-mark.py),
    // shown on its agenda rows like a team crest — a path under site/
    'The Traveling Goat': 'marks/traveling-goat.png',
  };
  // Venue hues for dark backgrounds — the same values the calendar's
  // styles.css dark block sets as --v-* variables; keep the two in step.
  var VENUE_COLOR = {
    'Cornish Playhouse': '#3ecf97', 'Climate Pledge Arena': '#4da3f0', 'T-Mobile Park': '#8ad8e0',
    'Seattle Center': '#6a72e6', 'Lumen Field': '#8b8fe8', 'SIFF Cinema Uptown': '#b596e0',
    'The Vera Project': '#a26be6', 'On the Boards': '#e07ae0', 'McCaw Hall': '#d158a7',
    'Convention Center': '#7fa7cc',
    "Children's Theatre": '#6cc9db', 'MoPOP': '#e88ad8', 'Pacific Science Center': '#62b8f7', 'KEXP': '#b48cf5',
    'The Traveling Goat': '#5fb3a1', // bars: a muted sea-green, off the fallback hash's neon
  };

  // How many people each place holds — the one measure of an event's size
  // the sources agree on (none of them report attendance or sell-outs
  // except DICE). Round figures: the arena's concert configuration, the
  // ballpark and stadium's seating, a theatre's house, the Convention
  // Center's two buildings as a big show fills them, Seattle Center as its
  // biggest grounds festival.
  var VENUE_CAPACITY = {
    'Lumen Field': 68700, 'T-Mobile Park': 47900, 'Convention Center': 20000,
    'Climate Pledge Arena': 18100, 'Seattle Center': 10000, 'McCaw Hall': 2900,
    'MoPOP': 800, "Children's Theatre": 480, 'Cornish Playhouse': 460, 'SIFF Cinema Uptown': 450,
    'Pacific Science Center': 400, 'The Vera Project': 300, 'On the Boards': 300, 'KEXP': 200,
  };

  // The campus venues walk a crowd past Lower Queen Anne; these three are a
  // bus ride away and listed for their size (a venue missing here is campus).
  var VENUE_AREA = { 'T-Mobile Park': 'town', 'Lumen Field': 'town', 'Convention Center': 'town', 'Starfire Stadium': 'town' };

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Purely subtractive: everything shows until unchecked. An unchecked venue
  // drops its events, an unchecked team drops its home games, and an
  // unchecked type drops every event inferred into it.
  function matchesFilter(e, mode) {
    mode = mode || {};
    var venueMode = mode.venueMode || {};
    var badgeMode = mode.badgeMode || {};
    var teamMode = mode.teamMode || {};
    if (venueMode[e.venue] === 'ex') return false;
    if (badgeMode[eventType(e)] === 'ex') return false;
    var title = e.title || '';
    for (var slug in teamMode) {
      if (teamMode[slug] === 'ex' && TEAM_BY_SLUG[slug] && TEAM_BY_SLUG[slug].re.test(title)) return false;
    }
    return true;
  }

  // Compact filter code <-> filter state, for share links (?f=CODE).
  // REGISTRY is every filterable key in a fixed order; the code is the set of
  // EXCLUDED entries as a bitmask written in upper-case base 36, zero-padded
  // to CODE_LENGTH characters ("000000" means everything shown); parsing
  // accepts either case. Append-only:
  // adding an entry adds a bit and every existing code keeps meaning what it
  // meant. Six base-36 digits hold 31 bits, so the registry can grow to 31
  // entries before CODE_LENGTH needs a bump (old, shorter codes still parse).
  // A venue the feed turns up that isn't listed here can't be encoded and
  // drops out of the link.
  var CODE_LENGTH = 6;
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
  ];
  var GROUP_MAP = { venue: 'venueMode', badge: 'badgeMode', team: 'teamMode' };
  function encodeFilterCode(mode) {
    var mask = 0;
    REGISTRY.forEach(function (entry, i) {
      var map = mode[GROUP_MAP[entry[0]]] || {};
      if (map[entry[1]] === 'ex') mask += Math.pow(2, i);
    });
    var code = mask.toString(36).toUpperCase();
    while (code.length < CODE_LENGTH) code = '0' + code;
    return code;
  }
  function parseFilterCode(code) {
    var mode = { venueMode: {}, badgeMode: {}, teamMode: {} };
    var mask = parseInt(code, 36);
    if (isNaN(mask) || mask < 0) return null;
    REGISTRY.forEach(function (entry, i) {
      if (Math.floor(mask / Math.pow(2, i)) % 2 === 1) mode[GROUP_MAP[entry[0]]][entry[1]] = 'ex';
    });
    return mode;
  }

  // ---- search ----
  // Every whitespace-separated word must appear somewhere in the event's
  // venue, title, type words, or the home team's name — so "kraken",
  // "climate", "arts", "home game" and "vera concert" all do the obvious.
  var TYPE_WORDS = {
    concert: 'concert concerts music show', sports: 'sports game games home game',
    arts: 'arts art theater theatre', movie: 'movie movies film cinema',
    community: 'community festival festivals fair',
    expo: 'expo expos convention conventions conference trade show',
    bar: 'bar bars pub nightlife trivia karaoke happy hour watch party',
  };
  // each team's sport and league, so "baseball" finds the Mariners
  var SPORT_WORDS = {
    mariners: 'baseball mlb', storm: 'basketball wnba', seahawks: 'football nfl',
    reign: 'soccer nwsl', sounders: 'soccer mls', kraken: 'hockey nhl', torrent: 'hockey pwhl',
  };
  function matchesSearch(e, q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var title = e.title || '';
    var hay = [e.venue || '', title, TYPE_WORDS[eventType(e)] || ''];
    TEAMS.forEach(function (t) {
      if (t.re.test(title)) hay.push(t.label + ' home game ' + (SPORT_WORDS[t.slug] || ''));
    });
    hay = hay.join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }
  // The search term travels in share links as ?s=CODE: UTF-8 bytes, each
  // XOR-ed with a rolling key, in URL-safe base64 — unreadable in the URL bar
  // but fully reversible, so the link opens with the same search applied.
  var S_KEY = [0x4c, 0x51, 0x41, 0x21, 0x37, 0x6b];
  function encodeSearch(q) {
    var bytes = unescape(encodeURIComponent(String(q || '')));
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes.charCodeAt(i) ^ S_KEY[i % S_KEY.length]);
    return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeSearch(code) {
    try {
      var bytes = atob(String(code || '').replace(/-/g, '+').replace(/_/g, '/'));
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes.charCodeAt(i) ^ S_KEY[i % S_KEY.length]);
      return decodeURIComponent(escape(out));
    } catch (e) { return ''; }
  }

  // Event-type hues for dark backgrounds — same values as the calendar's
  // dark --t-* variables; keep in step.
  var TYPE_COLOR = { concert: '#f0806a', sports: '#f2d21b', arts: '#d63a4f', movie: '#8b9db0', community: '#e660a8', expo: '#4fd1c5', bar: '#e3ad3c' };

  // ---- series: the same event on nearby days — a homestand, a two-night
  // stand, an opera run. Same venue + same title, occurrences within 2 days
  // of each other. Movies sit this out: SIFF's daily showtimes would make
  // everything a series. Returns the series (sorted by start, with ids) and
  // stamps each member event with e.series = { s, n, total }.
  // s.lane says whether the gutter graph draws it: a run that is on day
  // after day for longer than a week (a theatre run, a seasonal village —
  // dark Mondays included, "day after day" is at least 4 dates in 7) is
  // wallpaper, not something a reader traces, and only clutters the
  // gutter; its "n of N" label under the time still says it's a run. ----
  function parseYmd(s) { var p = String(s).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function seriesKey(e) { return e.venue + '|' + String(e.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function seriesLabel(s) {
    var f = function (d) { return parseYmd(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
    return s.events[0].title + ' — ' + s.events.length + ' ' + (eventType(s.events[0]) === 'sports' ? 'games' : 'nights') + ' · ' + f(s.start) + ' – ' + f(s.end);
  }
  function findSeries(list) {
    var groups = {};
    list.forEach(function (e) {
      delete e.series;
      if (e.movie) return;
      var k = seriesKey(e);
      (groups[k] = groups[k] || []).push(e);
    });
    var all = [];
    var flush = function (run) {
      if (run.length < 2) return;
      var s = { venue: run[0].venue, start: run[0].date, end: run[run.length - 1].date, events: run };
      var span = Math.round((parseYmd(s.end) - parseYmd(s.start)) / 86400e3); // days between first and last
      var daily = run.length / (span + 1) >= 4 / 7;
      s.lane = !(daily && span >= 7);
      run.forEach(function (e, i) { e.series = { s: s, n: i + 1, total: run.length }; });
      all.push(s);
    };
    Object.keys(groups).forEach(function (k) {
      var evs = groups[k].sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
      var run = [evs[0]];
      for (var i = 1; i < evs.length; i++) {
        var gap = Math.round((parseYmd(evs[i].date) - parseYmd(evs[i - 1].date)) / 86400e3);
        // a run's dates are consecutive or every other day; a class that
        // meets weekly or Wed/Sat (3–4 apart) must not chain into one
        if (gap <= 2) run.push(evs[i]); else { flush(run); run = [evs[i]]; }
      }
      flush(run);
    });
    all.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    all.forEach(function (s, i) { s.id = i; });
    return all;
  }

  // Lanes are assigned on row order, not pixels, so the gutter can be
  // sized before anything is measured: each series takes the first free
  // lane whose last series ended above it. With maxLanes, anything that
  // would need a lane past the cap is merged into the last lane instead
  // (it.merged), and the graph draws that lane as one shared trunk with
  // each series' own coloured branches into its cards, git-client style.
  // items: [{ from, to, ... }] sorted by from; returns laneEnd (its length
  // is the lane count) and sets it.lane / it.merged on each.
  function assignLanes(items, maxLanes) {
    var laneEnd = [];
    var cap = maxLanes > 0 ? maxLanes : Infinity;
    items.forEach(function (it) {
      for (var l = 0; ; l++) {
        if (l >= cap) { it.lane = cap - 1; it.merged = true; laneEnd[it.lane] = Math.max(laneEnd[it.lane], it.to); break; }
        if (laneEnd[l] == null || laneEnd[l] < it.from) { laneEnd[l] = it.to; it.lane = l; break; }
      }
    });
    return laneEnd;
  }

  // The series graph: a vertical line per series in a gutter to the right
  // of the rows, git-client style; at each of its rows the lane swings over
  // to touch the row's right edge and swings back (an incoming curve from
  // above and its mirror below). The first row of a series has only the
  // outgoing half, the last only the incoming; the lane runs off the top or
  // bottom edge when the series continues on another page.
  //   container: positioned element the rows sit in (gets the <svg>)
  //   rows: [{ el, series }] in document order, only rows in a series
  //   opts: firstDate/lastDate of the page, laneWidth (px), bend (px),
  //         dot (px radius; 0 or unset for none) drawn where the line meets
  //         each row, onLanes(n) called before measuring so the caller can
  //         size its gutter, gutterX(containerBox) → x of the first lane's
  //         left edge relative to the container, color(series), label(series)
  // Returns the number of lanes used.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function drawSeriesGraph(container, rows, opts) {
    var old = container.querySelector('.series-graph');
    if (old) old.remove();
    var byId = {};
    rows.forEach(function (r, i) {
      var k = r.series.id;
      if (!byId[k]) byId[k] = { s: r.series, els: [], idx: [] };
      byId[k].els.push(r.el); byId[k].idx.push(i);
    });
    // lanes are assigned on row order, not pixels, so the gutter can be
    // sized before anything is measured: the first free lane whose last
    // series ended above this one
    var items = Object.keys(byId).map(function (k) {
      var it = byId[k], s = it.s;
      it.before = s.start < opts.firstDate; it.after = s.end > opts.lastDate;
      it.from = it.before ? -1 : it.idx[0]; it.to = it.after ? rows.length : it.idx[it.idx.length - 1];
      return it;
    }).sort(function (a, b) { return a.from - b.from; });
    var laneEnd = assignLanes(items, opts.maxLanes);
    if (opts.onLanes) opts.onLanes(laneEnd.length);
    if (!items.length) return 0;
    var box = container.getBoundingClientRect(); // after the caller sized its gutter
    var gx = typeof opts.gutterX === 'function' ? opts.gutterX(box) : opts.gutterX;
    var laneW = opts.laneWidth, b = opts.bend || 24, h = opts.hug || 0;
    var top = h + b, bot = h + b; // a join's reach above and below the row's centre
    var f = function (v) { return Math.round(v * 10) / 10; };
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'series-graph');
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    svg.setAttribute('aria-hidden', 'true');
    var defs = null;
    var trunk = {}; // lane -> [[top, bottom], ...] the stretch of the lane each merged-lane series occupies
    var merged = {};
    items.forEach(function (it) { if (it.merged) merged[it.lane] = true; });
    items.forEach(function (it, idx) {
      var pts = it.els.map(function (el) { var r = el.getBoundingClientRect(); return { x: r.right - box.left - 1, y: r.top + r.height / 2 - box.top }; });
      var x = f(gx + it.lane * laneW + laneW / 2);
      var n = pts.length;
      // one continuous path per series, top to bottom: the pen starts at
      // the page edge (or the first row's edge), and for each row runs the
      // straight lane down to the row's entry, curves in, and curves back out.
      // A series whose earlier dates aren't listed (they're in the past)
      // arrives as a lead that fades in, 0% at the top of the first listed
      // row's day group → 100% at the curve into the row, so it reads as
      // "continues from earlier" without dead-ending against anything.
      var d = '';
      if (it.before) {
        var leadEnd = f(pts[0].y - top);
        var group = it.els[0].closest(opts.groupSelector || '.day-row');
        var leadStart = group ? f(Math.max(0, group.getBoundingClientRect().top - box.top)) : 0;
        if (leadEnd > leadStart) {
          if (!defs) { defs = document.createElementNS(SVG_NS, 'defs'); svg.appendChild(defs); }
          var gid = 'sg-fade-' + idx + '-' + Math.round(Math.random() * 1e6);
          var grad = document.createElementNS(SVG_NS, 'linearGradient');
          grad.setAttribute('id', gid);
          grad.setAttribute('gradientUnits', 'userSpaceOnUse');
          grad.setAttribute('x1', 0); grad.setAttribute('x2', 0);
          grad.setAttribute('y1', leadStart); grad.setAttribute('y2', leadEnd);
          [[0, 0], [1, 1]].forEach(function (s) {
            var stop = document.createElementNS(SVG_NS, 'stop');
            stop.setAttribute('offset', s[0]);
            stop.style.stopColor = opts.color(it.s); // a style, so a CSS var works
            stop.setAttribute('stop-opacity', s[1]);
            grad.appendChild(stop);
          });
          defs.appendChild(grad);
          var lead = document.createElementNS(SVG_NS, 'path');
          lead.setAttribute('class', 'sg-line');
          lead.setAttribute('d', 'M' + x + ' ' + leadStart + ' L' + x + ' ' + leadEnd);
          lead.style.stroke = 'url(#' + gid + ')';
          svg.appendChild(lead);
        }
        d = 'M' + x + ' ' + Math.max(leadStart, leadEnd);
      }
      // Each join is a merge, not a hairpin: an S-curve from the lane that
      // arrives running along the card's edge, a short straight hug of the
      // edge either side of the row's centre, and an S-curve back out — so
      // the tangent is the edge's own at the join and nothing kinks.
      pts.forEach(function (p, i) {
        var starts = i === 0 && !it.before, ends = i === n - 1 && !it.after;
        var px = f(p.x), py = f(p.y);
        var hi = f(py - h), lo = f(py + h);
        if (starts) d += 'M' + px + ' ' + py + ' L' + px + ' ' + lo;
        else d += ' L' + x + ' ' + f(py - top) + ' C' + x + ' ' + f(py - h - b / 2) + ' ' + px + ' ' + f(py - h - b / 2) + ' ' + px + ' ' + hi
          + ' L' + px + ' ' + (ends ? py : lo);
        if (!ends) d += ' C' + px + ' ' + f(py + h + b / 2) + ' ' + x + ' ' + f(py + h + b / 2) + ' ' + x + ' ' + f(py + bot);
      });
      if (it.after) d += ' L' + x + ' ' + f(box.height);
      if (d.indexOf('C') < 0 && d.indexOf('L') < 0) return; // a lone row with nothing to connect
      if (merged[it.lane]) { // where this series runs along the lane: from its first curve out to its last curve in
        var t0 = it.before ? 0 : pts[0].y + bot, t1 = it.after ? box.height : pts[n - 1].y - top;
        if (t1 > t0) (trunk[it.lane] = trunk[it.lane] || []).push([t0, t1]);
      }
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'sg-line');
      path.setAttribute('d', d);
      path.style.stroke = opts.color(it.s);
      // with an edge colour, the stroke fades across the bend from the lane's
      // colour to the card's own, so at the join it dissolves into the card
      if (opts.edgeColor) {
        if (!defs) { defs = document.createElementNS(SVG_NS, 'defs'); svg.appendChild(defs); }
        var eid = 'sg-edge-' + idx + '-' + Math.round(Math.random() * 1e6);
        var eg = document.createElementNS(SVG_NS, 'linearGradient');
        eg.setAttribute('id', eid);
        eg.setAttribute('gradientUnits', 'userSpaceOnUse');
        eg.setAttribute('x1', f(pts[0].x)); eg.setAttribute('x2', x); eg.setAttribute('y1', 0); eg.setAttribute('y2', 0);
        [[0, opts.edgeColor(it.s)], [1, opts.color(it.s)]].forEach(function (st) {
          var stop = document.createElementNS(SVG_NS, 'stop');
          stop.setAttribute('offset', st[0]);
          stop.style.stopColor = st[1];
          eg.appendChild(stop);
        });
        defs.appendChild(eg);
        path.style.stroke = 'url(#' + eid + ')';
      }
      if (opts.label) {
        var tip = document.createElementNS(SVG_NS, 'title');
        tip.textContent = opts.label(it.s);
        path.appendChild(tip);
      }
      svg.appendChild(path);
    });
    // merged lanes: where two or more series run along the lane at once, a
    // neutral trunk is drawn over their verticals so the stretch reads as
    // shared; a series alone in the lane keeps its colour, and only the
    // branches into the cards are ever coloured on a shared stretch
    Object.keys(trunk).forEach(function (l) {
      var x = f(gx + Number(l) * laneW + laneW / 2);
      var edges = [];
      trunk[l].forEach(function (iv) { edges.push([iv[0], 1]); edges.push([iv[1], -1]); });
      edges.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; }); // a start before an end at the same y
      var depth = 0, from = null;
      edges.forEach(function (e) {
        var was = depth; depth += e[1];
        if (was < 2 && depth >= 2) from = e[0];
        else if (was >= 2 && depth < 2 && from != null) {
          var t = document.createElementNS(SVG_NS, 'path');
          t.setAttribute('class', 'sg-line sg-trunk');
          t.setAttribute('d', 'M' + x + ' ' + f(from) + ' L' + x + ' ' + f(e[0]));
          svg.appendChild(t);
          from = null;
        }
      });
    });
    container.appendChild(svg);
    return laneEnd.length;
  }

  // Which page numbers a pager shows: always the first, last and current,
  // then the current's neighbors outward until the slots run out (a …
  // between non-adjacent numbers takes a slot too).
  function pagesToShow(total, page, slots) {
    var i, all = [];
    if (total <= slots) { for (i = 0; i < total; i++) all.push(i); return all; }
    var shown = {};
    shown[0] = shown[total - 1] = shown[page] = true;
    var keys = function () { return Object.keys(shown).map(Number).sort(function (a, b) { return a - b; }); };
    var rendered = function () {
      var k = keys(), n = k.length;
      for (var j = 1; j < k.length; j++) if (k[j] - k[j - 1] > 1) n++;
      return n;
    };
    for (var r = 1; r < total; r++) {
      var added = false;
      [page - r, page + r].forEach(function (p) {
        if (p <= 0 || p >= total - 1 || shown[p]) return;
        shown[p] = true;
        if (rendered() > slots) delete shown[p]; else added = true;
      });
      if (!added) break;
    }
    return keys();
  }

  global.LQAFilter = {
    TYPE_COLOR: TYPE_COLOR,
    findSeries: findSeries,
    assignLanes: assignLanes,
    seriesLabel: seriesLabel,
    drawSeriesGraph: drawSeriesGraph,
    pagesToShow: pagesToShow,
    TEAMS: TEAMS,
    TEAM_BY_SLUG: TEAM_BY_SLUG,
    VENUE_ICON: VENUE_ICON,
    VENUE_COLOR: VENUE_COLOR,
    VENUE_CAPACITY: VENUE_CAPACITY,
    VENUE_AREA: VENUE_AREA,
    slugify: slugify,
    eventType: eventType,
    matchesFilter: matchesFilter,
    matchesSearch: matchesSearch,
    encodeSearch: encodeSearch,
    decodeSearch: decodeSearch,
    encodeFilterCode: encodeFilterCode,
    parseFilterCode: parseFilterCode,
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: the node tests
