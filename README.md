# LQA Events

Event feed and calendar for Lower Queen Anne / the Seattle Center area:
Climate Pledge Arena, McCaw Hall, and the Seattle Center grounds.

Live at **https://fosdal.net/lqa-events/** — a GitHub Actions cron refreshes
the data every ~6 hours and deploys straight to GitHub Pages (no data commits).

## What it publishes

| Path | What |
|---|---|
| `/lqa-events/` | Calendar UI — month grid, agenda, venue filters, subscribe |
| `/lqa-events/events.json` | JSON feed: `{ generated, events: [{venue,title,date,time,url}] }` — plus optional per-event `end` (same-day local end time), `age21`, `soldOut`, `free` |
| `/lqa-events/events.ics` | iCalendar feed — subscribable in Google/Apple Calendar |
| `/lqa-events/embed.js` | Drop-in widget for other sites |
| `/lqa-events/filter.js` | Shared filter/classification logic (teams, event types, venue matching) and the share-link code — the single source of truth other sites should use if they filter this feed themselves, instead of re-implementing the rules |

Embed on any site:

```html
<div id="lqa-events"></div>
<script src="https://fosdal.net/lqa-events/embed.js" data-max="8" defer></script>
```

Options via data-attributes: `data-max`, `data-venue`, `data-target`,
`data-nostyle`. Output uses `lqa-ev-*` classes for restyling.

## Filter links

The "Copy Filter Link" button (next to Reset Filters) copies a URL that
reproduces the current filter panel state as a short code — e.g.
`?f=00035s` (the default view, movies hidden). The code is the set of
excluded venues/types/teams as a base-36 bitmask over a fixed, append-only
registry in `filter.js`, zero-padded to six digits, so links keep working
as venues and teams are added and every code is the same length.
Opening one loads with those exclusions instead of your saved local prefs.
`filter.js` exposes `LQAFilter.parseFilterCode`/`encodeFilterCode`/
`matchesFilter` so another site can apply the same code to its own copy of
`events.json`.

## Layout

- `scripts/fetch-events.mjs` — aggregates sources into `site/events.json` +
  `site/events.ics`. Dedicated sources first: Ticketmaster Discovery API
  (Climate Pledge Arena — needs `TICKETMASTER_API_KEY`, skipped without it),
  McCaw Hall's RSS feed, and The Vera Project via the DICE API. Then a
  campus-wide sweep of seattlecenter.com's calendar covers every venue
  category its filter lists (discovered at runtime; venues already covered
  by a dedicated source are skipped). 365-day window, de-duped.
- `scripts/ics.mjs` — RFC 5545 generation (stable UIDs, PST/PDT VTIMEZONE,
  all-day vs timed events). Tests: `node --test scripts/ics.test.mjs`.
- `site/` — the static site; generated feed files land here (gitignored).
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
