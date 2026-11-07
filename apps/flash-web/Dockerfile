# Build context is the repo root, because npm workspaces need the root lockfile.
FROM node:26.13.0-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY libs/typekit/package.json libs/typekit/
COPY libs/flash-commons/package.json libs/flash-commons/
COPY apps/flash-be/package.json apps/flash-be/
COPY apps/flash-be-e2e/package.json apps/flash-be-e2e/
COPY apps/flash-web/package.json apps/flash-web/
COPY apps/flash-web-e2e/package.json apps/flash-web-e2e/
COPY apps/flash-load/package.json apps/flash-load/
RUN npm ci --ignore-scripts
COPY libs/typekit libs/typekit
RUN npm run build -w @flash/typekit
# flash-commons is built on top of typekit, and flash-web imports its dist.
COPY libs/flash-commons libs/flash-commons
RUN npm run build -w @flash/flash-commons
COPY apps/flash-web apps/flash-web
RUN npm run build -w flash-web

FROM node:26.13.0-alpine AS runtime
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000
WORKDIR /app
# Nitro's output is self-contained, so only .output ships in the runtime image.
COPY --from=build --chown=node:node /repo/apps/flash-web/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", ".output/server/index.mjs"]
