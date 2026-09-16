# A headed Chromium on a virtual display: to the web it is a normal desktop
# browser with a window; on the Mac nothing shows. The checker drives it over
# the DevTools port, published to localhost only. A headed Chromium binds its
# DevTools port to the container's own loopback whatever
# --remote-debugging-address says, so socat forwards the published port to it.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb xauth socat fonts-liberation fonts-noto-color-emoji ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
ENV TZ=America/Los_Angeles
RUN useradd -m -s /bin/bash browse
COPY --chmod=755 start.sh /usr/local/bin/start.sh
USER browse
WORKDIR /home/browse
EXPOSE 9222
CMD ["/usr/local/bin/start.sh"]
