// LQA Events — shared filter/classification logic.
//
// Single source of truth for "does this event survive the filter", used by
// the main calendar (app.js) and by other sites that render a filtered
// slice of the feed (e.g. the river site's Neighborhood section). Keeping
// this in one file means a change to team regexes or event-type rules can't
// silently drift between the sites that consume it.
//
// Filter state shape: { venueMode, badgeMode, teamMode } — each a map of
// key -> 'ex' for excluded; a key absent from the map means included. Venue
// keys are the raw venue name as it appears in events.json (e.g. "The Vera
// Project"); badge keys are the TYPE_LIST keys (concert/sports/arts/movie/
// community); team keys are TEAMS[].slug.
(function (global) {
  'use strict';

  // Local pro teams — matched on the title no matter what the venue.
  // Mirrors TEAMS in scripts/badges.mjs. venue = the team's home building;
  // schedule = the team's own schedule page (a game's link still goes to
  // wherever its tickets are sold).
  var TEAMS = [
    { slug: 'mariners', label: 'Mariners', re: /mariners/i, venue: 'T-Mobile Park', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png', schedule: 'https://www.mlb.com/mariners/schedule' },
    { slug: 'storm', label: 'Storm', re: /seattle storm/i, venue: 'Climate Pledge Arena', logo: 'https://a.espncdn.com/i/teamlogos/wnba/500/sea.png', schedule: 'https://storm.wnba.com/schedule/' },
    { slug: 'seahawks', label: 'Seahawks', re: /seahawks/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', schedule: 'https://www.seahawks.com/schedule/' },
    { slug: 'reign', label: 'Reign', re: /reign fc|seattle reign/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/15363.png', schedule: 'https://www.reignfc.com/schedule' },
    { slug: 'sounders', label: 'Sounders', re: /sounders/i, venue: 'Lumen Field', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png', schedule: 'https://www.soundersfc.com/schedule/' },
    { slug: 'kraken', label: 'Kraken', re: /kraken/i, venue: 'Climate Pledge Arena', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png', schedule: 'https://www.nhl.com/kraken/schedule' },
  ];
  var TEAM_BY_SLUG = {};
  TEAMS.forEach(function (t) { TEAM_BY_SLUG[t.slug] = t; });

  var TYPE_VENUE_DEFAULT = {
    'Climate Pledge Arena': 'concert', 'The Vera Project': 'concert',
    'T-Mobile Park': 'concert', 'Lumen Field': 'concert', // non-game stadium bookings are shows
    'McCaw Hall': 'arts', 'Cornish Playhouse': 'arts', 'On the Boards': 'arts',
    'Seattle Center': 'community', 'SIFF Cinema Uptown': 'community', // SIFF specials = festival programming
  };
  function eventType(e) {
    var title = e.title || '';
    if (e.movie) return 'movie';
    if (TEAMS.some(function (t) { return t.re.test(title); }) || /\bvs\.?\s/i.test(title)) return 'sports';
    if (/ballet|opera|symphon|orchestra|philharmon|theatre|theater|musical|broadway|shakespeare|comedy|stand-?up|improv|dance|cirque|on ice/i.test(title)) return 'arts';
    if (/festival|fest[aá]l|\bfair\b|\bexpo\b|market|convention|summit|celebration|ceremony|\bwalk\b|\brun\b|parade/i.test(title)) return 'community';
    if (/concert|\btour\b|live music|\bdj\b|\blive\b/i.test(title)) return 'concert';
    return TYPE_VENUE_DEFAULT[e.venue] || 'community';
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Purely subtractive: everything shows until unchecked. An unchecked venue
  // drops its events, an unchecked team drops its home games, and an
  // unchecked type drops every event inferred into it.
  function matchesFilter(e, mode) {
    mode = mode || {};
    var venueMode = mode.venueMode || {};
    var badgeMode = mode.badgeMode || {};
    var teamMode = mode.teamMode || {};
    if (venueMode[e.venue] === 'ex') return false;
    if (badgeMode[eventType(e)] === 'ex') return false;
    var title = e.title || '';
    for (var slug in teamMode) {
      if (teamMode[slug] === 'ex' && TEAM_BY_SLUG[slug] && TEAM_BY_SLUG[slug].re.test(title)) return false;
    }
    return true;
  }

  // URL query <-> filter state. Venue names are stored verbatim (URL-encoded
  // by URLSearchParams) rather than slugified, so matching stays exact —
  // slugifying and reversing risks collisions between similarly-named venues.
  function encodeFilterQuery(mode) {
    var params = new URLSearchParams();
    Object.keys(mode.venueMode || {}).forEach(function (v) {
      if (mode.venueMode[v] === 'ex') params.append('ex_venue', v);
    });
    Object.keys(mode.badgeMode || {}).forEach(function (k) {
      if (mode.badgeMode[k] === 'ex') params.append('ex_badge', k);
    });
    Object.keys(mode.teamMode || {}).forEach(function (k) {
      if (mode.teamMode[k] === 'ex') params.append('ex_team', k);
    });
    return params.toString();
  }
  function parseFilterQuery(search) {
    var params = new URLSearchParams(search);
    var mode = { venueMode: {}, badgeMode: {}, teamMode: {} };
    var any = false;
    params.getAll('ex_venue').forEach(function (v) { mode.venueMode[v] = 'ex'; any = true; });
    params.getAll('ex_badge').forEach(function (k) { mode.badgeMode[k] = 'ex'; any = true; });
    params.getAll('ex_team').forEach(function (k) { mode.teamMode[k] = 'ex'; any = true; });
    mode.any = any;
    return mode;
  }

  global.LQAFilter = {
    TEAMS: TEAMS,
    TEAM_BY_SLUG: TEAM_BY_SLUG,
    slugify: slugify,
    eventType: eventType,
    matchesFilter: matchesFilter,
    encodeFilterQuery: encodeFilterQuery,
    parseFilterQuery: parseFilterQuery,
  };
})(window);
