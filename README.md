# LQA Events

Event feed and calendar for Lower Queen Anne / the Seattle Center area:
Climate Pledge Arena, McCaw Hall, and the Seattle Center grounds.

Live at **https://fosdal.net/lqa-events/** — a GitHub Actions cron refreshes
the data every ~6 hours and deploys straight to GitHub Pages (no data commits).

## What it publishes

| Path | What |
|---|---|
| `/lqa-events/` | Calendar UI — month grid, agenda, venue filters, subscribe |
| `/lqa-events/events.json` | JSON feed: `{ generated, events: [{venue,title,date,time,url}] }` |
| `/lqa-events/events.ics` | iCalendar feed — subscribable in Google/Apple Calendar |
| `/lqa-events/embed.js` | Drop-in widget for other sites |

Embed on any site:

```html
<div id="lqa-events"></div>
<script src="https://fosdal.net/lqa-events/embed.js" data-max="8" defer></script>
```

Options via data-attributes: `data-max`, `data-venue`, `data-target`,
`data-nostyle`. Output uses `lqa-ev-*` classes for restyling.

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
