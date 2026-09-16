#!/bin/sh
# virtual display, port forwarder, then Chromium in the foreground (its stderr
# is the container log — grep -v dbus, the bus is noise)
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
export DISPLAY=:99
socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223 &
sleep 1
exec chromium --no-sandbox --remote-debugging-port=9223 \
  --user-data-dir=/home/browse/profile --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage --window-size=1440,900 --start-maximized about:blank
