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
  var TEAMS = [
    { slug: 'mariners', label: 'Mariners', re: /mariners/i, venue: 'T-Mobile Park', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png', schedule: 'https://www.mlb.com/mariners/schedule' },
    { slug: 'storm', label: 'Storm', re: /seattle storm/i, venue: 'Climate Pledge Arena', logo: 'https://a.espncdn.com/i/teamlogos/wnba/500/sea.png', schedule: 'https://storm.wnba.com/schedule/' },
    { slug: 'seahawks', label: 'Seahawks', re: /seahawks/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', schedule: 'https://www.seahawks.com/schedule/' },
    { slug: 'reign', label: 'Reign', re: /reign fc|seattle reign/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/15363.png', schedule: 'https://www.reignfc.com/schedule' },
    { slug: 'sounders', label: 'Sounders', re: /sounders/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png', schedule: 'https://www.soundersfc.com/schedule/' },
    { slug: 'kraken', label: 'Kraken', re: /kraken/i, venue: 'Climate Pledge Arena', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png', schedule: 'https://www.nhl.com/kraken/schedule' },
    // PWHL, first season 2025-26. No public crest image to hotlink yet, and
    // the league site has no per-team schedule URL — the team page holds it.
    { slug: 'torrent', label: 'Torrent', re: /seattle torrent/i, venue: 'Climate Pledge Arena', schedule: 'https://www.thepwhl.com/en/teams/seattle-torrent' },
  ];
  var TEAM_BY_SLUG = {};
  TEAMS.forEach(function (t) { TEAM_BY_SLUG[t.slug] = t; });

  var TYPE_VENUE_DEFAULT = {
    'Climate Pledge Arena': 'concert', 'The Vera Project': 'concert',
    'T-Mobile Park': 'concert', 'Lumen Field': 'concert', // non-game stadium bookings are shows
    'McCaw Hall': 'arts', 'Cornish Playhouse': 'arts', 'On the Boards': 'arts',
    'Seattle Center': 'community', 'SIFF Cinema Uptown': 'community', // SIFF specials = festival programming
  };
  function eventType(e) {
    var title = e.title || '';
    if (e.movie) return 'movie';
    if (TEAMS.some(function (t) { return t.re.test(title); }) || /\bvs\.?\s/i.test(title)) return 'sports';
    if (/ballet|opera|symphon|orchestra|philharmon|theatre|theater|musical|broadway|shakespeare|comedy|stand-?up|improv|dance|cirque|on ice/i.test(title)) return 'arts';
    if (/festival|fest[aá]l|\bfair\b|\bexpo\b|market|convention|summit|celebration|ceremony|\bwalk\b|\brun\b|parade/i.test(title)) return 'community';
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
  };
  // Venue hues for dark backgrounds — the same values the calendar's
  // styles.css dark block sets as --v-* variables; keep the two in step.
  var VENUE_COLOR = {
    'Cornish Playhouse': '#00ff99', 'Climate Pledge Arena': '#0099ff', 'T-Mobile Park': '#ccffff',
    'Seattle Center': '#3333ff', 'Lumen Field': '#6666ff', 'SIFF Cinema Uptown': '#cc99ff',
    'The Vera Project': '#9900ff', 'On the Boards': '#ff66ff', 'McCaw Hall': '#cc0099',
  };

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

  // Event-type hues for dark backgrounds — same values as the calendar's
  // dark --t-* variables; keep in step.
  var TYPE_COLOR = { concert: '#ff9900', sports: '#ffff00', arts: '#ff3333', movie: '#cc9966', community: '#ff66cc' };

  // ---- series: the same event on nearby days — a homestand, a two-night
  // stand, an opera run. Same venue + same title, occurrences within a week
  // of each other. Movies sit this out: SIFF's daily showtimes would make
  // everything a series. Returns the series (sorted by start, with ids) and
  // stamps each member event with e.series = { s, n, total }. ----
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
      run.forEach(function (e, i) { e.series = { s: s, n: i + 1, total: run.length }; });
      all.push(s);
    };
    Object.keys(groups).forEach(function (k) {
      var evs = groups[k].sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
      var run = [evs[0]];
      for (var i = 1; i < evs.length; i++) {
        var gap = Math.round((parseYmd(evs[i].date) - parseYmd(evs[i - 1].date)) / 86400e3);
        if (gap <= 7) run.push(evs[i]); else { flush(run); run = [evs[i]]; }
      }
      flush(run);
    });
    all.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    all.forEach(function (s, i) { s.id = i; });
    return all;
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
  //         onLanes(n) called before measuring so the caller can size its
  //         gutter, gutterX(containerBox) → x of the first lane's left edge
  //         relative to the container, color(series), label(series)
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
    var laneEnd = [];
    items.forEach(function (it) {
      for (var l = 0; ; l++) {
        if (laneEnd[l] == null || laneEnd[l] < it.from) { laneEnd[l] = it.to; it.lane = l; break; }
      }
    });
    if (opts.onLanes) opts.onLanes(laneEnd.length);
    if (!items.length) return 0;
    var box = container.getBoundingClientRect(); // after the caller sized its gutter
    var gx = typeof opts.gutterX === 'function' ? opts.gutterX(box) : opts.gutterX;
    var laneW = opts.laneWidth, b = opts.bend || 24;
    var f = function (v) { return Math.round(v * 10) / 10; };
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'series-graph');
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    svg.setAttribute('aria-hidden', 'true');
    items.forEach(function (it) {
      var pts = it.els.map(function (el) { var r = el.getBoundingClientRect(); return { x: r.right - box.left - 1, y: r.top + r.height / 2 - box.top }; });
      var x = f(gx + it.lane * laneW + laneW / 2);
      var n = pts.length;
      // one continuous path per series, top to bottom: the pen starts at
      // the page edge (or the first row's edge), and for each row runs the
      // straight lane down to the row's entry, curves in, and curves back out
      var d = it.before ? 'M' + x + ' 0' : '';
      pts.forEach(function (p, i) {
        var starts = i === 0 && !it.before, ends = i === n - 1 && !it.after;
        var px = f(p.x), py = f(p.y);
        var rx = f(p.x + (x - p.x) * 0.45); // where the curve levels out toward the row
        if (starts) d += 'M' + px + ' ' + py;
        else d += ' L' + x + ' ' + f(py - b) + ' C' + x + ' ' + f(py - b / 3) + ' ' + rx + ' ' + py + ' ' + px + ' ' + py;
        if (!ends) d += ' C' + rx + ' ' + py + ' ' + x + ' ' + f(py + b / 3) + ' ' + x + ' ' + f(py + b);
      });
      if (it.after) d += ' L' + x + ' ' + f(box.height);
      if (d.indexOf('C') < 0 && d.indexOf('L') < 0) return; // a lone row with nothing to connect
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'sg-line');
      path.setAttribute('d', d);
      path.style.stroke = opts.color(it.s);
      if (opts.label) {
        var tip = document.createElementNS(SVG_NS, 'title');
        tip.textContent = opts.label(it.s);
        path.appendChild(tip);
      }
      svg.appendChild(path);
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
    seriesLabel: seriesLabel,
    drawSeriesGraph: drawSeriesGraph,
    pagesToShow: pagesToShow,
    TEAMS: TEAMS,
    TEAM_BY_SLUG: TEAM_BY_SLUG,
    VENUE_ICON: VENUE_ICON,
    VENUE_COLOR: VENUE_COLOR,
    slugify: slugify,
    eventType: eventType,
    matchesFilter: matchesFilter,
    encodeFilterCode: encodeFilterCode,
    parseFilterCode: parseFilterCode,
  };
})(window);
