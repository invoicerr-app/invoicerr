FROM --platform=$BUILDPLATFORM node:22-bullseye AS backend-builder
# PDF rendering uses `playwright-core` (not the full `playwright` package), which — unlike the
# `puppeteer` it replaced — bundles no browser at all and downloads nothing on `npm ci`, so there is
# no equivalent of puppeteer's old ~750MB postinstall fetch to skip here. The runtime stage still
# points the app at the Chromium already present in the base image (CHROMIUM_EXECUTABLE_PATH below).

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
COPY backend/.npmrc .npmrc
COPY backend/prisma ./prisma

RUN npm ci

COPY backend/. .

RUN DATABASE_URL=not_required npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

FROM --platform=$BUILDPLATFORM node:22-bullseye AS frontend-builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/. .

RUN npm run build

FROM ghcr.io/invoicerr-app/server-image:latest

# `playwright-core` ships no browser of its own — this points it at the Chromium already baked into
# the base image (`ghcr.io/invoicerr-app/server-image`), the same binary the old PUPPETEER_EXECUTABLE_PATH
# used to name (render-pdf.ts still honours that variable too, as a backward-compatibility alias, for
# self-hosted operators whose own env/compose files still set it).
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

COPY --from=frontend-builder /app/dist /usr/share/nginx/html

COPY --from=backend-builder /app/dist /usr/share/nginx/backend
COPY --from=backend-builder /app/node_modules /usr/share/nginx/backend/node_modules
COPY --from=backend-builder /app/package*.json /usr/share/nginx/backend/
COPY --from=backend-builder /app/prisma /usr/share/nginx/backend/prisma
COPY --from=backend-builder /app/package.json /usr/share/nginx/
COPY --from=backend-builder /app/prisma.config.ts /usr/share/nginx/backend
COPY --from=backend-builder /app/prisma.config.ts /usr/share/nginx/backend/prisma
COPY --from=backend-builder /app/prisma.config.ts /usr/share/nginx/backend/src

COPY entrypoint.sh /usr/share/nginx/entrypoint.sh
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

RUN chmod +x /usr/share/nginx/entrypoint.sh

# Which commit this image was built from — deliberately the LAST thing in the file.
# `GIT_REVISION` changes on every build, so anything placed after an instruction that consumes it is
# rebuilt every time; keeping these at the very end leaves every expensive layer above cacheable.
#
# Without this, "what is actually running in production?" has no answer that does not go through the
# registry API: `docker image inspect` on the deployed container shows the tag and the digest but
# nothing tying either to a commit, and a moving branch tag (`:compliance-engine-v2`) points at a
# different commit every build. Measured 2026-09-14 on the live deployment: the running image's
# commit could only be GUESSED, by correlating the image's build timestamp with the git log to
# within two minutes — and reading it from GHCR needed a token scope we did not have. A label costs
# nothing and turns that guess into a fact.
#
# The value is also exposed as an env var so it can be read from INSIDE the container (a shell, a
# future health endpoint) without a Docker socket — the label alone is only visible to whoever can
# inspect the image.
ARG GIT_REVISION=unknown
ARG GIT_REF_NAME=unknown
LABEL org.opencontainers.image.revision=$GIT_REVISION \
      org.opencontainers.image.version=$GIT_REF_NAME \
      org.opencontainers.image.source=https://github.com/invoicerr-app/invoicerr \
      org.opencontainers.image.title=invoicerr
ENV INVOICERR_REVISION=$GIT_REVISION \
    INVOICERR_REF_NAME=$GIT_REF_NAME

CMD ["/usr/share/nginx/entrypoint.sh"]
