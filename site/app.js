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
  };
  function venueColor(v) {
    if (VENUE_VARS[v]) return 'var(' + VENUE_VARS[v] + ')';
    var h = 0;
    for (var i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 42%, 52%)';
  }

  var state = { events: [], byDate: {}, venues: [], venuesOn: {}, badges: {}, month: null, showPast: false };

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
          vs[e.venue] = true;
        });
        state.venues = Object.keys(vs).sort();
        var now = new Date();
        state.month = new Date(now.getFullYear(), now.getMonth(), 1);
        // forget saved venues that no longer appear in the feed
        Object.keys(state.venuesOn).forEach(function (v) {
          if (state.venues.indexOf(v) === -1) delete state.venuesOn[v];
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
  };
  function activeBadges() {
    return Object.keys(state.badges).filter(function (k) { return state.badges[k]; });
  }
  function activeVenues() {
    return Object.keys(state.venuesOn).filter(function (k) { return state.venuesOn[k]; });
  }
  // Venues OR together; badges AND on top.
  function filtered(list) {
    var keys = activeBadges();
    var venues = activeVenues();
    return list.filter(function (e) {
      if (venues.length && venues.indexOf(e.venue) === -1) return false;
      for (var i = 0; i < keys.length; i++) if (!BADGE_PREDS[keys[i]](e)) return false;
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
  var PRESET_VENUES = ['Climate Pledge Arena', 'McCaw Hall', 'The Vera Project', 'Cornish Playhouse'];

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
    syncFilters();
  }
  // One venue or badge can be represented by several buttons (preset pill,
  // panel chip) — sync the on-state everywhere.
  function syncFilters() {
    document.querySelectorAll('[data-venue]').forEach(function (c) {
      c.classList.toggle('is-on', !!state.venuesOn[c.dataset.venue]);
    });
    document.querySelectorAll('[data-badge]').forEach(function (c) {
      c.classList.toggle('is-on', !!state.badges[c.dataset.badge]);
      c.setAttribute('aria-pressed', String(!!state.badges[c.dataset.badge]));
    });
    var any = activeVenues().length > 0 || activeBadges().length > 0;
    $('filterToggle').classList.toggle('is-on', any);
    $('clearAll').disabled = !any;
  }
  // Filter choices persist per-browser (no login — just localStorage).
  function saveFilters() {
    try {
      localStorage.setItem('lqa-filters', JSON.stringify({ venues: activeVenues(), badges: activeBadges() }));
    } catch (e) { /* private mode etc. — filters just won't persist */ }
  }
  function loadFilters() {
    try {
      var s = JSON.parse(localStorage.getItem('lqa-filters') || '{}');
      (s.venues || []).forEach(function (v) { state.venuesOn[v] = true; });
      (s.badges || []).forEach(function (k) { if (BADGE_PREDS[k]) state.badges[k] = true; });
    } catch (e) { /* unreadable storage — start unfiltered */ }
  }
  function applyFilters() { syncFilters(); renderCal(); renderAgenda(); updateSubscribe(); saveFilters(); }

  document.addEventListener('click', function (e) {
    var v = e.target.closest('[data-venue]');
    if (v) { state.venuesOn[v.dataset.venue] = !state.venuesOn[v.dataset.venue]; applyFilters(); return; }
    var b = e.target.closest('[data-badge]');
    if (b) { state.badges[b.dataset.badge] = !state.badges[b.dataset.badge]; applyFilters(); }
  });
  $('filterToggle').addEventListener('click', function () {
    var p = $('filterPanel');
    p.hidden = !p.hidden;
    this.setAttribute('aria-expanded', String(!p.hidden));
  });
  function clearAllFilters() {
    state.venuesOn = {};
    state.badges = {};
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
    $('calTitle').textContent = m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var bounds = monthBounds();
    $('calPrev').disabled = !bounds || sameMonth(m, new Date(bounds.min.getFullYear(), bounds.min.getMonth(), 1));
    $('calNext').disabled = !bounds || sameMonth(m, new Date(bounds.max.getFullYear(), bounds.max.getMonth(), 1));

    var grid = $('calGrid');
    grid.innerHTML = '';
    var first = new Date(m.getFullYear(), m.getMonth(), 1);
    var start = new Date(first);
    start.setDate(1 - first.getDay()); // back up to Sunday
    var today = todayStr();
    for (var i = 0; i < 42; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      if (i === 35 && d.getMonth() !== m.getMonth()) break; // skip empty 6th row
      var key = ymd(d);
      var evs = filtered(state.byDate[key] || []);
      var cell = document.createElement(evs.length ? 'button' : 'div');
      cell.className = 'cal-day';
      if (d.getMonth() !== m.getMonth()) cell.className += ' is-out';
      if (key === today) cell.className += ' is-today';
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = d.getDate();
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
        var a = document.createElement('a');
        a.href = e.url || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = e.title;
        var venue = document.createElement('span');
        venue.className = 'venue';
        venue.textContent = e.venue;
        venue.style.setProperty('--dot', venueColor(e.venue));
        row.appendChild(time); row.appendChild(a); row.appendChild(venue);
        appendBadges(row, e);
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
  // The feed follows the active filter where a pre-built file exists: one
  // venue, or one badge. Combined filters fall back to the full feed.
  var BADGE_NAMES = { '21plus': '21+', 'day': 'daytime', 'soldout': 'sold-out', 'free': 'free' };
  function updateSubscribe() {
    var keys = activeBadges();
    var venues = activeVenues();
    // A dedicated feed exists for exactly one venue or one badge.
    var filteredFile = null, filteredNote = '';
    if (venues.length === 1 && !keys.length) {
      filteredFile = 'events-venue-' + slugify(venues[0]) + '.ics';
      filteredNote = 'Only ' + venues[0] + ' events.';
    } else if (!venues.length && keys.length === 1) {
      filteredFile = 'events-' + keys[0] + '.ics';
      filteredNote = 'Only ' + BADGE_NAMES[keys[0]] + ' events.';
    }
    $('subFilterRow').hidden = !filteredFile;
    var useFilter = filteredFile && $('subUseFilter').checked;
    var file = useFilter ? filteredFile : 'events.ics';
    var note;
    if (useFilter) {
      note = filteredNote;
    } else if (venues.length || keys.length) {
      note = filteredFile
        ? 'The full calendar — every venue and event.'
        : 'Combined filters have no dedicated feed — this is the full calendar.';
    } else {
      note = 'Covers every venue and event.';
    }
    var icsHref = new URL(file, location.href).href;
    $('subNote').textContent = note;
    $('icsUrl').textContent = icsHref;
    $('webcalLink').href = icsHref.replace(/^https?:/, 'webcal:');
    $('gcalLink').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(icsHref.replace(/^https?:/, 'webcal:'));
  }
  $('subUseFilter').addEventListener('change', updateSubscribe);
  updateSubscribe();
  $('subscribeBtn').addEventListener('click', function () {
    var pop = $('subscribePop');
    var open = pop.hidden;
    pop.hidden = !open;
    this.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.masthead-actions')) {
      $('subscribePop').hidden = true;
      $('subscribeBtn').setAttribute('aria-expanded', 'false');
    }
  });
  $('copyIcs').addEventListener('click', function () {
    var btn = this;
    navigator.clipboard.writeText($('icsUrl').textContent).then(function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
    });
  });

  loadFilters();
  load();
})();
