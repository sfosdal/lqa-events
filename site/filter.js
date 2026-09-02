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
    // PWHL, first season 2025-26. No public crest image to hotlink yet, and
    // the league site has no per-team schedule URL — the team page holds it.
    { slug: 'torrent', label: 'Torrent', re: /seattle torrent/i, venue: 'Climate Pledge Arena', schedule: 'https://www.thepwhl.com/en/teams/seattle-torrent' },
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

  // Compact filter code <-> filter state, for share links (?f=CODE).
  // REGISTRY is every filterable key in a fixed order; the code is the set of
  // EXCLUDED entries as a bitmask written in base 36 — a few characters, and
  // "0" means everything shown. Append-only: adding an entry adds a bit and
  // every existing code keeps meaning what it meant. A venue the feed turns
  // up that isn't listed here can't be encoded and drops out of the link.
  var REGISTRY = [
    ['venue', 'Climate Pledge Arena'], ['venue', 'McCaw Hall'], ['venue', 'Seattle Center'],
    ['venue', 'Cornish Playhouse'], ['venue', 'The Vera Project'], ['venue', 'SIFF Cinema Uptown'],
    ['venue', 'On the Boards'], ['venue', 'T-Mobile Park'], ['venue', 'Lumen Field'],
    ['badge', 'concert'], ['badge', 'sports'], ['badge', 'arts'], ['badge', 'movie'], ['badge', 'community'],
    ['team', 'mariners'], ['team', 'storm'], ['team', 'seahawks'], ['team', 'reign'],
    ['team', 'sounders'], ['team', 'kraken'], ['team', 'torrent'],
  ];
  var GROUP_MAP = { venue: 'venueMode', badge: 'badgeMode', team: 'teamMode' };
  function encodeFilterCode(mode) {
    var mask = 0;
    REGISTRY.forEach(function (entry, i) {
      var map = mode[GROUP_MAP[entry[0]]] || {};
      if (map[entry[1]] === 'ex') mask += Math.pow(2, i);
    });
    return mask.toString(36);
  }
  function parseFilterCode(code) {
    var mode = { venueMode: {}, badgeMode: {}, teamMode: {} };
    var mask = parseInt(code, 36);
    if (isNaN(mask) || mask < 0) return null;
    REGISTRY.forEach(function (entry, i) {
      if (Math.floor(mask / Math.pow(2, i)) % 2 === 1) mode[GROUP_MAP[entry[0]]][entry[1]] = 'ex';
    });
    return mode;
  }

  global.LQAFilter = {
    TEAMS: TEAMS,
    TEAM_BY_SLUG: TEAM_BY_SLUG,
    slugify: slugify,
    eventType: eventType,
    matchesFilter: matchesFilter,
    encodeFilterCode: encodeFilterCode,
    parseFilterCode: parseFilterCode,
  };
})(window);
