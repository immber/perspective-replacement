# Build for linux/amd64 (Cloud Run). tfjs-node needs glibc, so Alpine will not work.

# --- Build: install deps, compile, download and verify model weights ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# tfjs-node's install step downloads its prebuilt libtensorflow binary.
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build \
 && MODEL_DIR=/app/model npm run fetch-model

# Drop dev deps, then remove packages that tfjs-node only uses at install time
# (binary download/extract and the converter CLI). They carry known
# vulnerabilities and are never loaded by the running service.
RUN npm prune --omit=dev \
 && rm -rf node_modules/tar node_modules/adm-zip node_modules/argparse node_modules/sprintf-js

# --- Runtime ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    MODEL_DIR=/app/model
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/model ./model
COPY package.json NOTICE ./

USER node
EXPOSE 8080
# --no-deprecation hides tfjs-node's util.isArray warnings at start.
CMD ["node", "--no-deprecation", "dist/server.js"]
