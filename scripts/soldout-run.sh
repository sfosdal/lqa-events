#!/bin/zsh
# One sold-out run: Ticketmaster capacities and sold-out status read from this
# Mac (Ticketmaster's edge blocks GitHub's runners), committed and pushed (the
# push triggers the Actions build, which stamps the feed). launchd runs this
# twice a day — scripts/launchd/net.fosdal.lqa-soldout.plist. By hand:
#   scripts/soldout-run.sh [--limit N]      NO_PUSH=1 skips the commit
# Log: ~/Library/Logs/lqa-soldout.log
#
# Since 2026-10-28 (after it had failed every run from Oct 22 with OrbStack
# down, and would otherwise have pushed whatever local main carried):
#   - it runs in its own checkout, ~/repos/lqa-events-soldout, a worktree of
#     this repo reset to origin/main each run, and pushes HEAD:main from
#     there — never this checkout's main, whose unpushed commits stay put;
#   - the capacity seed (scripts/capacity-seed.mjs, no Docker) runs first,
#     so new shows get their house even when the container can't start;
#   - OrbStack is started if its daemon doesn't answer (orb start).
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export HOME=${HOME:-/Users/sfosdal}
REPO=${0:A:h:h}
RUN=$HOME/repos/lqa-events-soldout
DOCKER=($HOME/.orbstack/bin/docker --context orbstack)   # OrbStack's daemon by name: a Docker Desktop install would otherwise steal the default context
NAME=lqa-soldout-browser
LOG=$HOME/Library/Logs/lqa-soldout.log
LOCK=/tmp/lqa-soldout.lock
exec >>"$LOG" 2>&1
echo "== $(date '+%Y-%m-%d %H:%M:%S') start ($*)"
if ! mkdir "$LOCK" 2>/dev/null; then echo "another run holds $LOCK — skipped"; exit 0; fi
trap 'rm -rf "$LOCK"; "${DOCKER[@]}" rm -f "$NAME" >/dev/null 2>&1' EXIT

# the run checkout: origin/main as published, plus the key and the Teams feed the checker reads
git -C "$REPO" fetch -q origin main || { echo "fetch failed"; exit 1; }
if [[ ! -d $RUN/.git && ! -f $RUN/.git ]]; then git -C "$REPO" worktree add -q --detach "$RUN" origin/main || { echo "worktree add failed"; exit 1; }; fi
git -C "$RUN" checkout -q --detach origin/main && git -C "$RUN" reset -q --hard origin/main || { echo "reset to origin/main failed"; exit 1; }
cp "$REPO/.env" "$RUN/.env" 2>/dev/null
SITE=$(node -e "require('$RUN/site/city.js'); console.log(globalThis.LQACity.site)")
curl -sf -m 30 "${SITE}teams.json" -o "$RUN/site/teams.json" || echo "teams.json not fetched — away games skipped this run"
cd "$RUN" || exit 1

# 1. capacities (plain fetches from home, no browser)
node scripts/capacity-seed.mjs || echo "capacity seed failed"

# 2. sold-out status through the Chromium container
SOLD=1
if ! "${DOCKER[@]}" info >/dev/null 2>&1; then
  echo "OrbStack not answering — starting it"
  orb start >/dev/null 2>&1
  for i in {1..60}; do "${DOCKER[@]}" info >/dev/null 2>&1 && break; sleep 2; done
fi
if ! "${DOCKER[@]}" image inspect "$NAME" >/dev/null 2>&1; then
  "${DOCKER[@]}" build -q -t "$NAME" docker/soldout-browser >/dev/null || { echo "image build failed"; SOLD=0; }
fi
if (( SOLD )); then
  "${DOCKER[@]}" rm -f "$NAME" >/dev/null 2>&1
  "${DOCKER[@]}" run -d --name "$NAME" -p 127.0.0.1:9222:9222 "$NAME" >/dev/null || { echo "container start failed (is OrbStack running?)"; SOLD=0; }
fi
if (( SOLD )); then
  for i in {1..30}; do curl -sf -m 2 http://127.0.0.1:9222/json/version >/dev/null && break; sleep 1; done
  # The checker in the background, with two guards (2026-10-10, after a run that
  # slept with the Mac on Oct 8 and hung for two days — launchd never starts a
  # second instance while one lives, so every later fire was skipped):
  #   caffeinate -i   no idle sleep while it runs (a closed lid still sleeps)
  #   watchdog        a checker still running after WATCHDOG_SECS (a run takes
  #                   ~15 min) is killed, so the next fire is not blocked
  WATCHDOG_SECS=${WATCHDOG_SECS:-2400}
  CDP_URL=http://127.0.0.1:9222 node scripts/soldout-check.mjs "$@" & CHECK=$!
  caffeinate -i -w $CHECK &
  ( for ((s = 0; s < WATCHDOG_SECS; s += 30)); do sleep 30; kill -0 $CHECK 2>/dev/null || exit 0; done
    kill $CHECK 2>/dev/null && echo "watchdog: checker still running after ${WATCHDOG_SECS}s — killed" ) &
  wait $CHECK; RC=$?
  (( RC == 0 )) || { echo "checker failed (exit $RC)"; git checkout -q -- scripts/data/soldout.json; }
  "${DOCKER[@]}" rm -f "$NAME" >/dev/null 2>&1
fi

# 3. commit what changed, on top of origin/main, and push it there
if [[ -n "${NO_PUSH:-}" ]]; then echo "NO_PUSH set — not committing"; git status --short scripts/data; exit 0; fi
git add scripts/data/soldout.json scripts/data/capacity.json
if git diff --cached --quiet; then echo "no change"; exit 0; fi
git -c user.name="Steve Fosdal" -c user.email=steve@fosdal.net commit -q -m "Sold-out status and capacities, $(date '+%b %-d %H:%M')" || { echo "commit failed"; exit 1; }
for try in 1 2 3; do
  git push -q origin HEAD:main && { echo "pushed $(git rev-parse --short HEAD)"; exit 0; }
  git fetch -q origin main && git rebase -q origin/main || { git rebase --abort 2>/dev/null; break; }
done
echo "push failed — will retry next run"
