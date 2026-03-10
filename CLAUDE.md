# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Farnham Home Finder — automated property search aggregator that scrapes 15 estate agent websites for properties near Farnham, Surrey (GU9/GU10). Filters by distance to Highfield South Farnham School (≤1.2mi walking) and town centre (≤0.5mi), then sends Telegram alerts for matches. Includes a web dashboard with map view.

## Commands

```bash
npm start              # Start scheduler + dashboard (port 3000)
npm test               # Run unit tests (node:test runner)
npm run scrape         # One-off manual scrape via CLI
npm run dashboard      # Dashboard only (no scheduler)
npm run ci:syntax      # Syntax validation for CI
npm run ci:smoke       # Smoke tests for CI
npm run setup          # First-time setup + Telegram test
npm run backfill:geo   # Backfill geocodes for existing listings
```

Run a single test file: `node --test test/scraper-helpers.test.js`

## Deployment

```bash
bash deploy.sh                    # Full deploy: copies compose + .env, pulls image, restarts
./manage-vps.sh                   # VPS management helper
./manage-vps.sh logs              # Live container logs
./manage-vps.sh status            # Container status + health
./manage-vps.sh restart           # Restart containers
./manage-vps.sh backup            # Download DB to backups/
./manage-vps.sh restore <file>    # Upload DB backup and restart
./manage-vps.sh ssh               # SSH into VPS
./manage-vps.sh update            # Run deploy.sh
```

**VPS**: Oracle Cloud arm64, deployed via `docker-compose.prod.yml`. Connection config in `deploy.config` (not committed).

**Tailscale exit node**: App traffic routes through a Tailscale sidecar container using a residential IP exit node. This is critical — estate agent sites block/degrade datacenter IPs (missing images, empty results, captchas).

**Image**: Built by CI and pushed to `ghcr.io/enderekici/estate-agent:main`. Multi-arch (amd64 + arm64).

**Redeploying after code changes**: Push to main → wait for CI → `./manage-vps.sh update`.

**Clearing DB for fresh start**: `./manage-vps.sh ssh`, then `rm -f data/listings.db`, then restart.

**Important**: `docker compose restart` does NOT reload `.env` changes — use `up -d --force-recreate` instead.

## Debugging Scrapers

**Checking live API**:
```bash
curl -s 'http://localhost:3000/api/stats'
curl -s 'http://localhost:3000/api/listings?source=rightmove'
curl -s 'http://localhost:3000/api/scrape/status'
```

**Running scripts inside the container**: Write a `.js` file locally, `scp` to VPS, then `docker cp` into the container and exec. Direct `node -e` via SSH mangles `$` and `!` characters.
```bash
scp -i "$SSH_KEY" /tmp/debug.js "$SERVER:$DEPLOY_DIR/"
ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker cp debug.js estate-agent-app-1:/app/ && docker compose -f docker-compose.prod.yml exec app node debug.js"
```

**Common scraper issues**:
- Pipeline filters listings by `MAX_PRICE` and `MIN_BEDROOMS` before storing — check these if listings seem missing
- "0 new" doesn't mean scraper failed — it means all URLs were already in the DB
- Rightmove OUTCODE IDs can shift silently; verify at `https://www.rightmove.co.uk/property-for-sale/GU9.html` (search page source for `OUTCODE^NNNN`). Current: GU9=1042, GU10=1043
- Images: many sites lazy-load thumbnails; extractors should check `<picture><source srcset>` and `data-src` attributes, not just `img.src`
- Cross-source deduplication backfills missing `prop_type` and `thumbnail` from duplicate onto canonical listing
- Scrapers run 4 at a time (`SCRAPE_CONCURRENCY` env var); they share a single Chromium instance with separate contexts

## Architecture

**Entry flow:** `index.js` → starts dashboard server + cron scheduler → scheduler triggers `pipeline.js` every 45min (8am–10pm)

**Pipeline** (`src/pipeline.js`): scrape all sources (parallel, batches of 4) → upsert to DB → geocode new addresses via Nominatim → deduplicate cross-source → send Telegram notifications for matches

**Scrapers** (`src/scrapers/`): Each file exports `{ scrape, SOURCE }`. All use Playwright via shared `browser.js` (singleton Chromium instance). Local agents extend patterns from `_localBase.js` which provides `normalise()`, `parsePrice()`, `parseBeds()`, `inferPropertyType()`, and `canonicaliseUrl()`. Portal scrapers (rightmove, zoopla, onthemarket) have their own page-evaluation logic. `search-params.js` and `search-url-builders.js` centralize search criteria for URL construction.

**Database** (`src/db.js`): Uses `node:sqlite` (built-in, Node ≥24 required — no native deps). SQLite with WAL mode. Two tables: `listings` (properties with geocoding, dedup, favourites) and `scrape_runs` (run history). Deduplication uses normalized address + price matching across sources.

**Dashboard** (`src/dashboard/server.js`): Express API serving `public/index.html` (single-page dark-theme UI with Leaflet map). API endpoints: `/api/listings`, `/api/stats`, `/api/config`, `/api/scrape` (POST trigger), `/api/scrape/status`.

## Key Conventions

- Node.js ≥24 required (uses `node:sqlite` built-in module)
- No native compilation dependencies — `better-sqlite3` was replaced with `node:sqlite`
- Tests use `node:test` and `node:assert/strict` (no test framework dependency)
- Listing IDs are MD5 hashes of canonicalized URLs
- All scrapers return arrays of objects with `{ url, address, price, bedrooms, prop_type, thumbnail }` — these get normalized through `_localBase.normalise()`
- URL validation in `pipeline.js` (`VALID_URL_PATTERNS`) rejects non-property-detail URLs per source
- Geocoding rate-limited to ~1 req/1.6s (Nominatim public API)
- Dashboard auto-starts unless `NODE_ENV=test` or `DASHBOARD_AUTOSTART=0`
- Docker image uses multi-stage build: `node:24-bookworm-slim` for deps, `playwright:v1.58.2-noble` for runtime. Playwright version in Dockerfile must match `package.json`.

## Environment Variables

Configured via `.env` (see `.env.example`):
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — optional, notifications disabled without them
- `MIN_BEDROOMS`, `MAX_PRICE` — override search filters from config.js
- `DB_PATH` — SQLite database location (default: `data/listings.db`)
- `DASHBOARD_PORT` — dashboard port (default: 3000)
- `SCRAPE_CONCURRENCY` — parallel scraper count (default: 4)
