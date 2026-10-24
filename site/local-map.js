// The Map view — the fourth stop of the view toolbar, in a city whose city.js
// carries a `map` block and `geo: [lat, lon]` on its rooms (Steve, 2026-10-24,
// "local map view for event locations": Kona first, then lqa and Seattle).
// Shared: synced from lqa by sync-shared.sh; a city without a map simply does
// not load it (no Map stop in its index.html), and app.js's hooks stay quiet.
//
// The ground is local-map.json (scripts/build-local-map.mjs — an island's
// outline from Natural Earth, or a city's shoreline, lakes and main roads
// from OpenStreetMap, read once at build time and committed), drawn as one
// SVG with a pin on every room that has geo. A pin is sized by the room's
// upcoming events under the filters in force and opens a card of them (the
// month view's day card) with the room's own site at its foot. Wheel, pinch,
// drag and the +/−/fit buttons zoom and pan; two rooms on one spot are nudged
// apart so both can be tapped. app.js lends what it needs via window.LQAHooks.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CITY = window.LQACity, H = window.LQAHooks, svg = $('lmSvg');
  if (!CITY || !H || !svg) return;
  var VENUES = CITY.venues, ROOMS = Object.keys(VENUES).filter(function (v) { return VENUES[v].geo; });
  var data = null, view = null, FRAME = { w: 1000, h: 1000 }, u = 1; // view: the viewBox in frame units; u: frame units per CSS pixel
  var NS = 'http://www.w3.org/2000/svg';
  var openVenue = null, rafId = 0;

  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function px(lat, lon) { var p = data.proj; return [(lon - p.cx) * p.k * p.s + p.w / 2, (p.cy - lat) * p.s + p.h / 2]; }
  function version() { var s = document.querySelector('script[src*="local-map.js"]'); var m = s && /[?&]v=([^&]+)/.exec(s.getAttribute('src')); return m ? m[1] : ''; }
  function load() {
    if (data) return Promise.resolve(data);
    return fetch('local-map.json' + (version() ? '?v=' + version() : '')).then(function (r) { return r.json(); }).then(function (d) {
      data = d; FRAME = { w: d.proj.w, h: d.proj.h };
      svg.parentElement.style.setProperty('--lm-ar', FRAME.w / FRAME.h); // the frame takes the ground's shape
      if (!view) home(false); return d;
    });
  }
  // the view at first: the city's `home` box (a wider frame holds the out-of-town rooms), else the whole frame
  function home(draw) {
    if (data && data.home) { var h = data.home, w = Math.max(h[2], h[3] * FRAME.w / FRAME.h); view = { x: h[0] + h[2] / 2 - w / 2, y: h[1] + h[3] / 2 - w * FRAME.h / FRAME.w / 2, w: w, h: w * FRAME.h / FRAME.w }; }
    else fit(false);
    if (draw !== false) render();
  }
  function fit(draw) { view = { x: 0, y: 0, w: FRAME.w, h: FRAME.h }; if (draw !== false) render(); }
  function unit() { var r = svg.getBoundingClientRect(); return r.width ? view.w / r.width : 1; }
  function isOpen() { return document.documentElement.classList.contains('map-open'); }

  // the rooms' upcoming events under the filters, per room, in date order
  function tally() {
    var today = H.todayStr(), by = H.byDate(), n = {}, next = {};
    Object.keys(by).sort().forEach(function (d) {
      if (d < today) return;
      H.dayItems(d).forEach(function (e) { n[e.venue] = (n[e.venue] || 0) + 1; (next[e.venue] = next[e.venue] || []).push(e); });
    });
    return { n: n, next: next };
  }

  // pins closer than a tap apart are pushed off each other (a few iterations
  // of pairwise repulsion), but never farther than their own radius from the
  // true spot (p.cap) — the venue stays under its disc; where a city's rooms
  // sit closer than that, the discs overlap, and a zoom in parts them
  function spread(pins, gap) {
    for (var it = 0; it < 40; it++) {
      var moved = false;
      for (var i = 0; i < pins.length; i++) for (var j = i + 1; j < pins.length; j++) {
        var a = pins[i], b = pins[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || .001, want = a.r + b.r + gap; // the discs clear each other by a hair
        if (d >= want) continue;
        var push = (want - d) / 2, ux = dx / d, uy = dy / d;
        if (d < .01) { ux = 1; uy = 0; }
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; moved = true;
      }
      pins.forEach(function (p) { var ex = p.x - p.ox, ey = p.y - p.oy, e = Math.sqrt(ex * ex + ey * ey); if (e > p.cap) { p.x = p.ox + ex / e * p.cap; p.y = p.oy + ey / e * p.cap; } });
      if (!moved) break;
    }
  }
  // labels: right of the pin first, then left, below, above — the first spot
  // clear of every label already placed (and the frame's edge); none, if none
  function placeLabels(pins, fs) {
    var boxes = [], cw = fs * .58, lh = fs * 1.25;
    function free(bx, self) { if (bx.x < view.x || bx.x + bx.w > view.x + view.w || bx.y < view.y || bx.y + bx.h > view.y + view.h) return false; return !boxes.some(function (o) { return o.pin !== self && bx.x < o.x + o.w && bx.x + bx.w > o.x && bx.y < o.y + o.h && bx.y + bx.h > o.y; }); }
    function disc(p) { boxes.push({ x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r, pin: p }); } // a square round the disc; a pin's own square is skipped for its own label (the diagonal spots clear the circle, not the square)
    pins.filter(function (p) { return p.n; }).forEach(disc); // the counted discs first; an empty pin's disc only after the counted names are placed (a name beats a hollow ring)
    pins.slice().sort(function (a, b) { return b.n - a.n || a.y - b.y; }).forEach(function (p, i, all) {
      if (!p.n && (i === 0 || all[i - 1].n)) pins.filter(function (q) { return !q.n; }).forEach(disc);
      var w = p.name.length * cw + fs * .3, g = p.r + fs * .35;
      var spots = [
        { x: p.x + g, y: p.y - lh / 2, anchor: 'start', tx: p.x + g, ty: p.y },
        { x: p.x - g - w, y: p.y - lh / 2, anchor: 'end', tx: p.x - g, ty: p.y },
        { x: p.x - w / 2, y: p.y + g, anchor: 'middle', tx: p.x, ty: p.y + g + lh / 2 },
        { x: p.x - w / 2, y: p.y - g - lh, anchor: 'middle', tx: p.x, ty: p.y - g - lh / 2 },
        // then the diagonals, for a pin hemmed in on its four sides
        { x: p.x + g * .75, y: p.y - g * .75 - lh, anchor: 'start', tx: p.x + g * .75, ty: p.y - g * .75 - lh / 2 },
        { x: p.x + g * .75, y: p.y + g * .75, anchor: 'start', tx: p.x + g * .75, ty: p.y + g * .75 + lh / 2 },
        { x: p.x - g * .75 - w, y: p.y - g * .75 - lh, anchor: 'end', tx: p.x - g * .75, ty: p.y - g * .75 - lh / 2 },
        { x: p.x - g * .75 - w, y: p.y + g * .75, anchor: 'end', tx: p.x - g * .75, ty: p.y + g * .75 + lh / 2 },
      ];
      for (var k = 0; k < spots.length; k++) { var bx = { x: spots[k].x, y: spots[k].y, w: w, h: lh }; if (free(bx, p)) { boxes.push(bx); p.label = spots[k]; return; } }
      p.label = null;
    });
    return boxes;
  }

  function render() {
    if (!data || !isOpen()) return;
    u = unit();
    svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(function (v) { return v.toFixed(2); }).join(' '));
    svg.style.setProperty('--u', u);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var zoom = FRAME.w / view.w; // 1 = the whole frame
    // ---- the ground ----
    if (data.kind === 'urban') { // land everywhere inside the frame, the sea and the lakes over it, then the roads
      el('rect', { x: 0, y: 0, width: FRAME.w, height: FRAME.h, 'class': 'lm-land' }, svg);
      (data.sea || []).forEach(function (d) { el('path', { d: d, 'class': 'lm-sea', 'fill-rule': 'evenodd' }, svg); });
      (data.water || []).forEach(function (d) { el('path', { d: d, 'class': 'lm-water', 'fill-rule': 'evenodd' }, svg); });
      ['secondary', 'primary', 'trunk', 'motorway'].forEach(function (c) { if (data.roads && data.roads[c]) el('path', { d: data.roads[c], 'class': 'lm-road lm-road-' + c }, svg); });
    } else {
      (data.far || data.neighbours || []).forEach(function (d) { el('path', { d: d, 'class': 'lm-far' }, svg); });
      (data.land || [data.island]).forEach(function (d) { el('path', { d: d, 'class': 'lm-island' }, svg); });
    }
    // ---- the rooms: size by count, then nudged apart, then labelled ----
    var t = tally(), fs = 12.5 * u, total = 0;
    var pins = ROOMS.map(function (v) {
      var p = px(VENUES[v].geo[0], VENUES[v].geo[1]), n = t.n[v] || 0; total += n;
      return { v: v, name: VENUES[v].short || v.replace(/ National Historic(al)? (Park|Site)$/, ''), ox: p[0], oy: p[1], x: p[0], y: p[1], n: n, r: (n ? 7 + 2.2 * Math.sqrt(n) : 5) * u, color: H.venueColor(v) };
    });
    // crowding: the discs in view may cover about a sixth of it; past that every disc shrinks alike (a dense city at the whole-frame zoom), never below half
    var area = 0; pins.forEach(function (p) { if (p.ox > view.x - p.r && p.ox < view.x + view.w + p.r && p.oy > view.y - p.r && p.oy < view.y + view.h + p.r) area += Math.PI * p.r * p.r; });
    var shrink = Math.min(1, Math.max(.5, Math.sqrt(.16 * view.w * view.h / (area || 1))));
    pins.forEach(function (p) { p.r *= shrink; p.cap = Math.max(p.r * .9, 10 * u); });
    spread(pins, 3 * u);
    var boxes = placeLabels(pins, fs);
    // ---- the places a visitor steers by, where a pin's label has not taken the spot ----
    var tfs = 10.5 * u;
    function labelFree(x, y, w, anchor) { var bx = { x: anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, y: y - tfs, w: w, h: tfs * 1.3 }; if (bx.x < view.x || bx.x + bx.w > view.x + view.w || bx.y < view.y || bx.y + bx.h > view.y + view.h) return false; return !boxes.some(function (o) { return bx.x < o.x + o.w && bx.x + bx.w > o.x && bx.y < o.y + o.h && bx.y + bx.h > o.y; }) && (boxes.push(bx), true); }
    (data.labels || []).forEach(function (L) {
      var x = L.xy[0], y = L.xy[1], tx;
      if (L.kind === 'peak') {
        var s = 5 * u;
        el('path', { d: 'M' + (x - s) + ' ' + (y + s * .8) + 'L' + x + ' ' + (y - s) + 'L' + (x + s) + ' ' + (y + s * .8) + 'Z', 'class': 'lm-peak' }, svg);
        if (zoom >= .9 && labelFree(x, y + s * 2.6, L.name.length * tfs * .62, 'middle')) { tx = el('text', { x: x, y: y + s * 2.6, 'text-anchor': 'middle', 'font-size': tfs * .92, 'class': 'lm-peak-name' }, svg); tx.textContent = L.name; }
      } else if (L.kind === 'water') {
        if (labelFree(x, y, L.name.length * tfs * .6, 'middle')) { tx = el('text', { x: x, y: y, 'text-anchor': 'middle', 'font-size': tfs * .95, 'class': 'lm-water-name' }, svg); tx.textContent = L.name; }
      } else {
        var dx = (L.anchor === 'end' ? -1 : L.anchor === 'middle' ? 0 : 1) * 6 * u, dy = (L.dy || 4) * u;
        el('circle', { cx: x, cy: y, r: 2.2 * u, 'class': 'lm-town-dot' }, svg);
        if (labelFree(x + dx, y + dy, L.name.length * tfs * .68, L.anchor)) { tx = el('text', { x: x + dx, y: y + dy, 'text-anchor': L.anchor, 'font-size': tfs, 'class': 'lm-town' }, svg); tx.textContent = L.name; }
      }
    });
    pins.forEach(function (p) {
      if (Math.abs(p.x - p.ox) + Math.abs(p.y - p.oy) > 1.5 * u) el('path', { d: 'M' + p.ox + ' ' + p.oy + 'L' + p.x + ' ' + p.y, 'class': 'lm-leader' }, svg);
    });
    pins.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (p) { // the big discs first, so a small one overlapped stays on top
      var g = el('g', { 'class': 'lm-pin' + (p.n ? '' : ' is-empty') + (openVenue === p.v ? ' is-open' : ''), role: 'button', tabindex: '0', 'data-venue': p.v }, svg);
      g.style.setProperty('--pin', p.color);
      var title = el('title', {}, g); title.textContent = p.v + ' — ' + (p.n ? p.n + ' upcoming' : 'nothing upcoming under these filters');
      el('circle', { cx: p.x, cy: p.y, r: p.r, fill: p.color }, g);
      if (p.n) { var n = el('text', { x: p.x, y: p.y + p.r * .36, 'font-size': Math.max(9 * u, p.r * .95), 'class': 'lm-n' }, g); n.textContent = p.n; }
      if (p.label) { var l = el('text', { x: p.label.tx, y: p.label.ty + fs * .36, 'text-anchor': p.label.anchor, 'font-size': fs, 'class': 'lm-name' }, g); l.textContent = p.name; }
    });
    var cap = $('lmCaption');
    if (cap) cap.firstElementChild.textContent = total + ' upcoming at ' + ROOMS.filter(function (v) { return t.n[v]; }).length + ' of ' + ROOMS.length + ' places';
  }
  function schedule() { if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; render(); }); }

  // ---- zoom and pan ----
  var MIN_W = function () { return FRAME.w / (data && data.kind === 'urban' ? 24 : 16); }; // a city zooms a little deeper: its rooms sit a block apart
  function clamp() {
    var maxW = FRAME.w * 1.3, minW = MIN_W();
    view.w = Math.min(maxW, Math.max(minW, view.w)); view.h = view.w * FRAME.h / FRAME.w;
    view.x = Math.min(FRAME.w * 1.15 - view.w, Math.max(-FRAME.w * .15, view.x));
    view.y = Math.min(FRAME.h * 1.15 - view.h, Math.max(-FRAME.h * .15, view.y));
  }
  function zoomAt(cx, cy, f) { // cx, cy: client coordinates the zoom keeps still
    var r = svg.getBoundingClientRect(), k = view.w / r.width, fx = (cx - r.left) * k + view.x, fy = (cy - r.top) * k + view.y;
    var w = view.w / f; w = Math.min(FRAME.w * 1.3, Math.max(MIN_W(), w)); var ff = view.w / w;
    view.x = fx - (fx - view.x) / ff; view.y = fy - (fy - view.y) / ff; view.w = w; view.h = w * FRAME.h / FRAME.w;
    clamp(); closePop(); schedule();
  }
  var pts = {}, drag = null, pinch = null;
  svg.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY }; svg.setPointerCapture(e.pointerId);
    var ids = Object.keys(pts);
    if (ids.length === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target.closest('.lm-pin') };
    else if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: view.w, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; drag = null; }
  });
  svg.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts);
    if (pinch && ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), f = d / (pinch.d || 1);
      view.w = pinch.w; view.h = view.w * FRAME.h / FRAME.w; zoomAt(pinch.mx, pinch.my, f); return;
    }
    if (!drag) return;
    var k = view.w / svg.getBoundingClientRect().width, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; svg.classList.add('is-dragging'); closePop();
    view.x = drag.vx - dx * k; view.y = drag.vy - dy * k; clamp();
    svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
  });
  function up(e) {
    delete pts[e.pointerId];
    if (drag && !drag.moved && drag.target) toggleVenue(drag.target.dataset.venue, drag.target);
    else if (drag && !drag.moved && !drag.target) closePop();
    if (drag && drag.moved) schedule(); // the labels re-fitted to the new frame
    drag = null; if (Object.keys(pts).length < 2) pinch = null; svg.classList.remove('is-dragging');
  }
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.25 : .8); }, { passive: false });
  svg.addEventListener('dblclick', function (e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, 2); });
  svg.addEventListener('keydown', function (e) { var g = e.target.closest && e.target.closest('.lm-pin'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleVenue(g.dataset.venue, g); } });
  $('mapView').querySelector('.lm-zoom').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-z]'); if (!b) return;
    var r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (b.dataset.z === 'in') zoomAt(cx, cy, 1.6); else if (b.dataset.z === 'out') zoomAt(cx, cy, 1 / 1.6); else { closePop(); fit(); } // fit: the whole frame, out-of-town rooms included
  });

  // ---- the pin's card ----
  function closePop() {
    var old = document.querySelector('.lm-pop'); if (old) old.remove();
    openVenue = null; svg.querySelectorAll('.lm-pin.is-open').forEach(function (g) { g.classList.remove('is-open'); });
    document.removeEventListener('click', popOff, true); document.removeEventListener('keydown', popOff); window.removeEventListener('scroll', closePop);
  }
  function popOff(e) { if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest('.lm-pop')) closePop(); }
  function toggleVenue(v, g) {
    if (openVenue === v) { closePop(); return; }
    H.closeDayPop(); closePop();
    openVenue = v; g.classList.add('is-open');
    var t = tally(), list = t.next[v] || [], room = VENUES[v];
    var pop = document.createElement('div'); pop.className = 'mb-pop lm-pop'; pop.setAttribute('role', 'dialog'); pop.dataset.venue = v;
    var h = document.createElement('h3'); h.textContent = v;
    var n = document.createElement('span'); n.className = 'mb-pop-n'; n.textContent = list.length ? list.length + ' upcoming' : 'nothing upcoming'; h.appendChild(n);
    pop.setAttribute('aria-label', v); pop.appendChild(h);
    if (!list.length) { var none = document.createElement('p'); none.className = 'mb-none'; none.textContent = 'Nothing listed under these filters'; pop.appendChild(none); }
    list.slice(0, 6).forEach(function (e) { pop.appendChild(H.boardEntry(e, true)); });
    if (list.length > 6) { var more = document.createElement('p'); more.className = 'lm-more'; more.textContent = '+ ' + (list.length - 6) + ' more in the list'; pop.appendChild(more); }
    if (room.url) { var a = document.createElement('a'); a.className = 'lm-site'; a.href = room.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = (room.festival ? 'Festival site' : 'Venue site') + ' ↗'; pop.appendChild(a); }
    document.body.appendChild(pop);
    if (!window.matchMedia('(max-width: 640px)').matches) { // a phone takes the sheet from the foot (styles.css); here the card sits beside the pin
      var r = g.querySelector('circle').getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, w = Math.min(22 * 16, vw - 16);
      pop.style.width = w + 'px';
      var left = r.right + 10; if (left + w > vw - 8) left = r.left - 10 - w; if (left < 8) left = Math.max(8, Math.min(r.left, vw - w - 8));
      var foot = document.querySelector('footer'), floor = foot ? Math.min(vh, foot.getBoundingClientRect().top) : vh;
      var hgt = pop.offsetHeight, top = r.top - 8; if (top + hgt > floor - 8) top = Math.max(8, floor - 8 - hgt);
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }
    setTimeout(function () { document.addEventListener('click', popOff, true); document.addEventListener('keydown', popOff); window.addEventListener('scroll', closePop, { passive: true }); }, 0);
  }

  // ---- the view itself ----
  function open(on, remember) {
    if (on === isOpen()) { if (on) render(); return; }
    document.documentElement.classList.toggle('map-open', on);
    $('mapView').hidden = !on;
    var ag = document.querySelector('.agenda'); if (ag && $('teamsView').hidden) ag.hidden = on;
    closePop();
    if (remember) { try { localStorage.setItem('lqa-map', on ? '1' : '0'); if (on) localStorage.setItem('lqa-view', 'list'); } catch (e) { /* no storage */ } } // app.js restores List; this file then opens the map over it
    H.syncViewSwitch(); H.fitFilterBar();
    if (on) load().then(function () { home(false); render(); });
  }
  window.LQAMap = { open: open, isOpen: isOpen, render: schedule };
  window.addEventListener('resize', function () { if (isOpen()) schedule(); });
  // at load: ?view=map, or the remembered choice — unless a ?team= link or a saved Month view got there first
  (function () {
    var q = new URLSearchParams(location.search), saved = null;
    try { saved = localStorage.getItem('lqa-map'); } catch (e) { /* unreadable storage */ }
    if (q.get('team') || document.documentElement.classList.contains('month-open')) { if (saved === '1') try { localStorage.setItem('lqa-map', '0'); } catch (e) { /* */ } return; }
    if (q.get('view') === 'map' || (!q.get('view') && saved === '1')) open(true, false);
    else load(); // warm, so the first tap draws at once
  })();
})();
