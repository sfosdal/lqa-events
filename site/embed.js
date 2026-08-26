/**
 * LQA Events embeddable widget.
 *
 * Usage on any site:
 *   <div id="lqa-events"></div>
 *   <script src="https://fosdal.net/lqa-events/embed.js" data-max="8" defer></script>
 *
 * Options (data- attributes on the script tag):
 *   data-max     max events to show (default 8)
 *   data-target  CSS selector for the container (default "#lqa-events")
 *   data-venue   only this venue (e.g. "McCaw Hall")
 *   data-nostyle present = skip the built-in styles and bring your own
 *
 * Everything renders with lqa-ev-* classes so host pages can restyle it.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var base = script.src.replace(/embed\.js.*$/, '');
  var max = Number(script.dataset.max) || 8;
  var target = script.dataset.target || '#lqa-events';
  var venue = script.dataset.venue || '';

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
        '.lqa-ev-badge{font-size:.7em;text-transform:uppercase;letter-spacing:.07em;border:1px solid currentColor;border-radius:3px;padding:.1em .45em;opacity:.8}' +
        '.lqa-ev-more{font-size:.85em;opacity:.75;padding-top:.5em}' +
        '.lqa-ev-more a{color:inherit}';
      document.head.appendChild(css);
    }

    fetch(base + 'events.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data.events || []);
        var t = new Date();
        var today = t.getFullYear() + '-' +
          ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
        list = list.filter(function (e) { return e.date >= today; }); // the feed keeps a year of history
        if (venue) list = list.filter(function (e) { return e.venue === venue; });
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
          var tags = [];
          if (e.age21) tags.push('21+');
          if (e.soldOut) tags.push('sold out');
          if (e.free) tags.push('free');
          tags.forEach(function (t) {
            var b = document.createElement('span');
            b.className = 'lqa-ev-badge';
            b.textContent = t;
            li.appendChild(b);
          });
          ul.appendChild(li);
        });
        var more = document.createElement('div');
        more.className = 'lqa-ev-more';
        more.innerHTML = '<a href="' + base + '" target="_blank" rel="noopener">Full calendar &amp; subscribe</a>';
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
