#!/bin/zsh
# One sold-out run: the Chromium container up, the checker through it, the
# container down, the status file committed and pushed (the push triggers the
# Actions build, which stamps the feed). launchd runs this twice a day —
# scripts/launchd/net.fosdal.lqa-soldout.plist. By hand:
#   scripts/soldout-run.sh [--limit N]      NO_PUSH=1 skips the commit
# Log: ~/Library/Logs/lqa-soldout.log
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export HOME=${HOME:-/Users/sfosdal}
REPO=${0:A:h:h}
DOCKER=($HOME/.orbstack/bin/docker --context orbstack)   # OrbStack's daemon by name: a Docker Desktop install would otherwise steal the default context
NAME=lqa-soldout-browser
LOG=$HOME/Library/Logs/lqa-soldout.log
LOCK=/tmp/lqa-soldout.lock
cd "$REPO" || exit 1
exec >>"$LOG" 2>&1
echo "== $(date '+%Y-%m-%d %H:%M:%S') start ($*)"
if ! mkdir "$LOCK" 2>/dev/null; then echo "another run holds $LOCK — skipped"; exit 0; fi
trap 'rm -rf "$LOCK"; "${DOCKER[@]}" rm -f "$NAME" >/dev/null 2>&1' EXIT
if ! "${DOCKER[@]}" image inspect "$NAME" >/dev/null 2>&1; then
  "${DOCKER[@]}" build -q -t "$NAME" docker/soldout-browser >/dev/null || { echo "image build failed"; exit 1; }
fi
"${DOCKER[@]}" rm -f "$NAME" >/dev/null 2>&1
"${DOCKER[@]}" run -d --name "$NAME" -p 127.0.0.1:9222:9222 "$NAME" >/dev/null || { echo "container start failed (is OrbStack running?)"; exit 1; }
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
(( RC == 0 )) || { echo "checker failed (exit $RC)"; exit 1; }
"${DOCKER[@]}" rm -f "$NAME" >/dev/null 2>&1
if [[ -n "${NO_PUSH:-}" ]]; then echo "NO_PUSH set — not committing"; exit 0; fi
git add scripts/data/soldout.json
if git diff --cached --quiet; then echo "no change"; exit 0; fi
git commit -q -m "Sold-out status, $(date '+%b %-d %H:%M')" || { echo "commit failed"; exit 1; }
git pull -q --rebase --autostash origin main && git push -q origin main && echo "pushed $(git rev-parse --short HEAD)" || echo "push failed — will retry next run"
