# Build context is the repo root, because npm workspaces need the root lockfile.
FROM node:26.13.0-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY libs/typekit/package.json libs/typekit/
COPY apps/flash-be/package.json apps/flash-be/
COPY apps/flash-be-e2e/package.json apps/flash-be-e2e/
COPY apps/flash-web/package.json apps/flash-web/
COPY apps/flash-web-e2e/package.json apps/flash-web-e2e/
COPY apps/flash-load/package.json apps/flash-load/
RUN npm ci --ignore-scripts
COPY libs/typekit libs/typekit
RUN npm run build -w @flash/typekit
COPY apps/flash-be apps/flash-be
RUN npm run build -w flash-be && npm prune --omit=dev

FROM node:26.13.0-alpine AS runtime
ENV NODE_ENV=production \
	FLASH_BE_HOST=0.0.0.0 \
	FLASH_BE_PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
# node_modules/@flash/typekit is a link to ../../libs/typekit, so the library ships at that path.
COPY --from=build --chown=node:node /repo/libs/typekit/package.json ./libs/typekit/package.json
COPY --from=build --chown=node:node /repo/libs/typekit/dist ./libs/typekit/dist
COPY --from=build --chown=node:node /repo/apps/flash-be/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/flash-be/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/main.js"]
