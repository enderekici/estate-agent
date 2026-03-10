# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps

WORKDIR /app
ENV NODE_ENV=production \
    npm_config_update_notifier=false

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM mcr.microsoft.com/playwright:v1.58.2-noble AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    npm_config_update_notifier=false

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY config.js index.js setup.js inspect.js ./
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/config').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
