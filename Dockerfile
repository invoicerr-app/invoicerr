FROM --platform=$BUILDPLATFORM node:22-bullseye AS backend-builder

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

ENV PLUGIN_DIR=/usr/share/nginx/plugins
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
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

ENV BETTER_AUTH_URL="http://localhost:3000"

CMD ["/usr/share/nginx/entrypoint.sh"]
