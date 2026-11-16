# The Maat agent. Build context: agent/. Built remotely (fly deploy --remote-only, or docker build on the VPS);
# see "Run in a container" in agent/README.md.
# Pin the base by digest when you build, e.g. FROM node:24-slim@sha256:<digest> with the digest that
# `docker buildx imagetools inspect node:24-slim` prints, so a rebuild cannot pick up a different image.
FROM node:24-slim

# tini starts node, forwards SIGTERM and SIGINT to it and reaps zombies. On a stop signal node finishes the round
# in flight, releases agent.lock and exits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies before sources, so a source change reuses the installed layer. tsx is a dependency: it runs src/.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# tsx reads tsconfig.json, so src/ compiles as it does in a dev run.
COPY tsconfig.json ./
COPY src ./src

# state.json, the journal and agent.lock live here. Secrets are passed at run time, never built in.
ENV MAAT_DATA_DIR=/data
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
# node itself, not npm, so the signals reach it. Another entry point in src/ runs from this image by overriding CMD.
CMD ["node", "--import", "tsx", "src/main.ts"]
