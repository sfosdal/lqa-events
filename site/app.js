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
  var state = { events: [], byDate: {}, venues: [], venueMode: {}, badgeMode: {}, teamMode: {}, q: '', holidays: false, month: null, showPast: false, pastFrom: null, series: [] };

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
  // ---- series (detection, labels and the gutter graph live in filter.js,
  // shared with other sites that list the feed) ----
  var seriesLabel = LQAFilter.seriesLabel;
  function findSeries(list) {
    state.series = LQAFilter.findSeries(list);
    document.querySelector('.agenda-layout').classList.toggle('has-series', state.series.length > 0);
  }
  // The gutter column right of the cards is sized per page for the lanes
  // the graph needs; lines are in the series' event-type color and curve
  // into each card's type stripe.
  function drawSeriesGraph() {
    var ol = $('agenda');
    var layout = document.querySelector('.agenda-layout');
    if (!state.series.length || !matchMedia('(min-width: 641px)').matches) {
      var old = ol.querySelector('.series-graph');
      if (old) old.remove();
      layout.style.removeProperty('--gutter');
      return;
    }
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    var de = ol.querySelector('.day-events');
    var rows = Array.from(ol.querySelectorAll('.ev[data-series]')).map(function (el) {
      return { el: el, series: state.series[Number(el.dataset.series)] };
    });
    var dates = Array.from(ol.querySelectorAll('.day-row')).map(function (li) { return li.dataset.date; });
    LQAFilter.drawSeriesGraph(ol, rows, {
      firstDate: dates[0], lastDate: dates[dates.length - 1],
      laneWidth: 0.9 * rem,
      onLanes: function (n) { layout.style.setProperty('--gutter', (n ? n * 0.9 + 0.3 : 0.9) + 'rem'); },
      gutterX: function (box) { return de.getBoundingClientRect().right - box.left + rem; }, // past the cards and the grid gap
      color: function (s) { return typeColor(eventType(s.events[0])); },
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
    if (state.q || state.holidays) return false;
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
      [nthWeekday(y, 0, 1, 3), 'Martin Luther King Jr. Day'],
      [nthWeekday(y, 1, 1, 3), "Presidents' Day"],
      [nthWeekday(y, 4, 1, -1), 'Memorial Day'],
      [new Date(y, 5, 19), 'Juneteenth'],
      [new Date(y, 6, 4), 'Independence Day'],
      [nthWeekday(y, 8, 1, 1), 'Labor Day'],
      [nthWeekday(y, 9, 1, 2), "Indigenous Peoples' Day"],
      [new Date(y, 10, 11), 'Veterans Day'],
      [thanks, 'Thanksgiving'],
      [friday, 'Native American Heritage Day'],
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
  // Every checkbox in the panel syncs from state in one pass, so Select all /
  // only / Reset all land in the same place.
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
    $('holidaysToggle').checked = state.holidays;
    if ($('searchBox').value.trim() !== state.q) $('searchBox').value = state.q;
    var any = !isDefaultState();
    $('filterToggle').classList.toggle('is-on', any);
    $('clearAll').disabled = !any;
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
    var l = e.target.closest('.fp-link');
    if (l && l.dataset.group) { // Reset all is an .fp-link too, with its own handler
      // a group's own links, or the footer's, which sweep all three groups
      var groups = l.dataset.group === 'all' ? ['venue', 'team', 'badge'] : [l.dataset.group];
      if (l.dataset.group === 'all') state.holidays = l.dataset.act === 'all'; // the footer's sweep takes Holidays along
      groups.forEach(function (g) {
        var gi = groupInfo(g);
        gi.keys.forEach(function (k) { setChecked(gi.map, k, l.dataset.act === 'all'); });
        if (g === 'team' && l.dataset.act === 'all') {
          TEAMS.forEach(function (t) { ensureTeamVenue(t.slug); });
        }
      });
      applyFilters();
    }
  });
  function setPanelOpen(open) {
    $('filterPanel').hidden = !open;
    $('filterToggle').setAttribute('aria-expanded', String(open));
  }
  function togglePanel() { setPanelOpen($('filterPanel').hidden); }
  $('filterToggle').addEventListener('click', togglePanel);
  // a click anywhere outside the panel or its chip closes it
  document.addEventListener('click', function (e) {
    if (!$('filterPanel').hidden && !e.target.closest('#filterPanel, #filterToggle')) {
      setPanelOpen(false);
    }
  });
  function clearAllFilters() {
    state.venueMode = {};
    state.teamMode = {};
    state.q = '';
    state.holidays = false;
    applyDefaultFilters();
    applyFilters();
  }
  $('clearAll').addEventListener('click', clearAllFilters);
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

  // ---- the mini calendar: docked or floating ----
  // Wide layout (the page at its full width): docked beside the list, always
  // shown, no toggle. Narrower: never docked — beside the list it would
  // squeeze the cards to a sliver — so a handle at the list's top-right
  // opens it as a floating panel over the list, and it closes again on a
  // day pick or a tap elsewhere (transient, so nothing is stored).
  var STACKED = '(max-width: 1023px)';
  var calFloatOpen = false;
  function syncCal() {
    var stacked = matchMedia(STACKED).matches;
    var open = !stacked || calFloatOpen;
    $('calBox').hidden = !open;
    document.querySelector('.cal-side').classList.toggle('is-float', stacked && open);
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
    if (!e.target.closest('.cal-side')) closeFloatCal();
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
    if (state.q) url += '&s=' + LQAFilter.encodeSearch(state.q);
    if (state.holidays) url += '&h=1';
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

    var box = $('calGrid');
    box.innerHTML = '';
    var today = todayStr();
    // Two months at a time — this one and the next — so the near future is
    // always completely in view; the ‹ TODAY › bar above slides the pair by
    // one. Each month is its own card (name, weekday row, grid) holding
    // only its own days.
    [m, next].forEach(function (first) {
      var sec = document.createElement('section');
      sec.className = 'cal-month';
      sec.dataset.month = first.getMonth() + 1; // styles.css tints the name row by season
      var h = document.createElement('h3');
      h.className = 'cal-mname';
      h.textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      sec.appendChild(h);
      var dow = document.createElement('div');
      dow.className = 'cal-dow';
      dow.setAttribute('aria-hidden', 'true');
      'SMTWTFS'.split('').forEach(function (c) {
        var s = document.createElement('span'); s.textContent = c; dow.appendChild(s);
      });
      sec.appendChild(dow);
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
        var cell = document.createElement(evs.length ? 'button' : 'div');
        cell.className = 'cal-day';
        if (key === today) cell.className += ' is-today';
        if (key < today) cell.className += ' is-past';
        var num = document.createElement('span');
        num.className = 'num';
        num.textContent = dayN;
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
        days.appendChild(cell);
      }
      sec.appendChild(days);
      box.appendChild(sec);
    });
  }
  $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
  $('calNext').addEventListener('click', function () { shiftMonth(1); });
  // TODAY is always live: back to the current month, past days put away,
  // the list on its first page and scrolled to its first (= nearest) day
  $('calToday').addEventListener('click', function () {
    var now = new Date();
    state.month = new Date(now.getFullYear(), now.getMonth(), 1);
    state.showPast = false; state.pastFrom = null;
    renderCal();
    renderAgenda();
    scrollToDate(todayStr());
  });
  function shiftMonth(dir) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + dir, 1);
    renderCal();
    jumpToMonth();
  }
  // Scroll the list to a day: its own row, or the first listed day after it.
  function scrollToDate(date) {
    var rows = Array.from(document.querySelectorAll('.day-row'));
    var row = rows.filter(function (r) { return r.dataset.date >= date; })[0] || rows[rows.length - 1];
    if (row) row.scrollIntoView({ block: 'start' });
  }
  // The listing follows the calendar: scroll to the shown month's first
  // listed day (a fully past month opens the past list first).
  function jumpToMonth() {
    var target = ymd(state.month);
    if (target < todayStr() && !sameMonth(state.month, new Date())) {
      state.showPast = true;
      state.pastFrom = target; // nothing older than that month
      renderAgenda();
    }
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
    // one pushes it out.
    var lastMonth = null;
    function divider(cls, text) {
      var li = document.createElement('li');
      li.className = cls;
      var s = document.createElement('span');
      s.textContent = text;
      li.appendChild(s);
      ol.appendChild(li);
    }
    function ensureMonth(dateStr) {
      var month = dateStr.slice(0, 7);
      if (month === lastMonth) return;
      lastMonth = month;
      divider('month-row', parseDate(dateStr).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
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
          divider('holiday-row', h.title + ' – ' + parseDate(hd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }));
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
      var li = document.createElement('li');
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
  }
  // the series graph is measured from the rows, so it follows the window
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawSeriesGraph, 150);
  });

  // The month divider that's currently stuck (just under the pinned filter
  // bar) gets a shadow: the last one whose top has reached the bar's bottom
  // edge (rAF-throttled scroll).
  var stuckPending = false;
  function markStuck() {
    stuckPending = false;
    // the bar's Back-to-top button shows once the masthead has scrolled off
    $('toTop').hidden = document.scrollingElement.scrollTop < 240;
    var edge = document.querySelector('.filter-area').getBoundingClientRect().bottom + 1;
    var rows = document.querySelectorAll('.month-row');
    var stuck = null;
    rows.forEach(function (r) { if (r.getBoundingClientRect().top <= edge) stuck = r; });
    rows.forEach(function (r) { r.classList.toggle('is-stuck', r === stuck && document.scrollingElement.scrollTop > 0); });
    // and the mini calendar follows the list: its first month is the month
    // of the first day still in view under the bar
    var days = Array.from(document.querySelectorAll('.day-row'));
    var first = days.filter(function (d) { return d.getBoundingClientRect().bottom > edge; })[0];
    if (first && state.month) {
      var ym = first.dataset.date.slice(0, 7);
      if (ym !== ymd(state.month).slice(0, 7)) {
        state.month = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
        renderCal();
      }
    }
  }
  window.addEventListener('scroll', function () {
    if (!stuckPending) { stuckPending = true; requestAnimationFrame(markStuck); }
  }, { passive: true });
  $('toTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // "Put this on your site" (in the pinned footer) floats open over the
  // list; a click anywhere else folds it back
  document.addEventListener('click', function (e) {
    var share = $('embed');
    if (share.open && !e.target.closest('#embed')) share.open = false;
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
    // sit under the chip, but never past the bar's right edge
    var bar = this.parentNode;
    pop.style.setProperty('--pop-x', Math.max(0, Math.min(this.offsetLeft, bar.clientWidth - pop.offsetWidth)) + 'px');
    if (open) { $('qrPanel').hidden = true; $('qrBtn').setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#subscribeBtn, #subscribePop')) {
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
