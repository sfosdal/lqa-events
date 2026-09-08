# LQA Events

Event feed and calendar for Lower Queen Anne / the Seattle Center area:
Climate Pledge Arena, McCaw Hall, and the Seattle Center grounds.

Live at **https://fosdal.net/lqa-events/** — a GitHub Actions cron refreshes
the data every ~6 hours and deploys straight to GitHub Pages (no data commits).

## What it publishes

| Path | What |
|---|---|
| `/lqa-events/` | Calendar UI — month grid, agenda, venue filters, subscribe |
| `/lqa-events/events.json` | JSON feed: `{ generated, events: [{venue,title,date,time,url}] }` — plus optional per-event `end` (same-day local end time), `age21`, `soldOut`, `free`, `dateTbd`, `type` (the source's own classification — concert/sports/arts/movie/community/expo — which the site's type rules trust before falling back to title words), and `status` (`cancelled` or `postponed`) with `statusSince` (ISO time the status was first detected; a cancelled show stays in its slot, marked, until its date passes), and `watch` on a home game (`{ tv: [...], radio: [...] }` — the national and home-market broadcasts its league lists, when it lists any) |
| `/lqa-events/events.ics` | iCalendar feed — subscribable in Google/Apple Calendar |
| `/lqa-events/embed.js` | Drop-in widget for other sites |
| `/lqa-events/filter.js` | Shared filter/classification logic (teams, event types, venue matching, venue capacities — the site's venue list is ordered by them) and the share-link code — the single source of truth other sites should use if they filter this feed themselves, instead of re-implementing the rules |

Embed on any site:

```html
<div id="lqa-events"></div>
<script src="https://fosdal.net/lqa-events/embed.js" data-max="8" defer></script>
```

Options via data-attributes: `data-max`, `data-venue`, `data-target`,
`data-nostyle`. Output uses `lqa-ev-*` classes for restyling.

## Filter links

The "Copy Filter Link" button (under *Embed* in the footer) copies a URL that
reproduces the current filter panel state as a short code — e.g.
`?f=04ZVUO` (the default view: movies and the Children's Theatre hidden). The code is the set of
excluded venues/types/teams as an upper-case base-36 bitmask over a fixed,
append-only registry in `filter.js`, zero-padded to six digits, so links
keep working as venues and teams are added and every code is the same
length.
Opening one loads with those exclusions instead of your saved local prefs.
The panel's preset chips (Default, Everything, Nothing, Neighborhood,
Capacity > 2,500) are just such filter states applied in one tap — Everything switches
Holidays on as well, Nothing unchecks every group, and Capacity keeps the
venues that seat 2,500 or more; the venue list is
split into Lower Queen Anne and Downtown & SoDo, each with its own
all / none.
Two optional parameters ride along: `s=` carries the search box's text,
encoded (UTF-8 bytes XOR-ed with a fixed key, URL-safe base64 — not readable
in the address bar, but reversible; `LQAFilter.encodeSearch`/`decodeSearch`),
and `h=1` switches the US & WA holidays rows on.
`filter.js` exposes `LQAFilter.parseFilterCode`/`encodeFilterCode`/
`matchesFilter` so another site can apply the same code to its own copy of
`events.json`.

## Layout

- `scripts/fetch-events.mjs` — aggregates sources into `site/events.json` +
  `site/events.ics`. Dedicated sources first: Ticketmaster Discovery API
  (Climate Pledge Arena — needs `TICKETMASTER_API_KEY`, skipped without it),
  The Vera Project via the DICE API, SIFF Cinema Uptown's calendar, On the
  Boards' Squarespace JSON, and the Convention Center's Momentus
  calendar (downtown, like the SoDo stadiums; conventions and consumer shows
  as one all-day event per day, private one-day meetings skipped), and the
  campus neighbours Seattle Center's calendar doesn't carry: Seattle
  Children's Theatre (month grids on sct.org; classes skipped), MoPOP (the
  calendar list on mopop.org/events), Pacific Science Center (its events
  page) and KEXP (its own list, station events only), plus the first
  neighborhood bar, The Traveling Goat (its Wix events page; typed `bar`,
  which the site shows as "Local Bars" — bars get the one type switch and
  stay out of the venue list). Then a
  campus-wide sweep walks every page of seattlecenter.com's calendar
  (dates from its date bars, year inferred; venue from each card's facility
  tag, matched against the calendar's own venue filter — untagged
  campus-wide events like Bumbershoot become "Seattle Center"; venues with a
  dedicated source are skipped — McCaw Hall is *not* one of them: every
  performance comes from the sweep, with the venue's RSS supplying its own
  detail-page links; standing daily attractions such as the Sculpture Walk
  are excluded). Ticketmaster is queried by venue id, every page. 365-day
  window, de-duped.
- `scripts/ics.mjs` — RFC 5545 generation (stable UIDs, PST/PDT VTIMEZONE,
  all-day vs timed events). Tests: `node --test scripts/ics.test.mjs`.
- `site/` — the static site; generated feed files land here (gitignored).
  `site/marks/` holds agenda-row marks for local bars, made from logos
  supplied by hand (not fetched) by `scripts/make-mark.py`: the logo's look
  kept but muted — charcoal disc, desaturated gold strokes, lines thickened
  a touch for ~46px. The site shows them unfiltered in both themes
  (`.venue-mark`), unlike the team crests.
- `.github/workflows/events.yml` — cron + push → test, fetch, deploy to Pages.

## Run locally

```
node scripts/fetch-events.mjs        # generates site/events.json + events.ics
python3 -m http.server -d site 8087  # or any static server
```

Without `TICKETMASTER_API_KEY` in the environment only McCaw Hall events
appear — fine for previewing the UI.

## Secrets

`TICKETMASTER_API_KEY` — free Ticketmaster Discovery API key, set as a repo
Actions secret.

## Credits

The toolbar icons (filter, search, calendar, link, back to top) are from
[Lucide](https://lucide.dev) (ISC license, © Lucide Icons and Contributors),
inlined as SVG in `site/index.html`.
