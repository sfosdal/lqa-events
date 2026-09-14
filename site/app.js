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
    'Convention Center': '--v-scc',
    "Children's Theatre": '--v-sct',
    'MoPOP': '--v-mopop',
    'Pacific Science Center': '--v-pacsci',
    'KEXP': '--v-kexp',
    'The Traveling Goat': '--v-goat',
  };
  // Unexpected venues draw from the same cool, web-safe family as the
  // curated ones, hashed from the name so the pick is stable day to day.
  var VENUE_FALLBACK = ['#66ccff', '#9999ff', '#66ffff', '#cc66cc', '#3399ff', '#ff99ff', '#00cccc', '#6666ff'];
  function venueColor(v) {
    if (VENUE_VARS[v]) return 'var(' + VENUE_VARS[v] + ')';
    var h = 0;
    for (var i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) % 360;
    return VENUE_FALLBACK[h % VENUE_FALLBACK.length];
  }
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
    'Convention Center': 'https://seattlecc.com/upcoming-events/',
    "Children's Theatre": 'https://www.sct.org/tickets-shows/calendar/',
    'MoPOP': 'https://www.mopop.org/events',
    'The Traveling Goat': 'https://www.travelinggoatseattle.com/events',
    'Pacific Science Center': 'https://pacificsciencecenter.org/events/',
    'KEXP': 'https://www.kexp.org/events/kexp-events/',
  };

  // Venue list order = how big a crowd the place can hold (LQAFilter.
  // VENUE_CAPACITY), biggest first; a venue the table doesn't know sorts
  // after the known ones, busiest first.
  var VENUE_CAPACITY = LQAFilter.VENUE_CAPACITY;
  function venueOrder(counts) {
    return function (a, b) {
      var ca = VENUE_CAPACITY[a] || 0, cb = VENUE_CAPACITY[b] || 0;
      if (ca !== cb) return cb - ca;
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
  var state = { events: [], byDate: {}, venues: [], venueMode: {}, badgeMode: {}, teamMode: {}, q: '', holidays: false, month: null, showPast: false, pastFrom: null, series: [] };

  function modeKeys(map, mode) {
    return Object.keys(map).filter(function (k) { return map[k] === mode; });
  }
  function setChecked(map, key, on) {
    if (on) delete map[key]; else map[key] = 'ex';
  }

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  // "2026-09-05T18:27:23.798Z" → "Sep 5"
  function fmtSince(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
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
  // ---- series (detection, labels and the gutter graph live in filter.js,
  // shared with other sites that list the feed) ----
  var seriesLabel = LQAFilter.seriesLabel;
  function findSeries(list) {
    state.series = LQAFilter.findSeries(list);
  }
  // The gutter column right of the cards is sized per page for the lanes
  // the graph needs; lines take their series' venue colour and merge into
  // each card's right edge, running along it briefly at the join.
  function drawSeriesGraph() {
    var ol = $('agenda');
    var layout = document.querySelector('.agenda-layout');
    if (!state.series.length || !matchMedia('(min-width: 641px)').matches) {
      var old = ol.querySelector('.series-graph');
      if (old) old.remove();
      layout.classList.remove('has-series');
      layout.style.removeProperty('--gutter');
      return;
    }
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    var de = ol.querySelector('.day-events');
    // only the series that get a lane (filter.js: not the long nightly runs)
    var rows = Array.from(ol.querySelectorAll('.ev[data-series]')).map(function (el) {
      return { el: el, series: state.series[Number(el.dataset.series)] };
    }).filter(function (r) { return r.series.lane; });
    var dates = Array.from(ol.querySelectorAll('.day-row')).map(function (li) { return li.dataset.date; });
    LQAFilter.drawSeriesGraph(ol, rows, {
      firstDate: dates[0], lastDate: dates[dates.length - 1],
      laneWidth: 0.5 * rem, // narrow lanes: uncapped, a busy page needs five or six
      bend: 16, // the S-curve's height between the lane and the card's edge
      hug: 5,   // how far the line runs along the edge either side of the row's centre
      maxLanes: 0, // no cap: every concurrent series keeps its own lane (Steve, 2026-09-10 — a shared grey trunk hid them)
      // the gutter column exists only while a lane needs it: no lanes on
      // this page, no column, and the cards take the width. The lanes start
      // half a rem past the cards, inside the grid's 1rem gap, so the column
      // only has to hold what runs past the gap.
      onLanes: function (n) {
        layout.classList.toggle('has-series', n > 0);
        if (n > 0) layout.style.setProperty('--gutter', Math.max(0.3, n * 0.5 - 0.3) + 'rem'); else layout.style.removeProperty('--gutter');
      },
      gutterX: function (box) { return de.getBoundingClientRect().right - box.left + rem / 2; },
      // each series in its venue's colour, keyed like the card's venue label
      // (pure in dark mode, pulled toward ink in light), so the line reads
      // as part of the listing it runs into
      color: function (s) { return 'color-mix(in srgb, ' + venueColor(s.events[0].venue) + ' var(--venue-text), var(--ink))'; },
      // …and fades to the card's own face colour (its venue wash over the
      // page) across the bend, so the join dissolves into the listing
      edgeColor: function (s) { return 'color-mix(in srgb, ' + venueColor(s.events[0].venue) + ' var(--tint), var(--sky))'; },
      label: seriesLabel,
    });
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
        // within a day: all-day items first, then by clock time (a stable
        // sort keeps the feed's order among equals)
        Object.keys(state.byDate).forEach(function (dt) {
          state.byDate[dt].sort(function (a, b) {
            var ta = a.time || '', tb = b.time || '';
            return (ta ? 1 : 0) - (tb ? 1 : 0) || (ta < tb ? -1 : ta > tb ? 1 : 0);
          });
        });
        // Bars (every event typed 'bar') stay out of the venue list: the one
        // "Local Bars" type switch covers them all, so they're never in
        // venueMode and the venue presets and "only" links don't see them.
        var barOnly = {};
        list.forEach(function (e) { barOnly[e.venue] = (barOnly[e.venue] !== false) && e.type === 'bar'; });
        state.venues = Object.keys(vs).filter(function (v) { return !barOnly[v]; }).sort(venueOrder(vs));
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
            // the compact bar's copy, terser: "6min current", "3h current", "2d current"
            var terse = mins < 1 ? '' : mins < 60 ? mins + 'min ' : mins < 48 * 60 ? Math.round(mins / 60) + 'h ' : Math.round(mins / 1440) + 'd ';
            $('barUpdated').textContent = terse + 'current';
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
    { key: 'community', label: 'Festivals', title: 'Grounds events, festivals, walks, celebrations, classes, SIFF specials' },
    { key: 'expo', label: 'Conventions', title: 'Conventions, conferences, trade and consumer shows — the Convention Center, Exhibition Hall, Fisher Pavilion' },
    { key: 'bar', label: 'Neighborhood', title: 'Trivia, live music, watch parties and specials at neighborhood bars — The Traveling Goat so far' },
  ];
  // Type hues mirror the venue hues: a dot on the filter rows.
  var TYPE_VARS = {
    concert: '--t-concert', sports: '--t-sports', arts: '--t-arts',
    movie: '--t-movie', community: '--t-community', expo: '--t-expo', bar: '--t-bar',
  };
  function typeColor(k) { return 'var(' + TYPE_VARS[k] + ')'; }
  var TYPE_KEYS = {};
  TYPE_LIST.forEach(function (t) { TYPE_KEYS[t.key] = true; });
  // The baseline every visitor starts from (and "Reset filters" returns to):
  // SIFF's daily movie showings unchecked, everything else checked.
  function venueArea(v) { return LQAFilter.VENUE_AREA[v] || 'campus'; }
  // Presets: each names what's OFF in every group; `holidays` (when given)
  // sets the switch too, and the search box is left alone. Venue lists that
  // depend on the feed are functions of the venues present. `teamsOff`
  // unchecks every team (only Nothing does; the rest leave teams checked).
  // The default view (Steve's pick, 2026-09-10): the big rooms — the arena,
  // the Seattle Center grounds, McCaw Hall and the two stadiums — with
  // Movies off; every other venue starts unchecked (the Convention Center
  // included, for all its size). Bars aren't venues here, so they're
  // untouched. The Teams view is never filtered — every game shows there.
  var DEFAULT_VENUES_ON = ['Climate Pledge Arena', 'Seattle Center', 'McCaw Hall', 'Lumen Field', 'T-Mobile Park'];
  var DEFAULT_VENUES_OFF = ['MoPOP', "Children's Theatre", 'Cornish Playhouse', 'SIFF Cinema Uptown', 'Pacific Science Center',
    'The Vera Project', 'On the Boards', 'KEXP', 'Convention Center', 'Starfire Stadium'];
  var BIG_NIGHT_SEATS = 2000; // the Capacity preset's floor; McCaw Hall (2,900) is the smallest venue in
  var PRESETS = [
    { key: 'default', label: 'Default', title: 'The big rooms — ' + DEFAULT_VENUES_ON.join(', ') + ' — every team and type except Movies',
      venuesOff: function () { return DEFAULT_VENUES_OFF.slice(); }, typesOff: ['movie'], holidays: false },
    { key: 'all', label: 'Everything', title: 'Every venue, type and team, holidays too', venuesOff: function () { return []; }, typesOff: [], holidays: true },
    { key: 'none', label: 'Nothing', title: 'Everything off — build your own view from scratch',
      venuesOff: function () { return state.venues.slice(); }, typesOff: TYPE_LIST.map(function (t) { return t.key; }), teamsOff: true, holidays: false },
    { key: 'neighborhood', label: 'Neighborhood', title: 'Just Lower Queen Anne — no stadiums or Convention Center',
      venuesOff: function () { return DEFAULT_VENUES_OFF.concat(state.venues.filter(function (v) { return venueArea(v) === 'town' && DEFAULT_VENUES_OFF.indexOf(v) < 0; })); }, typesOff: ['movie'] },
    { key: 'big', label: 'Capacity > 2K', title: 'Only the places that hold ' + BIG_NIGHT_SEATS.toLocaleString('en-US') + ' or more — the stadiums, the arena, McCaw Hall',
      venuesOff: function () { return state.venues.filter(function (v) { return (VENUE_CAPACITY[v] || 0) < BIG_NIGHT_SEATS; }); }, typesOff: ['bar'] },
  ];
  function applyPreset(p) {
    state.venueMode = {}; state.badgeMode = {}; state.teamMode = {};
    p.venuesOff().forEach(function (v) { state.venueMode[v] = 'ex'; });
    p.typesOff.forEach(function (t) { state.badgeMode[t] = 'ex'; });
    if (p.teamsOff) groupInfo('team').keys.forEach(function (t) { state.teamMode[t] = 'ex'; });
    if (p.holidays !== undefined) state.holidays = p.holidays;
  }
  // Does the panel's current state equal this preset? Compares what's off in
  // each group against the preset's lists (only keys the panel shows count,
  // so a saved exclusion for a venue that left the feed can't spoil a match).
  function presetMatches(p) {
    var off = function (g) {
      var gi = groupInfo(g);
      return gi.keys.filter(function (k) { return gi.map[k] === 'ex'; }).sort().join('|');
    };
    var sorted = function (a) { return a.slice().sort().join('|'); };
    if (off('team') !== (p.teamsOff ? sorted(groupInfo('team').keys) : '')) return false;
    if (p.holidays !== undefined && state.holidays !== p.holidays) return false;
    var shown = groupInfo('venue').keys;
    return off('venue') === sorted(p.venuesOff().filter(function (v) { return shown.indexOf(v) >= 0; })) && off('badge') === sorted(p.typesOff);
  }
  function renderPresets() {
    var box = $('fpPresets');
    box.innerHTML = '';
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip fp-preset'; b.textContent = p.label; b.title = p.title; b.dataset.preset = p.key;
      b.addEventListener('click', function () { applyPreset(p); applyFilters(); });
      box.appendChild(b);
    });
  }
  function syncPresets() {
    document.querySelectorAll('.fp-preset').forEach(function (b) {
      var p = PRESETS.filter(function (x) { return x.key === b.dataset.preset; })[0];
      b.classList.toggle('is-on', !!p && presetMatches(p));
      b.setAttribute('aria-pressed', String(!!p && presetMatches(p)));
    });
  }
  function applyDefaultFilters() {
    state.badgeMode = { movie: 'ex' };
    state.venueMode = {};
    DEFAULT_VENUES_OFF.forEach(function (v) { state.venueMode[v] = 'ex'; });
  }
  function isDefaultState() {
    if (Object.keys(state.teamMode).length) return false;
    if (state.q || state.holidays) return false;
    var v = Object.keys(state.venueMode);
    if (v.length !== DEFAULT_VENUES_OFF.length || !DEFAULT_VENUES_OFF.every(function (x) { return state.venueMode[x] === 'ex'; })) return false;
    var k = Object.keys(state.badgeMode);
    return k.length === 1 && state.badgeMode.movie === 'ex';
  }
  // Matching itself lives in filter.js so other sites filtering this feed
  // (e.g. river's Neighborhood section) can't drift from these rules.
  function filtered(list) {
    return list.filter(function (e) {
      return LQAFilter.matchesFilter(e, { venueMode: state.venueMode, badgeMode: state.badgeMode, teamMode: state.teamMode })
        && LQAFilter.matchesSearch(e, state.q);
    });
  }

  // ---- holidays (off by default, a switch in the filter panel) ----
  // Computed from the rules, no feed needed; the actual date, not the
  // observed weekday shift. One merged list of what the US, Washington and
  // the City of Seattle observe: the federal set, Indigenous Peoples' Day
  // (Seattle's name for the October Monday) and the Friday after
  // Thanksgiving (WA's Native American Heritage Day). Shown as divider rows
  // in the listing, right above the day's first event.
  function nthWeekday(y, m, wd, n) { // n-th (1-based) weekday wd of month m; n < 0 counts from the end
    var d = n > 0 ? new Date(y, m, 1) : new Date(y, m + 1, 0);
    var step = n > 0 ? 1 : -1;
    while (d.getDay() !== wd) d.setDate(d.getDate() + step);
    d.setDate(d.getDate() + (Math.abs(n) - 1) * 7 * step);
    return d;
  }
  function holidaysFor(y) {
    var thanks = nthWeekday(y, 10, 4, 4);
    var friday = new Date(thanks); friday.setDate(thanks.getDate() + 1);
    return [
      [new Date(y, 0, 1), "New Year's Day"],
      [nthWeekday(y, 0, 1, 3), 'Martin Luther King Jr. Day'], // a day of service
      [nthWeekday(y, 1, 1, 3), "Presidents' Day"],
      [nthWeekday(y, 4, 1, -1), 'Memorial Day'], // the poppy
      [new Date(y, 5, 19), 'Juneteenth'],
      [new Date(y, 6, 4), 'Independence Day'],
      [nthWeekday(y, 8, 1, 1), 'Labor Day'],
      [nthWeekday(y, 9, 1, 2), "Indigenous Peoples' Day"],
      [new Date(y, 10, 11), 'Veterans Day'],
      [thanks, 'Thanksgiving'],
      [friday, 'Native American Heritage Day'], // the harvest
      [new Date(y, 11, 25), 'Christmas Day'],
    ].map(function (h) { return { date: ymd(h[0]), title: h[1] }; });
  }
  var holidayCache = {}; // year -> map date -> [rows]
  function holidayMap() {
    if (!state.holidays) return {};
    var years = {};
    var now = new Date().getFullYear();
    years[now] = years[now + 1] = true;
    Object.keys(state.byDate).forEach(function (d) { years[Number(d.slice(0, 4))] = true; });
    var map = {};
    Object.keys(years).forEach(function (y) {
      if (!holidayCache[y]) holidayCache[y] = holidaysFor(Number(y));
      holidayCache[y].forEach(function (h) { (map[h.date] = map[h.date] || []).push(h); });
    });
    return map;
  }
  // the feed's events for a day that survive the filter and the search
  function dayItems(date) { return filtered(state.byDate[date] || []); }

  // ---- filter panel ----
  // Kayak-style groups of checkbox rows, dropped open under the bar by the
  // funnel chip and closed by it or a click anywhere else.
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
  // Panel rows are plain text: the venue / type / team colours show on the
  // calendar and agenda, not here.
  function plainName(label) {
    var name = document.createElement('span');
    name.className = 'fp-name';
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
    name.appendChild(extLink(v, VENUE_URL[v], "See " + v + "’s own events list"));
    return name;
  }
  function renderFilters() {
    renderPresets();
    // Counts play the role of Kayak's price column: upcoming events each row
    // would govern, unaffected by the current filter so they stay stable.
    var today = todayStr();
    var upcoming = state.events.filter(function (e) { return e.date >= today; });
    var pv = $('panelVenues'), pt = $('panelVenuesTown');
    pv.innerHTML = ''; pt.innerHTML = '';
    state.venues.forEach(function (v) {
      var n = upcoming.filter(function (e) { return e.venue === v; }).length;
      var cap = VENUE_CAPACITY[v];
      (venueArea(v) === 'town' ? pt : pv).appendChild(filterRow('venue', v, venueName(v), n, cap ? 'Holds about ' + cap.toLocaleString('en-US') : undefined));
    });
    var pt = $('panelTeams');
    pt.innerHTML = '';
    TEAMS.forEach(function (t) {
      var name = document.createElement('span');
      name.className = 'fp-name';
      name.appendChild(extLink(t.label, t.schedule, t.label + ' schedule'));
      var n = upcoming.filter(function (e) { return t.re.test(e.title || ''); }).length;
      pt.appendChild(filterRow('team', t.slug, name, n, t.label + ' home games'));
    });
    var pb = $('panelBadges');
    pb.innerHTML = '';
    TYPE_LIST.forEach(function (t) {
      var n = upcoming.filter(function (e) { return eventType(e) === t.key; }).length;
      pb.appendChild(filterRow('badge', t.key, plainName(t.label), n, t.title));
    });
    syncFilters();
    syncPresets(); // the chips are new; light the one that matches
  }
  // Every checkbox in the panel syncs from state in one pass, so presets and
  // "only" land in the same place.
  function syncFilters() {
    syncPresets();
    document.querySelectorAll('input[data-venue]').forEach(function (c) {
      c.checked = state.venueMode[c.dataset.venue] !== 'ex';
    });
    document.querySelectorAll('input[data-badge]').forEach(function (c) {
      c.checked = state.badgeMode[c.dataset.badge] !== 'ex';
    });
    document.querySelectorAll('input[data-team]').forEach(function (c) {
      c.checked = state.teamMode[c.dataset.team] !== 'ex';
    });
    $('holidaysToggle').checked = state.holidays;
    if ($('searchBox').value.trim() !== state.q) $('searchBox').value = state.q;
    var any = !isDefaultState();
    $('filterToggle').classList.toggle('is-on', any);
  }
  // Filter choices persist per-browser (no login — just localStorage).
  function saveFilters() {
    try {
      localStorage.setItem('lqa-filters', JSON.stringify({ v: 3, venues: state.venueMode, badges: state.badgeMode, teams: state.teamMode, hol: state.holidays }));
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
        state.holidays = !!s.hol;
      } else {
        // v1 arrays: only its team exclusions survive the checkbox model
        (s.teams || []).forEach(function (k) { if (TEAM_BY_SLUG[k]) state.teamMode[k] = 'ex'; });
      }
    } catch (e) { applyDefaultFilters(); } // unreadable storage — start at the baseline
  }
  // A link built from "Copy filter link" takes over the initial view instead
  // of your saved prefs — open it, and you see exactly what was shared.
  // Interacting with the panel from there saves normally, like any visit.
  // ?f=CODE carries the checkboxes, ?s=CODE the (encoded) search term, and
  // ?h=1 the holidays switch.
  function loadFiltersFromURL() {
    var params = new URLSearchParams(location.search);
    if (params.get('s')) state.q = LQAFilter.decodeSearch(params.get('s')).trim();
    if (params.get('h') === '1') state.holidays = true;
    var code = params.get('f');
    var parsed = code == null ? null : LQAFilter.parseFilterCode(code);
    if (!parsed) return false;
    state.venueMode = parsed.venueMode;
    state.badgeMode = parsed.badgeMode;
    state.teamMode = parsed.teamMode;
    return true;
  }
  // a filter change also rewinds the agenda to its first page
  function applyFilters() { syncFilters(); renderCal(); renderAgenda(); updateSubscribe(); saveFilters(); }

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
  });
  function setPanelOpen(open) {
    $('filterPanel').hidden = !open;
    $('filterToggle').setAttribute('aria-expanded', String(open));
    if (open) fitPops(true);
  }
  function togglePanel() { setPanelOpen($('filterPanel').hidden); }
  $('filterToggle').addEventListener('click', togglePanel);
  // a click anywhere outside the panel or its chip closes it
  document.addEventListener('click', function (e) {
    if (!$('filterPanel').hidden && !e.target.closest('#filterPanel, #filterToggle')) {
      setPanelOpen(false);
    }
  });
  $('holidaysToggle').addEventListener('change', function () {
    state.holidays = this.checked;
    applyFilters();
  });
  // the search applies as you type, a beat after the last keystroke
  var searchTimer = null;
  $('searchBox').addEventListener('input', function () {
    var v = this.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      if (v === state.q) return;
      state.q = v;
      applyFilters();
    }, 180);
  });
  // ---- light / dark pill ----
  // The head script already applied a saved choice; nothing saved means the
  // page follows prefers-color-scheme. The knob sits under the stop that's
  // in effect, so with nothing saved it shows the system's side.
  var darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function currentTheme() {
    var t = document.documentElement.dataset.theme;
    return t === 'light' || t === 'dark' ? t : (darkQuery.matches ? 'dark' : 'light');
  }
  function applyTheme(t, persist) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme; // follow the system
    var cur = currentTheme();
    $('themeToggle').dataset.active = cur;
    $('themeToggle').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.theme === cur));
    });
    // only a click saves: the load-time call mirrors what the head script
    // applied (on phones that's always the system setting, and must not
    // erase a choice)
    if (persist) {
      try { localStorage.setItem('lqa-theme', t); } catch (e) { /* no storage */ }
    }
    // browser chrome follows: both theme-color metas take the chosen shade,
    // or go back to their own light/dark values while following the system
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.content = t === 'dark' ? '#141a20' : t === 'light' ? '#edf1f4' : (m.dataset.light || m.dataset.dark);
    });
  }
  applyTheme(document.documentElement.dataset.theme);
  // either stop flips the mode — clicking the active one toggles too
  $('themeToggle').addEventListener('click', function (e) {
    if (e.target.closest('button[data-theme]')) applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
  });
  // no saved choice: the knob tracks the OS setting as it changes
  darkQuery.addEventListener('change', function () {
    if (!document.documentElement.dataset.theme) applyTheme();
  });

  // ---- the mini calendar: docked or floating ----
  // Wide layout (the page at its full width): docked beside the list, always
  // shown, no toggle. Narrower: never docked — beside the list it would
  // squeeze the cards to a sliver — so a handle at the list's top-right
  // opens it as a floating panel over the list, and it closes again on a
  // day pick or a tap elsewhere (transient, so nothing is stored).
  var STACKED = '(max-width: 1023px)';
  var calFloatOpen = false;
  var calWasStacked = null;
  function syncCal() {
    var stacked = matchMedia(STACKED).matches;
    if (stacked !== calWasStacked) { calWasStacked = stacked; renderCal(); } // one month floating, two docked
    var open = !stacked || calFloatOpen;
    $('calBox').hidden = !open;
    document.querySelector('.cal-side').classList.toggle('is-float', stacked && open);
    if (stacked && open) fitPops(true);
    var t = $('calToggle');
    t.hidden = !stacked;
    t.setAttribute('aria-expanded', String(open));
    t.title = open ? 'Hide calendar' : 'Show calendar';
    t.querySelector('span').textContent = t.title;
  }
  $('calToggle').addEventListener('click', function () {
    calFloatOpen = $('calBox').hidden;
    syncCal();
  });
  function closeFloatCal() { if (calFloatOpen) { calFloatOpen = false; syncCal(); } }
  $('calGrid').addEventListener('click', function (e) {
    if (e.target.closest('button.cal-day')) closeFloatCal();
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.cal-side, #calToggle')) closeFloatCal();
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


  // ---- Teams: each home team's season, home and away ----
  // The Teams chip swaps the agenda (list and calendar) for a schedule view:
  // a strip of the home teams' crests, then the chosen team's whole season
  // from teams.json (scripts/schedules.mjs, home and away, never filtered).
  // Rows reuse the agenda's day/card markup. Each opponent's crest is a
  // button: tap it and only that opponent's games stay lit, a bar above the
  // list names them (with the club's own site for more) and the page jumps
  // to the next one; tap again, or the bar's ✕, for the whole season. The
  // view is linkable (?team=mariners) and lives in history like a page.
  var teamsData = null, teamsLoading = null;
  var teamView = { slug: null, opp: null, showPast: false, cal: false }; // played games fold away behind a button; cal = the season calendar in place of the list
  try { teamView.cal = localStorage.getItem('lqa-teams-view') === 'cal'; } catch (e) { /* no storage: the list */ } // the list/calendar choice is remembered per browser
  function loadTeams() {
    if (teamsData) return Promise.resolve(teamsData);
    if (!teamsLoading) {
      teamsLoading = fetch('teams.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { teams: {} }; })
        .catch(function () { return { teams: {} }; })
        .then(function (d) { teamsData = d; return d; });
    }
    return teamsLoading;
  }
  function teamsUrl(slug) {
    var params = new URLSearchParams(location.search);
    if (slug) params.set('team', slug); else params.delete('team');
    var q = params.toString();
    return location.pathname + (q ? '?' + q : '') + location.hash;
  }
  // open (slug) or close (null) the view; push = a history entry (a chip
  // tap), else the URL is only kept in step (load, back/forward)
  function setTeamsView(slug, push) {
    var open = !!slug;
    document.documentElement.classList.toggle('teams-open', open);
    var bn = document.querySelector('.bar-name'), h1 = document.querySelector('.masthead h1'); // the masthead and the pinned bar's title name the view: the events, or the clubs
    if (bn) { if (!bn.dataset.events) bn.dataset.events = bn.textContent; bn.textContent = open ? 'Hometown Teams' : bn.dataset.events; }
    if (h1) { if (!h1.dataset.events) h1.dataset.events = h1.innerHTML; h1.innerHTML = open ? 'Hometown Teams' : h1.dataset.events; }
    if (open) fitTeamStrip();
    $('teamsView').hidden = !open;
    document.querySelector('.agenda').hidden = open;
    $('viewToggle').dataset.active = open ? 'teams' : 'events'; // the switch's knob slides to the view on show
    $('teamsBtn').setAttribute('aria-checked', String(open)); $('eventsBtn').setAttribute('aria-checked', String(!open));
    if (push) history.pushState(null, '', teamsUrl(slug));
    if (open) {
      applyTeamView();
      // the floating panels close: they belong to the agenda
      $('filterPanel').hidden = true; $('filterToggle').setAttribute('aria-expanded', 'false');
      if (!$('subscribePop').hidden) setSubscribeOpen(false);
      teamView.opp = null;
      loadTeams().then(function () { if (!$('teamsView').hidden) renderTeams(slug); });
    } else {
      teamView.slug = null;
      clearTimeout(live.timer);
    }
    fitFilterBar();
  }
  function teamGames(slug) { return (teamsData && teamsData.teams && teamsData.teams[slug]) || null; }
  function oppKey(g) { return g.opp && (g.opp.abbrev || g.opp.name) || '?'; }
  // simple line icons for the strip: the sport, after the team's name
  var SPORT_ICONS = {
    football: '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-45 12 12)"/><path d="M9.5 14.5l5-5M10.5 11.5l2 2M11.5 10.5l2 2M9.5 12.5l2 2"/>',
    baseball: '<circle cx="12" cy="12" r="9"/><path d="M6.2 5.6c2.3 2.2 2.3 10.6 0 12.8M17.8 5.6c-2.3 2.2-2.3 10.6 0 12.8"/>',
    hockey: '<ellipse cx="12" cy="9" rx="8" ry="3.2"/><path d="M4 9v5.5c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V9"/>',
    basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8"/>',
    rugby: '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-45 12 12)"/><path d="M8.5 15.5l7-7M10 13l1.5 1.5M12 11l1.5 1.5M14 9l1.5 1.5"/>',
    soccer: '<circle cx="12" cy="12" r="9"/><path d="M12 8.2l3.8 2.8-1.5 4.5h-4.6l-1.5-4.5z"/><path d="M12 8.2V3.4M15.8 11l4.2-1.4M14.3 15.5l2.6 3.6M9.7 15.5l-2.6 3.6M8.2 11L4 9.6"/>',
  };
  function sportIcon(sport) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'sport'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = SPORT_ICONS[sport] || '';
    return svg;
  }
  function renderTeams(slug) {
    // every home team from the filter gets a tab, schedule loaded or not
    var teams = LQAFilter.TEAMS.slice();
    var strip = $('teamStrip');
    var list = $('teamSched'); list.innerHTML = '';
    if (!teams.some(function (t) { return t.slug === slug; })) slug = teams[0].slug;
    teamView.slug = slug;
    // The strip is built once and kept: a switch only moves the pressed
    // state (and refreshes the game counts), so the crests never reload or
    // shift under the pointer.
    if (!strip.children.length) {
      teams.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'team-tab'; b.dataset.slug = t.slug;
        if (t.logo) { var img = document.createElement('img'); img.src = t.logo; img.alt = ''; img.width = 40; img.height = 40; b.appendChild(img); }
        var l = document.createElement('span'); l.textContent = t.label; b.appendChild(l);
        if (t.sport && SPORT_ICONS[t.sport]) b.appendChild(sportIcon(t.sport)); // hidden with the name in crest-only mode
        b.addEventListener('click', function () { if (t.slug !== teamView.slug) { teamView.opp = null; teamView.showPast = false; history.replaceState(null, '', teamsUrl(t.slug)); renderTeams(t.slug); } });
        strip.appendChild(b);
      });
    }
    teams.forEach(function (t) {
      var b = strip.querySelector('.team-tab[data-slug="' + t.slug + '"]');
      var n = (teamGames(t.slug) || []).length;
      b.setAttribute('aria-pressed', String(t.slug === slug));
      b.title = t.label + (n ? ' — ' + n + ' games' : ' — schedule not loaded yet');
    });
    fitTeamStrip();
    var team = LQAFilter.TEAMS.filter(function (t) { return t.slug === slug; })[0];
    if (!teamGames(slug)) { // no season data for this one (yet): say so, point at the club's own schedule
      var none = document.createElement('li'); none.className = 'empty';
      none.appendChild(document.createTextNode('No ' + team.label + ' schedule loaded yet' + (team.schedule ? ' — ' : '.')));
      if (team.schedule) { var a = document.createElement('a'); a.href = team.schedule; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'their schedule ↗'; none.appendChild(a); }
      list.appendChild(none);
      renderTeamFocus(null); $('teamCal').innerHTML = ''; $('teamHead').innerHTML = ''; return;
    }
    var all = teamGames(slug).slice().sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
    var today = todayStr(), lastMonth = null, group = null, dayBox = null, lastDate = null;
    // the season so far folds away: a line at the top says how many games
    // have been played and opens them (this team, this visit)
    var played = all.filter(function (g) { return g.date < today; });
    var games = teamView.showPast ? all : all.filter(function (g) { return g.date >= today; });
    if (played.length) {
      var fold = document.createElement('li'); fold.className = 'team-fold';
      var fb = document.createElement('button'); fb.type = 'button'; fb.className = 'chip';
      fb.textContent = (teamView.showPast ? 'Hide the ' : 'Show the ') + played.length + ' played game' + (played.length === 1 ? '' : 's');
      fb.addEventListener('click', function () { teamView.showPast = !teamView.showPast; renderTeams(teamView.slug); });
      fold.appendChild(fb); list.appendChild(fold);
    }
    if (!games.length) list.appendChild(renderSeasonNext(team, all)); // nothing left to play: a look at the season past and the one ahead
    // the feed's own listing for a home game, when it has one: its ticket link
    var feedByDate = {};
    state.events.forEach(function (e) { if (team.re.test(e.title || '') && e.venue === team.venue) feedByDate[e.date] = e; });
    games.forEach(function (g) {
      var month = g.date.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        group = document.createElement('li'); group.className = 'month-group';
        var mr = document.createElement('div'); mr.className = 'month-row';
        var ms = document.createElement('span'); ms.textContent = parseDate(g.date).toLocaleDateString('en-US', { month: 'long' });
        mr.appendChild(ms); group.appendChild(mr); list.appendChild(group);
        lastDate = null;
      }
      if (g.date !== lastDate) {
        lastDate = g.date;
        var d = parseDate(g.date);
        var li = document.createElement('div');
        li.className = 'day-row' + (g.date === today ? ' is-today' : '') + (g.date < today ? ' is-past' : '');
        li.dataset.date = g.date;
        var rail = document.createElement('div');
        rail.className = 'date-rail';
        rail.innerHTML = '<span class="dnum">' + d.getDate() + '</span><span class="dmeta">' + d.toLocaleDateString('en-US', { weekday: 'long' }) + '</span>';
        li.appendChild(rail);
        dayBox = document.createElement('div'); dayBox.className = 'day-events';
        li.appendChild(dayBox); group.appendChild(li);
      }
      var row = document.createElement('div');
      row.className = 'ev' + (g.home ? ' is-home' : ' is-away');
      row.dataset.opp = oppKey(g);
      // the home building's wash for a home game; away games stay on the page
      if (g.home) row.style.background = 'color-mix(in srgb, ' + venueColor(team.venue) + ' var(--tint), transparent)';
      var time = document.createElement('span'); time.className = 'time';
      time.textContent = g.tbd || !g.time ? 'TBD' : fmtTime(g.time);
      row.appendChild(time);
      var body = document.createElement('div'); body.className = 'ev-body';
      var where = document.createElement('span'); where.className = 'venue' + (g.home ? '' : ' is-away');
      if (g.home) { where.style.setProperty('--dot', venueColor(team.venue)); where.textContent = team.venue; }
      else where.textContent = '@ ' + (g.venue || g.opp.name);
      body.appendChild(where);
      var title = document.createElement('span'); title.className = 'ev-title';
      var a = document.createElement('a');
      var feed = g.home && feedByDate[g.date];
      a.href = feed && feed.url ? feed.url : (g.home ? team.schedule : (g.opp.site || team.schedule));
      a.target = '_blank'; a.rel = 'noopener';
      a.textContent = (g.home ? 'vs ' : 'at ') + g.opp.name;
      a.title = g.home ? (feed && feed.url ? 'Tickets' : team.label + ' schedule') : (g.opp.site ? g.opp.name + ' — their site' : team.label + ' schedule');
      title.appendChild(a);
      if (g.playoff) { var pb = document.createElement('span'); pb.className = 'badge b-playoff'; pb.textContent = 'playoff'; title.appendChild(pb); }
      if (g.pre) { var pr = document.createElement('span'); pr.className = 'badge b-pre'; pr.textContent = 'preseason'; title.appendChild(pr); }
      if (g.tbd) { var tb = document.createElement('span'); tb.className = 'badge b-tbd'; tb.textContent = 'time tbd'; title.appendChild(tb); }
      body.appendChild(title);
      if (g.watch && ((g.watch.tv || []).length || (g.watch.radio || []).length)) {
        var w = document.createElement('span'); w.className = 'ev-watch';
        [['tv', 'TV'], ['radio', 'Radio']].forEach(function (k) {
          if (!g.watch[k[0]] || !g.watch[k[0]].length) return;
          if (w.childNodes.length) w.appendChild(document.createTextNode(' · '));
          var b = document.createElement('b'); b.textContent = k[1] + ' ';
          w.appendChild(b); w.appendChild(document.createTextNode(g.watch[k[0]].join(', ')));
        });
        body.appendChild(w);
      }
      row.appendChild(body);
      // the opponent's crest: a button that lights up just their games
      var ob = document.createElement('button');
      ob.type = 'button'; ob.className = 'opp-btn'; ob.title = 'Just the games against the ' + (g.opp.short || g.opp.name);
      if (g.opp.logo) { var om = document.createElement('img'); om.className = 'team-mark opp-mark'; om.src = g.opp.logo; om.alt = ''; om.width = 46; om.height = 46; ob.appendChild(om); }
      else { var ot = document.createElement('span'); ot.className = 'opp-abbr'; ot.textContent = g.opp.abbrev || '?'; ob.appendChild(ot); }
      var key = oppKey(g);
      ob.addEventListener('click', function () { focusOpp(teamView.opp === key ? null : key, g.opp); });
      row.appendChild(ob); // just the opponent's crest: ours is in the bar and the block already
      dayBox.appendChild(row);
    });
    // the postseason's rounds, at the foot of the list: a row each, dashed, until the club is in and the real games take their place
    var rounds = teamPostseason(slug);
    if (rounds.length) {
      var pg = document.createElement('li'); pg.className = 'month-group is-post';
      var pr = document.createElement('div'); pr.className = 'month-row'; var pspan = document.createElement('span'); pspan.textContent = 'Postseason'; pr.appendChild(pspan); pg.appendChild(pr);
      rounds.forEach(function (r) {
        var d = parseDate(r.start), li = document.createElement('div'); li.className = 'day-row is-post'; li.dataset.date = r.start;
        var rail = document.createElement('div'); rail.className = 'date-rail';
        var e = parseDate(r.end); // the rail: the first day large, then the span ("Oct 3–10", "Sep 29 – Oct 1") or the weekday
        rail.innerHTML = '<span class="dnum">' + d.getDate() + '</span><span class="dmeta">' + (r.start === r.end ? d.toLocaleDateString('en-US', { weekday: 'short' }) + ', ' + d.toLocaleDateString('en-US', { month: 'short' }) : d.getMonth() === e.getMonth() ? d.toLocaleDateString('en-US', { month: 'short' }) + ' ' + d.getDate() + '–' + e.getDate() : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</span>';
        li.appendChild(rail);
        var pbox = document.createElement('div'); pbox.className = 'day-events'; li.appendChild(pbox);
        var prow = document.createElement('div'); prow.className = 'ev is-post'; pbox.appendChild(prow);
        var ptime = document.createElement('span'); ptime.className = 'time'; ptime.textContent = r.tbd ? 'TBA' : ''; prow.appendChild(ptime);
        var pbody = document.createElement('div'); pbody.className = 'ev-body'; prow.appendChild(pbody);
        var pwhere = document.createElement('span'); pwhere.className = 'venue is-away'; pwhere.textContent = r.site || roundSpan(r); pbody.appendChild(pwhere);
        var ptitle = document.createElement('span'); ptitle.className = 'ev-title'; ptitle.textContent = r.name + ' '; pbody.appendChild(ptitle);
        var badge = document.createElement('span'); badge.className = 'badge b-post'; badge.textContent = r.tbd ? 'if they qualify · dates TBA' : 'if they qualify'; ptitle.appendChild(badge);
        pg.appendChild(li);
      });
      list.appendChild(pg);
    }
    renderTeamFocus(null);
    renderTeamCal(team, all, today);
    // land on the next game, under the bar (with the played games folded
    // that is the top of the list)
    var next = list.querySelector('.day-row:not(.is-past)');
    if (next && teamView.showPast) next.scrollIntoView({ block: 'start', behavior: 'instant' });
    else if (!teamView.showPast) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  // The season calendar beside the list, in the style of the schedule
  // posters: one card per month from the first game's to the last's, every
  // game day a solid cell (home) or a pale one (away) with the opponent's
  // abbreviation and the start time. A cell jumps the list to that day.
  function lum(hex) { // relative luminance of a #rrggbb
    var n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function teamCalTime(g) {
    if (g.tbd || !g.time) return 'TBD';
    var hm = g.time.split(':'), h = Number(hm[0]);
    return (h % 12 || 12) + ':' + (hm[1] || '00') + (h < 12 ? 'a' : ''); // mornings marked; the rest are evenings, like the posters
  }
  // The crest at the row's far end: the opponent's mark, or, for a club
  // with no mark on file (some rugby sides), a disc with its abbreviation.
  function oppCrest(logo, name, abbr, title, site) {
    var el;
    if (logo) { el = document.createElement('img'); el.className = 'tf-opp'; el.src = logo; el.alt = name || ''; el.width = 96; el.height = 96; }
    else { el = document.createElement('span'); el.className = 'tf-opp tf-opp-abbr'; el.textContent = String(abbr || '?').slice(0, 3).toUpperCase(); }
    el.title = title || name || '';
    return crestLink(el, site, name);
  }
  // a crest opens its club's site in a new tab (the image itself is the control, so the row's layout is untouched)
  function crestLink(el, site, name) {
    if (!site) return el;
    el.classList.add('is-link'); el.setAttribute('role', 'link'); el.tabIndex = 0; el.title = (el.title ? el.title + ' — ' : '') + 'their site';
    el.setAttribute('aria-label', (name || 'the club') + ', their site');
    function go() { window.open(site, '_blank', 'noopener'); }
    el.addEventListener('click', go);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    return el;
  }
  function teamSite(team) { return team.site || (team.schedule ? team.schedule.replace(/\/(schedule|fixtures)[^]*$/i, '') : null); } // the club's home page: its schedule page's parent
  // ---- the postseason, until the real games arrive ----
  // The league's rounds for the season (teams.json postseason, hand-kept in
  // scripts/data/postseason.json): the ones still ahead, minus any round
  // the schedule already carries a real playoff game for.
  function teamPostseason(slug) {
    var ps = teamsData && teamsData.postseason && teamsData.postseason[slug];
    if (!ps || !ps.rounds) return [];
    var today = todayStr(), games = teamGames(slug) || [];
    return ps.rounds.filter(function (r) { return r.end >= today && !games.some(function (g) { return g.playoff && g.date >= r.start && g.date <= r.end; }); });
  }
  function roundSpan(r) { // "Sep 29 – Oct 1", or the one day
    var a = parseDate(r.start), b = parseDate(r.end), f = { month: 'short', day: 'numeric' };
    return r.start === r.end ? a.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : a.toLocaleDateString('en-US', f) + ' – ' + b.toLocaleDateString('en-US', f);
  }
  // ---- between seasons: in place of the empty list ----
  // The season just gone in numbers — the record and the standing, the home
  // record, the last five, when it ran — and what the next one holds: the
  // hand-written outlook (outlook.json) and when it opens, from the league's
  // usual calendar until the schedule itself arrives.
  var OPENS = { mariners: 'late March', kraken: 'early October', seahawks: 'September', storm: 'May', sounders: 'late February', reign: 'March', torrent: 'late November', seawolves: 'March' };
  function renderSeasonNext(team, all) {
    function esc(x) { return String(x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    var form = (teamsData && teamsData.form && teamsData.form[team.slug]) || {};
    var played = all.filter(function (g) { return g.res && !g.pre; });
    var li = document.createElement('li'); li.className = 'season-next';
    var head = document.createElement('h3'); head.className = 'sn-title'; head.textContent = 'Next season'; li.appendChild(head);
    var blurb = document.createElement('p'); blurb.className = 'sn-blurb'; li.appendChild(blurb);
    loadOutlook().then(function (d) { if (d[team.slug]) blurb.textContent = d[team.slug]; else blurb.remove(); });
    var facts = document.createElement('div'); facts.className = 'sn-facts'; li.appendChild(facts);
    function fact(html) { var p = document.createElement('p'); p.innerHTML = html; facts.appendChild(p); }
    var record = form.record && !/^0-0(-0)?$/.test(form.record) ? form.record : played.length ? recordFrom(played) : null;
    var standing = (form.standing || '').replace(/ Conference Division$/, ' Conference');
    if (record) fact('<b>The season</b> ' + esc(record) + (standing ? ' · ' + esc(standing) : ''));
    var homeG = played.filter(function (g) { return g.home; });
    if (homeG.length) {
      var p = document.createElement('p'); p.innerHTML = '<b>At ' + esc(team.venue) + '</b> ' + esc(form.home && !/^0-0(-0)?$/.test(form.home) ? form.home : recordFrom(homeG));
      var five = played.slice(-5);
      if (five.length) { p.appendChild(document.createTextNode(' · ')); var b = document.createElement('b'); b.textContent = 'Last ' + five.length + ' '; p.appendChild(b); var run = document.createElement('span'); run.className = 'tf-run'; five.forEach(function (g) { var i = document.createElement('i'); i.className = 'r-' + resLetter(g); i.textContent = resLetter(g); i.title = gameLine(g) + ' ' + g.res.us + '–' + g.res.them; run.appendChild(i); }); p.appendChild(run); }
      facts.appendChild(p);
    }
    if (all.length) {
      var fmtD = function (d) { return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
      fact('<b>Ran</b> ' + esc(fmtD(all[0].date) + ' – ' + fmtD(all[all.length - 1].date)) + ' · ' + all.length + ' games, ' + all.filter(function (g) { return g.home; }).length + ' at home');
    }
    if (form.prev && form.prev.record) fact('<b>' + esc(form.prev.season) + '</b> ' + esc(form.prev.record) + esc(form.prev.seed ? (form.prev.seed <= 8 ? ' · playoff seed ' + form.prev.seed : ' · missed the playoffs') : form.prev.rank ? ' · ' + ordinal(form.prev.rank) + ' in the table' : ''));
    if (OPENS[team.slug]) fact('<b>Opens</b> ' + esc(OPENS[team.slug]) + ' <span class="sn-soft">(the usual; the schedule fills in here once the league publishes it)</span>');
    return li;
  }
  // ---- the form block at the top of the calendar view ----
  // What the club is doing, by where the season stands: before it starts, the
  // opener and the outlook blurb; in season, the record, the standing, the
  // last five and the next game; just over, the final line; long over, the
  // outlook again. Records and standings come with teams.json (form), the
  // blurbs from outlook.json (hand-written).
  var outlookData = null, outlookLoading = null;
  function loadOutlook() {
    if (outlookData) return Promise.resolve(outlookData);
    if (!outlookLoading) outlookLoading = fetch('outlook.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (d) { outlookData = d; return d; });
    return outlookLoading;
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function gameLine(g) { // "Thu Sep 11 at Athletics"
    return parseDate(g.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + (g.home ? 'vs ' : 'at ') + (g.opp.short || g.opp.name);
  }
  function resLetter(g) { return g.res.won ? 'W' : g.res.us === g.res.them ? 'D' : 'L'; }
  function recordFrom(games) { // W-L(-D) from the results, for a club with no standings line
    var w = 0, l = 0, d = 0;
    games.forEach(function (g) { var r = resLetter(g); if (r === 'W') w++; else if (r === 'D') d++; else l++; });
    return w + '-' + l + (d ? '-' + d : '');
  }
  function renderTeamForm(team, games, today) {
    function esc(x) { return String(x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    var form = (teamsData && teamsData.form && teamsData.form[team.slug]) || {};
    var played = games.filter(function (g) { return g.date < today && g.res && !g.pre; }); // the record and the last five: the season proper, not the preseason
    var upcoming = games.filter(function (g) { return g.date >= today; });
    var last = games[games.length - 1], next = upcoming[0] || null;
    var daysOver = upcoming.length ? 0 : Math.round((parseDate(today) - parseDate(last.date)) / 864e5);
    var stage = !played.length && upcoming.length ? 'pre' : upcoming.length ? 'in' : daysOver <= 60 ? 'over' : 'off';
    var record = played.length ? (form.record && !/^0-0(-0)?$/.test(form.record) ? form.record : recordFrom(played)) : null;
    var standing = (form.standing || '').replace(/ Conference Division$/, ' Conference');
    var homeRec = played.length ? (form.home && !/^0-0(-0)?$/.test(form.home) ? form.home : recordFrom(played.filter(function (g) { return g.home; }))) : null;
    var five = played.slice(-5);
    // the same skeleton as a game: our crest, the season's bug, the column
    // beside it, the next opponent's crest, the news; the watch strip along
    // the foot for the next game
    var box = document.createElement('div'); box.className = 'team-form is-live is-season has-bug is-' + stage;
    var main = document.createElement('div'); main.className = 'tf-main'; box.appendChild(main);
    var row = document.createElement('div'); row.className = 'tf-row'; main.appendChild(row);
    if (team.logo) { var im = document.createElement('img'); im.src = team.logo; im.alt = ''; im.width = 56; im.height = 56; im.title = 'Seattle ' + team.label; row.appendChild(crestLink(im, teamSite(team), 'Seattle ' + team.label)); }
    var body = document.createElement('div'); body.className = 'tf-body'; row.appendChild(body);
    var inner = document.createElement('div'); inner.className = 'tf-inner'; body.appendChild(inner);
    var cluster = document.createElement('div'); cluster.className = 'tf-cluster'; inner.appendChild(cluster);
    var head = document.createElement('div'); head.className = 'tf-head'; cluster.appendChild(head); // the compact bar's line: the record and the standing
    if (stage === 'pre') head.innerHTML = '<span class="tf-title">Season ahead</span>';
    else if (stage === 'off') head.innerHTML = '<span class="tf-title">Off-season</span>' + (record ? '<span class="tf-standing">' + esc(record) + '</span>' : '');
    else head.innerHTML = '<span class="tf-record">' + esc(record) + '</span>' + (standing ? '<span class="tf-standing">' + esc(standing) + '</span>' : '');
    var home = document.createElement('p'); home.className = 'tf-where'; cluster.appendChild(home); // the home ground along the top of the bug
    var bugwrap = document.createElement('div'); bugwrap.className = 'tf-bugwrap'; cluster.appendChild(bugwrap);
    bugwrap.appendChild(buildSeasonBug(team, stage, record, standing, homeRec, five, played, upcoming, form));
    var lines = document.createElement('div'); lines.className = 'tf-lines'; cluster.appendChild(lines);
    // the top of the news column: the next game (or the last), last season, the outlook
    var lead = document.createElement('div'); lead.className = 'tf-lines tf-lead';
    var hl = document.createElement('a'); hl.textContent = team.venue; hl.target = '_blank'; hl.rel = 'noopener'; hl.title = 'On Google Maps';
    hl.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(team.venue + ', Seattle, WA'); home.appendChild(hl);
    function line(cls, html) { var p = document.createElement('p'); p.className = cls; p.innerHTML = html; lead.appendChild(p); return p; }
    if (next) line('tf-next', '<b>' + (stage === 'pre' ? (next.pre ? 'Preseason' : 'Opens') : 'Next') + '</b> ' + esc(gameLine(next)) + (next.time && !next.tbd ? ', ' + esc(fmtTime(next.time)) : '')); // before the season: the next game, named for what it is (a preseason game, or the opener)
    else if (last && last.res) line('tf-next', '<b>Last game</b> ' + esc(gameLine(last)) + ', ' + (last.res.won ? 'won ' : last.res.us === last.res.them ? 'drew ' : 'lost ') + last.res.us + '–' + last.res.them);
    if (form.prev && form.prev.record) { // last season, from ESPN's record for the season before (its "playoff seed" runs past the bracket for the clubs that missed it)
      var pv = form.prev, tail = pv.seed ? (pv.seed <= 8 ? ' · playoff seed ' + pv.seed : ' · missed the playoffs') : pv.rank ? ' · ' + ordinal(pv.rank) + ' in the table' : '';
      line('tf-series', '<b>' + esc(pv.season) + '</b> ' + esc(pv.record) + esc(tail));
    }
    if (stage === 'pre') { // the hand-written outlook (once a season is over it sits in the panel below the block instead)
      var blurb = document.createElement('p'); blurb.className = 'tf-blurb'; lead.appendChild(blurb);
      loadOutlook().then(function (d) { if (d[team.slug]) blurb.textContent = d[team.slug]; else blurb.remove(); foldNews(); });
    }
    var oppG = next || (played.length ? played[played.length - 1] : null); // the crest at the other end: the next opponent's (the last one's, after the season)
    if (oppG && oppG.opp) { row.appendChild(vsLine(team.label, oppG.home, oppG.opp.short || oppG.opp.name)); row.appendChild(oppCrest(oppG.opp.logo, oppG.opp.name, oppG.opp.abbrev || oppG.opp.short || oppG.opp.name, (next ? 'Next: ' : 'Last: ') + (oppG.opp.name || ''), oppG.opp.site)); } // the compact bar's "at"/"vs" and the opponent's crest
    var side = buildFormSide(form, lead.childNodes.length ? lead : null);
    if (side) box.appendChild(side);
    var strip = buildWatchStrip(next && next.watch ? next.watch.tv || [] : [], next && next.watch ? next.watch.radio : null, '', team); // the strip, as in every state
    box.appendChild(strip);
    inner.appendChild(buildBrief(lead, strip)); // the pinned bar's run
    return box;
  }
  // The season in the scorebug's frame: the standing along the top (last
  // season's line at the right); a row for the club — the record, the last
  // five — and a row for home — the home record, the last game played;
  // before a season, the opener and the home opener instead.
  function buildSeasonBug(team, stage, record, standing, homeRec, five, played, upcoming, form) {
    function esc(x) { return String(x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    var col = '#' + String((team.colors || [])[0] || '555').replace(/^#/, '');
    var top = stage === 'pre' ? 'Season ahead' : stage === 'off' ? 'Off-season' : stage === 'over' ? 'Season over' + (standing ? ' · ' + standing : '') : (standing || 'This season');
    var right = form.prev && form.prev.record ? form.prev.season + ' ' + form.prev.record : '';
    var r1 = '', r2 = '', s1 = record || '–', s2 = homeRec || '–';
    if (five.length) r1 = '<span class="tf-run">' + five.map(function (g) { return '<i class="r-' + resLetter(g) + '" title="' + esc(gameLine(g) + ' ' + g.res.us + '–' + g.res.them) + '">' + resLetter(g) + '</i>'; }).join('') + '</span>';
    var last = played[played.length - 1];
    if (last) r2 = esc(gameLine(last) + ' ' + (last.res.won ? 'W' : last.res.us === last.res.them ? 'D' : 'L') + ' ' + last.res.us + '–' + last.res.them);
    if (stage === 'pre' && upcoming.length) { var reg = upcoming.filter(function (g) { return !g.pre; }), ho = reg.filter(function (g) { return g.home; })[0]; r1 = 'Opens ' + esc(gameLine(reg[0] || upcoming[0])); r2 = ho ? 'Home opener ' + esc(gameLine(ho)) : ''; } // the season proper opens after any preseason
    var b = document.createElement('div'); b.className = 'tf-bug is-generic is-season-bug';
    b.innerHTML = '<div class="bug-top"><span class="bug-pitcher">' + esc(top) + '</span>' + (right ? '<span class="bug-pc">' + esc(right) + '</span>' : '') + '</div>' +
      '<div class="bug-grid bug-grid-2">' +
      '<span class="bug-team" style="background:' + col + '">SEA</span><span class="bug-score">' + esc(s1) + '</span><span class="bug-ev">' + r1 + '</span>' +
      '<span class="bug-team bug-team-soft">HOME</span><span class="bug-score">' + esc(s2) + '</span><span class="bug-ev">' + r2 + '</span></div>';
    return b;
  }
  // The block's right column: the latest written pieces from ESPN's team
  // feed (recent and newsy); a club ESPN doesn't cover gets the season's
  // Wikipedia lead instead. Shared by the season and the live blocks.
  // The pieces come from several outlets (ESPN, the Seattle Times, the
  // club's own site, the fan sites), each tagged with its source. The fold:
  // as many as fit beside the crests (foldNews measures once the block is
  // on the page; three until then), the rest behind the arrow at the lower
  // right (open stays open across redraws). `lead` is a block for the top of
  // the column — the pregame's starters and the leaders out.
  var NEWS_SHOWN = 3, newsOpen = false;
  function buildFormSide(form, lead) {
    if (lead || (form.news && form.news.length) || (form.wiki && form.wiki.text)) {
      var side = document.createElement('div'); side.className = 'tf-wiki';
      var cols = document.createElement('div'); cols.className = 'tf-cols'; side.appendChild(cols); // the lead and the news: one column beside the crests, two once the column wraps under the row
      if (lead) cols.appendChild(lead);
      if (form.news && form.news.length) {
        var ul = document.createElement('ul'); ul.className = 'tf-news';
        form.news.forEach(function (n, i) {
          var li = document.createElement('li');
          if (i >= NEWS_SHOWN) li.className = 'is-more';
          var a = document.createElement('a'); a.href = n.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = n.headline; li.appendChild(a);
          var meta = [n.source, n.date && parseDate(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })].filter(Boolean);
          if (meta.length) { var dt = document.createElement('span'); dt.className = 'tf-date'; dt.textContent = meta.join(' · '); li.appendChild(dt); }
          if (n.text) { var p = document.createElement('p'); p.textContent = n.text; li.appendChild(p); }
          ul.appendChild(li);
        });
        cols.appendChild(ul);
        if (form.news.length > 1) { // the arrow, lower right: the rest of the pieces (shown only while some are folded)
          side.classList.toggle('has-more', form.news.length > NEWS_SHOWN);
          var more = document.createElement('button'); more.type = 'button'; more.className = 'tf-more';
          more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
          function setOpen(open) { newsOpen = open; side.classList.toggle('is-open', open); more.title = open ? 'Fewer' : 'More news'; more.setAttribute('aria-label', more.title); more.setAttribute('aria-expanded', open ? 'true' : 'false'); if (!open) foldNews(side); }
          setOpen(newsOpen);
          more.addEventListener('click', function () { setOpen(!newsOpen); });
          side.appendChild(more);
        }
      } else if (form.wiki && form.wiki.text) {
        var wp = document.createElement('p'); wp.textContent = form.wiki.text; side.appendChild(wp);
      }
      return side;
    }
    return null;
  }
  // The fold, measured: the column may run as tall as the rest of the block
  // (the crests, or the game cluster, whichever is taller) and no taller;
  // every piece whose bottom would pass that line goes behind the arrow.
  // Under the row (the narrow layout, where the column sits below the
  // crests) the count fold stands instead. Called once a block is on the
  // page and again when the window is resized.
  var ARROW_ROOM = 1.1; // rem: the arrow's row at the foot of the column (.tf-wiki.has-more padding)
  function foldNews(side) {
    side = side || document.querySelector('#teamHead .tf-wiki');
    if (!side || !side.isConnected || side.classList.contains('is-open') || $('teamHead').classList.contains('is-compact')) return;
    var items = side.querySelectorAll('.tf-news li');
    if (!items.length) return;
    var box = side.parentNode, narrow = window.matchMedia('(max-width: 760px)').matches;
    var hidden = 0;
    // the column under the row rather than beside the crests (the block wrapped): styles.css lays the lead and the news side by side, the column as tall as the lead
    var mainEl = box.querySelector(':scope > .tf-main'), lead = side.querySelector('.tf-lead');
    var wrapped = !!mainEl && side.getBoundingClientRect().top >= mainEl.getBoundingClientRect().bottom - 1;
    box.classList.toggle('is-wrapped', wrapped);
    if (narrow) {
      items.forEach(function (li, i) { li.classList.toggle('is-more', i >= NEWS_SHOWN); if (i >= NEWS_SHOWN) hidden++; });
    } else {
      var limit = 0; // the tallest thing beside the column
      box.querySelectorAll(':scope > img, :scope > .tf-body, :scope > .tf-main').forEach(function (el) { limit = Math.max(limit, el.offsetHeight); });
      if (wrapped && lead) limit = Math.max(limit, lead.offsetHeight); // beside the lead, the news may run as tall as it does
      var rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      side.classList.add('is-measuring'); // every piece laid out, from the top
      var bottoms = Array.prototype.map.call(items, function (li) { return li.offsetTop + li.offsetHeight; });
      side.classList.remove('is-measuring');
      var fits = bottoms.filter(function (b) { return b <= limit; }).length;
      if (fits < items.length) fits = Math.max(1, bottoms.filter(function (b) { return b <= limit - ARROW_ROOM * rem; }).length); // the arrow needs its row
      items.forEach(function (li, i) { li.classList.toggle('is-more', i >= fits); if (i >= fits) hidden++; });
    }
    side.classList.toggle('has-more', hidden > 0);
  }
  // The crests either side of a game sit level with the scorebug, not with
  // the cluster as a whole (the venue line above it and the lines below
  // would pull them down): measured once the block is on the page, set as
  // a top margin on the row. Redone with the fold on every redraw and resize.
  function alignCrests() {
    var row = document.querySelector('#teamHead .team-form.is-live .tf-row'), bug = row && row.querySelector('.tf-bug');
    if (!row || !row.isConnected || $('teamHead').classList.contains('is-compact')) return;
    if (!bug) { row.style.removeProperty('--crest-top'); return; }
    row.style.removeProperty('--crest-top'); // measure from the plain layout
    var rr = row.getBoundingClientRect(), br = bug.getBoundingClientRect(), centre = br.top - rr.top + br.height / 2;
    var imgs = row.querySelectorAll(':scope > img'), tallest = 0;
    imgs.forEach(function (i) { tallest = Math.max(tallest, i.offsetHeight); });
    row.style.setProperty('--crest-top', Math.max(0, Math.round(centre - tallest / 2)) + 'px');
  }
  // the watch strip keeps to one line: when the ways to watch run past it, the chevron at its right end shows (and unfolds them)
  function foldWatch() {
    document.querySelectorAll('#teamHead .tf-watch').forEach(function (w) {
      if (w.classList.contains('is-open')) return;
      var ch = w.querySelector('.tf-channels');
      w.classList.toggle('has-more', !!ch && ch.scrollHeight > ch.clientHeight + 2);
    });
  }
  function settleBlock() { foldNews(); alignCrests(); foldWatch(); }
  var foldPending = false;
  window.addEventListener('resize', function () { if (!foldPending) { foldPending = true; requestAnimationFrame(function () { foldPending = false; settleBlock(); }); } });
  // ---- where to watch: the networks ESPN names, looked up in channels.json ----
  var CAST_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 12a9 9 0 0 1 8 8"/><path d="M2 16a5 5 0 0 1 4 4"/><path d="M2 20h.01"/></svg>';
  var channelsData = null, channelsLoading = null;
  function loadChannels() {
    if (channelsData) return Promise.resolve(channelsData);
    if (!channelsLoading) channelsLoading = fetch('channels.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { channels: [] }; }).catch(function () { return { channels: [] }; }).then(function (d) { channelsData = d; return d; });
    return channelsLoading;
  }
  function channelInfo(name) {
    var list = (channelsData && channelsData.channels) || [];
    for (var i = 0; i < list.length; i++) { try { if (new RegExp(list[i].match, 'i').test(name)) return list[i]; } catch (e) { /* bad pattern: skip */ } }
    return null;
  }
  // an entry's link: the longest name in channels.json's links the text contains
  function watchLink(text) {
    var links = (channelsData && channelsData.links) || {}, best = null, t = String(text).toLowerCase();
    Object.keys(links).forEach(function (k) { if (k !== '_' && t.indexOf(k.toLowerCase()) >= 0 && (!best || k.length > best.length)) best = k; });
    return best ? links[best] : null;
  }
  function watchEntry(tag, text) {
    var el = document.createElement(tag), href = watchLink(text);
    if (href) { var a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; el.appendChild(a); }
    else el.textContent = text;
    return el;
  }
  // The pinned bar's run: copies of the lines that lead the news column (the
  // next game, the series, last season, the last out) and the strip's
  // networks and radio in short — shown only while the block is compact.
  function buildBrief(lead, watch) {
    var brief = document.createElement('div'); brief.className = 'tf-brief'; brief.setAttribute('aria-hidden', 'true');
    if (lead) lead.querySelectorAll('p').forEach(function (p) { if (!p.classList.contains('tf-blurb')) brief.appendChild(p.cloneNode(true)); });
    if (watch) {
      var tv = [], radio = [];
      watch.querySelectorAll('.tf-channels > li').forEach(function (li) {
        var name = li.querySelector('b') ? li.querySelector('b').textContent : '';
        if (name === 'Radio') li.querySelectorAll('span').forEach(function (sp) { radio.push(sp.textContent); }); else if (name) tv.push(name);
      });
      if (tv.length) { var t = document.createElement('p'); t.className = 'tf-brief-watch'; t.innerHTML = '<b>TV</b> '; t.appendChild(document.createTextNode(tv.join(' · '))); brief.appendChild(t); }
      if (radio.length) { var r = document.createElement('p'); r.className = 'tf-brief-watch'; r.innerHTML = '<b>Radio</b> '; r.appendChild(document.createTextNode(radio.join(' · '))); brief.appendChild(r); }
    }
    return brief;
  }
  // The strip along the block's foot, in every state: the cast mark, then
  // each network with the ways to get it; the schedule's networks for a game
  // not yet on ESPN's board; a note when none are known yet. `label` names
  // whose game it is when it isn't the one shown ("Next game").
  function buildWatchStrip(names, radio, label, team) {
    // the club's standing outlets (channels.json clubs): its radio network and local streams, beside whatever the league listed; the feeds a Seattle viewer can't use left out
    var club = (channelsData && channelsData.clubs && team && channelsData.clubs[team.slug]) || {};
    names = (names || []).filter(function (n) { var i = channelInfo(n); return !(i && i.hide); });
    (club.tv || []).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    radio = (radio || []).slice();
    (club.radio || []).forEach(function (r) { if (radio.indexOf(r) < 0) radio.push(r); });
    var wl = document.createElement('div'); wl.className = 'tf-watch';
    var wh = document.createElement('span'); wh.className = 'tf-tv'; wh.title = label ? 'Where to watch the next game' : 'Where to watch';
    wh.innerHTML = CAST_SVG + '<span class="sr-only">Watch</span>';
    wl.appendChild(wh);
    if (label) { var lb = document.createElement('b'); lb.className = 'tf-watch-label'; lb.textContent = label; wl.appendChild(lb); }
    if (names.length || (radio && radio.length)) wl.appendChild(buildWatchList(names, radio));
    else { var none = document.createElement('span'); none.className = 'tf-watch-none'; none.textContent = 'Broadcast to be announced'; wl.appendChild(none); }
    var more = document.createElement('button'); more.type = 'button'; more.className = 'tf-wmore'; // the rest of the ways, when one line can't hold them (foldWatch shows the chevron)
    more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    function setWatchOpen(open) { wl.classList.toggle('is-open', open); more.title = open ? 'Fewer' : 'More ways to watch'; more.setAttribute('aria-label', more.title); more.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    setWatchOpen(false);
    more.addEventListener('click', function () { setWatchOpen(!wl.classList.contains('is-open')); settleBlock(); });
    wl.appendChild(more);
    if (!channelsData) loadChannels().then(function () { // once the table has loaded: the numbers, the links, the club's own outlets (the countdown carries over)
      var fresh = buildWatchStrip(names, radio, label, team); fresh.className = wl.className; fresh.style.cssText = wl.style.cssText;
      if (wl.parentNode) wl.parentNode.replaceChild(fresh, wl); foldNews(); foldWatch();
      var box = fresh.closest('.team-form'), old = box && box.querySelector('.tf-brief');
      if (old) old.replaceWith(buildBrief(box.querySelector('.tf-lead'), fresh));
    });
    return wl;
  }
  // a list: each network with how to get it — DirecTV / Dish numbers, the
  // over-the-air station, the streaming services — plus the radio call;
  // every entry a link where the table has one
  function buildWatchList(names, radio) {
    var ul = document.createElement('ul'); ul.className = 'tf-channels';
    names.forEach(function (n) {
      var li = document.createElement('li'), info = channelInfo(n);
      li.appendChild(watchEntry('b', n));
      var how = [];
      if (info) { // a streaming-only service is just its name; a network gets the ways to reach it — the strip has two lines, so: the antenna, DirecTV, Xfinity, and the first two services
        if (info.ota) how.push('over the air ' + info.ota);
        if (info.directv) how.push('DirecTV ' + info.directv);
        if (info.xfinity) how.push('Xfinity ' + info.xfinity);
        (info.stream || []).filter(function (x) { return x.toLowerCase() !== String(n).toLowerCase(); }).slice(0, 2).forEach(function (x) { how.push(x); }); // not the network itself (Apple TV)
      }
      how.forEach(function (h) { li.appendChild(watchEntry('span', h)); });
      ul.appendChild(li);
    });
    if (radio && radio.length) {
      var rl = document.createElement('li'); var rb = document.createElement('b'); rb.textContent = 'Radio'; rl.appendChild(rb);
      radio.forEach(function (r) { rl.appendChild(watchEntry('span', r)); }); ul.appendChild(rl);
    }
    return ul;
  }
  // ---- a live game: the block becomes the game ----
  // While the club has a game on today, ESPN's scoreboard is asked every
  // minute (the page visible, the Teams view open); once the game is in
  // progress the season block gives way to the score, the situation and
  // where to watch, and once it's final the result stays until the next
  // visit. The feed is ESPN's because it answers from the browser.
  var POLL_MS = 30000; // the scoreboard is asked this often while a game is on (styles.css tf-tick counts it down — keep the two in step)
  var live = { slug: null, event: null, events: {}, shown: null, timer: null, at: null, busy: false, lastOut: {}, matchup: {}, pitches: {}, lastPitch: {}, highlights: {} };
  // MLB's clips for the game (statsapi's content feed, open to the browser),
  // newest first, a few of them: linked to their pages on mlb.com. Fetched
  // with each poll while the game is on, once it is over, and kept by game.
  function fetchHighlights(team, g) {
    if (!g || !g.id) return;
    var have = live.highlights[team.slug];
    if (have && have.id === g.id && have.final && Date.now() - have.at < 600000) return; // a final's clips: refreshed every ten minutes
    fetch('https://statsapi.mlb.com/api/v1/game/' + g.id + '/content', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        var items = ((((c || {}).highlights || {}).highlights || {}).items) || [];
        var clips = items.filter(function (i) { return i.slug && i.title; }).map(function (i) { return { title: i.title, url: 'https://www.mlb.com/video/' + i.slug, date: i.date || '' }; });
        clips.sort(function (a, b) { return b.date.localeCompare(a.date); });
        var was = live.highlights[team.slug];
        live.highlights[team.slug] = { id: g.id, at: Date.now(), final: !!(g.res), clips: clips.slice(0, 5), n: clips.length };
        if (teamView.slug === team.slug && (!was || was.id !== g.id || was.n !== clips.length)) swapFormBlock(team, true);
      })
      .catch(function () { /* no clips: the column stands without them */ });
  }
  // the game the block follows: today's if there is one, else yesterday's
  // (its final stays up through the following day), else the next one if
  // it is within two days (the pregame — the odds, the starters — from
  // two days out until it starts)
  var AHEAD_DAYS = 2;
  function dayBefore(s) { var d = parseDate(s); d.setDate(d.getDate() - 1); return ymd(d); }
  function dayAfter(s, n) { var d = parseDate(s); d.setDate(d.getDate() + (n || 1)); return ymd(d); }
  function liveGameToday(slug) {
    var today = todayStr(), yday = dayBefore(today), horizon = dayAfter(today, AHEAD_DAYS);
    var gs = teamGames(slug) || [];
    return gs.filter(function (g) { return g.date === today; })[0] || gs.filter(function (g) { return g.date === yday; })[0] ||
      gs.filter(function (g) { return g.date > today && g.date <= horizon; })[0];
  }
  // A club ESPN doesn't cover (the Torrent, the Seawolves) gets the same
  // block from the schedule alone: the game ahead, and the final once the
  // feed's next run brings the result — no live score, no odds.
  function synthEvent(team, g) {
    var when = new Date(g.date + 'T' + (g.tbd || !g.time ? '12:00:00' : g.time));
    var us = { team: { id: 'us', abbreviation: 'SEA', displayName: 'Seattle ' + team.label, shortDisplayName: team.label, color: String((team.colors || [])[0] || '').replace('#', '') }, score: g.res ? String(g.res.us) : '', homeAway: g.home ? 'home' : 'away' };
    var them = { team: { id: 'them', abbreviation: g.opp.abbrev || String(g.opp.short || g.opp.name).slice(0, 3).toUpperCase(), displayName: g.opp.name, shortDisplayName: g.opp.short || g.opp.name, name: g.opp.short || g.opp.name, logo: g.opp.logo }, score: g.res ? String(g.res.them) : '', homeAway: g.home ? 'away' : 'home' };
    var detail = g.res ? 'Final' + (g.res.ot ? '/' + g.res.ot : '') : '';
    return { id: 'sched-' + g.date, date: when.toISOString(), links: [], competitions: [{ competitors: [us, them], status: { type: { state: g.res ? 'post' : 'pre', detail: detail, shortDetail: detail } }, venue: { fullName: g.home ? team.venue : (g.venue || '') }, broadcasts: g.watch && g.watch.tv ? [{ market: 'national', names: g.watch.tv }] : [], details: [] }] };
  }
  // ?team=x&demo=live (or pre, final): the block as a game — a made-up
  // one on the club's next (or last) fixture, no feed asked — so its look
  // can be worked on when nothing is being played. Local use only.
  var DEMO = (new URLSearchParams(location.search).get('demo') || '').toLowerCase();
  if (DEMO && !/^(live|pre|final)$/.test(DEMO)) DEMO = 'live';
  function demoEvent(team) {
    var today = todayStr(), gs = teamGames(team.slug) || [];
    var g = gs.filter(function (x) { return x.date === today; })[0] || gs.filter(function (x) { return x.date > today; })[0] || gs[gs.length - 1];
    if (!g) return null;
    var sport = team.espn ? team.espn.sport : team.sport, state = DEMO === 'pre' ? 'pre' : DEMO === 'final' ? 'post' : 'in';
    var ev = synthEvent(team, Object.assign({}, g, { res: null, date: today }));
    ev.id = 'demo-' + team.slug;
    var c = ev.competitions[0], us = c.competitors[0], them = c.competitors[1], st = c.status;
    var ourId = team.espn ? team.espn.id : 'us'; us.team.id = ourId; // the block finds us by the feed's id
    if (state === 'pre') { st.type = { state: 'pre', detail: '7:10 PM PT', shortDetail: '7:10 PM PT' }; return ev; }
    us.score = '4'; them.score = '3';
    if (state === 'post') { st.type = { state: 'post', detail: 'Final', shortDetail: 'Final', completed: true }; us.winner = true; return ev; }
    if (sport === 'baseball') {
      st.type = { state: 'in', detail: 'Bottom 7th', shortDetail: 'Bot 7th' }; st.period = 7;
      c.situation = { balls: 2, strikes: 1, outs: 1, onFirst: true, onSecond: false, onThird: true,
        pitcher: { athlete: { id: 'demo-p', displayName: 'Bryan Woo', shortName: 'B. Woo' } },
        batter: { athlete: { id: 'demo-b', displayName: 'Julio Rodríguez', shortName: 'J. Rodríguez' }, summary: '1-3, HR, 2 RBI' } };
      live.pitches[team.slug] = { 'demo-p': 78 };
      live.lastPitch[team.slug] = { mph: 96, type: 'Four-seam FB', result: 'Strike Looking' };
      live.lastOut[team.slug] = { id: 'demo-out', text: 'Raleigh grounded out to second.', batter: 'C. Raleigh', pitcher: 'J. Ryan', when: 'Bot 7th' };
    } else if (sport === 'football') {
      st.type = { state: 'in', detail: '8:42 - 3rd', shortDetail: '8:42 - 3rd' }; st.period = 3; st.displayClock = '8:42';
      c.situation = { downDistanceText: '2nd & 7 at SEA 42', possession: ourId, lastPlay: { text: 'K. Walker III rushed for 5 yards to the SEA 42.' } };
    } else if (sport === 'soccer') {
      st.type = { state: 'in', detail: "64'", shortDetail: "64'" }; st.period = 2; st.displayClock = "64'";
      us.statistics = [{ name: 'possessionPct', displayValue: '57' }];
      c.details = [{ scoringPlay: true, team: { id: ourId }, athletesInvolved: [{ shortName: 'J. Morris' }], clock: { displayValue: "23'" }, type: { text: 'Goal' } },
        { scoringPlay: true, team: { id: 'them' }, athletesInvolved: [{ shortName: 'D. Bouanga' }], clock: { displayValue: "41'" }, type: { text: 'Penalty - Scored' } },
        { scoringPlay: true, team: { id: ourId }, athletesInvolved: [{ shortName: 'P. Arriola' }], clock: { displayValue: "58'" }, type: { text: 'Goal' } }];
      c.situation = { lastPlay: { text: 'Corner, Seattle. Conceded by the visitors.' } };
    } else { // hockey, basketball, rugby: a period and a clock
      var per = sport === 'basketball' ? '3rd' : '2nd';
      st.type = { state: 'in', detail: '12:34 - ' + per, shortDetail: '12:34 - ' + per }; st.period = sport === 'basketball' ? 3 : 2; st.displayClock = '12:34';
      if (sport === 'hockey') c.details = [{ scoringPlay: true, team: { id: ourId }, athletesInvolved: [{ shortName: 'J. Eberle' }], clock: { displayValue: '4:12' }, type: { text: 'Goal' } },
        { scoringPlay: true, team: { id: 'them' }, athletesInvolved: [{ shortName: 'N. MacKinnon' }], clock: { displayValue: '15:50' }, type: { text: 'Goal' } }];
      c.situation = { lastPlay: { text: sport === 'basketball' ? 'N. Diggins-Smith makes 3-pt jump shot' : 'Shot on goal by Beniers, saved.' } };
    }
    var titles = sport === 'baseball' ? ['Rodríguez launches a two-run homer to left', 'Raleigh guns down a runner at second', 'Woo strikes out the side in the 4th', 'Crawford\'s diving stop saves a run', 'Arozarena doubles off the wall'] :
      sport === 'football' ? ['Smith-Njigba takes a slant 45 yards to the house', 'Love goes airborne for the interception', 'Walker III bounces outside for 18', 'Williams sacks the quarterback on third down', 'Myers drills a 52-yard field goal'] :
      sport === 'soccer' ? ['Morris heads home the opener', 'Bouanga converts from the spot', 'Arriola finishes a sweeping move', 'Frei denies a point-blank header', 'Roldan clips the crossbar from 25 yards'] :
      sport === 'hockey' ? ['Eberle opens the scoring on the power play', 'MacKinnon answers with a wrist shot', 'Grubauer robs a breakaway', 'Beniers rings the post', 'Three-minute recap'] :
      ['Diggins-Smith drains a step-back three', 'Ogwumike finishes through contact', 'A chase-down block to end the quarter', 'Fast-break dunk off the steal', 'Game highlights'];
    live.highlights[team.slug] = { id: ev.id, at: Date.now(), final: false, n: 5, clips: titles.map(function (t) { return { title: t, url: '#' }; }) };
    return ev;
  }
  function demoPoll() { // the demo's poll: no feed — the same made-up game again, so the ring and the redraw behave as they do live
    var t = LQAFilter.TEAMS.filter(function (x) { return x.slug === teamView.slug; })[0];
    if (!t) return;
    live.at = new Date();
    var ev = demoEvent(t);
    live.events[t.slug] = ev; live.event = ev; live.slug = t.slug;
    var state = ev && ev.competitions[0].status.type.state;
    var pill = $('teamStrip').querySelector('.team-tab[data-slug="' + t.slug + '"]');
    if (pill) pill.classList.toggle('is-live', state === 'in');
    live.shown = state || null; swapFormBlock(t);
    live.timer = setTimeout(pollLive, state === 'in' ? POLL_MS : 10 * POLL_MS);
  }
  // Every club with a game on today is checked (one scoreboard call per
  // league): the strip's pill pulses for a game in progress, and the
  // selected club's block becomes its game.
  function pollLive(force) {
    clearTimeout(live.timer);
    if ($('teamsView').hidden) return;
    if (DEMO) { demoPoll(); return; }
    var playing = LQAFilter.TEAMS.filter(function (t) { return t.espn && liveGameToday(t.slug); });
    if (!playing.length) return;
    if (document.hidden && !force) { live.timer = setTimeout(pollLive, POLL_MS); return; }
    live.busy = true; $('teamHead').querySelectorAll('.tf-refresh').forEach(function (b) { b.classList.add('is-busy'); });
    var today = todayStr(), span = dayBefore(today).replace(/-/g, '') + '-' + dayAfter(today, AHEAD_DAYS).replace(/-/g, ''); // yesterday through two days out
    var anyIn = false; // a game in progress somewhere: the quick poll; otherwise every few minutes
    var leagues = {};
    playing.forEach(function (t) { leagues[t.espn.sport + '/' + t.espn.league] = true; });
    Promise.all(Object.keys(leagues).map(function (k) {
      return fetch('https://site.api.espn.com/apis/site/v2/sports/' + k + '/scoreboard?dates=' + span, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { return [k, j]; });
    })).then(function (pairs) {
      var boards = {};
      pairs.forEach(function (p) { boards[p[0]] = p[1]; });
      live.at = new Date();
      playing.forEach(function (t) {
        var j = boards[t.espn.sport + '/' + t.espn.league];
        if (!j) return; // that league's board didn't come: leave what we had
        var want = liveGameToday(t.slug), ours = (j.events || []).filter(function (e) {
          return (e.competitions[0].competitors || []).some(function (c) { return String(c.team.id) === t.espn.id; });
        });
        // the event on the game's day (today's game first, else yesterday's)
        var ev = ours.filter(function (e) { return seattleDay(e.date) === want.date; })[0] || ours[ours.length - 1];
        live.events[t.slug] = ev || null;
        var state = ev && ev.competitions[0].status.type.state; // pre, in, post
        if (state === 'in') anyIn = true;
        var pill = $('teamStrip').querySelector('.team-tab[data-slug="' + t.slug + '"]');
        if (pill) pill.classList.toggle('is-live', state === 'in');
        if (t.slug === teamView.slug) {
          var want = state || null; // the game block all game day: before, during and after — and the day after
          live.event = ev || null; live.slug = t.slug;
          // re-drawn while live (the score moves) and whenever the stage changes
          if (want === 'in' || want !== live.shown) { live.shown = want; swapFormBlock(t); }
          if (want === 'in' && t.espn.sport === 'baseball') fetchLastOut(t, ev); // the play-by-play, for the last out
          if ((want === 'in' || want === 'post') && t.espn.sport === 'baseball') fetchHighlights(t, liveGameToday(t.slug)); // the game's clips
          if (want === 'pre' || want === 'post') fetchMatchup(t, ev, want); // the matchup before the game; the series line after
        }
      });
    }).then(function () {
      live.busy = false; $('teamHead').querySelectorAll('.tf-refresh').forEach(function (b) { b.classList.remove('is-busy'); });
      live.timer = setTimeout(pollLive, anyIn ? POLL_MS : 10 * POLL_MS);
    });
  }
  function seattleDay(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); }
  function swapFormBlock(team, quiet) {
    var old = $('teamHead').querySelector('.team-form');
    if (!old) return;
    var games = teamGames(team.slug) || [];
    var fresh = (live.event && live.slug === team.slug) ? renderTeamLive(team, live.event) : renderTeamForm(team, games, todayStr());
    if (!quiet && old.classList.contains('is-live') && fresh.classList.contains('is-live')) fresh.classList.add('is-flash'); // a fresh score: the block glows for a beat
    old.replaceWith(fresh);
    settleBlock();
  }
  // Baseball's most recent out, from ESPN's game summary: the last at-bat
  // that ended in one (its "Play Result" line names the batter and whoever
  // made the play), with the batter and the pitcher looked up in the rosters.
  function fetchLastOut(team, ev) {
    fetch('https://site.api.espn.com/apis/site/v2/sports/' + team.espn.sport + '/' + team.espn.league + '/summary?event=' + ev.id, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.plays) return;
        var names = {}, pitches = {}; // the rosters carry one side; the box score has both — and each pitcher's pitch count (PC)
        function learn(a) { if (a && a.id && !names[a.id]) names[a.id] = a.shortName || a.displayName; }
        (s.rosters || []).forEach(function (r) { (r.roster || []).forEach(function (p) { learn(p.athlete); }); });
        ((s.boxscore && s.boxscore.players) || []).forEach(function (t) { (t.statistics || []).forEach(function (st) {
          var pc = (st.labels || []).indexOf('PC');
          (st.athletes || []).forEach(function (p) { learn(p.athlete); if (pc >= 0 && p.athlete && p.stats && p.stats[pc] != null) pitches[p.athlete.id] = p.stats[pc]; });
        }); });
        live.pitches[team.slug] = pitches;
        // the last pitch thrown: its speed, its type and what came of it (Ball, Strike Swinging, Fly Out…)
        var pitchPlays = s.plays.filter(function (p) { return p.pitchVelocity && p.summaryType === 'P'; }), lastPitch = pitchPlays[pitchPlays.length - 1];
        live.lastPitch[team.slug] = lastPitch ? { mph: lastPitch.pitchVelocity, type: lastPitch.pitchType && lastPitch.pitchType.text, result: lastPitch.type && lastPitch.type.text, count: lastPitch.resultCount } : null;
        var results = s.plays.filter(function (p) { return p.type && p.type.text === 'Play Result' && p.text; });
        var out = null;
        for (var i = results.length - 1; i >= 0; i--) {
          if (/\b(out|struck out|strikes out|double play|triple play|caught stealing|picked off)\b/i.test(results[i].text)) { out = results[i]; break; }
        }
        var was = live.lastOut[team.slug] && live.lastOut[team.slug].id;
        if (!out) { delete live.lastOut[team.slug]; return; }
        var who = {};
        (out.participants || []).forEach(function (x) { if (x.athlete && names[x.athlete.id]) who[x.type] = names[x.athlete.id]; });
        live.lastOut[team.slug] = {
          id: out.id, text: out.text.replace(/\s+/g, ' ').trim(), batter: who.batter || null, pitcher: who.pitcher || null,
          when: out.period ? (out.period.type === 'Top' ? 'Top ' : out.period.type === 'Bottom' ? 'Bot ' : '') + ordinal(out.period.number) : '',
        };
        if (teamView.slug === team.slug && live.shown === 'in') swapFormBlock(team, true); // the box score landed (a new out, a new pitch count): redraw without the flash
      })
      .catch(function () { /* the play-by-play didn't come: the line just stays off */ });
  }
  // ---- the matchup, from ESPN's game summary ----
  // Before the game: ESPN's matchup predictor, the season series and the
  // last meeting, the probable starters, each side's statistical leaders
  // (flagged when hurt) and the injured lists. After it: the series, now
  // including this game. Fetched once per event and stage, and again
  // after ten minutes (the lists move on game day); the block is redrawn
  // quietly when it lands.
  var STAT_ABBR = { avg: 'avg', homeRuns: 'HR', RBIs: 'RBI', ERA: 'ERA', wins: 'W', strikeouts: 'K', saves: 'SV', goals: 'G', assists: 'A', points: 'PTS', plusMinus: '+/−', goalsAgainstAverage: 'GAA', savePct: 'SV%', passingYards: 'pass yds', rushingYards: 'rush yds', receivingYards: 'rec yds', passingTouchdowns: 'pass TD', rushingTouchdowns: 'rush TD', receivingTouchdowns: 'rec TD', rebounds: 'REB', totalShots: 'shots', accuratePasses: 'passes', defensiveInterventions: 'def. plays', saves_soccer: 'saves' };
  function fetchMatchup(team, ev, stage) {
    var have = live.matchup[team.slug];
    if (have && have.id === ev.id && have.stage === stage && Date.now() - have.at < 600000) return;
    fetch('https://site.api.espn.com/apis/site/v2/sports/' + team.espn.sport + '/' + team.espn.league + '/summary?event=' + ev.id, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        live.matchup[team.slug] = { id: ev.id, stage: stage, at: Date.now(), data: digestMatchup(s, team) };
        if (teamView.slug === team.slug && live.shown === stage) swapFormBlock(team, true);
      })
      .catch(function () { /* the summary didn't come: the block stands without it */ });
  }
  function digestMatchup(s, team) {
    var mine = function (id) { return String(id) === team.espn.id; };
    var out = { chance: null, series: null, starters: {}, leaders: {}, injured: {} };
    var p = s.predictor;
    if (p && p.homeTeam && p.awayTeam) {
      var usP = mine(p.homeTeam.id) ? p.homeTeam : p.awayTeam, themP = usP === p.homeTeam ? p.awayTeam : p.homeTeam;
      if (usP.gameProjection) out.chance = { us: Math.round(+usP.gameProjection), them: Math.round(+themP.gameProjection) };
    }
    // the series: the regular season's (or the head-to-head), its last completed meeting
    var ser = (s.seasonseries || []).filter(function (x) { return x.type !== 'preseason'; });
    ser = ser.filter(function (x) { return x.type === 'season'; })[0] || ser[ser.length - 1];
    if (ser) {
      var done = (ser.events || []).filter(function (e) { return e.status === 'post' || (e.statusType && e.statusType.completed); });
      var lastE = done[done.length - 1], lastM = null;
      if (lastE) {
        var cu = (lastE.competitors || []).filter(function (c) { return mine(c.team.id); })[0], ct = (lastE.competitors || []).filter(function (c) { return !mine(c.team.id); })[0];
        if (cu && ct) lastM = { date: seattleDay(lastE.date), us: +cu.score, them: +ct.score, won: cu.winner === true, home: cu.homeAway === 'home' };
      }
      out.series = { text: String(ser.summary || '').replace(/\bseries\b\s*/i, '').replace(/(\d)-(\d)/g, '$1–$2').trim(), played: done.length, last: lastM };
    }
    // each side: starters, leaders (hurt ones flagged), the injured
    var hurt = {}; // athlete id -> the injury, by team
    (s.injuries || []).forEach(function (t) {
      var key = mine(t.team.id) ? 'us' : 'them', list = [];
      (t.injuries || []).forEach(function (i) {
        if (!i.athlete) return;
        var d = i.details || {}, st = String(i.status || ''), what = String(d.type || d.detail || '').toLowerCase();
        var short = /\bIL\b/i.test(st) ? 'IL' : /injured reserve|^IR\b/i.test(st) ? 'IR' : /day.to.day/i.test(st) ? 'day-to-day' : st.toLowerCase();
        var inj = { name: i.athlete.shortName || i.athlete.displayName, pos: i.athlete.position && i.athlete.position.abbreviation, what: what, status: short, back: d.returnDate || '' };
        hurt[i.athlete.id] = inj; list.push(inj);
      });
      out.injured[key] = list;
    });
    (s.leaders || []).forEach(function (t) {
      var key = mine(t.team.id) ? 'us' : 'them', by = {}, order = [];
      (t.leaders || []).forEach(function (cat) {
        var x = cat.leaders && cat.leaders[0];
        if (!x || !x.athlete) return;
        var id = x.athlete.id, abbr = STAT_ABBR[cat.name] || (cat.shortDisplayName || cat.displayName || cat.name || '').toLowerCase();
        if (!by[id]) { by[id] = { name: x.athlete.shortName || x.athlete.displayName, pos: x.athlete.position && x.athlete.position.abbreviation, stats: [], hurt: hurt[id] || null }; order.push(id); }
        by[id].stats.push(x.displayValue + ' ' + abbr);
      });
      out.leaders[key] = order.map(function (id) { return by[id]; });
    });
    var comps = (s.header && s.header.competitions && s.header.competitions[0] && s.header.competitions[0].competitors) || [];
    comps.forEach(function (c) {
      var pr = (c.probables || [])[0];
      if (!pr || !pr.athlete) return;
      var cats = {}; (((pr.statistics || {}).splits || {}).categories || []).forEach(function (k) { cats[k.name] = k.displayValue; });
      var line = pr.athlete.shortName || pr.athlete.displayName;
      if (cats.wins != null && cats.losses != null) line += ' ' + cats.wins + '-' + cats.losses;
      if (cats.ERA != null) line += ', ' + cats.ERA + ' ERA';
      out.starters[mine(c.team.id) ? 'us' : 'them'] = line;
    });
    return out;
  }
  // the pregame: ESPN's predictor as a ring split in the two clubs' colours
  // (ours from the top, clockwise, as much of the ring as our chance), the
  // percentages either side; then the starters, and the leaders on the IL
  function buildPredictor(m, team, us, them) {
    function esc(s) { return String(s).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
    if (!m.chance) return null;
    // each side's colour is whichever of its two stands off the card: the
    // brighter on the dark theme (navies and forest greens sink), the darker on the light
    var bg = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
    var dark = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 < 0.5;
    function pick(cols) {
      cols = cols.filter(Boolean).map(function (c) { return '#' + String(c).replace(/^#/, ''); });
      if (!cols.length) return '#8a97a4';
      cols.sort(function (x, y) { return dark ? lum(y) - lum(x) : lum(x) - lum(y); });
      return cols[0];
    }
    var ours = pick([team.colors && team.colors[0], team.colors && team.colors[1], us.team.color, us.team.alternateColor]), theirs = pick([them.team.color, them.team.alternateColor]);
    var box = document.createElement('div'); box.className = 'tf-pred'; box.title = 'ESPN matchup predictor';
    box.innerHTML = '<span class="tp-side"><b style="color:' + ours + '">' + m.chance.us + '%</b>' + esc(us.team.abbreviation || team.label) + '</span>' +
      '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.9155" fill="none" stroke="' + theirs + '" stroke-width="5"/>' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="' + ours + '" stroke-width="5" stroke-dasharray="' + m.chance.us + ' ' + (100 - m.chance.us) + '" transform="rotate(-90 18 18)"/></svg>' +
      '<span class="tp-side"><b style="color:' + theirs + '">' + m.chance.them + '%</b>' + esc(them.team.abbreviation || them.team.shortDisplayName) + '</span>';
    return box;
  }
  // A baseball game in progress, drawn the way a broadcast draws it: the
  // pitcher and his pitch count along the top; a row per side — the
  // visitors first — the abbreviation on the club's colour and the score on
  // white; the inning between arrows (the filled one says which half); the
  // bases as three diamonds, lit when a runner is on; the outs as two
  // lamps (the third ends the half); the count beside them.
  function buildScorebug(team, c, us, them) {
    function esc(x) { return String(x).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
    var s = c.situation || {}, st = c.status, detail = String(st.type.shortDetail || st.type.detail || '');
    var half = /^(top)/i.test(detail) ? 'top' : /^(bot)/i.test(detail) ? 'bot' : ''; // Mid / End: between halves, neither arrow lit
    var inning = st.period || (detail.match(/\d+/) || [''])[0];
    var pitcher = s.pitcher && s.pitcher.athlete, batter = s.batter && s.batter.athlete, pcs = live.pitches[team.slug] || {};
    var pc = pitcher && pcs[pitcher.id] != null ? pcs[pitcher.id] : null;
    var surname = function (a) { return a ? String(a.displayName || a.shortName || '').trim().split(/\s+/).pop() : ''; };
    var last = surname(pitcher), lp = live.lastPitch[team.slug]; // the last pitch, as of the last box-score fetch
    var col = function (side) { // the club's primary; ours from filter.js, theirs from ESPN
      var c0 = side === us ? (team.colors && team.colors[0]) || us.team.color : them.team.color;
      return c0 ? '#' + String(c0).replace(/^#/, '') : '#555';
    };
    var order = us.homeAway === 'home' ? [them, us] : [us, them]; // visitors on top
    var rows = order.map(function (side) {
      return teamCell(side, team, col(side)) + '<span class="bug-score">' + esc(side.score || 0) + '</span>';
    });
    var b = document.createElement('div'); b.className = 'tf-bug'; b.title = detail;
    b.innerHTML = '<div class="bug-top"><span class="bug-pitcher">' + esc(last || detail) + '</span>' + (pc != null ? '<span class="bug-pc">P: ' + esc(pc) + '</span>' : '') + '</div>' +
      (batter ? '<div class="bug-top bug-bat"><span class="bug-batter">' + esc(surname(batter)) + '</span>' + (s.batter.summary ? '<span class="bug-pc">' + esc(s.batter.summary) + '</span>' : '') + '</div>' : '') +
      (lp ? '<div class="bug-top bug-pitch"><span>' + esc(lp.mph + ' mph' + (lp.type ? ' ' + lp.type : '')) + '</span>' + (lp.result ? '<span class="bug-pc">' + esc(lp.result) + '</span>' : '') + '</div>' : '') +
      '<div class="bug-grid">' + rows[0] +
      '<span class="bug-inn"><i class="bug-up' + (half === 'top' ? ' is-on' : '') + '"></i><b>' + esc(inning) + '</b><i class="bug-dn' + (half === 'bot' ? ' is-on' : '') + '"></i></span>' +
      '<span class="bug-field">' + // as the broadcast draws it: the count large with the outs beneath, the bases beside
      '<span class="bug-count">' + (s.balls != null && s.strikes != null ? '<b>' + s.balls + '-' + s.strikes + '</b>' : '<b>&nbsp;</b>') +
      '<span class="bug-outs"><i class="' + (s.outs >= 1 ? 'is-on' : '') + '"></i><i class="' + (s.outs >= 2 ? 'is-on' : '') + '"></i></span></span>' +
      '<svg class="bug-bases" viewBox="0 0 40 24" aria-hidden="true">' + // three diamonds set apart, second on top
      '<polygon class="' + (s.onSecond ? 'is-on' : '') + '" points="20,1 26,7 20,13 14,7"/>' +
      '<polygon class="' + (s.onThird ? 'is-on' : '') + '" points="11,9 17,15 11,21 5,15"/>' +
      '<polygon class="' + (s.onFirst ? 'is-on' : '') + '" points="29,9 35,15 29,21 23,15"/></svg></span>' +
      rows[1] + '</div>';
    var sr = document.createElement('span'); sr.className = 'sr-only';
    sr.textContent = detail + ', ' + (s.outs || 0) + ' out' + (pitcher ? ', pitching ' + (pitcher.shortName || '') : '');
    b.appendChild(sr);
    return b;
  }
  // The other sports' scorebug, in the same style: the clock along the top
  // (the half or the period, the down and distance in football, the
  // possession in soccer); a row per side — the visitors first — with the
  // score and, beside it, that side's goals (the scorer and the minute,
  // penalties and own goals marked) or, in football, the ball.
  function buildGenericBug(team, c, us, them) {
    function esc(x) { return String(x).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
    var s = c.situation || {}, st = c.status, type = st.type, sport = team.espn ? team.espn.sport : team.sport;
    var detail = String(type.shortDetail || type.detail || ''), final = type.state === 'post';
    var top = final ? (/^final/i.test(detail) ? detail.replace(/^final/i, 'Final') : 'Final' + (detail && !/^FT$/i.test(detail) ? ' · ' + detail : '')) : detail, right = '';
    if (final) { /* the result stands alone on the top row */ }
    else if (sport === 'football') { if (s.downDistanceText) right = s.downDistanceText; }
    else if (sport === 'soccer') {
      var poss = (us.statistics || []).filter(function (x) { return x.name === 'possessionPct'; })[0];
      if (poss && poss.displayValue) right = 'Possession ' + esc(us.team.abbreviation) + ' ' + Math.round(+poss.displayValue) + '%';
    }
    if (!right && st.displayClock && detail.indexOf(st.displayClock) < 0 && !/^(HT|FT|Final)/i.test(detail)) right = st.displayClock;
    var col = function (side) {
      var c0 = side === us ? (team.colors && team.colors[0]) || us.team.color : them.team.color;
      return c0 ? '#' + String(c0).replace(/^#/, '') : '#555';
    };
    var goals = {}; // team id -> [text]
    (c.details || []).forEach(function (d) {
      if (!d.scoringPlay || !d.team) return;
      var who = (d.athletesInvolved || [])[0], t = String((d.type && d.type.text) || '');
      var mark = /own goal/i.test(t) ? ' (og)' : /penalty/i.test(t) ? ' (pen)' : '';
      (goals[d.team.id] = goals[d.team.id] || []).push(esc((who ? who.shortName || who.displayName : 'Goal') + (d.clock && d.clock.displayValue ? ' ' + d.clock.displayValue : '') + mark));
    });
    var order = us.homeAway === 'home' ? [them, us] : [us, them];
    var rows = order.map(function (side) {
      var ev = goals[side.team.id] ? goals[side.team.id].join(', ') : '';
      if (sport === 'football' && s.possession && String(s.possession) === String(side.team.id)) ev = '<i class="bug-ball" title="Possession"></i>' + ev;
      return teamCell(side, team, col(side)) + '<span class="bug-score">' + esc(side.score || 0) + '</span><span class="bug-ev">' + ev + '</span>';
    });
    var b = document.createElement('div'); b.className = 'tf-bug is-generic'; b.title = detail;
    var anyEv = Object.keys(goals).length || (sport === 'football' && s.possession); // nothing to put beside the scores: the bug is just the rows
    b.innerHTML = '<div class="bug-top"><span class="bug-pitcher">' + esc(top) + '</span>' + (right ? '<span class="bug-pc">' + esc(right) + '</span>' : '') + '</div>' +
      '<div class="bug-grid bug-grid-2' + (anyEv ? '' : ' no-ev') + '">' + rows.join('') + '</div>';
    return b;
  }
  // Before the game, in the same frame: the day and the start along the
  // top, a row per side with ESPN's chance of winning where the score will
  // go, and the predictor ring beside them (the odds, from two days out)
  function buildPregameBug(team, c, us, them, mu, rel, when) {
    function esc(x) { return String(x).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
    var sport = team.espn ? team.espn.sport : team.sport;
    var start = (rel || 'Today') + (when ? ' · ' + new Date(when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (sport === 'baseball' ? ' first pitch' : sport === 'hockey' ? ' puck drop' : sport === 'basketball' ? ' tip-off' : ' kickoff') : '');
    var col = function (side) { var c0 = side === us ? (team.colors && team.colors[0]) || us.team.color : them.team.color; return c0 ? '#' + String(c0).replace(/^#/, '') : '#555'; };
    var order = us.homeAway === 'home' ? [them, us] : [us, them];
    var chance = mu && mu.chance ? { us: mu.chance.us, them: mu.chance.them } : null;
    var rows = order.map(function (side) {
      var pct = chance ? (side === us ? chance.us : chance.them) + '%' : '–';
      return teamCell(side, team, col(side)) + '<span class="bug-score bug-odds">' + esc(pct) + '</span>';
    });
    var ring = '';
    if (chance) { // the ring: ours from the top, clockwise, as much of it as our chance
      var pg = buildPredictor(mu, team, us, them), svg = pg && pg.querySelector('svg');
      if (svg) ring = '<span class="bug-ring" title="ESPN matchup predictor">' + svg.outerHTML + '</span>';
    }
    var b = document.createElement('div'); b.className = 'tf-bug is-generic is-pregame' + (ring ? '' : ' no-ev'); b.title = 'Before the game';
    b.innerHTML = '<div class="bug-top"><span class="bug-pitcher">' + esc(start) + '</span>' + (chance ? '<span class="bug-pc">Win chance</span>' : '') + '</div>' +
      '<div class="bug-grid bug-grid-2' + (ring ? ' has-ring' : ' no-ev') + '">' + rows[0] + ring + rows[1] + '</div>';
    return b;
  }
  // "at" or "vs" between the crests on the compact bar
  function vsLine(ours, home, theirs) { // just the word: the crests either side say who
    var p = document.createElement('p'); p.className = 'tf-vs'; p.textContent = home ? 'vs' : 'at'; p.title = ours + (home ? ' vs ' : ' at ') + (theirs || '');
    return p;
  }
  // a club's nickname for the compact bar: ESPN's name field where it is one
  // (Seahawks, Kraken), else the display name without its city (Wave FC,
  // Courage) — and the whole name where nothing but a suffix would be left
  // (Toronto FC, Atlanta United FC, Angel City FC)
  var CITY = /^(San Diego|San Jose|San Francisco|Los Angeles|LA|Las Vegas|New York City|New York|New England|New Jersey|North Carolina|Kansas City|Salt Lake|St\. Louis|Tampa Bay|Green Bay|Golden State|Portland|Orlando|Houston|Chicago|Washington|Seattle|Utah|Louisville|Denver|Boston|Colorado|Columbus|Nashville|Atlanta|Austin|Charlotte|Cincinnati|Dallas|Minnesota|Montr[ée]al|Philadelphia|Vancouver|Toronto|Miami|Calgary|Edmonton|Anaheim|Winnipeg|Ottawa|Detroit|Pittsburgh|Buffalo|Carolina|Florida|Arizona|Phoenix|Indiana|Connecticut|Oakland|Sacramento|Cleveland|Baltimore|Milwaukee|Texas|Kansas|Oklahoma City|Memphis|Brooklyn|Bay Area)\s+/i;
  function nickname(t) {
    if (!t) return '';
    if (t.name && t.name !== t.displayName && !/^[A-Z]{2,4}$/.test(t.name)) return t.name;
    var full = t.displayName || t.shortDisplayName || t.name || '', rest = full.replace(CITY, '');
    return rest && rest !== full && !/^(FC|SC|CF|United|City|United FC|City FC|City SC)$/i.test(rest) ? rest : full;
  }
  function teamCell(side, team, color) { // the abbreviation on the block, the nickname on the compact bar (styles.css .bug-abbr / .bug-nick)
    function esc(x) { return String(x).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
    var abbr = side.team.abbreviation || side.team.shortDisplayName, nick = side.isUs ? team.label : nickname(side.team);
    return '<span class="bug-team" style="background:' + color + '"><i class="bug-abbr">' + esc(abbr) + '</i><i class="bug-nick">' + esc(nick || abbr) + '</i></span>';
  }
  function renderTeamLive(team, ev) {
    function esc(s) { return String(s).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
    var c = ev.competitions[0], st = c.status, type = st.type, sport = team.espn ? team.espn.sport : team.sport, ourId = team.espn ? team.espn.id : 'us';
    var us = c.competitors.filter(function (x) { return String(x.team.id) === ourId; })[0];
    var them = c.competitors.filter(function (x) { return x !== us; })[0];
    if (us) us.isUs = true; // the bugs name our side by the club's label
    var final = type.state === 'post', pre = type.state === 'pre';
    var today = todayStr(), gameDay = seattleDay(ev.date);
    var rel = gameDay === today ? 'Today' : gameDay === dayBefore(today) ? 'Yesterday' : gameDay === dayAfter(today, 1) ? 'Tomorrow' : parseDate(gameDay).toLocaleDateString('en-US', { weekday: 'long' });
    var box = document.createElement('div'); box.className = 'team-form is-live' + (final ? ' is-final' : pre ? ' is-pre' : '');
    // the left section: the crests either side of the cluster, then the venue line and the watch strip across it, centred; the news column beside
    var main = document.createElement('div'); main.className = 'tf-main'; box.appendChild(main);
    var row = document.createElement('div'); row.className = 'tf-row'; main.appendChild(row);
    if (team.logo) { var im = document.createElement('img'); im.src = team.logo; im.alt = ''; im.width = 56; im.height = 56; im.title = 'Seattle ' + team.label; row.appendChild(crestLink(im, teamSite(team), 'Seattle ' + team.label)); }
    var body = document.createElement('div'); body.className = 'tf-body'; row.appendChild(body);
    var inner = document.createElement('div'); inner.className = 'tf-inner'; body.appendChild(inner); // the cluster (the score) beside a column of the rest, all within the crests' height
    var cluster = document.createElement('div'); cluster.className = 'tf-cluster'; inner.appendChild(cluster);
    var head = document.createElement('div'); head.className = 'tf-head'; cluster.appendChild(head);
    var tag = document.createElement('span'); tag.className = 'tf-live'; tag.textContent = final ? 'Final' + (rel === 'Yesterday' ? ' · yesterday' : '') : pre ? rel : 'Live'; head.appendChild(tag);
    // refresh now (the score also refreshes itself every minute), and when it was last fetched
    var rw = document.createElement('span'); rw.className = 'tf-refresh-wrap'; // at the head's right end: the time, then the button
    if (live.at) {
    }
    var rb = document.createElement('button'); rb.type = 'button'; rb.className = 'tf-refresh' + (live.busy ? ' is-busy' : '');
    rb.title = 'Refresh the score'; rb.setAttribute('aria-label', 'Refresh the score');
    rb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>';
    rb.addEventListener('click', function () { if (!live.busy) pollLive(true); });
    rw.appendChild(rb);
    var score = document.createElement('span'); score.className = 'tf-score';
    if (pre) score.innerHTML = '<b>' + esc(us.team.abbreviation || team.label) + '</b><span class="tf-dash">' + (us.homeAway === 'home' ? 'vs' : 'at') + '</span>' + esc(them.team.abbreviation || them.team.shortDisplayName);
    else score.innerHTML = '<b>' + esc(us.team.abbreviation || team.label) + ' ' + (us.score || 0) + '</b><span class="tf-dash">–</span>' + (them.score || 0) + ' ' + esc(them.team.abbreviation || them.team.shortDisplayName);
    head.appendChild(score);
    var bugwrap = null; // the scorebug: baseball's while it plays, the general one for the other sports and for every final (the head and the state line stay, for the compact block)
    var mu0 = live.matchup[team.slug]; mu0 = mu0 && mu0.id === ev.id ? mu0.data : null;
    box.classList.add('has-bug'); bugwrap = document.createElement('div'); bugwrap.className = 'tf-bugwrap'; cluster.appendChild(bugwrap);
    bugwrap.appendChild(pre ? buildPregameBug(team, c, us, them, mu0, rel, ev.date) : sport === 'baseball' && !final ? buildScorebug(team, c, us, them) : buildGenericBug(team, c, us, them));
    var lines = document.createElement('div'); lines.className = 'tf-lines'; cluster.appendChild(lines);
    function line(txt, cls) { var p = document.createElement('p'); if (cls) p.className = cls; p.textContent = txt; lines.appendChild(p); return p; }
    // the state of play: inning / period / clock, then the sport's situation
    var detail = type.shortDetail || type.detail || '';
    var s = c.situation || {}, bits = [pre ? (ev.date ? new Date(ev.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (sport === 'baseball' ? ' first pitch' : sport === 'hockey' ? ' puck drop' : sport === 'basketball' ? ' tip-off' : ' kickoff') : '') : final && /^final$/i.test(detail) ? '' : detail]; // the tag already says Final; the line keeps only more (Final/OT, Final/10)
    if (!final && sport === 'baseball') {
      if (s.outs != null) bits.push(s.outs + ' out');
      var on = [s.onFirst && '1st', s.onSecond && '2nd', s.onThird && '3rd'].filter(Boolean);
      if (on.length) bits.push((on.length > 1 ? 'runners on ' : 'runner on ') + on.join(' & '));
      if (s.balls != null && s.strikes != null) bits.push(s.balls + '-' + s.strikes + ' count');
    } else if (!final && sport === 'football') {
      if (s.downDistanceText) bits.push(s.downDistanceText);
      if (s.possession) bits.push((String(s.possession) === ourId ? team.label : them.team.shortDisplayName) + ' ball');
    }
    if (bits.filter(Boolean).length) line(bits.filter(Boolean).join(' · '), 'tf-state');
    var lead = null; // the top of the news column: the last out (baseball) or the last play; before the game, the starters and the leaders out
    var hl = live.highlights[team.slug], sg0 = liveGameToday(team.slug);
    // the game's highlights: MLB's clips fetched here, else the ones the build found (the league's feed, the club's and the league's YouTube — teams.json clips)
    var clips = !pre && (hl && (hl.id === ev.id || (sg0 && hl.id === sg0.id)) && hl.clips.length ? hl.clips : (sg0 && sg0.clips && sg0.clips.length ? sg0.clips : null));
    if (clips) { // a short list of links to the clips
      lead = document.createElement('div'); lead.className = 'tf-lines tf-lead';
      var hh = document.createElement('p'); hh.className = 'tf-hl-head'; hh.innerHTML = '<b>Highlights</b>'; lead.appendChild(hh);
      var hul = document.createElement('ul'); hul.className = 'tf-hl'; lead.appendChild(hul);
      clips.slice(0, 5).forEach(function (cl) { var li = document.createElement('li'); var a = document.createElement('a'); a.href = cl.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = cl.title; li.appendChild(a); hul.appendChild(li); });
    }
    var lo = !final && live.lastOut[team.slug];
    if (lo) { // the most recent out: batter vs pitcher, then the play as called
      if (!lead) { lead = document.createElement('div'); lead.className = 'tf-lines tf-lead'; }
      var lp = document.createElement('p'); lp.className = 'tf-out'; lead.insertBefore(lp, lead.firstChild);
      lp.innerHTML = '<b>Last out' + (lo.when ? ' · ' + esc(lo.when) : '') + '</b> ' + (lo.batter || lo.pitcher ? esc((lo.batter || '?') + ' vs ' + (lo.pitcher || '?')) + ' — ' : '') + esc(lo.text);
    } else if (!final && s.lastPlay && s.lastPlay.text && sport !== 'baseball') {
      if (!lead) { lead = document.createElement('div'); lead.className = 'tf-lines tf-lead'; }
      var lq = document.createElement('p'); lq.className = 'tf-out'; lead.appendChild(lq);
      lq.innerHTML = '<b>Last play</b> ' + esc(s.lastPlay.text);
    }
    // the venue: the top of the column beside the score, a link to it on the map
    var where = document.createElement('p'); where.className = 'tf-where';
    var vn = (c.venue && c.venue.fullName) || them.team.displayName, va = c.venue && c.venue.address;
    var vl = document.createElement('a'); vl.textContent = vn; vl.target = '_blank'; vl.rel = 'noopener'; vl.title = 'On Google Maps';
    vl.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([vn, va && va.city, va && va.state].filter(Boolean).join(', '));
    where.appendChild(vl);
    var mu = live.matchup[team.slug]; mu = mu && mu.id === ev.id ? mu.data : null;
    if (final) { // the next game, after the final
      var upcoming = (teamGames(team.slug) || []).filter(function (g) { return g.date > gameDay; })[0];
      if (upcoming) line('', 'tf-next').innerHTML = '<b>Next</b> ' + esc(gameLine(upcoming)) + (upcoming.time && !upcoming.tbd ? ', ' + esc(fmtTime(upcoming.time)) : '');
    }
    if (mu && mu.series && (mu.series.text || mu.series.played)) { // the season series, and how the last meeting went
      var sp = line('', 'tf-series'), sl = mu.series.last;
      var lastTxt = sl && (sl.us !== sl.them || sl.us) ? ' · last met ' + parseDate(sl.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + (sl.won ? 'won ' : sl.us === sl.them ? 'drew ' : 'lost ') + sl.us + '–' + sl.them + (sl.home ? ' at home' : ' away') : '';
      sp.innerHTML = '<b>Series</b> ' + esc(mu.series.text || (mu.series.played ? mu.series.played + ' played' : 'first meeting this season')) + esc(lastTxt);
    }
    if (pre && mu) {
      lead = document.createElement('div'); lead.className = 'tf-lines tf-lead';
      function leadLine(cls, html) { var p = document.createElement('p'); p.className = cls; p.innerHTML = html; lead.appendChild(p); }
      if (mu.starters.us || mu.starters.them) leadLine('tf-starters', '<b>Starters</b> ' + esc(mu.starters.us || '?') + ' <span class="tf-dash">vs</span> ' + esc(mu.starters.them || '?'));
      var hurt = []; // the leaders on the IL, by side — the one injury note that matters
      [['us', us.team.abbreviation || team.label], ['them', them.team.abbreviation || them.team.shortDisplayName]].forEach(function (k) {
        var hs = (mu.leaders[k[0]] || []).filter(function (l) { return l.hurt; });
        if (hs.length) hurt.push(esc(k[1]) + ' ' + hs.map(function (l) { return esc(l.name + (l.hurt.what ? ' (' + l.hurt.what + ')' : '')); }).join(', '));
      });
      if (hurt.length) leadLine('tf-hurt', '<b>Leaders out</b> ' + hurt.join(' · '));
      if (!lead.childNodes.length) lead = null;
    }
    // no link out to ESPN, during the game or after it — the block says it all (Steve's call, three times over)
    var watch = null;
    if (final) { // after the final: where to watch the next game, from the schedule
      var nxt = (teamGames(team.slug) || []).filter(function (g) { return g.date > gameDay; })[0];
      watch = buildWatchStrip(nxt && nxt.watch ? nxt.watch.tv || [] : [], nxt && nxt.watch ? nxt.watch.radio : null, '', team);
    } else { // where to watch (before and during): the national and home-market networks (the other side's regional feed left out), the radio from the schedule
      var names = [], side = us.homeAway; // national feeds, plus our own market's — not the other side's regional network
      (c.broadcasts || []).forEach(function (b) {
        var mk = String(b.market || '').toLowerCase();
        if (mk && mk !== 'national' && mk !== side) return;
        (b.names || []).forEach(function (n) { if (n && names.indexOf(n) < 0) names.push(n); });
      });
      var g = liveGameToday(team.slug), radio = g && g.watch && g.watch.radio;
      if (!names.length && g && g.watch && g.watch.tv) names = g.watch.tv.slice(); // ESPN names none: the schedule's
      watch = buildWatchStrip(names, radio, '', team);
    }
    // the ring around the refresh button is the countdown to the next fetch: it fills clockwise over the half-minute, picked up mid-way when the block is redrawn
    // only while the game is on: a final is asked about every five minutes, not thirty seconds, and nothing counts down
    if (!pre && !final && live.at) { rw.classList.add('is-ticking'); rw.style.setProperty('--tick-delay', -Math.min(POLL_MS, Date.now() - live.at.getTime()) + 'ms'); }
    cluster.insertBefore(where, bugwrap); // the venue along the top of the bug
    var vs = vsLine(team.label, us.homeAway === 'home', them.team.shortDisplayName || them.team.displayName); // the compact bar: "at" or "vs" between the two crests, the nicknames either side when the bar has room
    row.appendChild(vs); // in the row, so the compact bar (the row's children laid in the block's own row) can seat it between the crests
    lines.querySelectorAll('.tf-next, .tf-series').forEach(function (p) { // the next game and the season series: the top of the news column, with the starters or the last out
      if (!lead) { lead = document.createElement('div'); lead.className = 'tf-lines tf-lead'; }
      lead.appendChild(p);
    });
    inner.appendChild(rw); // the corner
    var sg = liveGameToday(team.slug), oppLogo = (sg && sg.opp && sg.opp.logo) || them.team.logo; // the schedule's crest (served without its ™) before ESPN's
    var oppSite = (sg && sg.opp && sg.opp.site) || ((them.team.links || []).filter(function (l) { return (l.rel || []).indexOf('clubhouse') >= 0; })[0] || {}).href || null;
    row.appendChild(oppCrest(oppLogo, them.team.displayName, them.team.abbreviation || them.team.shortDisplayName, them.team.displayName || '', oppSite)); // the opponent's crest, the same size as ours, at the other end of the row
    var form = (teamsData && teamsData.form && teamsData.form[team.slug]) || {};
    var side = buildFormSide(form, lead);
    if (side) box.appendChild(side);
    if (watch) box.appendChild(watch); // the strip along the foot, under both columns, as in every state
    inner.insertBefore(buildBrief(lead, watch), rw); // the pinned bar's run
    return box;
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('teamsView').hidden) pollLive(); });
  function renderTeamCal(team, games, today) {
    var box = $('teamCal'); box.innerHTML = '';
    if (!games.length) return;
    if (!team.espn) { var sg = liveGameToday(team.slug); live.events[team.slug] = sg ? synthEvent(team, sg) : null; } // no feed: the block from the schedule
    if (live.slug !== team.slug || !team.espn) { // a switch: whatever the last poll knew about this club
      live.slug = team.slug; live.event = live.events[team.slug] || null;
      live.shown = (live.event && live.event.competitions[0].status.type.state) || null;
    }
    var head = $('teamHead'); head.innerHTML = '';
    head.appendChild(live.shown ? renderTeamLive(team, live.event) : renderTeamForm(team, games, today));
    settleBlock();
    pollLive();
    // the club's colours dress the cards (styles.css .team-cal): home cells
    // in the primary, frames and headers in the accent
    var cols = team.colors || [];
    [box, $('teamsView')].forEach(function (el) { // the section too: the printed banner and legend sit outside the calendar
      el.style.setProperty('--team', cols[0] || 'var(--ink)');
      el.style.setProperty('--team-2', cols[1] || 'var(--ink-soft)');
    });
    // the dark palette paints home cells in the accent (the primaries are
    // navies that sink into the card); its text is dark or white by how
    // light the accent is
    box.style.setProperty('--team-2-on', cols[1] && lum(cols[1]) > 0.35 ? '#0b1620' : '#fff');
    $('teamsView').style.setProperty('--team-2-on', box.style.getPropertyValue('--team-2-on'));
    var byDate = {};
    games.forEach(function (g) { (byDate[g.date] = byDate[g.date] || []).push(g); });
    var rounds = teamPostseason(team.slug), lastRound = rounds.length ? parseDate(rounds[rounds.length - 1].end) : null; // the postseason's rounds shade their days, and the cards run to the final's month
    var first = parseDate(games[0].date), last = parseDate(games[games.length - 1].date);
    if (lastRound && lastRound > last) last = lastRound;
    var m = new Date(first.getFullYear(), first.getMonth(), 1);
    var end = new Date(last.getFullYear(), last.getMonth(), 1);
    // a card gets as many week rows as its month needs, or as its neighbour
    // in the same row of the grid needs (two cards to a row, styles.css) —
    // so the pair lines up and no row of cards carries a spare blank week
    var need = [];
    for (var w = new Date(m); w <= end; w = new Date(w.getFullYear(), w.getMonth() + 1, 1)) {
      need.push(Math.ceil((w.getDay() + new Date(w.getFullYear(), w.getMonth() + 1, 0).getDate()) / 7));
    }
    var idx = 0;
    while (m <= end) {
      var weeks = Math.max(need[idx], need[idx % 2 === 0 ? idx + 1 : idx - 1] || 0);
      idx++;
      var sec = document.createElement('section');
      sec.className = 'cal-month';
      sec.dataset.month = m.getMonth() + 1;
      var h = document.createElement('h3');
      h.className = 'cal-mname';
      // the year only where it changes hands (the first card and each January)
      if (team.logo) { var crest = document.createElement('img'); crest.src = team.logo; crest.alt = ''; crest.width = 28; crest.height = 28; h.appendChild(crest); }
      h.appendChild(document.createTextNode(m.toLocaleDateString('en-US', (m.getTime() === new Date(first.getFullYear(), first.getMonth(), 1).getTime() || m.getMonth() === 0) ? { month: 'long', year: 'numeric' } : { month: 'long' })));
      if (team.sport && SPORT_ICONS[team.sport]) h.appendChild(sportIcon(team.sport)); // crest · name · sport, like the strip's pills
      sec.appendChild(h);
      var wd = document.createElement('div'); wd.className = 'cal-wd'; // the weekday row: print only
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) { var x = document.createElement('span'); x.textContent = d; wd.appendChild(x); });
      sec.appendChild(wd);
      var days = document.createElement('div');
      days.className = 'cal-days';
      var lastDay = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      var cells = weeks * 7;
      for (var i = 0; i < cells; i++) {
        var dayN = i - m.getDay() + 1;
        if (dayN < 1 || dayN > lastDay) {
          var blank = document.createElement('div');
          blank.className = 'cal-day is-blank';
          days.appendChild(blank);
          continue;
        }
        var key = ymd(new Date(m.getFullYear(), m.getMonth(), dayN));
        var gs = byDate[key] || [];
        var cell = document.createElement(gs.length ? 'button' : 'div');
        cell.className = 'cal-day' + (key === today ? ' is-today' : '') + (key < today ? ' is-past' : '');
        var num = document.createElement('span'); num.className = 'num'; num.textContent = dayN; cell.appendChild(num);
        if (!gs.length) { // a postseason day: shaded, named on hover
          var rd = rounds.filter(function (r) { return key >= r.start && key <= r.end; })[0];
          if (rd) { cell.className += ' is-post' + (rd.final ? ' is-final' : ''); cell.title = rd.name + (rd.tbd ? ' (dates to be announced)' : '') + ' — if they qualify'; }
        }
        if (gs.length) {
          var g = gs[0];
          cell.type = 'button'; cell.dataset.date = key;
          cell.className += (g.home ? ' is-home' : ' is-away') + (g.pre ? ' is-pre' : '');
          cell.title = gs.map(function (x) { return (x.home ? 'vs ' : 'at ') + x.opp.name + ', ' + (x.tbd || !x.time ? 'time TBD' : fmtTime(x.time)); }).join(' · ');
          var ab = document.createElement('span'); ab.className = 'abbr'; ab.textContent = g.opp.abbrev || (g.opp.short || g.opp.name).slice(0, 3).toUpperCase(); cell.appendChild(ab);
          var tm = document.createElement('span'); tm.className = 'gtime'; var tt = gs.length > 1 ? '×' + gs.length : teamCalTime(g); tm.textContent = tt.replace(/a$/, ''); cell.appendChild(tm);
          if (/a$/.test(tt)) { var am = document.createElement('i'); am.textContent = 'a'; tm.appendChild(am); } // the morning marker: on screen only — the printed cell has no room beside the day number, and the posters print bare times
          cell.addEventListener('click', jumpToTeamDate);
        }
        days.appendChild(cell);
      }
      sec.appendChild(days);
      box.appendChild(sec);
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }
  }
  // list ⇄ calendar: the section shows one or the other, the chip is lit
  // while the calendar is up
  function applyTeamView() {
    $('teamsView').classList.toggle('is-cal', teamView.cal);
    $('teamCal').hidden = !teamView.cal;
    $('teamViewBtn').setAttribute('aria-pressed', String(teamView.cal));
    $('teamViewBtn').title = teamView.cal ? 'Back to the list' : 'Season calendar';
  }
  $('teamViewBtn').addEventListener('click', function () {
    teamView.cal = !teamView.cal; applyTeamView();
    try { localStorage.setItem('lqa-teams-view', teamView.cal ? 'cal' : 'list'); } catch (e) { /* no storage */ }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  // PDF: the browser's own print-to-PDF of the calendar view alone (styles.css
  // @media print, html.print-team). The list view is switched to the calendar
  // for the print and back after; the document title names the file.
  // prepPrint sets the page up as the poster (also from ?print=1 on a
  // ?team= link, for a headless print-to-PDF); it hands back the undo
  function prepPrint(team) {
    var games = teamGames(team.slug) || [];
    if (!games.length) return null;
    var wasCal = teamView.cal, title = document.title;
    var y1 = games[0].date.slice(0, 4), y2 = games[games.length - 1].date.slice(0, 4);
    // a season is named by its span — but football by the year it starts in
    var season = y1 === y2 || (team.espn && team.espn.sport === 'football') ? y1 : y1 + '–' + y2.slice(2);
    document.title = team.label + ' ' + season + ' schedule';
    // the poster's banner and legend (print only, styles.css)
    var ph = $('printHead'); ph.innerHTML = '';
    if (team.logo) { var pi = document.createElement('img'); pi.src = team.logo; pi.alt = ''; ph.appendChild(pi); }
    var pt = document.createElement('div'); pt.className = 'ph-text';
    var played = games.filter(function (g) { return g.res; });
    var rec = played.length ? recordFrom(played) : '';
    pt.innerHTML = '<span class="ph-team">Seattle ' + team.label + '</span><span class="ph-season">' + season + ' season' + (rec ? ' · ' + rec : '') + '</span>';
    ph.appendChild(pt);
    var pf = $('printFoot'); pf.innerHTML = '<span class="pf-home">Home</span><span class="pf-away">Away</span><span>Start times Pacific, subject to change</span><span>fosdal.net/lqa-events</span>';
    // the sheet: square months on one portrait page (like the wall posters),
    // two, three or four across — whichever leaves them biggest. Letter
    // less 8mm margins is 200 × 263mm; the banner and legend take ~36mm.
    var months = $('teamCal').querySelectorAll('.cal-month').length, best = null;
    [2, 3, 4].forEach(function (cols) {
      var gap = cols === 2 ? 5 : 4, rows = Math.ceil(months / cols);
      var card = Math.min((200 - gap * (cols - 1)) / cols, (224 - gap * (rows - 1)) / rows);
      if (!best || card > best.card + 0.5) best = { cols: cols, gap: gap, card: card };
    });
    document.documentElement.style.setProperty('--pcard', best.card.toFixed(1) + 'mm');
    document.documentElement.style.setProperty('--pgap', best.gap + 'mm');
    teamView.cal = true; applyTeamView();
    document.documentElement.classList.add('print-team');
    return function () {
      document.documentElement.classList.remove('print-team');
      document.documentElement.style.removeProperty('--pcard'); document.documentElement.style.removeProperty('--pgap');
      document.title = title;
      teamView.cal = wasCal; applyTeamView();
    };
  }
  $('teamPdfBtn').addEventListener('click', function () {
    var team = LQAFilter.TEAMS.filter(function (t) { return t.slug === teamView.slug; })[0];
    var undo = team && prepPrint(team);
    if (!undo) return;
    var done = function () { undo(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  });
  // a cell: over to the list, on that day (a played game opens the past first)
  function jumpToTeamDate(e) {
    var date = e.currentTarget.dataset.date;
    if (date < todayStr() && !teamView.showPast) { teamView.showPast = true; renderTeams(teamView.slug); }
    teamView.cal = false; applyTeamView();
    var row = $('teamSched').querySelector('.day-row[data-date="' + date + '"]');
    if (row) row.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  // one opponent: dim every other row, name them above the list, jump to the
  // next meeting. null lights the whole season again.
  function focusOpp(key, opp) {
    teamView.opp = key;
    var rows = $('teamSched').querySelectorAll('.ev');
    var first = null;
    Array.prototype.forEach.call(rows, function (r) {
      var on = !key || r.dataset.opp === key;
      r.classList.toggle('is-dim', !on);
      if (on && key && !first && !r.closest('.day-row').classList.contains('is-past')) first = r;
    });
    renderTeamFocus(key ? opp : null, key);
    if (first) first.closest('.day-row').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function renderTeamFocus(opp, key) {
    var bar = $('teamFocus'); bar.innerHTML = '';
    bar.hidden = !opp;
    if (!opp) { $('teamsView').style.removeProperty('--focus-h'); return; }
    var n = $('teamSched').querySelectorAll('.ev[data-opp="' + key + '"]').length;
    if (opp.logo) { var im = document.createElement('img'); im.src = opp.logo; im.alt = ''; im.width = 28; im.height = 28; bar.appendChild(im); }
    var t = document.createElement('span'); t.className = 'focus-name'; t.textContent = opp.name; bar.appendChild(t);
    var c = document.createElement('span'); c.className = 'focus-n'; c.textContent = n + ' game' + (n === 1 ? '' : 's'); bar.appendChild(c);
    if (opp.site) { var a = document.createElement('a'); a.className = 'chip'; a.href = opp.site; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Their site ↗'; bar.appendChild(a); }
    var x = document.createElement('button'); x.type = 'button'; x.className = 'chip'; x.textContent = '✕ All games'; x.title = 'Back to the whole season';
    x.addEventListener('click', function () { focusOpp(null); });
    bar.appendChild(x);
    $('teamsView').style.setProperty('--focus-h', (bar.offsetHeight + 8) + 'px'); // the month rows stick below it
  }
  $('viewToggle').addEventListener('click', function () { // a tap anywhere on the pill flips the view, as the theme pill does
    if (!$('teamsView').hidden) setTeamsView(null, true);
    else setTeamsView(teamView.slug || new URLSearchParams(location.search).get('team') || LQAFilter.TEAMS[0].slug, true);
  });
  window.addEventListener('popstate', function () {
    var slug = new URLSearchParams(location.search).get('team');
    if (!!slug !== !$('teamsView').hidden || (slug && slug !== teamView.slug)) setTeamsView(slug, false);
  });

  // ---- the event sheet ----
  // A click anywhere on a card opens it (capture phase, so it wins over the
  // venue link's own handler): the details plus the two real choices, the
  // ticket page and the venue's own list. On phones it's a bottom sheet; on
  // wider screens the same element is a pop hung under the card (styles.css
  // ≥641px), placed here and re-placed as the page scrolls. Modifier and
  // middle clicks on the inline links still open them directly.
  var sheetTouch = '(max-width: 640px)';
  var sheetAnchor = null;
  function placeSheet() {
    var sheet = $('sheet');
    if (sheet.hidden || !sheetAnchor || matchMedia(sheetTouch).matches) return;
    if (!document.body.contains(sheetAnchor)) { closeSheet(); return; } // the list re-rendered
    var card = sheetAnchor.getBoundingClientRect();
    var pop = sheet.querySelector('.sheet-card').getBoundingClientRect();
    var gap = 6, pad = 8;
    var left = Math.max(pad, Math.min(card.left, window.innerWidth - pop.width - pad));
    var barBottom = document.querySelector('.filter-area').getBoundingClientRect().bottom + gap;
    var top = card.bottom + gap;
    if (top + pop.height > window.innerHeight - pad) top = card.top - pop.height - gap; // no room below: above
    if (top < barBottom) top = Math.max(pad, window.innerHeight - pop.height - pad); // nor above: keep it on screen, over the card if it must
    sheet.style.left = Math.round(left) + 'px';
    sheet.style.top = Math.round(top) + 'px';
  }
  window.addEventListener('resize', placeSheet);
  function openSheet(e, anchor) {
    $('sheetVenue').textContent = e.venue;
    $('sheetTitle').textContent = e.title;
    var when = parseDate(e.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + fmtTime(e.time);
    if (e.series) when += ' · ' + e.series.n + ' of ' + e.series.total;
    if (e.status) when += ' · ' + e.status.toUpperCase() + (e.statusSince ? ' (noticed ' + fmtSince(e.statusSince) + ')' : '');
    if (e.dateTbd) when += ' · date TBD';
    $('sheetWhen').textContent = when;
    // a home game's TV / radio, when its league listed them
    var w = $('sheetWatch'); w.innerHTML = '';
    var watch = e.watch || {};
    [['tv', 'TV'], ['radio', 'Radio']].forEach(function (k) {
      if (!watch[k[0]] || !watch[k[0]].length) return;
      if (w.childNodes.length) w.appendChild(document.createTextNode(' \u00b7 '));
      var b = document.createElement('b'); b.textContent = k[1];
      w.appendChild(b); w.appendChild(document.createTextNode(watch[k[0]].join(', ')));
    });
    w.hidden = !w.childNodes.length;
    var t = $('sheetTickets'); t.href = e.url || '#'; t.hidden = !e.url;
    var v = $('sheetVenueLink'); v.href = VENUE_URL[e.venue] || '#'; v.hidden = !VENUE_URL[e.venue]; v.textContent = e.venue + ' events';
    var phone = matchMedia(sheetTouch).matches;
    var sheet = $('sheet');
    sheetAnchor = anchor || null;
    sheet.hidden = false;
    sheet.querySelector('.sheet-card').setAttribute('aria-modal', String(phone));
    if (phone) {
      sheet.style.left = sheet.style.top = '';
      document.body.classList.add('sheet-open');
      $('sheetClose').focus();
    } else {
      placeSheet();
      sheet.querySelector('.sheet-card').focus();
    }
  }
  function closeSheet() {
    $('sheet').hidden = true; sheetAnchor = null;
    document.body.classList.remove('sheet-open');
  }
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBack').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
  // a click anywhere outside the pop closes it (the opening click never gets
  // here — cardTap stops it in the capture phase)
  document.addEventListener('click', function (e) {
    if (!$('sheet').hidden && !e.target.closest('.sheet-card')) closeSheet();
  });
  function cardTap(e) {
    return function (ev) {
      // let a deliberate new-tab / middle click on an inline link through
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault(); ev.stopPropagation();
      openSheet(e, ev.currentTarget);
    };
  }
  // copy to the clipboard; falls back to a selection + execCommand where the
  // async API is missing (older browsers, or the site opened over plain http)
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }
  $('copyFilterLink').addEventListener('click', function () {
    var code = LQAFilter.encodeFilterCode({ venueMode: state.venueMode, badgeMode: state.badgeMode, teamMode: state.teamMode });
    var url = location.origin + location.pathname + '?f=' + code;
    if (state.q) url += '&s=' + LQAFilter.encodeSearch(state.q);
    if (state.holidays) url += '&h=1';
    var label = $('copyFilterLabel');
    var original = label.textContent;
    copyText(url).then(function () {
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
    var single = true; // one month, docked or floating (Steve's call 2026-09-08)
    var last = single ? m : next; // the last month shown; › stops when it reaches the feed's last month
    $('calPrev').disabled = !bounds || sameMonth(m, new Date(bounds.min.getFullYear(), bounds.min.getMonth(), 1));
    $('calNext').disabled = !bounds ||
      last.getFullYear() * 12 + last.getMonth() >= bounds.max.getFullYear() * 12 + bounds.max.getMonth();

    var box = $('calGrid');
    box.innerHTML = '';
    var today = todayStr();
    // the month's name sits in the card's header between ‹ and ›
    $('calHead').querySelector('.cal-cur').textContent = m.toLocaleDateString('en-US', { month: 'long' });
    // One month at a time; the ‹ Today › bar above pages by one. The card
    // (name, grid) holds only its own days.
    (single ? [m] : [m, next]).forEach(function (first) {
      var sec = document.createElement('section');
      sec.className = 'cal-month';
      sec.dataset.month = first.getMonth() + 1; // styles.css tints the name row by season
      var h = document.createElement('h3');
      h.className = 'cal-mname';
      h.textContent = first.toLocaleDateString('en-US', { month: 'long' }); // month only, like the list's dividers
      sec.appendChild(h); // no weekday row: the name sits where it was, and the grid starts on Sunday
      var days = document.createElement('div');
      days.className = 'cal-days';
      var last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      var cells = Math.ceil((first.getDay() + last) / 7) * 7;
      for (var i = 0; i < cells; i++) {
        var dayN = i - first.getDay() + 1;
        if (dayN < 1 || dayN > last) { // pad to whole weeks, but no neighbor-month days
          var blank = document.createElement('div');
          blank.className = 'cal-day is-blank';
          days.appendChild(blank);
          continue;
        }
        var d = new Date(first.getFullYear(), first.getMonth(), dayN);
        var key = ymd(d);
        var evs = dayItems(key);
        // every real day is a button: one with nothing on jumps the list to
        // the next listed day (a past one opens the past from there)
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.dataset.date = key;
        cell.setAttribute('aria-label', d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + ', ' + (evs.length ? evs.length + ' event' + (evs.length > 1 ? 's' : '') : 'nothing listed'));
        cell.className = 'cal-day' + (evs.length ? '' : ' is-empty');
        if (key === today) cell.className += ' is-today';
        if (key < today) cell.className += ' is-past';
        var num = document.createElement('span');
        num.className = 'num';
        num.textContent = dayN;
        cell.appendChild(num);
        if (evs.length) {
          var ticks = document.createElement('span');
          ticks.className = 'ticks';
          evs.slice(0, 6).forEach(function (e) {
            var t = document.createElement('i');
            t.style.setProperty('--dot', venueColor(e.venue));
            ticks.appendChild(t);
          });
          cell.appendChild(ticks);
        }
        days.appendChild(cell);
      }
      sec.appendChild(days);
      box.appendChild(sec);
    });
  }
  $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
  $('calNext').addEventListener('click', function () { shiftMonth(1); });
  // TODAY (the floater at the lower right): back to the current month, past
  // days put away, the list on its first page and scrolled to its first
  // (= nearest) day. It only shows while there is somewhere to come back
  // from — see syncTodayFloat.
  $('calToday').addEventListener('click', function () {
    var now = new Date();
    state.month = new Date(now.getFullYear(), now.getMonth(), 1);
    state.showPast = false; state.pastFrom = null;
    renderCal();
    renderAgenda();
    scrollToDate(todayStr());
    syncTodayFloat(); // no scroll event if the list was already there
  });
  function shiftMonth(dir) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + dir, 1);
    swapCal(dir);
    jumpToMonth();
  }
  // The bar's team pills carry names while the row has room for them and
  // fall back to crests alone when it doesn't (re-checked on resize).
  function fitTeamStrip() {
    var strip = $('teamStrip');
    if (!strip.children.length || !document.documentElement.classList.contains('teams-open')) return;
    // three sizes: names with their sport icons; names alone; crests alone
    strip.classList.remove('is-crests', 'is-nosport');
    if (strip.scrollWidth > strip.clientWidth + 1) strip.classList.add('is-nosport');
    if (strip.scrollWidth > strip.clientWidth + 1) strip.classList.add('is-crests');
  }
  // Re-render the month cards with a reel move: forward (dir > 0) the top
  // card scrolls up and out and the new one rises in from below; backward is
  // the mirror. The outgoing card rides along for the run, then goes.
  var calSwapRun = 0;
  function swapCal(dir) {
    var box = $('calGrid');
    var old = Array.from(box.children);
    renderCal();
    if (!old.length || !dir || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var run = ++calSwapRun;
    var exiting = dir > 0 ? old[0] : old[old.length - 1];
    box.style.height = box.offsetHeight + 'px'; box.style.overflow = 'hidden'; // clip to the two-card stack
    if (dir > 0) box.insertBefore(exiting, box.firstChild); else box.appendChild(exiting);
    var gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    var shift = (dir > 0 ? exiting : box.firstChild).offsetHeight + gap; // one card's worth
    var from = dir > 0 ? 0 : -shift, to = dir > 0 ? -shift : 0;
    var DUR = 340;
    var anims = Array.from(box.children).map(function (c) {
      return c.animate([{ transform: 'translateY(' + from + 'px)' }, { transform: 'translateY(' + to + 'px)' }],
        { duration: DUR, easing: 'cubic-bezier(.2, .7, .2, 1)', fill: 'both' });
    });
    // clean up on a timer rather than onfinish (a newer swap will have
    // re-rendered everything already, so it only runs for the latest run)
    setTimeout(function () {
      if (run !== calSwapRun) return;
      anims.forEach(function (a) { a.cancel(); });
      exiting.remove(); box.style.height = ''; box.style.overflow = '';
    }, DUR + 30);
  }
  // Scroll the list to a day: its own row, or the first listed day after it.
  function scrollToDate(date) {
    var rows = Array.from(document.querySelectorAll('.day-row'));
    var row = rows.filter(function (r) { return r.dataset.date >= date; })[0] || rows[rows.length - 1];
    if (row) row.scrollIntoView({ block: 'start' });
  }
  // The listing follows the calendar: scroll to the shown month's first
  // listed day (a fully past month opens the past list first).
  // While a jump's smooth scroll is in flight the calendar must not follow
  // the list (it would turn back to each month passed on the way): the
  // follow pauses until the scroll ends, or a beat later if scrollend never
  // fires. Resuming doesn't re-sync — if the scroll didn't happen (a hidden
  // tab, nowhere left to scroll) the month you chose stays chosen, and the
  // next real scroll syncs as usual.
  var calFollowPaused = false, calFollowTimer = null;
  function pauseCalFollow() {
    calFollowPaused = true;
    clearTimeout(calFollowTimer);
    calFollowTimer = setTimeout(resumeCalFollow, 1200);
  }
  function resumeCalFollow() {
    calFollowPaused = false; clearTimeout(calFollowTimer);
  }
  window.addEventListener('scrollend', resumeCalFollow);
  function jumpToMonth() {
    var target = ymd(state.month);
    if (target < todayStr() && !sameMonth(state.month, new Date())) {
      state.showPast = true;
      state.pastFrom = target; // nothing older than that month
      renderAgenda();
    }
    pauseCalFollow();
    scrollToDate(target);
  }
  $('calGrid').addEventListener('click', function (e) {
    var cell = e.target.closest('button.cal-day');
    if (!cell || !cell.dataset.date) return;
    var date = cell.dataset.date;
    if (date < todayStr()) {
      // past days are hidden until asked for — and a clicked day is where
      // the past list starts, not the whole year of history
      state.showPast = true;
      state.pastFrom = date;
      renderAgenda();
    }
    scrollToDate(date);
  });

  // ---- agenda ----
  // One continuous list of every upcoming day (the calendar is the way
  // around it). Past days are hidden until asked for — from the calendar (a
  // past day, or ‹ into a past month); TODAY puts them away again.
  function renderAgenda() {
    var ol = $('agenda');
    ol.innerHTML = '';
    var dates = Object.keys(state.byDate).sort();
    var today = todayStr();
    var pastCount = 0;
    var inPast = function (d) { return d < today && (!state.pastFrom || d >= state.pastFrom); };
    dates.forEach(function (date) { if (date < today) pastCount += dayItems(date).length; });
    var shown = 0;
    var visible = dates.filter(function (d) {
      return dayItems(d).length && (d >= today || (state.showPast && inPast(d)));
    });
    // A month divider opens each month; it sticks to the top until the next
    // one pushes it out — which needs each month's rows in their own group
    // (a sticky element only sticks within its parent), so the list is
    // <li class="month-group"> per month holding the divider and its days.
    var lastMonth = null, group = null;
    function ordinal(n) { var t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
    // text is the label; a holiday passes { title, date } and reads just
    // "Labor Day" on its own row (its day is right below), "New Year's Day –
    // 1st" when it joins the month's row
    function divider(cls, text) {
      if (cls === 'month-row') {
        group = document.createElement('li');
        group.className = 'month-group';
        ol.appendChild(group);
      }
      var s = document.createElement('span');
      // A holiday falling on a month's first listed day would put two
      // dividers back to back; instead its pill joins the month's row (and
      // hides while that row is stuck, so the sticky header stays the month).
      var joinMonth = cls === 'holiday-row' && group && group.children.length === 1 && group.lastChild.classList.contains('month-row');
      var li = joinMonth ? group.lastChild : document.createElement('div');
      if (!joinMonth) li.className = cls; else s.className = 'hol-pill';
      if (typeof text !== 'string') {
        text = joinMonth ? text.title + ' – ' + ordinal(parseDate(text.date).getDate()) : text.title;
      }
      s.appendChild(document.createTextNode(text));
      li.appendChild(s);
      if (!joinMonth) (group || ol).appendChild(li);
    }
    function ensureMonth(dateStr) {
      var month = dateStr.slice(0, 7);
      if (month === lastMonth) return;
      lastMonth = month;
      divider('month-row', parseDate(dateStr).toLocaleDateString('en-US', { month: 'long' }));
    }
    // Holidays (when switched on) are plain dividers — "Labor Day – September
    // 7" — placed right above the day's first event, and they scroll past.
    // One that falls on a day with nothing listed still shows, between its
    // neighbors.
    var holDates = Object.keys(holidayMap()).sort();
    var dayBefore = function (s) { var d = parseDate(s); d.setDate(d.getDate() - 1); return ymd(d); };
    var prevDate = state.showPast ? (state.pastFrom ? dayBefore(state.pastFrom) : '') : dayBefore(today);
    function holidaysThrough(dateStr) {
      holDates.forEach(function (hd) {
        if (hd <= prevDate || hd > dateStr) return;
        ensureMonth(hd);
        holidayMap()[hd].forEach(function (h) {
          divider('holiday-row', { title: h.title, date: hd });
        });
      });
      prevDate = dateStr;
    }
    visible.forEach(function (date) {
      var evs = dayItems(date);
      shown += evs.length;
      var d = parseDate(date);
      holidaysThrough(date);
      ensureMonth(date);
      var li = document.createElement('div');
      li.className = 'day-row' + (date === today ? ' is-today' : '') + (date < today ? ' is-past' : '');
      li.dataset.date = date;

      var rail = document.createElement('div');
      rail.className = 'date-rail';
      rail.innerHTML =
        '<span class="dnum">' + d.getDate() + '</span>' +
        '<span class="dmeta">' + d.toLocaleDateString('en-US', { weekday: 'long' }) + '</span>';
      li.appendChild(rail);

      var wrap = document.createElement('div');
      wrap.className = 'day-events';
      evs.forEach(function (e) {
        var row = document.createElement('div');
        row.className = 'ev' + (e.time ? '' : ' is-allday');
        row.addEventListener('click', cardTap(e), true);
        // the venue's hue over the card at --tint (stronger in light mode, where
        // a faint wash on white disappears)
        row.style.background = 'color-mix(in srgb, ' + venueColor(e.venue) + ' var(--tint), transparent)';
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
        // a home game's crest; a local bar's night carries the bar's own logo
        // the same way (other venues carry no mark)
        var mark = (team && team.logo) || (eventType(e) === 'bar' && LQAFilter.VENUE_ICON[e.venue]) || '';
        if (mark) {
          var logo = document.createElement('img');
          logo.className = 'team-mark' + (team ? '' : ' venue-mark'); // a bar's logo keeps its colors, muted
          logo.src = mark;
          logo.alt = ''; // decorative — the row already names the team/venue
          row.appendChild(logo);
        }
        titleLine.appendChild(a);
        body.appendChild(venue); body.appendChild(titleLine);
        // a show that's off: struck through, with a third line saying so
        // (and when we noticed, if the feed knows)
        if (e.status) {
          row.classList.add('is-off');
          // the card's wash goes gray so only the note has color
          row.style.background = 'color-mix(in srgb, var(--ink-soft) 14%, transparent)';
          var off = document.createElement('span');
          off.className = 'ev-note';
          off.textContent = e.status.charAt(0).toUpperCase() + e.status.slice(1) + (e.statusSince ? ' ' + fmtSince(e.statusSince) : '');
          off.title = 'This event has been ' + e.status + ' — check the ticket page for refunds or a new date';
          body.appendChild(off);
        }
        // a game the league may still move
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
      (group || ol).appendChild(li);
    });
    // holidays after the last listed day (or all of them, when the filter
    // leaves nothing) — the year ahead, so the switch shows something even
    // with every venue cleared
    var yearOut = new Date(); yearOut.setFullYear(yearOut.getFullYear() + 1);
    holidaysThrough(ymd(yearOut));
    if (!shown && !pastCount && !ol.children.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No upcoming events for this filter yet — check back after the next refresh.';
      ol.appendChild(li);
    }
    drawSeriesGraph();
    syncTodayFloat();
  }
  // the series graph is measured from the rows, so it follows the window
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { drawSeriesGraph(); fitTeamStrip(); }, 150);
  });

  // The month divider that's currently stuck (just under the pinned filter
  // bar) gets a shadow: the last one whose top has reached the bar's bottom
  // edge (rAF-throttled scroll).
  // The floating panels (filter panel, Add To Calendar pop, the phone's
  // calendar) hang off the pinned bar, but before the page has scrolled the
  // bar still sits under the masthead — so a stylesheet max-height measured
  // from the top of the viewport can run past its bottom. Cap each open
  // panel at the room it actually has; re-measured as the bar rides up.
  // On open (opening = true) a panel with almost no room — a landscape phone
  // with the masthead still on screen — first scrolls the page until the bar
  // is pinned, which is where the panel would end up anyway.
  function fitPops(opening) {
    [$('filterPanel'), $('subscribePop'), $('calBox')].forEach(function (el) {
      if (el.hidden) return;
      if (el === $('calBox') && !document.querySelector('.cal-side.is-float')) { el.style.maxHeight = ''; return; }
      var room = window.innerHeight - el.getBoundingClientRect().top - 12;
      if (opening && room < 240) {
        var bar = document.querySelector('.filter-area').getBoundingClientRect();
        if (bar.top > 0) {
          window.scrollTo({ top: window.scrollY + bar.top, behavior: 'instant' });
          room = window.innerHeight - el.getBoundingClientRect().top - 12;
        }
      }
      el.style.maxHeight = Math.max(200, Math.round(room)) + 'px';
    });
  }
  window.addEventListener('resize', fitPops);
  // The Today floater shows only when it would do something: past days are
  // open, the calendar is on another month, or the list has scrolled off the
  // day Today would return to (the nearest listed day from today on).
  function syncTodayFloat() {
    var btn = $('calToday');
    var today = todayStr();
    var edge = document.querySelector('.filter-area').getBoundingClientRect().bottom + 1;
    var rows = Array.from(document.querySelectorAll('#agenda .day-row'));
    var home = rows.filter(function (r) { return r.dataset.date >= today; })[0] || rows[rows.length - 1];
    var first = rows.filter(function (r) { return r.getBoundingClientRect().bottom > edge; })[0];
    var away = state.showPast ||
      (state.month && !sameMonth(state.month, new Date())) ||
      (home && first && first !== home);
    btn.hidden = !away;
  }
  var stuckPending = false, lastHeadH = '', lastFullH = 0;
  var COMPACT_BELOW = 0.75; // the pinned block goes compact once the list below it runs longer than this share of the window
  function markStuck() {
    stuckPending = false;
    // the Back-to-top floater (lower right, above the footer) shows once the
    // page has scrolled a way; the bar's title line the moment the masthead
    // itself is out of view (and goes the moment it's back)
    var atTop = document.scrollingElement.scrollTop < 240;
    if ($('toTop').hidden !== atTop) $('toTop').hidden = atTop;
    var mastOff = document.querySelector('.masthead').getBoundingClientRect().bottom <= 0;
    var bt = document.querySelector('.bar-title');
    if (bt.hidden === mastOff) {
      bt.hidden = !mastOff;
      document.documentElement.classList.toggle('is-scrolled', mastOff); // raises --barh by the title line
    }
    fitPops();
    // the Teams block: pinned under the bar once the page has scrolled past
    // its place, and compact while it is — small crests floating at the top
    // with the record or the score, the rest of it folded away. The sentinel
    // is the block's own spot in the flow (it never moves when the block shrinks).
    // (reads only, and a write only when the value moves: a style write
    // between the reads would force a fresh layout on every scroll frame)
    var th = $('teamHead'), teamsOn = !$('teamsView').hidden;
    if (teamsOn && th.firstChild) {
      // the whole block scrolls away with the page like anything else; once it has gone under the bar — and there is a real run of list below to scroll through (a short page, an off-season, keeps nothing pinned) — the compact bar takes its place, pinned under the bar (styles.css: #teamHead is sticky only while compact)
      if (!th.classList.contains('is-compact')) lastFullH = th.offsetHeight;
      var spotTop = $('teamHeadTop').getBoundingClientRect().top, barBottom = document.querySelector('.filter-area').getBoundingClientRect().bottom;
      var se = document.scrollingElement, below = se.scrollHeight - (se.scrollTop + spotTop) - lastFullH; // the page below the block's spot
      var compact = spotTop + lastFullH <= barBottom && below > window.innerHeight * COMPACT_BELOW;
      if (th.classList.contains('is-compact') !== compact) {
        // going compact the block gives up height; that height goes into its bottom margin so the page keeps its length — otherwise a short page shrinks under the scroll, the block unpins, grows, pins again, and loops
        var fullH = compact ? th.offsetHeight : 0;
        th.classList.toggle('is-compact', compact);
        th.style.marginBottom = compact ? 'calc(1.1rem + ' + Math.max(0, fullH - th.offsetHeight) + 'px)' : '';
        if (!compact) settleBlock();
      }
      var headH = compact ? th.offsetHeight + 'px' : ''; // the opponent bar and the month rows pin below the compact bar (the bar's top padding is the gap under the filter bar)
      if (headH !== lastHeadH) { lastHeadH = headH; if (headH) $('teamsView').style.setProperty('--head-h', headH); else $('teamsView').style.removeProperty('--head-h'); }
    }
    var edge = document.querySelector('.filter-area').getBoundingClientRect().bottom + 1;
    var rows = document.querySelectorAll('section:not([hidden]) .month-row'); // the list on show: agenda or Teams
    var stuck = null;
    rows.forEach(function (r) { if (r.getBoundingClientRect().top <= edge) stuck = r; });
    rows.forEach(function (r) { r.classList.toggle('is-stuck', r === stuck && document.scrollingElement.scrollTop > 0); });
    // and the mini calendar follows the list: its first month is the month
    // of the first day still in view under the bar
    var first = null;
    if (state.month && !calFollowPaused && !teamsOn && !document.documentElement.classList.contains('teams-open')) { // the agenda only; the first row still under the bar, by bisection (the rows are in order)
      var days = document.querySelectorAll('.agenda .day-row'), lo = 0, hi = days.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (days[mid].getBoundingClientRect().bottom > edge) hi = mid; else lo = mid + 1; }
      if (days.length && days[lo].getBoundingClientRect().bottom > edge) first = days[lo];
    }
    if (first) {
      var ym = first.dataset.date.slice(0, 7);
      var cur = ymd(state.month).slice(0, 7);
      if (ym !== cur) {
        state.month = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
        swapCal(ym > cur ? 1 : -1); // the reel turns the way the list moved
      }
    }
    syncTodayFloat();
  }
  window.addEventListener('scroll', function () {
    placeSheet(); // the event pop rides with its card, same frame as the scroll
    if (!stuckPending) { stuckPending = true; requestAnimationFrame(markStuck); setTimeout(function () { if (stuckPending) markStuck(); }, 150); } // a hidden tab gets no frames: the timer keeps the pin state in step with the scroll
  }, { passive: true });
  $('toTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // The footer keeps to one line: when it wouldn't fit, Sources and Embed
  // drop to their icons; if it still doesn't, the credit drops to its mark.
  function fitFooter() {
    var inner = document.querySelector('.foot-inner');
    inner.classList.remove('is-tight', 'is-tighter');
    if (inner.scrollWidth > inner.clientWidth + 1) inner.classList.add('is-tight');
    if (inner.scrollWidth > inner.clientWidth + 1) inner.classList.add('is-tighter');
  }
  fitFooter();
  window.addEventListener('resize', fitFooter);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitFooter);

  // the footer's Sources and Embed panels float open over the list; a click
  // anywhere else folds them back
  document.addEventListener('click', function (e) {
    document.querySelectorAll('footer details[open]').forEach(function (d) {
      if (!d.contains(e.target)) d.open = false;
    });
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
  // the pop floats over the docked mini calendar and is shorter than it,
  // so while it's open the calendar fades out (styles.css: html.pop-open)
  // rather than showing a strip of days under the pop's bottom edge
  function setSubscribeOpen(open) {
    $('subscribePop').hidden = !open;
    $('subscribeBtn').setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('pop-open', open);
    if (open) { $('qrPanel').hidden = true; $('qrBtn').setAttribute('aria-expanded', 'false'); fitPops(true); }
  }
  $('subscribeBtn').addEventListener('click', function () { setSubscribeOpen($('subscribePop').hidden); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#subscribeBtn, #subscribePop') && !$('subscribePop').hidden) setSubscribeOpen(false);
  });
  $('copyIcs').addEventListener('click', function (ev) {
    ev.preventDefault();
    var chip = this;
    copyText(icsHref).then(function () {
      chip.classList.add('is-done'); // the chip shows a check for a moment
      setTimeout(function () { chip.classList.remove('is-done'); }, 1500);
    });
  });

  if (!loadFiltersFromURL()) loadFilters();
  load();
  // ?team=…&print=1: the page as the poster, ready for a headless print-to-PDF
  if (new URLSearchParams(location.search).get('print') === '1') {
    var printWait = setInterval(function () {
      var slug = new URLSearchParams(location.search).get('team');
      var t = LQAFilter.TEAMS.filter(function (x) { return x.slug === slug; })[0];
      if (!t || !teamGames(slug) || !$('teamCal').querySelector('.cal-month')) return;
      clearInterval(printWait); prepPrint(t);
      document.documentElement.classList.add('print-ready');
    }, 200);
  }
  // a ?team= link opens the Teams view straight away
  if (new URLSearchParams(location.search).get('team')) setTeamsView(new URLSearchParams(location.search).get('team'), false);
})();
