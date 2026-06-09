# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini
ENV NODE_ENV=production

# ---- Dependencies ----
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Build (includes dev deps for asset build) ----
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:css || echo "CSS build skipped (CDN fallback in views)"

# ---- Runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# Non-root user for security.
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY . .
RUN mkdir -p logs storage && chown -R app:app /app
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# Default command runs the web server; the worker overrides this in compose.
CMD ["node", "src/server.js"]
