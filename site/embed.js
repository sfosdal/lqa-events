/**
 * LQA Events embeddable widget.
 *
 * Usage on any site:
 *   <div id="lqa-events"></div>
 *   <script src="https://lqa.seattle.here.events/embed.js" data-max="8" defer></script>
 *
 * Options (data- attributes on the script tag):
 *   data-max     max events to show (default 8)
 *   data-target  CSS selector for the container (default "#lqa-events")
 *   data-venue   only this venue (e.g. "McCaw Hall")
 *   data-filter  a filter code — the site's Embed panel writes the snippet
 *                with the view you have set (the ?f= code of Copy Filter
 *                Link); the widget then shows exactly what that view shows,
 *                by the site's own rule (city.js + filter.js, loaded from
 *                the site only when one of these three is set)
 *   data-search  the search code of the same link (?s=)
 *   data-soldout present = only the sold-out (or nearly) events
 *   data-nostyle present = skip the built-in styles and bring your own
 *
 * Everything renders with lqa-ev-* classes so host pages can restyle it.
 * One site per page: the rule files set window.LQACity / LQAFilter.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var base = script.src.replace(/embed\.js.*$/, '');
  var max = Number(script.dataset.max) || 8;
  var target = script.dataset.target || '#lqa-events';
  var venue = script.dataset.venue || '';
  var filterCode = script.dataset.filter || '';
  var searchCode = script.dataset.search || '';
  var soldOnly = script.dataset.soldout !== undefined;
  var wantsRule = !!(filterCode || searchCode || soldOnly);
  var query = wantsRule ? '?f=' + (filterCode || '0') + (searchCode ? '&s=' + searchCode : '') + (soldOnly ? '&so=1' : '') : ''; // the "see all" link opens the same view

  // the site's own filter rule, loaded only when the snippet carries a view
  function loadRule() {
    if (!wantsRule || window.LQAFilter) return Promise.resolve();
    if (window.lqaRuleLoading) return window.lqaRuleLoading; // two widgets on one page share one load
    var load = function (file) {
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = base + file; s.onload = resolve; s.onerror = resolve; // a missing rule file leaves the list unfiltered rather than empty
        document.head.appendChild(s);
      });
    };
    window.lqaRuleLoading = load('city.js').then(function () { return load('filter.js'); });
    return window.lqaRuleLoading;
  }
  function applyRule(list) {
    var F = window.LQAFilter;
    if (!wantsRule || !F) return list;
    var mode = filterCode ? F.parseFilterCode(filterCode) : { venueMode: {}, badgeMode: {}, teamMode: {}, capMode: {} };
    if (!mode) return list; // not a code this site wrote
    mode.soldOnly = soldOnly;
    var q = searchCode ? F.decodeSearch(searchCode).trim() : '';
    return list.filter(function (e) { return F.matchesFilter(e, mode) && F.matchesSearch(e, q); });
  }

  function init() {
    var host = document.querySelector(target);
    if (!host) return;

    if (script.dataset.nostyle === undefined && !document.getElementById('lqa-ev-css')) {
      var css = document.createElement('style');
      css.id = 'lqa-ev-css';
      css.textContent =
        '.lqa-ev-list{list-style:none;margin:0;padding:0;font-size:.95em}' +
        '.lqa-ev-list li{display:flex;flex-wrap:wrap;gap:.25em .7em;align-items:baseline;padding:.45em 0;border-bottom:1px solid rgba(128,128,128,.25)}' +
        '.lqa-ev-date{font-variant-numeric:tabular-nums;opacity:.75;min-width:4.5em}' +
        '.lqa-ev-title{font-weight:600;text-decoration:none;color:inherit}' +
        '.lqa-ev-title:hover{text-decoration:underline}' +
        '.lqa-ev-venue{font-size:.8em;text-transform:uppercase;letter-spacing:.05em;opacity:.6}' +
        '.lqa-ev-badge{font-size:.7em;text-transform:uppercase;letter-spacing:.07em;border:1px dashed currentColor;border-radius:3px;padding:.1em .45em;opacity:.8}' +
        '.lqa-ev-more{font-size:.85em;opacity:.75;padding-top:.5em}' +
        '.lqa-ev-more a{color:inherit}';
      document.head.appendChild(css);
    }

    Promise.all([
      fetch(base + 'events.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
      loadRule(),
    ])
      .then(function (got) {
        var data = got[0];
        var list = Array.isArray(data) ? data : (data.events || []);
        var t = new Date();
        var today = t.getFullYear() + '-' +
          ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
        list = list.filter(function (e) { return e.date >= today; }); // the feed keeps a year of history
        if (venue) list = list.filter(function (e) { return e.venue === venue; });
        list = applyRule(list);
        if (!list.length) return;
        var ul = document.createElement('ul');
        ul.className = 'lqa-ev-list';
        list.slice(0, max).forEach(function (e) {
          var li = document.createElement('li');
          var d = document.createElement('span');
          d.className = 'lqa-ev-date';
          var p = e.date.split('-');
          d.textContent = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          var a = document.createElement('a');
          a.className = 'lqa-ev-title';
          a.href = e.url || base;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = e.title;
          var v = document.createElement('span');
          v.className = 'lqa-ev-venue';
          v.textContent = e.venue;
          li.appendChild(d); li.appendChild(a); li.appendChild(v);
          if (e.status) { // cancelled / postponed: struck through, labelled
            a.style.textDecoration = 'line-through';
            var s = document.createElement('span');
            s.className = 'lqa-ev-badge';
            s.textContent = e.status;
            li.appendChild(s);
          }
          if (e.dateTbd) {
            var b = document.createElement('span');
            b.className = 'lqa-ev-badge';
            b.textContent = 'date tbd';
            li.appendChild(b);
          }
          ul.appendChild(li);
        });
        var more = document.createElement('div');
        more.className = 'lqa-ev-more';
        more.innerHTML = '<a href="' + base + query + '" target="_blank" rel="noopener">Full calendar &amp; subscribe</a>';
        host.textContent = '';
        host.appendChild(ul);
        host.appendChild(more);
      })
      .catch(function () { /* leave the container as the host left it */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
