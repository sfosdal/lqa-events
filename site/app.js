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

  // Local pro teams — an exclusion filter ("hide Mariners games"), matched on
  // the title no matter what the venue. Mirrors TEAMS in scripts/badges.mjs.
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

  // Each filter map holds name → 'in' | 'ex' (absent = off). A click cycles
  // off → include → exclude → off.
  var state = { events: [], byDate: {}, venues: [], venueMode: {}, badgeMode: {}, teamMode: {}, month: null, showPast: false };

  function modeKeys(map, mode) {
    return Object.keys(map).filter(function (k) { return map[k] === mode; });
  }
  function cycleMode(map, key) {
    if (!map[key]) map[key] = 'in';
    else if (map[key] === 'in') map[key] = 'ex';
    else delete map[key];
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
  // The baseline every visitor starts from (and "Clear all filters" returns
  // to): SIFF's daily movie showings hidden, everything else visible.
  function applyDefaultFilters() { state.badgeMode = { movie: 'ex' }; }
  function isDefaultState() {
    if (Object.keys(state.venueMode).length || Object.keys(state.teamMode).length) return false;
    var k = Object.keys(state.badgeMode);
    return k.length === 1 && state.badgeMode.movie === 'ex';
  }
  // Included venues OR together and excluded venues drop out; included badges
  // AND on top while excluded badges must all miss; included teams OR (only
  // their games) and excluded teams drop out last.
  function filtered(list) {
    var vIn = modeKeys(state.venueMode, 'in'), vEx = modeKeys(state.venueMode, 'ex');
    var bIn = modeKeys(state.badgeMode, 'in'), bEx = modeKeys(state.badgeMode, 'ex');
    var tIn = modeKeys(state.teamMode, 'in'), tEx = modeKeys(state.teamMode, 'ex');
    return list.filter(function (e) {
      if (vIn.length && vIn.indexOf(e.venue) === -1) return false;
      if (vEx.indexOf(e.venue) !== -1) return false;
      for (var i = 0; i < bIn.length; i++) if (!BADGE_PREDS[bIn[i]](e)) return false;
      for (var j = 0; j < bEx.length; j++) if (BADGE_PREDS[bEx[j]](e)) return false;
      var title = e.title || '';
      for (var k = 0; k < tEx.length; k++) if (TEAM_BY_SLUG[tEx[k]].re.test(title)) return false;
      if (tIn.length && !tIn.some(function (s) { return TEAM_BY_SLUG[s].re.test(title); })) return false;
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
    b.style.setProperty('--dot', venueColor(v));
    return b;
  }
  function renderFilters() {
    var presets = $('presets');
    presets.innerHTML = '';
    PRESET_VENUES.forEach(function (v) {
      if (state.venues.indexOf(v) !== -1) presets.appendChild(venueChip(v));
    });
    var pv = $('panelVenues');
    pv.innerHTML = '';
    state.venues.forEach(function (v) { pv.appendChild(venueChip(v)); });
    var pt = $('panelTeams');
    pt.innerHTML = '';
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'chip';
    allBtn.dataset.teamAll = '1';
    allBtn.textContent = 'All';
    allBtn.title = 'Every team at once: only games, then no games, then off';
    pt.appendChild(allBtn);
    TEAMS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.team = t.slug;
      b.textContent = t.label;
      b.title = t.label + ' games: tap for only, again to hide';
      pt.appendChild(b);
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
  // One venue or badge can be represented by several buttons (preset pill,
  // panel chip) — sync the tri-state everywhere. aria-pressed reads
  // true / mixed / false for include / exclude / off.
  function markMode(c, mode) {
    c.classList.toggle('is-on', mode === 'in');
    c.classList.toggle('is-ex', mode === 'ex');
    c.setAttribute('aria-pressed', mode === 'in' ? 'true' : mode === 'ex' ? 'mixed' : 'false');
  }
  function syncFilters() {
    document.querySelectorAll('[data-venue]').forEach(function (c) {
      markMode(c, state.venueMode[c.dataset.venue]);
    });
    document.querySelectorAll('[data-badge]').forEach(function (c) {
      markMode(c, state.badgeMode[c.dataset.badge]);
    });
    document.querySelectorAll('[data-team]').forEach(function (c) {
      markMode(c, state.teamMode[c.dataset.team]);
    });
    var allIn = TEAMS.every(function (t) { return state.teamMode[t.slug] === 'in'; });
    var allEx = TEAMS.every(function (t) { return state.teamMode[t.slug] === 'ex'; });
    document.querySelectorAll('[data-team-all]').forEach(function (c) {
      markMode(c, allIn ? 'in' : allEx ? 'ex' : undefined);
    });
    var any = !isDefaultState();
    $('filterToggle').classList.toggle('is-on', any);
    $('clearAll').disabled = !any;
  }
  // Filter choices persist per-browser (no login — just localStorage).
  function saveFilters() {
    try {
      localStorage.setItem('lqa-filters', JSON.stringify({ v: 2, venues: state.venueMode, badges: state.badgeMode, teams: state.teamMode }));
    } catch (e) { /* private mode etc. — filters just won't persist */ }
  }
  function loadFilters() {
    var raw = null;
    try { raw = localStorage.getItem('lqa-filters'); } catch (e) { /* unreadable storage */ }
    if (raw == null) { applyDefaultFilters(); return; } // first visit
    try {
      var s = JSON.parse(raw);
      var mode = function (m) { return m === 'in' || m === 'ex' ? m : null; };
      if (s.v === 2) {
        Object.keys(s.venues || {}).forEach(function (v) { if (mode(s.venues[v])) state.venueMode[v] = s.venues[v]; });
        Object.keys(s.badges || {}).forEach(function (k) { if (BADGE_PREDS[k] && mode(s.badges[k])) state.badgeMode[k] = s.badges[k]; });
        Object.keys(s.teams || {}).forEach(function (k) { if (TEAM_BY_SLUG[k] && mode(s.teams[k])) state.teamMode[k] = s.teams[k]; });
      } else {
        // v1 arrays: venues and badges were includes, teams were exclusions
        (s.venues || []).forEach(function (v) { state.venueMode[v] = 'in'; });
        (s.badges || []).forEach(function (k) { if (BADGE_PREDS[k]) state.badgeMode[k] = 'in'; });
        (s.teams || []).forEach(function (k) { if (TEAM_BY_SLUG[k]) state.teamMode[k] = 'ex'; });
      }
    } catch (e) { applyDefaultFilters(); } // unreadable storage — start at the baseline
  }
  // fitPresets too: bold include labels change pill widths in the one-line bar
  function applyFilters() { syncFilters(); fitPresets(); renderCal(); renderAgenda(); updateSubscribe(); saveFilters(); }

  document.addEventListener('click', function (e) {
    var v = e.target.closest('[data-venue]');
    if (v) { cycleMode(state.venueMode, v.dataset.venue); applyFilters(); return; }
    var b = e.target.closest('[data-badge]');
    if (b) { cycleMode(state.badgeMode, b.dataset.badge); applyFilters(); return; }
    var t = e.target.closest('[data-team]');
    if (t) { cycleMode(state.teamMode, t.dataset.team); applyFilters(); return; }
    // "All" cycles the whole team list as one: include every team (games
    // only), then exclude every team (no games), then clear them all.
    var ta = e.target.closest('[data-team-all]');
    if (ta) {
      var allIn = TEAMS.every(function (tm) { return state.teamMode[tm.slug] === 'in'; });
      var allEx = TEAMS.every(function (tm) { return state.teamMode[tm.slug] === 'ex'; });
      state.teamMode = {};
      if (allIn) TEAMS.forEach(function (tm) { state.teamMode[tm.slug] = 'ex'; });
      else if (!allEx) TEAMS.forEach(function (tm) { state.teamMode[tm.slug] = 'in'; });
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
  // The feed follows the active filter where a pre-built file exists: exactly
  // one venue, one badge, or one hidden team. Combos fall back to the full feed.
  var icsHref = '';
  function updateSubscribe() {
    var filteredFile = null;
    // Pre-built feeds only cover a single included venue, a single included
    // badge, or a single excluded team — any other combo gets the full feed.
    var total = Object.keys(state.venueMode).length +
      Object.keys(state.badgeMode).length + Object.keys(state.teamMode).length;
    if (total === 1) {
      var vIn = modeKeys(state.venueMode, 'in');
      var bIn = modeKeys(state.badgeMode, 'in');
      var bEx = modeKeys(state.badgeMode, 'ex');
      var tEx = modeKeys(state.teamMode, 'ex');
      if (vIn.length) filteredFile = 'events-venue-' + slugify(vIn[0]) + '.ics';
      else if (bIn.length) filteredFile = 'events-' + bIn[0] + '.ics';
      else if (bEx[0] === 'movie') filteredFile = 'events-no-movies.ics'; // the default view
      else if (tEx.length) filteredFile = 'events-no-' + tEx[0] + '.ics';
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
