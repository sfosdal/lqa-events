// Lower Queen Anne Events — calendar UI over events.json.
(function () {
  'use strict';

  // Venue hue assignment: marquee venues keep curated colors; every other
  // venue gets a hue hashed from its name, so colors stay stable no matter
  // which venues the feed contains on a given day.
  var VENUE_VARS = {
    'Climate Pledge Arena': '--v-cpa',
    'McCaw Hall': '--v-mccaw',
    'Seattle Center': '--v-seactr',
    'Cornish Playhouse': '--v-cornish',
    'The Vera Project': '--v-vera',
    'SIFF Cinema Uptown': '--v-siff',
    'On the Boards': '--v-otb',
    'T-Mobile Park': '--v-tmobile',
    'Lumen Field': '--v-lumen',
  };
  // Venue marks for agenda rows with no team crest — shared with other
  // sites via filter.js
  var VENUE_ICON = LQAFilter.VENUE_ICON;
  // Unexpected venues draw from the same cool, web-safe family as the
  // curated ones, hashed from the name so the pick is stable day to day.
  var VENUE_FALLBACK = ['#66ccff', '#9999ff', '#66ffff', '#cc66cc', '#3399ff', '#ff99ff', '#00cccc', '#6666ff'];
  function venueColor(v) {
    if (VENUE_VARS[v]) return 'var(' + VENUE_VARS[v] + ')';
    var h = 0;
    for (var i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) % 360;
    return VENUE_FALLBACK[h % VENUE_FALLBACK.length];
  }
  function teamColor(slug) { return 'var(--tm-' + slug + ')'; }
  // Each venue's own events listing — not a ticket vendor. An event's own
  // link (the agenda row's title) still goes to wherever tickets are
  // sold; this is for the venue name in the panel and the agenda. A venue
  // with no entry here stays plain text.
  var VENUE_URL = {
    'Climate Pledge Arena': 'https://climatepledgearena.com/events/',
    'McCaw Hall': 'https://www.mccawhall.com/events',
    'Seattle Center': 'https://www.seattlecenter.com/events/event-calendar',
    'On the Boards': 'https://ontheboards.org/events',
    'The Vera Project': 'https://theveraproject.org/events/',
    // Seattle Center's calendar filtered to the Playhouse (the same venue
    // category the feed's sweep reads); Cornish's own calendar mixes in the
    // college's other campuses and can't be filtered by venue.
    'Cornish Playhouse': 'https://www.seattlecenter.com/events/event-calendar?cats=173',
    'T-Mobile Park': 'https://www.mlb.com/mariners/ballpark/events', // the ballpark's own list — concerts too, not just Mariners games
    'Lumen Field': 'https://www.lumenfield.com/events',
    'SIFF Cinema Uptown': 'https://www.siff.net/calendar',
  };

  // Venue list order = usefulness to an LQA bar owner: the campus venues that
  // actually walk a crowd past the bar come first, the SoDo stadiums last
  // (huge, but a bus ride away — staffing signal, not foot traffic). The feed
  // collapses campus micro-locations into "Seattle Center", so these seven are
  // normally the whole list; anything unexpected slots in before the stadiums,
  // busiest first.
  var VENUE_RANK = {
    'Climate Pledge Arena': 0, // 17k people, right across the street
    'McCaw Hall': 1,           // pre-show dinner-and-drinks crowd
    'Seattle Center': 2,       // festivals and grounds events
    'Cornish Playhouse': 3,
    'The Vera Project': 4,     // all-ages — least bar crossover of the campus
    'SIFF Cinema Uptown': 5,   // the Queen Anne Ave movie house
    'On the Boards': 6,        // contemporary performance, a block off the Center
    'T-Mobile Park': 90,
    'Lumen Field': 91,
  };
  function venueOrder(counts) {
    return function (a, b) {
      var ra = VENUE_RANK[a] != null ? VENUE_RANK[a] : 50;
      var rb = VENUE_RANK[b] != null ? VENUE_RANK[b] : 50;
      if (ra !== rb) return ra - rb;
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      return a < b ? -1 : 1;
    };
  }

  // Team roster, event-type classification, venue slugs, and filter
  // matching are shared with other sites that render a filtered slice of
  // this feed (see filter.js) — this is a thin alias, not a second copy.
  var TEAMS = LQAFilter.TEAMS;
  var TEAM_BY_SLUG = LQAFilter.TEAM_BY_SLUG;
  var slugify = LQAFilter.slugify;
  var eventType = LQAFilter.eventType;
  function teamFor(title) {
    for (var i = 0; i < TEAMS.length; i++) if (TEAMS[i].re.test(title || '')) return TEAMS[i];
    return null;
  }

  // Kayak-style checkboxes: each filter map holds name → 'ex' for unchecked
  // (hidden); absent = checked (shown). Everything starts checked except SIFF
  // movies — see applyDefaultFilters.
  var state = { events: [], byDate: {}, venues: [], venueMode: {}, badgeMode: {}, teamMode: {}, month: null, showPast: false, pastFrom: null, page: 0, pageByDate: {}, series: [] };

  function modeKeys(map, mode) {
    return Object.keys(map).filter(function (k) { return map[k] === mode; });
  }
  function setChecked(map, key, on) {
    if (on) delete map[key]; else map[key] = 'ex';
  }

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  function parseDate(s) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function todayStr() { return ymd(new Date()); }
  function fmtTime(t) {
    if (!t) return 'all day';
    var hm = t.split(':');
    var h = Number(hm[0]), m = hm[1] || '00';
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
  }

  // ---- data ----
  // ---- series: the same event on nearby days — a homestand, a two-night
  // stand, an opera run. Same venue + same title, occurrences within a week
  // of each other. Movies sit this out: SIFF's daily showtimes would make
  // everything a series. Each series gets a lane (interval coloring over its
  // date range) shared by the gutter graph and the calendar bars. ----
  function seriesKey(e) { return e.venue + '|' + String(e.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function seriesLabel(s) {
    var f = function (d) { return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
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
        var gap = Math.round((parseDate(evs[i].date) - parseDate(evs[i - 1].date)) / 86400e3);
        if (gap <= 7) run.push(evs[i]); else { flush(run); run = [evs[i]]; }
      }
      flush(run);
    });
    all.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    all.forEach(function (s, i) { s.id = i; });
    state.series = all;
    document.querySelector('.agenda-layout').classList.toggle('has-series', all.length > 0);
  }
  // The graph: a vertical line per series in the gutter, git-client style,
  // in the series' event-type color; at each of its cards the line curves
  // into the card's type stripe like a branch merging. It runs off the page
  // edge when the series continues on another page. Drawn from the rendered
  // rows, so it follows whatever the current page and filters show.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function drawSeriesGraph() {
    var ol = $('agenda');
    var old = ol.querySelector('.series-graph');
    if (old) old.remove();
    var layout = document.querySelector('.agenda-layout');
    if (!state.series.length || !matchMedia('(min-width: 641px)').matches) { layout.style.removeProperty('--gutter'); return; }
    var rows = Array.from(ol.querySelectorAll('.ev[data-series]'));
    var de = ol.querySelector('.day-events');
    if (!rows.length || !de) { layout.style.setProperty('--gutter', '0.9rem'); return; }
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    var dates = Array.from(ol.querySelectorAll('.day-row')).map(function (li) { return li.dataset.date; });
    var first = dates[0], last = dates[dates.length - 1];
    // Lanes are assigned on row order (not pixels) so the gutter can be
    // sized for this page before anything is measured: the first free lane
    // whose last series ended above this one.
    var byId = {};
    rows.forEach(function (row, i) { (byId[row.dataset.series] = byId[row.dataset.series] || { rows: [], idx: [] }).rows.push(row); byId[row.dataset.series].idx.push(i); });
    var items = Object.keys(byId).map(function (id) {
      var s = state.series[Number(id)];
      var idx = byId[id].idx;
      return { s: s, rows: byId[id].rows, before: s.start < first, after: s.end > last, from: s.start < first ? -1 : idx[0], to: s.end > last ? rows.length : idx[idx.length - 1] };
    }).sort(function (a, b) { return a.from - b.from; });
    var laneEnd = [];
    items.forEach(function (it) {
      for (var l = 0; ; l++) {
        if (laneEnd[l] == null || laneEnd[l] < it.from) { laneEnd[l] = it.to; it.lane = l; break; }
      }
    });
    layout.style.setProperty('--gutter', (laneEnd.length * 0.9 + 0.3) + 'rem');
    var olBox = ol.getBoundingClientRect(); // measured after the gutter is set
    items.forEach(function (it) {
      it.pts = it.rows.map(function (row) { var r = row.getBoundingClientRect(); return { y: r.top + r.height / 2 - olBox.top, x: r.right - olBox.left - 1 }; });
    });
    var laneW = 0.9 * rem;
    var gx = de.getBoundingClientRect().right - olBox.left + 1 * rem; // the gutter starts past the cards and the grid gap
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'series-graph');
    svg.setAttribute('width', olBox.width);
    svg.setAttribute('height', olBox.height);
    svg.setAttribute('aria-hidden', 'true');
    // At each card the lane swings over to touch the stripe and swings back:
    // an incoming curve from above and its mirror going out below, meeting
    // at the stripe. The first card of a series has only the outgoing half,
    // the last only the incoming half. `b` is how far along the lane each
    // half reaches; the straight lane runs between cards.
    var b = 24;
    var f = function (v) { return Math.round(v * 10) / 10; };
    items.forEach(function (it) {
      var x = f(gx + it.lane * laneW + laneW / 2);
      var color = typeColor(eventType(it.s.events[0]));
      var n = it.pts.length;
      // One continuous path per series, drawn top to bottom: the pen starts
      // at the page edge (or the first card's stripe), and for each card
      // runs the straight lane down to the card's entry, curves into the
      // stripe, and curves back out — then on to the next card or the edge.
      var d = it.before ? 'M' + x + ' 0' : '';
      it.pts.forEach(function (p, i) {
        var starts = i === 0 && !it.before, ends = i === n - 1 && !it.after;
        var px = f(p.x), py = f(p.y);
        var rx = f(p.x + (x - p.x) * 0.45); // where the curve levels out toward the stripe
        if (starts) d += 'M' + px + ' ' + py;
        else d += ' L' + x + ' ' + f(py - b) + ' C' + x + ' ' + f(py - b / 3) + ' ' + rx + ' ' + py + ' ' + px + ' ' + py;
        if (!ends) d += ' C' + rx + ' ' + py + ' ' + x + ' ' + f(py + b / 3) + ' ' + x + ' ' + f(py + b);
      });
      if (it.after) d += ' L' + x + ' ' + f(olBox.height);
      if (d.indexOf('C') < 0 && d.indexOf('L') < 0) return; // a lone card with nothing to connect
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'sg-line');
      path.setAttribute('d', d);
      path.style.stroke = color;
      var tip = document.createElementNS(SVG_NS, 'title');
      tip.textContent = seriesLabel(it.s);
      path.appendChild(tip);
      svg.appendChild(path);
    });
    ol.appendChild(svg);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawSeriesGraph(); });

  function load() {
    fetch('events.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data.events || []);
        state.events = list;
        findSeries(list);
        state.byDate = {};
        var vs = {};
        list.forEach(function (e) {
          (state.byDate[e.date] = state.byDate[e.date] || []).push(e);
          vs[e.venue] = (vs[e.venue] || 0) + 1;
        });
        state.venues = Object.keys(vs).sort(venueOrder(vs));
        if (!Array.isArray(data) && data.generated) {
          var gen = new Date(data.generated);
          // Relative stamp, re-rendered every minute so it never goes stale
          // while the tab sits open.
          var stamp = function () {
            var mins = Math.round((Date.now() - gen.getTime()) / 60000);
            var txt;
            if (mins < 1) txt = 'just now';
            else if (mins < 60) txt = mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
            else if (mins < 48 * 60) {
              var h = Math.round(mins / 60);
              txt = h + ' hour' + (h === 1 ? '' : 's') + ' ago';
            } else {
              txt = Math.round(mins / 1440) + ' days ago';
            }
            $('updated').textContent = 'Updated ' + txt;
          };
          stamp();
          setInterval(stamp, 60000);
        }
        var now = new Date();
        state.month = new Date(now.getFullYear(), now.getMonth(), 1);
        // forget saved venues that no longer appear in the feed
        Object.keys(state.venueMode).forEach(function (v) {
          if (state.venues.indexOf(v) === -1) delete state.venueMode[v];
        });
        renderFilters(); renderCal(); renderAgenda(); updateSubscribe();
      })
      .catch(function (err) {
        $('agenda').innerHTML = '';
        var li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'The event feed did not load (' + err.message + '). Reload the page to try again.';
        $('agenda').appendChild(li);
      });
  }

  // Event type is inferred, not sourced: every event lands in exactly one
  // bucket, from its flags, title, then venue. The 'movie' key survives from
  // the badge era so the saved movies-hidden default and the no-movies feed
  // carry over unchanged.
  var TYPE_LIST = [
    { key: 'concert', label: 'Concerts', title: 'Live music — arena tours to Vera Project shows' },
    { key: 'sports', label: 'Sports', title: 'Pro and college games' },
    { key: 'arts', label: 'Arts & Theater', title: 'Opera, ballet, plays, comedy, dance' },
    { key: 'movie', label: 'Movies', title: 'Film screenings at SIFF Cinema Uptown — unchecked by default' },
    { key: 'community', label: 'Festivals', title: 'Grounds events, festivals, fairs, SIFF specials' },
  ];
  // Type hues mirror the venue hues: a dot on the filter rows, a colored
  // right edge on each agenda row.
  var TYPE_VARS = {
    concert: '--t-concert', sports: '--t-sports', arts: '--t-arts',
    movie: '--t-movie', community: '--t-community',
  };
  function typeColor(k) { return 'var(' + TYPE_VARS[k] + ')'; }
  var TYPE_KEYS = {};
  TYPE_LIST.forEach(function (t) { TYPE_KEYS[t.key] = true; });
  // The baseline every visitor starts from (and "Reset filters" returns to):
  // SIFF's daily movie showings unchecked, everything else checked.
  function applyDefaultFilters() { state.badgeMode = { movie: 'ex' }; }
  function isDefaultState() {
    if (Object.keys(state.venueMode).length || Object.keys(state.teamMode).length) return false;
    var k = Object.keys(state.badgeMode);
    return k.length === 1 && state.badgeMode.movie === 'ex';
  }
  // Matching itself lives in filter.js so other sites filtering this feed
  // (e.g. river's Neighborhood section) can't drift from these rules.
  function filtered(list) {
    return list.filter(function (e) {
      return LQAFilter.matchesFilter(e, { venueMode: state.venueMode, badgeMode: state.badgeMode, teamMode: state.teamMode });
    });
  }

  // ---- quick filters + full panel ----
  // The collapsed view is a slice of the expanded panel — the same checkbox
  // rows, just the most-used filters. The filter icon swaps it for the full
  // panel and back.
  var QUICK_FILTERS = [
    { group: 'venue', key: 'Climate Pledge Arena' },
    { group: 'venue', key: 'McCaw Hall' },
    { group: 'venue', key: 'Seattle Center' },
    { group: 'venue', key: 'On the Boards' },
    { group: 'badge', key: 'sports' },
    { group: 'badge', key: 'concert' },
  ];
  // One panel row: [✓] name  only  count. The native checkbox stays in the
  // DOM (visually replaced by .cb) so keyboard and screen-reader behavior
  // come for free; "only" unchecks everything else in the group.
  function filterRow(group, key, nameEl, count, title) {
    var row = document.createElement('div');
    row.className = 'fp-row';
    var lab = document.createElement('label');
    lab.className = 'fp-check';
    if (title) lab.title = title;
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset[group] = key;
    var box = document.createElement('span');
    box.className = 'cb';
    lab.appendChild(input); lab.appendChild(box); lab.appendChild(nameEl);
    var only = document.createElement('button');
    only.type = 'button';
    only.className = 'fp-only';
    only.dataset.group = group;
    only.dataset.key = key;
    only.textContent = 'only';
    only.title = 'Show only this one';
    var cnt = document.createElement('span');
    cnt.className = 'fp-count';
    cnt.textContent = count;
    row.appendChild(lab); row.appendChild(only); row.appendChild(cnt);
    return row;
  }
  function dottedName(label, color) {
    var name = document.createElement('span');
    name.className = 'fp-name';
    var dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.setProperty('--dot', color);
    name.appendChild(dot);
    name.appendChild(document.createTextNode(label));
    return name;
  }
  // A name that links out (venue events page, team schedule) — or plain text
  // when there's nowhere to send it. Filter rows sit inside a <label> that
  // toggles the checkbox on any click; native label activation already
  // skips a nested link, and stopPropagation keeps the delegated handlers
  // out of it too.
  function extLink(text, url, title) {
    if (!url) return document.createTextNode(text);
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    if (title) a.title = title;
    a.textContent = text;
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }
  function venueName(v) {
    var name = document.createElement('span');
    name.className = 'fp-name';
    var dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.setProperty('--dot', venueColor(v));
    name.appendChild(dot);
    name.appendChild(extLink(v, VENUE_URL[v], "See " + v + "’s own events list"));
    return name;
  }
  function renderFilters() {
    // Counts play the role of Kayak's price column: upcoming events each row
    // would govern, unaffected by the current filter so they stay stable.
    var today = todayStr();
    var upcoming = state.events.filter(function (e) { return e.date >= today; });
    var typeByKey = {};
    TYPE_LIST.forEach(function (t) { typeByKey[t.key] = t; });
    var ql = $('quickList');
    ql.innerHTML = '';
    QUICK_FILTERS.forEach(function (q) {
      if (q.group === 'venue') {
        if (state.venues.indexOf(q.key) === -1) return;
        var n = upcoming.filter(function (e) { return e.venue === q.key; }).length;
        ql.appendChild(filterRow('venue', q.key, venueName(q.key), n));
      } else {
        var t = typeByKey[q.key];
        var m = upcoming.filter(function (e) { return eventType(e) === t.key; }).length;
        ql.appendChild(filterRow('badge', t.key, dottedName(t.label, typeColor(t.key)), m, t.title));
      }
    });
    var pv = $('panelVenues');
    pv.innerHTML = '';
    state.venues.forEach(function (v) {
      var n = upcoming.filter(function (e) { return e.venue === v; }).length;
      pv.appendChild(filterRow('venue', v, venueName(v), n));
    });
    var pt = $('panelTeams');
    pt.innerHTML = '';
    TEAMS.forEach(function (t) {
      var name = document.createElement('span');
      name.className = 'fp-name';
      var dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.setProperty('--dot', teamColor(t.slug));
      name.appendChild(dot);
      name.appendChild(extLink(t.label, t.schedule, t.label + ' schedule'));
      var n = upcoming.filter(function (e) { return t.re.test(e.title || ''); }).length;
      pt.appendChild(filterRow('team', t.slug, name, n, t.label + ' home games'));
    });
    var pb = $('panelBadges');
    pb.innerHTML = '';
    TYPE_LIST.forEach(function (t) {
      var n = upcoming.filter(function (e) { return eventType(e) === t.key; }).length;
      pb.appendChild(filterRow('badge', t.key, dottedName(t.label, typeColor(t.key)), n, t.title));
    });
    syncFilters();
  }
  // Every checkbox for a filter (quick strip or group list) syncs from state
  // in one pass, so Select all / only / Reset reach the strip rows too.
  function syncFilters() {
    document.querySelectorAll('input[data-venue]').forEach(function (c) {
      c.checked = state.venueMode[c.dataset.venue] !== 'ex';
    });
    document.querySelectorAll('input[data-badge]').forEach(function (c) {
      c.checked = state.badgeMode[c.dataset.badge] !== 'ex';
    });
    document.querySelectorAll('input[data-team]').forEach(function (c) {
      c.checked = state.teamMode[c.dataset.team] !== 'ex';
    });
    var any = !isDefaultState();
    $('filterToggle').classList.toggle('is-on', any);
    $('clearAll').disabled = !any;
  }
  // Filter choices persist per-browser (no login — just localStorage).
  function saveFilters() {
    try {
      localStorage.setItem('lqa-filters', JSON.stringify({ v: 3, venues: state.venueMode, badges: state.badgeMode, teams: state.teamMode }));
    } catch (e) { /* private mode etc. — filters just won't persist */ }
  }
  function loadFilters() {
    var raw = null;
    try { raw = localStorage.getItem('lqa-filters'); } catch (e) { /* unreadable storage */ }
    if (raw == null) { applyDefaultFilters(); return; } // first visit
    try {
      var s = JSON.parse(raw);
      if (s.v === 3 || s.v === 2) {
        // v2 was the tri-state era: its 'in' entries have no checkbox
        // equivalent and are dropped; 'ex' carries over as unchecked.
        Object.keys(s.venues || {}).forEach(function (v) { if (s.venues[v] === 'ex') state.venueMode[v] = 'ex'; });
        Object.keys(s.badges || {}).forEach(function (k) { if (TYPE_KEYS[k] && s.badges[k] === 'ex') state.badgeMode[k] = 'ex'; });
        Object.keys(s.teams || {}).forEach(function (k) { if (TEAM_BY_SLUG[k] && s.teams[k] === 'ex') state.teamMode[k] = 'ex'; });
      } else {
        // v1 arrays: only its team exclusions survive the checkbox model
        (s.teams || []).forEach(function (k) { if (TEAM_BY_SLUG[k]) state.teamMode[k] = 'ex'; });
      }
    } catch (e) { applyDefaultFilters(); } // unreadable storage — start at the baseline
  }
  // A link built from "Copy filter link" takes over the initial view instead
  // of your saved prefs — open it, and you see exactly what was shared.
  // Interacting with the panel from there saves normally, like any visit.
  function loadFiltersFromURL() {
    var code = new URLSearchParams(location.search).get('f');
    var parsed = code == null ? null : LQAFilter.parseFilterCode(code);
    if (!parsed) return false;
    state.venueMode = parsed.venueMode;
    state.badgeMode = parsed.badgeMode;
    state.teamMode = parsed.teamMode;
    return true;
  }
  // a filter change also rewinds the agenda to its first page
  function applyFilters() { state.page = 0; syncFilters(); renderCal(); renderAgenda(); updateSubscribe(); saveFilters(); }

  // Each group's map and full key list, for "only" and Select/Clear all.
  function groupInfo(g) {
    if (g === 'venue') return { map: state.venueMode, keys: state.venues.slice() };
    if (g === 'team') return { map: state.teamMode, keys: TEAMS.map(function (t) { return t.slug; }) };
    return { map: state.badgeMode, keys: TYPE_LIST.map(function (t) { return t.key; }) };
  }
  function ensureTeamVenue(slug) {
    var t = TEAM_BY_SLUG[slug];
    if (t && t.venue) setChecked(state.venueMode, t.venue, true);
  }
  // Team exclusion alone only drops a few teams' games — everything else
  // (concerts, arts, festivals, other venues) passes right through, since
  // matchesFilter's team check only fires for events matching an excluded
  // team's regex. So "only Reign" has to isolate venue and event-type too,
  // not just the team: the team's home venue is the only one that can host
  // its games, and a home game always classifies as 'sports'.
  function onlyTeam(slug) {
    var t = TEAM_BY_SLUG[slug];
    TEAMS.forEach(function (x) { state.teamMode[x.slug] = 'ex'; });
    delete state.teamMode[slug];
    if (t && t.venue) {
      state.venues.forEach(function (v) { state.venueMode[v] = 'ex'; });
      delete state.venueMode[t.venue];
    }
    TYPE_LIST.forEach(function (ty) { state.badgeMode[ty.key] = 'ex'; });
    delete state.badgeMode.sports;
  }
  // The venue counterpart: keep the teams that play there, and the event
  // types that actually occur there (a venue with nothing upcoming leaves
  // the types alone — there's nothing to narrow to).
  // And the type counterpart: keep the venues that host that type (from the
  // upcoming events) and, for Sports, the teams with upcoming games; any
  // other type drops every team (their games are all Sports anyway).
  function onlyType(key) {
    TYPE_LIST.forEach(function (ty) { state.badgeMode[ty.key] = 'ex'; });
    delete state.badgeMode[key];
    var today = todayStr();
    var upcoming = state.events.filter(function (e) { return e.date >= today && eventType(e) === key; });
    var venuesHosting = {};
    upcoming.forEach(function (e) { venuesHosting[e.venue] = true; });
    if (upcoming.length) {
      state.venues.forEach(function (v) { setChecked(state.venueMode, v, !!venuesHosting[v]); });
    }
    TEAMS.forEach(function (t) {
      var plays = key === 'sports' && upcoming.some(function (e) { return t.re.test(e.title || ''); });
      setChecked(state.teamMode, t.slug, plays);
    });
  }
  function onlyVenue(v) {
    state.venues.forEach(function (x) { state.venueMode[x] = 'ex'; });
    delete state.venueMode[v];
    TEAMS.forEach(function (t) { setChecked(state.teamMode, t.slug, t.venue === v); });
    var today = todayStr();
    var present = {};
    state.events.forEach(function (e) { if (e.venue === v && e.date >= today) present[eventType(e)] = true; });
    if (Object.keys(present).length) {
      TYPE_LIST.forEach(function (ty) { setChecked(state.badgeMode, ty.key, !!present[ty.key]); });
    }
  }
  // Panel checkboxes drive state through the native change event…
  document.addEventListener('change', function (e) {
    var c = e.target;
    if (!(c instanceof HTMLInputElement) || c.type !== 'checkbox') return;
    if (c.dataset.venue != null) { setChecked(state.venueMode, c.dataset.venue, c.checked); applyFilters(); }
    else if (c.dataset.badge != null) { setChecked(state.badgeMode, c.dataset.badge, c.checked); applyFilters(); }
    else if (c.dataset.team != null) {
      setChecked(state.teamMode, c.dataset.team, c.checked);
      if (c.checked) ensureTeamVenue(c.dataset.team);
      applyFilters();
    }
  });
  // …while the "only" links and group links are buttons.
  document.addEventListener('click', function (e) {
    var o = e.target.closest('.fp-only');
    if (o) {
      if (o.dataset.group === 'team') {
        onlyTeam(o.dataset.key);
      } else if (o.dataset.group === 'venue') {
        onlyVenue(o.dataset.key);
      } else {
        onlyType(o.dataset.key);
      }
      applyFilters();
      return;
    }
    var l = e.target.closest('.fp-link');
    if (l) {
      var gi = groupInfo(l.dataset.group);
      gi.keys.forEach(function (k) { setChecked(gi.map, k, l.dataset.act === 'all'); });
      if (l.dataset.group === 'team' && l.dataset.act === 'all') {
        TEAMS.forEach(function (t) { ensureTeamVenue(t.slug); });
      }
      applyFilters();
    }
  });
  // More/Less lives up in the bar (above everything that grows, so it never
  // moves); the card below swaps its quick strip for the full groups.
  function setPanelOpen(open) {
    $('quickList').hidden = open;
    $('fullFilters').hidden = !open;
    $('quickPanel').classList.toggle('is-open', open);
    $('filterToggle').setAttribute('aria-expanded', String(open));
  }
  function togglePanel() { setPanelOpen($('fullFilters').hidden); }
  $('filterToggle').addEventListener('click', togglePanel);
  // clicking anywhere outside the filter area collapses back to the quick view
  document.addEventListener('click', function (e) {
    if (!$('fullFilters').hidden && !e.target.closest('.filter-panel, .filterbar')) {
      setPanelOpen(false);
    }
  });
  function clearAllFilters() {
    state.venueMode = {};
    state.teamMode = {};
    applyDefaultFilters();
    applyFilters();
  }
  $('clearAll').addEventListener('click', clearAllFilters);
  // ---- light / system / dark ----
  // The head script already applied the saved choice; this just drives the
  // toggle and swaps <html data-theme> when a stop is picked.
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else { t = 'system'; delete document.documentElement.dataset.theme; }
    $('themeToggle').dataset.active = t;
    $('themeToggle').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.theme === t));
    });
    try { if (t === 'system') localStorage.removeItem('lqa-theme'); else localStorage.setItem('lqa-theme', t); } catch (e) { /* no storage */ }
    // browser chrome follows: both theme-color metas take the chosen shade,
    // or go back to their own light/dark values under "system"
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.content = t === 'dark' ? '#141a20' : t === 'light' ? '#edf1f4' : (m.dataset.light || m.dataset.dark);
    });
  }
  applyTheme(document.documentElement.dataset.theme || 'system');
  $('themeToggle').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-theme]');
    if (b) applyTheme(b.dataset.theme);
  });

  // ---- phones: collapsible mini calendar ----
  // Stacked above the list on small screens, it can be folded away behind
  // the toggle; it starts open and remembers a fold. On the wide layout it's
  // always open and the toggle is hidden.
  var STACKED = '(max-width: 760px)';
  function syncCal() {
    var stacked = matchMedia(STACKED).matches;
    var open = true;
    if (stacked) { try { open = localStorage.getItem('lqa-cal') !== 'closed'; } catch (e) { open = true; } }
    $('calBox').hidden = !open;
    $('calToggle').setAttribute('aria-expanded', String(open));
    $('calToggle').querySelector('span').textContent = open ? 'Hide calendar' : 'Show calendar';
  }
  $('calToggle').addEventListener('click', function () {
    var open = $('calBox').hidden;
    try { localStorage.setItem('lqa-cal', open ? 'open' : 'closed'); } catch (e) { /* no storage */ }
    syncCal();
  });
  syncCal();
  window.addEventListener('resize', syncCal);

  // ---- the filter bar folds Reset / Copy to icons only when it must ----
  // Measured with the labels shown: if the row would overflow its box, the
  // labels go (see .filterbar.is-tight). Re-checked on resize.
  function fitFilterBar() {
    var bar = document.querySelector('.filterbar');
    bar.classList.remove('is-tight');
    if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('is-tight');
  }
  fitFilterBar();
  window.addEventListener('resize', fitFilterBar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitFilterBar);

  // ---- phones: the event sheet ----
  // A tap anywhere on a card opens it (capture phase, so it wins over the
  // venue link's own handler); the sheet carries every detail and full-size
  // links. Desktop keeps its inline links.
  var sheetTouch = '(max-width: 640px)';
  function openSheet(e) {
    $('sheetVenue').textContent = e.venue;
    $('sheetTitle').textContent = e.title;
    var when = parseDate(e.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + fmtTime(e.time);
    if (e.series) when += ' · ' + e.series.n + ' of ' + e.series.total;
    if (e.dateTbd) when += ' · date TBD';
    $('sheetWhen').textContent = when;
    var t = $('sheetTickets'); t.href = e.url || '#'; t.hidden = !e.url;
    var v = $('sheetVenueLink'); v.href = VENUE_URL[e.venue] || '#'; v.hidden = !VENUE_URL[e.venue]; v.textContent = e.venue + ' events';
    $('sheet').hidden = false;
    document.body.classList.add('sheet-open');
    $('sheetClose').focus();
  }
  function closeSheet() { $('sheet').hidden = true; document.body.classList.remove('sheet-open'); }
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBack').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
  function cardTap(e) {
    return function (ev) {
      if (!matchMedia(sheetTouch).matches) return;
      ev.preventDefault(); ev.stopPropagation();
      openSheet(e);
    };
  }
  $('copyFilterLink').addEventListener('click', function () {
    var code = LQAFilter.encodeFilterCode({ venueMode: state.venueMode, badgeMode: state.badgeMode, teamMode: state.teamMode });
    var url = location.origin + location.pathname + '?f=' + code;
    var label = $('copyFilterLabel');
    var original = label.textContent;
    navigator.clipboard.writeText(url).then(function () {
      label.textContent = 'Copied!';
      // hold, fade out, then bring the normal label back in
      setTimeout(function () {
        label.classList.add('is-fading');
        setTimeout(function () {
          label.textContent = original;
          label.classList.remove('is-fading');
        }, 400);
      }, 1200);
    });
  });

  // ---- month grid ----
  function monthBounds() {
    var dates = Object.keys(state.byDate).sort();
    if (!dates.length) return null;
    return {
      min: parseDate(dates[0]),
      max: parseDate(dates[dates.length - 1]),
    };
  }
  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }
  function renderCal() {
    var m = state.month;
    if (!m) return;
    var bounds = monthBounds();
    var next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    $('calPrev').disabled = !bounds || sameMonth(m, new Date(bounds.min.getFullYear(), bounds.min.getMonth(), 1));
    $('calNext').disabled = !bounds ||
      next.getFullYear() * 12 + next.getMonth() >= bounds.max.getFullYear() * 12 + bounds.max.getMonth();
    $('calToday').disabled = sameMonth(m, new Date());

    var grid = $('calGrid');
    grid.innerHTML = '';
    var today = todayStr();
    // Two full months at a time — this one and the next — so the near
    // future is always completely in view. Arrows slide the pair by one.
    var start = new Date(m.getFullYear(), m.getMonth(), 1);
    start.setDate(1 - start.getDay()); // back up to Sunday
    var end = new Date(m.getFullYear(), m.getMonth() + 2, 0); // next month's last day
    $('calTitle').textContent =
      m.toLocaleDateString('en-US', m.getFullYear() === next.getFullYear()
        ? { month: 'short' } : { month: 'short', year: 'numeric' }) +
      ' – ' + next.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    var loYm = m.getFullYear() * 12 + m.getMonth();
    var cells = Math.ceil((Math.round((end - start) / 86400e3) + 1) / 7) * 7;
    for (var i = 0; i < cells; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var key = ymd(d);
      var evs = filtered(state.byDate[key] || []);
      var cell = document.createElement(evs.length ? 'button' : 'div');
      cell.className = 'cal-day';
      var ym = d.getFullYear() * 12 + d.getMonth();
      // only spill days outside the two shown months go faint
      if (ym < loYm || ym > loYm + 1) cell.className += ' is-out';
      if (key === today) cell.className += ' is-today';
      if (key < today) cell.className += ' is-past';
      // Month differentiation: the card's own border frames the whole
      // calendar (it follows the rounded corners); cells only draw the
      // interior month-boundary segments, so each region still reads as
      // fully enclosed without square corners fighting the card radius.
      var nb = function (days) {
        var n = new Date(d); n.setDate(d.getDate() + days); return n.getMonth() !== d.getMonth();
      };
      if (i >= 7 && nb(-7)) cell.className += ' mo-t';
      if (i % 7 !== 0 && nb(-1)) cell.className += ' mo-l';
      var num = document.createElement('span');
      num.className = 'num';
      // each month after the first announces itself on its 1st
      if (d.getDate() === 1 && ym > loYm) {
        num.className += ' num-mo';
        num.textContent = d.toLocaleDateString('en-US', { month: 'short' });
      } else {
        num.textContent = d.getDate();
      }
      cell.appendChild(num);
      if (evs.length) {
        cell.type = 'button';
        cell.setAttribute('aria-label', d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + ', ' + evs.length + ' event' + (evs.length > 1 ? 's' : ''));
        var ticks = document.createElement('span');
        ticks.className = 'ticks';
        evs.slice(0, 6).forEach(function (e) {
          var t = document.createElement('i');
          t.style.setProperty('--dot', venueColor(e.venue));
          ticks.appendChild(t);
        });
        cell.appendChild(ticks);
        cell.dataset.date = key;
      }
      grid.appendChild(cell);
    }
  }
  $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
  $('calNext').addEventListener('click', function () { shiftMonth(1); });
  $('calToday').addEventListener('click', function () {
    var now = new Date();
    state.month = new Date(now.getFullYear(), now.getMonth(), 1);
    renderCal();
    jumpToMonth();
  });
  function shiftMonth(dir) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + dir, 1);
    renderCal();
    jumpToMonth();
  }
  // The listing follows the calendar: land on the page holding the shown
  // month's first listed day (a fully past month opens the past list instead).
  function jumpToMonth() {
    var target = ymd(state.month);
    if (target < todayStr() && !sameMonth(state.month, new Date())) {
      state.showPast = true;
      state.pastFrom = target; // nothing older than that month
      gotoPage(0);
      return;
    }
    var dates = Object.keys(state.pageByDate).sort();
    var hit = null;
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] >= target) { hit = dates[i]; break; }
    }
    if (hit == null && dates.length) hit = dates[dates.length - 1];
    if (hit != null && state.pageByDate[hit] !== state.page) gotoPage(state.pageByDate[hit]);
  }
  $('calGrid').addEventListener('click', function (e) {
    var cell = e.target.closest('button.cal-day');
    if (!cell || !cell.dataset.date) return;
    var date = cell.dataset.date;
    if (date < todayStr()) {
      // past days live above page one, behind the toggle — and a clicked
      // day is where the past list starts, not the whole year of history
      state.showPast = true;
      state.pastFrom = date;
      state.page = 0;
      renderAgenda();
    } else if (state.pageByDate[date] != null && state.pageByDate[date] !== state.page) {
      state.page = state.pageByDate[date];
      renderAgenda();
    }
    var row = document.querySelector('.day-row[data-date="' + date + '"]');
    if (row) row.scrollIntoView({ block: 'start' });
  });

  // ---- agenda ----
  // Upcoming days are paged greedily: a page spans at most two weeks AND at
  // most 15 events, whichever fills first (a day is never split, so one huge
  // day can overflow a page by itself). Past events stay behind their
  // toggle, which lives on page one only.
  var PAGE_DAYS = 14;
  var PAGE_EVENTS = 15;
  function renderAgenda() {
    var ol = $('agenda');
    ol.innerHTML = '';
    var dates = Object.keys(state.byDate).sort();
    var today = todayStr();
    var pastCount = 0;   // every past event there is
    var pastListed = 0;  // the ones the past list will actually show
    var inPast = function (d) { return d < today && (!state.pastFrom || d >= state.pastFrom); };
    var pages = [];
    var count = 0;
    state.pageByDate = {};
    dates.forEach(function (date) {
      var n = filtered(state.byDate[date]).length;
      if (!n) return;
      if (date < today) { pastCount += n; if (inPast(date)) pastListed += n; return; }
      var start = pages.length ? pages[pages.length - 1][0] : null;
      // Math.round eats the DST hour before the day count is compared
      var days = start ? Math.round((parseDate(date) - parseDate(start)) / 86400e3) : 0;
      if (!pages.length || days >= PAGE_DAYS || count + n > PAGE_EVENTS) {
        pages.push([date]);
        count = n;
      } else {
        pages[pages.length - 1].push(date);
        count += n;
      }
      state.pageByDate[date] = pages.length - 1;
    });
    if (state.page >= pages.length) state.page = Math.max(0, pages.length - 1);
    var shown = 0;
    if (pastCount && state.page === 0) {
      var tli = document.createElement('li');
      tli.className = 'past-toggle';
      var tb = document.createElement('button');
      tb.type = 'button';
      tb.textContent = state.showPast
        ? 'Hide the ' + pastListed + ' past events'
        : 'Show ' + pastCount + ' past events';
      tb.addEventListener('click', function () {
        state.showPast = !state.showPast;
        state.pastFrom = null; // the button means all of them
        renderAgenda();
      });
      tli.appendChild(tb);
      ol.appendChild(tli);
    }
    var visible = pages.length ? pages[state.page] : [];
    if (state.showPast && state.page === 0) {
      visible = dates.filter(function (d) {
        return inPast(d) && filtered(state.byDate[d]).length;
      }).concat(visible);
    }
    visible.forEach(function (date) {
      var evs = filtered(state.byDate[date]);
      shown += evs.length;
      var li = document.createElement('li');
      li.className = 'day-row' + (date === today ? ' is-today' : '') + (date < today ? ' is-past' : '');
      li.dataset.date = date;
      var d = parseDate(date);

      var rail = document.createElement('div');
      rail.className = 'date-rail';
      rail.innerHTML =
        '<span class="dnum">' + d.getDate() + '</span>' +
        '<span class="dmeta">' + d.toLocaleDateString('en-US', { weekday: 'short' }) + ' · ' +
        d.toLocaleDateString('en-US', { month: 'short' }) + '</span>';
      li.appendChild(rail);

      var wrap = document.createElement('div');
      wrap.className = 'day-events';
      evs.forEach(function (e) {
        var row = document.createElement('div');
        row.className = 'ev';
        row.addEventListener('click', cardTap(e), true);
        row.style.background = 'color-mix(in srgb, ' + venueColor(e.venue) + ' 9%, transparent)';
        // the right edge carries the event type's hue, matching its filter dot
        row.style.borderRight = '1rem solid ' + typeColor(eventType(e));
        var time = document.createElement('span');
        time.className = 'time';
        time.textContent = fmtTime(e.time);
        if (e.series) {
          // "2 of 4" under the time; the gutter graph picks the row up by id
          var sn = document.createElement('span');
          sn.className = 'series-n';
          sn.textContent = e.series.n + ' of ' + e.series.total;
          sn.title = seriesLabel(e.series.s);
          time.appendChild(sn);
          row.dataset.series = e.series.s.id;
        }
        // time keeps its own column; everything else stacks left-aligned:
        // venue, then title, then tags
        var body = document.createElement('div');
        body.className = 'ev-body';
        var venue = document.createElement('span');
        venue.className = 'venue';
        venue.appendChild(extLink(e.venue, VENUE_URL[e.venue], "See " + e.venue + "’s own events list"));
        venue.style.setProperty('--dot', venueColor(e.venue));
        var a = document.createElement('a');
        a.href = e.url || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = e.title;
        var titleLine = document.createElement('span');
        titleLine.className = 'ev-title';
        var team = teamFor(e.title);
        var mark = (team && team.logo) || VENUE_ICON[e.venue];
        if (mark) {
          var logo = document.createElement('img');
          logo.className = 'team-mark';
          logo.src = mark;
          logo.alt = ''; // decorative — the row already names the team/venue
          row.appendChild(logo);
        }
        titleLine.appendChild(a);
        body.appendChild(venue); body.appendChild(titleLine);
        // the one status worth flagging: a game the league may still move
        if (e.dateTbd) {
          var tbd = document.createElement('span');
          tbd.className = 'badge b-tbd';
          tbd.textContent = 'date tbd';
          tbd.title = 'Date not final — the league may still move this game';
          titleLine.appendChild(tbd);
        }
        row.appendChild(time); row.appendChild(body);
        wrap.appendChild(row);
      });
      li.appendChild(wrap);
      ol.appendChild(li);
    });
    if (!shown && !pastCount) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No upcoming events for this filter yet — check back after the next refresh.';
      ol.appendChild(li);
    }
    renderPager(pages);
    drawSeriesGraph();
  }

  // ---- pager: ‹ 1 2 3 › under the list, ellipsized when the year runs long ----
  function gotoPage(p) {
    state.page = p;
    renderAgenda();
    document.querySelector('.agenda').scrollIntoView({ block: 'start' });
  }
  // How many page buttons (numbers plus … gaps) there's room for. Compact:
  // seven — first, last, current±1 and two gaps. Wide: whatever fits across
  // the cards' width at the normal spacing, so the extra room shows more
  // numbers rather than stretching the gaps.
  function pagerSlots(nav) {
    if (!nav.classList.contains('pager--wide') || !matchMedia('(min-width: 641px)').matches) return 7;
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    var de = $('agenda').querySelector('.day-events');
    var width = de ? de.clientWidth : $('agenda').clientWidth - 6.2 * rem; // the cards' width — see .pager--wide
    var slot = 2 * rem + 0.4 * rem;                  // a 2rem button plus the gap
    var arrows = 2 * (2.4 * rem + 0.4 * rem);
    return Math.max(7, Math.floor((width - arrows) / slot));
  }
  // Always the first, last and current page; then the current's neighbors,
  // outward, until the slots run out (a … between non-adjacent numbers
  // takes a slot too).
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
  var lastPages = [];
  function renderPager(pages) {
    var nav = $('agendaPager');
    nav.innerHTML = '';
    lastPages = pages;
    var total = pages.length;
    // with enough pages the pager spans the listing cards' width (see
    // .pager--wide); a short one stays a compact centered cluster
    nav.classList.toggle('pager--wide', total >= 5);
    if (total < 2) return;
    var show = pagesToShow(total, state.page, pagerSlots(nav));
    var rangeLabel = function (i) {
      var ds = pages[i];
      var fmt = function (s) {
        return parseDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      };
      return fmt(ds[0]) + ' – ' + fmt(ds[ds.length - 1]);
    };
    var arrow = function (txt, target, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pg-arrow';
      b.textContent = txt;
      b.setAttribute('aria-label', label);
      if (target == null) b.disabled = true;
      else b.addEventListener('click', function () { gotoPage(target); });
      return b;
    };
    nav.appendChild(arrow('‹', state.page > 0 ? state.page - 1 : null, 'Earlier events'));
    var last = -1;
    show.forEach(function (i) {
      if (i - last > 1) {
        var gap = document.createElement('span');
        gap.className = 'pg-gap';
        gap.textContent = '…';
        nav.appendChild(gap);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = i + 1;
      b.title = rangeLabel(i);
      if (i === state.page) {
        b.className = 'pg-cur';
        b.disabled = true;
        b.setAttribute('aria-current', 'page');
      } else {
        b.addEventListener('click', (function (p) { return function () { gotoPage(p); }; })(i));
      }
      nav.appendChild(b);
      last = i;
    });
    nav.appendChild(arrow('›', state.page < total - 1 ? state.page + 1 : null, 'Later events'));
  }
  // the wide pager's slot count depends on the window width
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (lastPages.length) renderPager(lastPages); drawSeriesGraph(); }, 150);
  });

  // ---- subscribe popover ----
  // The feed follows the active filter where a pre-built file exists: the
  // default no-movies view, one hidden team, or "only" one venue. Anything
  // else falls back to the full feed.
  var icsHref = '';
  function updateSubscribe() {
    var filteredFile = null;
    var vEx = modeKeys(state.venueMode, 'ex');
    var bEx = modeKeys(state.badgeMode, 'ex');
    var tEx = modeKeys(state.teamMode, 'ex');
    var vOn = state.venues.filter(function (v) { return state.venueMode[v] !== 'ex'; });
    var movieOnly = bEx.length === 1 && bEx[0] === 'movie';
    if (!vEx.length && !tEx.length && movieOnly) {
      filteredFile = 'events-no-movies.ics'; // the default view
    } else if (!vEx.length && !bEx.length && tEx.length === 1) {
      filteredFile = 'events-no-' + tEx[0] + '.ics';
    } else if (vOn.length === 1 && !tEx.length &&
        (!bEx.length || (movieOnly && vOn[0] !== 'SIFF Cinema Uptown'))) {
      // a lone remaining venue is "only that venue"; the baseline movie
      // exclusion changes nothing unless that venue is the cinema itself
      filteredFile = 'events-venue-' + slugify(vOn[0]) + '.ics';
    }
    $('subFilterRow').hidden = !filteredFile;
    var file = (filteredFile && $('subUseFilter').checked) ? filteredFile : 'events.ics';
    icsHref = new URL(file, location.href).href;
    var webcal = icsHref.replace(/^https?:/, 'webcal:');
    $('webcalLink').href = webcal;
    $('gcalLink').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
    $('outlookLink').href = 'https://outlook.live.com/calendar/0/addfromweb?url=' +
      encodeURIComponent(icsHref) + '&name=' + encodeURIComponent('LQA Events');
    if (!$('qrPanel').hidden) renderQr();
  }
  // QR of the webcal link (scanning it on iOS subscribes directly), rendered
  // locally by the vendored qrcode.js — no third-party service involved.
  function renderQr() {
    var qr = qrcode(0, 'L');
    qr.addData(icsHref.replace(/^https?:/, 'webcal:'));
    qr.make();
    $('qrImg').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  $('qrBtn').addEventListener('click', function (ev) {
    ev.preventDefault();
    var p = $('qrPanel');
    p.hidden = !p.hidden;
    this.setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) renderQr();
  });
  $('subUseFilter').addEventListener('change', updateSubscribe);
  updateSubscribe();
  $('subscribeBtn').addEventListener('click', function () {
    var pop = $('subscribePop');
    var open = pop.hidden;
    pop.hidden = !open;
    this.setAttribute('aria-expanded', String(open));
    if (open) { $('qrPanel').hidden = true; $('qrBtn').setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.masthead-actions')) {
      $('subscribePop').hidden = true;
      $('subscribeBtn').setAttribute('aria-expanded', 'false');
    }
  });
  $('copyIcs').addEventListener('click', function (ev) {
    ev.preventDefault();
    var label = this.querySelector('span');
    navigator.clipboard.writeText(icsHref).then(function () {
      label.textContent = 'Copied';
      setTimeout(function () { label.textContent = 'Copy link'; }, 1500);
    });
  });

  if (!loadFiltersFromURL()) loadFilters();
  load();
})();
