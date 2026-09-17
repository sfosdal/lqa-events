# LQA Events

Event feed and calendar for Lower Queen Anne / the Seattle Center area:
Climate Pledge Arena, McCaw Hall, and the Seattle Center grounds.

Live at **https://fosdal.net/lqa-events/** — a GitHub Actions cron refreshes
the data every ~6 hours and deploys straight to GitHub Pages (no data commits).

## What it publishes

| Path | What |
|---|---|
| `/lqa-events/` | Calendar UI — month grid, agenda, venue filters, subscribe, the Teams view. The default filter leaves the stadiums (over 20,000 seats: Lumen Field, T-Mobile Park) unchecked, like Movies and the Children's Theatre |
| `/lqa-events/events.json` | JSON feed: `{ generated, events: [{venue,title,date,time,url}] }` — plus optional per-event `end` (same-day local end time), `age21`, `soldOut`, `free`, `dateTbd`, `type` (the source's own classification — concert/sports/arts/movie/community/expo — which the site's type rules trust before falling back to title words), `tickets` on a Ticketmaster event (`{ box, resale, from?, checked }` — box-office and resale counts, the lowest price and when the local checker looked; see `scripts/soldout-check.mjs`), and `status` (`cancelled` or `postponed`) with `statusSince` (ISO time the status was first detected; a cancelled show stays in its slot, marked, until its date passes), and `watch` on a home game (`{ tv: [...], radio: [...] }` — the national and home-market broadcasts its league lists, when it lists any) Past events stay in the feed for a year: each build reads the live feed back as its archive and carries the past forward, and a build that cannot read it fails rather than publish without it (three tries; `ALLOW_NO_ARCHIVE=1` for a first build). |
| `/lqa-events/events.ics` | iCalendar feed — subscribable in Google/Apple Calendar |
| `/lqa-events/teams.json` | The home teams' seasons, home and away: `{ generated, teams: { mariners: [{ date, time, tbd, home, opp: { name, short, abbrev, logo, site }, venue, watch?, playoff?, res?: { us, them, won, ot? } }], … }, form: { mariners: { record, standing, home?, prev?: { season, record, seed? | rank? }, news?: [{ date, headline, text, url, source }], wiki?: { title, text, url } }, … } }` — from the leagues' own schedule APIs (`scripts/schedules.mjs`; preseason games kept and flagged `pre` — spring training, the NFL's and NHL's preseasons, the PWHL's, the Seawolves' round 0 friendly — shown faded with a badge and left out of the record and the last five; the Seawolves, Major League Rugby, from the club's schedule page at seawolves.rugby, results included, the opponents mapped to the clubs' own sites and crests by `MLR_CLUBS` — their Starfire Stadium home matches also enter the listing as `sports` events), Seattle-local dates and times, the opponent's crest (the league's file fetched once a week into `site/marks/opp/` with its ™ / ® taken off — `scripts/marks.mjs` drops the tiny cornered subpath of an SVG or blob of pixels of a PNG) and club page; `res` is a played game's line, `clips` its highlight links (`[{ title, url }]`, see below), `id` the league's game id (MLB, NHL), `week`/`season` the NFL's, `postseason` each league's playoff rounds for the season (hand-kept in `scripts/data/postseason.json` — dates, the final's site, `tbd` where the league hasn't announced) which the Teams view lists after the schedule and hatches on the calendar as "if they qualify" until real playoff games arrive, `form` each club's record and standing line (ESPN's team endpoint; the PWHL's own standings, RW-OTW-OTL-L) plus the latest pieces about the club — ESPN's team news feed merged with the outlets' RSS/Atom feeds (the Seattle Times' team pages; MLB.com, seahawks.com; Lookout Landing, Field Gulls, Sound Of Hockey, Davy Jones' Locker Room, Sounder at Heart), newest first, sixteen at most, each tagged with its source — and the lead paragraph of the season's Wikipedia page (CC BY-SA, linked on the site). Feeds the site's **Teams** view (the trophy stop of the view switch beside the theme pill — events list | home teams — or `?team=kraken`; several clubs pick together, `?team=kraken,mariners` — a tap adds or drops a club, the last one picked stays; the list merges their seasons, the head stacks a block per club, or only the clubs with a game in progress; the PDF chip then offers a chooser, one club or all in turn): a strip of the home teams, then one team's whole season as a list (played games folded away; tap an opponent's crest and only their games stay lit) or, behind the calendar chip, a poster-style season calendar in the club's colours; above either, a form block — record, standing, last five, next game, last season's line, the latest stories from ESPN and the local outlets, as many as fit beside the crests and the rest behind an arrow (the Wikipedia lead where there is no news, and a link to the season page always); from two days before a game until the day after its final the block becomes the game — the pregame (ESPN's win-probability ring, the starters, the leaders out) until it starts, the broadcast-style scorebug while it plays (ESPN's scoreboard asked every 30 seconds, every five minutes otherwise), the final after; the game's highlight clips lead the news column during and after the game — for the Mariners MLB's statsapi content feed by the schedule's `id` (linked to mlb.com/video, asked with each poll in the browser), for every club the ones the build attaches to the game as `clips` (`scripts/highlights.mjs`, games of the last four days: the NHL's gamecenter feed — each goal's clip and the three-minute recap on nhl.com, no CORS so only at build time; nfl.com's game page, which embeds the highlights reel and the can't-miss plays; and for all eight the club's and the league's official YouTube uploads feed, a video published within two days of the game that names the opponent and isn't a presser, interview or preview, a date in its title having to be the game's — clips already on the published file are carried forward, since YouTube's feed holds fifteen uploads; ESPN's clips are left out with the rest of its links); the Torrent and the Seawolves, which ESPN doesn't cover, get the same block from the schedule alone, without odds or a live score — score, inning or clock, the situation, a refresh button with the time of the last fetch and, around it, a ring that fills over the half-minute to the next fetch, before the game the matchup — ESPN's predictor ring, the season series, and at the top of the news column the probable starters and the leaders out — and a watch strip along the foot in every state (this game's networks, else the next game's: the league's listing looked up in `site/channels.json` — hand-kept DirecTV/Dish numbers, Xfinity numbers from `scripts/xfinity-lineup.mjs`, Seattle stations, streaming services, a link per name — with each club's standing outlets from the file's `clubs` table (radio network, local streams: 93.3 KJR for the Kraken and Sounders, Seattle Sports 710 and KIRO 97.3 for the Seahawks, KONG/KING 5+/Prime Video/YouTube where the club streams locally; verified 2026-09-13) and the feeds a Seattle viewer can't use (`hide`) left out), a Gamecast link, the news column — and, once it's over, the final; the club's pill in the strip pulses while its game is on, whichever club is selected; the block pins under the bar while the season scrolls and goes compact while pinned (the height it gives up goes into its bottom margin, so a short page keeps its length under the scroll) — small crests and one line (the score or the first pitch, the record or the opener) — and the PDF chip beside the calendar chip prints a one-sheet poster of the season — landscape letter, a light sheet whatever the theme, a banner with the crest and record, weekday rows, solid home cells and outlined away cells in the club's colours, a legend; three, four or five months across by the season's length (`@media print` in styles.css; `?team=x&print=1` puts the page in that state for a headless print-to-PDF; `?team=x&demo=live` (or `demo=pre`, `demo=final`) draws that club's next game as a made-up game in progress, before it, or over, local use only; add `&period=N` (any word does — `inning`, `quarter`, `half`, `frame`, `round`, `set`, `stage`, `start` — and a number past the sport's count folds round: `inning=7` on a football page is the 3rd quarter) and it starts there and plays a step on every poll to the final, stands a minute, then starts over from the 1st. Never filtered by the venue/capacity settings The site adds two lines from the results alone: Form (streak, last ten, road record) and Runs/Goals/Points (for and against a game, season margin). |
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
`?f=25EXYW` (the default view: the big rooms only, movies hidden). The code is the set of
excluded venues/types/teams as an upper-case base-36 bitmask over a fixed,
append-only registry in `filter.js`, zero-padded to six digits, so links
keep working as venues and teams are added and every code is the same
length.
Opening one loads with those exclusions instead of your saved local prefs.
The masthead has a theme pill (light, dark, system — `lqa-theme`), remembered per browser, phones included. `?team=a,b&demo=live` plays the first club picked as the game in progress.
The view pill's middle stop (`?view=month`, remembered as `lqa-view`) stacks the months from this one on, each its own framed block of square days padded to whole weeks, more appended as you scroll — there is no last one. A day carries only the names of what's on (as many as fit, the rest as "+N more"; phones show venue ticks); tapping it opens a card listing everything that day. The squares are sized so the whole of this month shows in the window at the top of the page; when that leaves the board narrower than the page each month's name stands as tall vertical text beside its block (otherwise a heading over it), and the ‹ MONTH › header pinned under the filter bar names the month at the top (its name, or the standing one, opens the month / year picker). The footer stamp reads "4hrs fresh" ("fresh just now" under an hour, "2 days old" past two).
The panel's preset chips (Default, Everything, Nothing, Neighborhood,
Capacity > 2,500) are just such filter states applied in one tap — Everything switches
Holidays on as well, Nothing unchecks every group, and Capacity keeps the
venues that seat 2,500 or more; the venue list is
split into Lower Queen Anne and Downtown & SoDo, each with its own
all / none.
Two optional parameters ride along: `s=` carries the search box's text,
encoded (UTF-8 bytes XOR-ed with a fixed key, URL-safe base64 — not readable
in the address bar, but reversible; `LQAFilter.encodeSearch`/`decodeSearch`),
`h=1` switches the US & WA holidays rows on, and `so=1` the Sold Out & Nearly switch (only events the feed marks sold out or within 5% of the house — `LQAFilter.ticketState`).
`filter.js` exposes `LQAFilter.parseFilterCode`/`encodeFilterCode`/
`matchesFilter` so another site can apply the same code to its own copy of
`events.json`.

## Layout

- `scripts/fetch-events.mjs` — aggregates sources into `site/events.json` +
  `site/events.ics`. Dedicated sources first: Ticketmaster Discovery API
  (Climate Pledge Arena — needs `TICKETMASTER_API_KEY`, skipped without it),
  The Vera Project via the DICE API, SIFF Cinema Uptown's calendar, On the
  Boards' Squarespace JSON, Seattle Rep's Tessitura performance feed
  (seattlerep.org/plays/json — the Bagley Wright, Leo K. and Poncho Forum
  houses, sold-out flag carried, a night's special/accessibility keywords
  after a colon in the title; classes, auditions and donor trips skipped —
  the campus sweep below used to carry these shows untagged, as the
  grounds, and now skips a card whose title starts with a Rep show playing
  that day), and the Convention Center's Momentus
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
- `scripts/soldout-check.mjs` + `scripts/soldout-run.sh` + `docker/soldout-browser/`
  — sold-out status for the Ticketmaster venues, a **local** job: Ticketmaster's
  public APIs carry no availability and its ticket pages are bot-walled for
  anything but a real windowed browser, so a launchd agent
  (`scripts/launchd/net.fosdal.lqa-soldout.plist`, 3am and 3pm) starts a
  Chromium-on-Xvfb container (OrbStack), drives it over the DevTools port
  through each on-sale event's page, reads the page's own inventory call
  (box-office and resale counts), stops the container and commits
  `scripts/data/soldout.json`; the push triggers the build, which stamps
  `tickets` and `soldOut` onto the feed — and onto the home teams' **away
  games** in teams.json: the checker also finds each club's away games of the
  next 45 days on Ticketmaster (by club name and date, primary listings only —
  MLB hosts sell through MLB's own system and show only as resale there, so
  those games carry nothing) and reads the host's page the same way. `--list`
  prints what a run would check, without a browser; `--away` checks only the
  away games (a partial run keeps the rest of the last one). Missed runs (Mac asleep) coalesce
  into one at wake; a blocked run leaves events `unknown`, never wrongly
  flagged. By hand: `scripts/soldout-run.sh [--limit N]`, `NO_PUSH=1` to skip
  the commit; log in `~/Library/Logs/lqa-soldout.log`.
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
