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
  };
  function venueColor(v) {
    if (VENUE_VARS[v]) return 'var(' + VENUE_VARS[v] + ')';
    var h = 0;
    for (var i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 42%, 52%)';
  }

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
  var state = { events: [], byDate: {}, venues: [], venueMode: {}, badgeMode: {}, teamMode: {}, month: null, showPast: false, page: 0, pageByDate: {} };

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
  function load() {
    fetch('events.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data.events || []);
        state.events = list;
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
    { key: 'community', label: 'Community & Festivals', title: 'Grounds events, festivals, fairs, SIFF specials' },
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

  // Estimated end: the source's real end time, else start + 3h. '' if unknown
  // or the estimate crosses midnight.
  function endEstimate(e) {
    if (e.end) return e.end;
    if (!e.time) return '';
    var h = Number(e.time.split(':')[0]) + 3;
    return h >= 24 ? '' : pad(h) + ':' + e.time.split(':')[1] + ':00';
  }
  function badgesFor(e) {
    var out = [];
    if (e.age21) out.push(['b-21', '21+', 'Door-restricted, no minors']);
    var end = endEstimate(e);
    if (end && end <= '16:00:00') out.push(['b-day', 'day', 'Wraps up by 4 p.m.']);
    if (e.soldOut) out.push(['b-sold', 'sold out', 'Full house guaranteed']);
    if (e.free) out.push(['b-free', 'free', 'Open to walk-ups']);
    if (e.movie) out.push(['b-movie', 'movie', 'A film screening, not a live event']);
    if (e.dateTbd) out.push(['b-tbd', 'date tbd', 'Date not final — the league may still move this game']);
    return out;
  }
  function appendBadges(el, e) {
    badgesFor(e).forEach(function (b) {
      var s = document.createElement('span');
      s.className = 'badge ' + b[0];
      s.textContent = b[1];
      s.title = b[2];
      el.appendChild(s);
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
  function venueName(v) { return dottedName(v, venueColor(v)); }
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
      name.textContent = t.label;
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
    var parsed = LQAFilter.parseFilterQuery(location.search);
    if (!parsed.any) return false;
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
      var g = groupInfo(o.dataset.group);
      g.keys.forEach(function (k) { g.map[k] = 'ex'; });
      delete g.map[o.dataset.key];
      if (o.dataset.group === 'team') ensureTeamVenue(o.dataset.key);
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
    $('quickMoreLabel').textContent = open ? 'Less' : 'More';
    $('quickMore').setAttribute('aria-expanded', String(open));
    $('filterToggle').setAttribute('aria-expanded', String(open));
  }
  function togglePanel() { setPanelOpen($('fullFilters').hidden); }
  $('filterToggle').addEventListener('click', togglePanel);
  $('quickMore').addEventListener('click', togglePanel);
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
  $('copyFilterLink').addEventListener('click', function () {
    var qs = LQAFilter.encodeFilterQuery({ venueMode: state.venueMode, badgeMode: state.badgeMode, teamMode: state.teamMode });
    var url = location.origin + location.pathname + (qs ? '?' + qs : '');
    var label = $('copyFilterLink');
    var original = label.textContent;
    navigator.clipboard.writeText(url).then(function () {
      label.textContent = 'Copied';
      setTimeout(function () { label.textContent = original; }, 1500);
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
      if (!state.showPast || state.page !== 0) { state.showPast = true; gotoPage(0); }
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
      // past days live above page one, behind the toggle
      if (!state.showPast || state.page !== 0) {
        state.showPast = true;
        state.page = 0;
        renderAgenda();
      }
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
    var pastCount = 0;
    var pages = [];
    var count = 0;
    state.pageByDate = {};
    dates.forEach(function (date) {
      var n = filtered(state.byDate[date]).length;
      if (!n) return;
      if (date < today) { pastCount += n; return; }
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
        ? 'Hide the ' + pastCount + ' past events'
        : 'Show ' + pastCount + ' past events';
      tb.addEventListener('click', function () {
        state.showPast = !state.showPast;
        renderAgenda();
      });
      tli.appendChild(tb);
      ol.appendChild(tli);
    }
    var visible = pages.length ? pages[state.page] : [];
    if (state.showPast && state.page === 0) {
      visible = dates.filter(function (d) {
        return d < today && filtered(state.byDate[d]).length;
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
        row.style.background = 'color-mix(in srgb, ' + venueColor(e.venue) + ' 9%, transparent)';
        // the right edge carries the event type's hue, matching its filter dot
        row.style.borderRight = '1rem solid ' + typeColor(eventType(e));
        var time = document.createElement('span');
        time.className = 'time';
        time.textContent = fmtTime(e.time);
        // time keeps its own column; everything else stacks left-aligned:
        // venue, then title, then tags
        var body = document.createElement('div');
        body.className = 'ev-body';
        var venue = document.createElement('span');
        venue.className = 'venue';
        venue.textContent = e.venue;
        venue.style.setProperty('--dot', venueColor(e.venue));
        var a = document.createElement('a');
        a.href = e.url || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = e.title;
        var titleLine = document.createElement('span');
        titleLine.className = 'ev-title';
        var team = teamFor(e.title);
        if (team) {
          var logo = document.createElement('img');
          logo.className = 'team-mark';
          logo.src = team.logo;
          logo.alt = ''; // decorative — the title already names the team
          row.appendChild(logo);
        }
        titleLine.appendChild(a);
        body.appendChild(venue); body.appendChild(titleLine);
        var tags = document.createElement('div');
        tags.className = 'ev-tags';
        appendBadges(tags, e);
        if (tags.children.length) body.appendChild(tags);
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
  }

  // ---- pager: ‹ 1 2 3 › under the list, ellipsized when the year runs long ----
  function gotoPage(p) {
    state.page = p;
    renderAgenda();
    document.querySelector('.agenda').scrollIntoView({ block: 'start' });
  }
  function renderPager(pages) {
    var nav = $('agendaPager');
    nav.innerHTML = '';
    var total = pages.length;
    if (total < 2) return;
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
    for (var i = 0; i < total; i++) {
      // always the first, last, and current±1; the rest collapse into …
      if (total > 7 && i !== 0 && i !== total - 1 && Math.abs(i - state.page) > 1) continue;
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
    }
    nav.appendChild(arrow('›', state.page < total - 1 ? state.page + 1 : null, 'Later events'));
  }

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
