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

  // Local pro teams — uncheck one to hide its home games, matched on the
  // title no matter what the venue. Mirrors TEAMS in scripts/badges.mjs.
  var TEAMS = [
    { slug: 'mariners', label: 'Mariners', re: /mariners/i },
    { slug: 'storm', label: 'Storm', re: /seattle storm/i },
    { slug: 'seahawks', label: 'Seahawks', re: /seahawks/i },
    { slug: 'reign', label: 'Reign', re: /reign fc|seattle reign/i },
    { slug: 'sounders', label: 'Sounders', re: /sounders/i },
    { slug: 'kraken', label: 'Kraken', re: /kraken/i },
    { slug: 'huskies', label: 'Huskies', re: /huskies/i },
  ];
  var TEAM_BY_SLUG = {};
  TEAMS.forEach(function (t) { TEAM_BY_SLUG[t.slug] = t; });

  // Kayak-style checkboxes: each filter map holds name → 'ex' for unchecked
  // (hidden); absent = checked (shown). Everything starts checked except SIFF
  // movies — see applyDefaultFilters.
  var state = { events: [], byDate: {}, venues: [], venueMode: {}, badgeMode: {}, teamMode: {}, month: null, showPast: false };

  function modeKeys(map, mode) {
    return Object.keys(map).filter(function (k) { return map[k] === mode; });
  }
  function setChecked(map, key, on) {
    if (on) delete map[key]; else map[key] = 'ex';
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

  // Predicates mirror scripts/badges.mjs — keep the two in sync.
  var BADGE_PREDS = {
    '21plus': function (e) { return !!e.age21; },
    'day': function (e) { var end = endEstimate(e); return !!end && end <= '16:00:00'; },
    'soldout': function (e) { return !!e.soldOut; },
    'free': function (e) { return !!e.free; },
    'movie': function (e) { return !!e.movie; },
    'siffevent': function (e) { return e.venue === 'SIFF Cinema Uptown' && !e.movie; },
  };
  // Panel rows for the Event type group, in display order. The label reuses
  // the same badge classes the agenda tags wear, so the filter and the tags
  // speak the same color language.
  var PANEL_BADGES = [
    { key: '21plus', cls: 'b-21', label: '21+', title: 'Door-restricted, no minors' },
    { key: 'day', cls: 'b-day', label: 'day', title: 'Wraps up by 4 p.m.' },
    { key: 'soldout', cls: 'b-sold', label: 'sold out', title: 'Full house guaranteed' },
    { key: 'free', cls: 'b-free', label: 'free', title: 'Open to walk-ups' },
    { key: 'movie', cls: 'b-movie', label: 'siff movies', title: 'Regular film screenings at SIFF Cinema Uptown — unchecked by default' },
    { key: 'siffevent', cls: 'b-siffev', label: 'siff events', title: 'SIFF special programming — festivals, Movie Club, series nights' },
  ];
  // The baseline every visitor starts from (and "Reset filters" returns to):
  // SIFF's daily movie showings unchecked, everything else checked.
  function applyDefaultFilters() { state.badgeMode = { movie: 'ex' }; }
  function isDefaultState() {
    if (Object.keys(state.venueMode).length || Object.keys(state.teamMode).length) return false;
    var k = Object.keys(state.badgeMode);
    return k.length === 1 && state.badgeMode.movie === 'ex';
  }
  // Purely subtractive: everything shows until unchecked. An unchecked venue
  // drops its events, an unchecked team drops its home games, and an event
  // carrying any unchecked type is hidden.
  function filtered(list) {
    var bEx = modeKeys(state.badgeMode, 'ex');
    var tEx = modeKeys(state.teamMode, 'ex');
    return list.filter(function (e) {
      if (state.venueMode[e.venue] === 'ex') return false;
      for (var j = 0; j < bEx.length; j++) if (BADGE_PREDS[bEx[j]](e)) return false;
      var title = e.title || '';
      for (var k = 0; k < tEx.length; k++) if (TEAM_BY_SLUG[tEx[k]].re.test(title)) return false;
      return true;
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

  // ---- filter bar: preset pills + full panel ----
  // The marquee venues get a spot in the bar; everything lives in the panel.
  // Same bar-owner order as VENUE_RANK, so when the bar runs out of room the
  // least relevant pills are the ones that drop.
  var PRESET_VENUES = ['Climate Pledge Arena', 'McCaw Hall', 'Seattle Center', 'Cornish Playhouse', 'The Vera Project', 'SIFF Cinema Uptown', 'T-Mobile Park', 'Lumen Field'];

  function venueChip(v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.venue = v;
    b.textContent = v;
    b.title = 'Show or hide ' + v + ' events';
    b.style.setProperty('--dot', venueColor(v));
    return b;
  }
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
  function renderFilters() {
    var presets = $('presets');
    presets.innerHTML = '';
    PRESET_VENUES.forEach(function (v) {
      if (state.venues.indexOf(v) !== -1) presets.appendChild(venueChip(v));
    });
    // Counts play the role of Kayak's price column: upcoming events each row
    // would govern, unaffected by the current filter so they stay stable.
    var today = todayStr();
    var upcoming = state.events.filter(function (e) { return e.date >= today; });
    var pv = $('panelVenues');
    pv.innerHTML = '';
    state.venues.forEach(function (v) {
      var name = document.createElement('span');
      name.className = 'fp-name';
      var dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.setProperty('--dot', venueColor(v));
      name.appendChild(dot);
      name.appendChild(document.createTextNode(v));
      var n = upcoming.filter(function (e) { return e.venue === v; }).length;
      pv.appendChild(filterRow('venue', v, name, n));
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
    PANEL_BADGES.forEach(function (b) {
      var name = document.createElement('span');
      name.className = 'badge ' + b.cls;
      name.textContent = b.label;
      var n = upcoming.filter(BADGE_PREDS[b.key]).length;
      pb.appendChild(filterRow('badge', b.key, name, n, b.title));
    });
    syncFilters();
    fitPresets();
  }
  // Keep the bar to one line: drop preset pills (lowest priority first) until
  // icon + presets + Clear all fit. Every venue is still in the panel.
  function fitPresets() {
    var wrap = $('presets');
    var pills = [].slice.call(wrap.children);
    pills.forEach(function (p) { p.style.display = ''; });
    for (var i = pills.length - 1; i >= 0 && wrap.scrollWidth > wrap.clientWidth; i--) {
      pills[i].style.display = 'none';
    }
  }
  var fitTimer;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitPresets, 100);
  });
  // One venue can be represented twice (marquee pill + panel checkbox) —
  // sync them all from state. Pills read as pressed while their venue shows.
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
    document.querySelectorAll('.chip[data-venue]').forEach(function (c) {
      var off = state.venueMode[c.dataset.venue] === 'ex';
      c.classList.toggle('is-ex', off);
      c.setAttribute('aria-pressed', String(!off));
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
        Object.keys(s.badges || {}).forEach(function (k) { if (BADGE_PREDS[k] && s.badges[k] === 'ex') state.badgeMode[k] = 'ex'; });
        Object.keys(s.teams || {}).forEach(function (k) { if (TEAM_BY_SLUG[k] && s.teams[k] === 'ex') state.teamMode[k] = 'ex'; });
      } else {
        // v1 arrays: only its team exclusions survive the checkbox model
        (s.teams || []).forEach(function (k) { if (TEAM_BY_SLUG[k]) state.teamMode[k] = 'ex'; });
      }
    } catch (e) { applyDefaultFilters(); } // unreadable storage — start at the baseline
  }
  // fitPresets too: bold include labels change pill widths in the one-line bar
  function applyFilters() { syncFilters(); fitPresets(); renderCal(); renderAgenda(); updateSubscribe(); saveFilters(); }

  // Each group's map and full key list, for "only" and Select/Clear all.
  function groupInfo(g) {
    if (g === 'venue') return { map: state.venueMode, keys: state.venues.slice() };
    if (g === 'team') return { map: state.teamMode, keys: TEAMS.map(function (t) { return t.slug; }) };
    return { map: state.badgeMode, keys: PANEL_BADGES.map(function (b) { return b.key; }) };
  }
  // Panel checkboxes drive state through the native change event…
  document.addEventListener('change', function (e) {
    var c = e.target;
    if (!(c instanceof HTMLInputElement) || c.type !== 'checkbox') return;
    if (c.dataset.venue != null) { setChecked(state.venueMode, c.dataset.venue, c.checked); applyFilters(); }
    else if (c.dataset.badge != null) { setChecked(state.badgeMode, c.dataset.badge, c.checked); applyFilters(); }
    else if (c.dataset.team != null) { setChecked(state.teamMode, c.dataset.team, c.checked); applyFilters(); }
  });
  // …while the marquee pills, "only" links, and group links are buttons.
  document.addEventListener('click', function (e) {
    var v = e.target.closest('.chip[data-venue]');
    if (v) {
      setChecked(state.venueMode, v.dataset.venue, state.venueMode[v.dataset.venue] === 'ex');
      applyFilters();
      return;
    }
    var o = e.target.closest('.fp-only');
    if (o) {
      var g = groupInfo(o.dataset.group);
      g.keys.forEach(function (k) { g.map[k] = 'ex'; });
      delete g.map[o.dataset.key];
      applyFilters();
      return;
    }
    var l = e.target.closest('.fp-link');
    if (l) {
      var gi = groupInfo(l.dataset.group);
      gi.keys.forEach(function (k) { setChecked(gi.map, k, l.dataset.act === 'all'); });
      applyFilters();
    }
  });
  $('filterToggle').addEventListener('click', function () {
    var p = $('filterPanel');
    p.hidden = !p.hidden;
    this.setAttribute('aria-expanded', String(!p.hidden));
  });
  // clicking anywhere outside the bar/panel closes the panel, same as the button
  document.addEventListener('click', function (e) {
    var p = $('filterPanel');
    if (!p.hidden && !e.target.closest('#filterPanel') && !e.target.closest('.filterbar')) {
      p.hidden = true;
      $('filterToggle').setAttribute('aria-expanded', 'false');
    }
  });
  function clearAllFilters() {
    state.venueMode = {};
    state.teamMode = {};
    applyDefaultFilters();
    applyFilters();
  }
  $('clearFilters').addEventListener('click', clearAllFilters);
  $('clearAll').addEventListener('click', clearAllFilters);

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
    $('calPrev').disabled = !bounds || sameMonth(m, new Date(bounds.min.getFullYear(), bounds.min.getMonth(), 1));
    $('calNext').disabled = !bounds || sameMonth(m, new Date(bounds.max.getFullYear(), bounds.max.getMonth(), 1));

    var grid = $('calGrid');
    grid.innerHTML = '';
    var today = todayStr();
    var now = new Date();
    // The current month renders as a rolling window — this week plus the
    // next four — so the top of the next month is always in view. Arrow
    // navigation shows classic full months.
    var rolling = sameMonth(m, now);
    var start, end;
    if (rolling) {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 27);
    } else {
      start = new Date(m.getFullYear(), m.getMonth(), 1);
      start.setDate(1 - start.getDay()); // back up to Sunday
      end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    }
    $('calTitle').textContent = (rolling && end.getMonth() !== start.getMonth())
      ? start.toLocaleDateString('en-US', { month: 'short' }) + ' – ' +
        end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var cells = Math.ceil((Math.round((end - start) / 86400e3) + 1) / 7) * 7;
    for (var i = 0; i < cells; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var key = ymd(d);
      var evs = filtered(state.byDate[key] || []);
      var cell = document.createElement(evs.length ? 'button' : 'div');
      cell.className = 'cal-day';
      // in the rolling window every day carries equal weight — only the
      // month-grid views dim their neighbors' spill-over days
      if (!rolling && d.getMonth() !== m.getMonth()) cell.className += ' is-out';
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
      // ...and the earlier month's day numbers go muted.
      var primaryYm = rolling ? now.getFullYear() * 12 + now.getMonth() : m.getFullYear() * 12 + m.getMonth();
      if (d.getFullYear() * 12 + d.getMonth() < primaryYm ||
          (rolling && end.getMonth() !== start.getMonth() && d.getFullYear() * 12 + d.getMonth() === primaryYm)) {
        cell.className += ' mo-fade';
      }
      var num = document.createElement('span');
      num.className = 'num';
      // the spill-over month announces itself on its 1st
      if (d.getDate() === 1 && d.getMonth() !== m.getMonth()) {
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
  function shiftMonth(dir) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + dir, 1);
    renderCal();
  }
  $('calGrid').addEventListener('click', function (e) {
    var cell = e.target.closest('button.cal-day');
    if (!cell || !cell.dataset.date) return;
    if (cell.dataset.date < todayStr() && !state.showPast) {
      state.showPast = true;
      renderAgenda();
    }
    var row = document.querySelector('.day-row[data-date="' + cell.dataset.date + '"]');
    if (row) row.scrollIntoView({ block: 'start' });
  });

  // ---- agenda ----
  function renderAgenda() {
    var ol = $('agenda');
    ol.innerHTML = '';
    var dates = Object.keys(state.byDate).sort();
    var today = todayStr();
    var shown = 0;
    var pastCount = 0;
    dates.forEach(function (date) {
      if (date < today) {
        pastCount += filtered(state.byDate[date]).length;
      }
    });
    if (pastCount) {
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
    dates.forEach(function (date) {
      if (date < today && !state.showPast) return;
      var evs = filtered(state.byDate[date]);
      if (!evs.length) return;
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
        body.appendChild(venue); body.appendChild(a);
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
    if (!shown) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No upcoming events for this filter yet — check back after the next refresh.';
      ol.appendChild(li);
    }
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

  // A fresh marquee line every visit ("On stage in LQA" stays as the
  // no-JS fallback in the HTML).
  var TITLES = [
    'Smells like LQA spirit',
    'Come as you are, LQA',
    'Unplugged in LQA',
    'Black hole sun over LQA',
    'Still alive in LQA',
    'Feedback and flannel in LQA',
    'Turn it up, LQA',
    'Amps on in LQA',
    'Soundcheck in LQA',
    'Distortion nights in LQA',
    'Loud and live in LQA',
    'Wall of sound in LQA',
    'Flannel weather in LQA',
    'Heavy sets in LQA',
  ];
  $('agendaTitle').textContent = TITLES[Math.floor(Math.random() * TITLES.length)];

  loadFilters();
  load();
})();
