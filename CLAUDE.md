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

## Architecture

**Entry flow:** `index.js` → starts dashboard server + cron scheduler → scheduler triggers `pipeline.js` every 45min (8am–10pm)

**Pipeline** (`src/pipeline.js`): scrape all sources → upsert to DB → geocode new addresses via Nominatim → deduplicate cross-source → send Telegram notifications for matches

**Scrapers** (`src/scrapers/`): Each file exports `{ scrape, SOURCE }`. All use Playwright via shared `browser.js` (singleton Chromium instance). Local agents extend patterns from `_localBase.js` which provides `normalise()`, `parsePrice()`, `parseBeds()`, `inferPropertyType()`, and `canonicaliseUrl()`. Portal scrapers (rightmove, zoopla, onthemarket) have their own page-evaluation logic. `search-params.js` and `search-url-builders.js` centralize search criteria for URL construction.

**Database** (`src/db.js`): Uses `node:sqlite` (built-in, Node ≥24 required — no native deps). SQLite with WAL mode. Two tables: `listings` (properties with geocoding, dedup, favourites) and `scrape_runs` (run history). Deduplication uses normalized address + price matching across sources.

**Dashboard** (`src/dashboard/server.js`): Express API serving `public/index.html` (single-page dark-theme UI with Leaflet map). API endpoints: `/api/listings`, `/api/stats`, `/api/config`, `/api/scrape` (trigger), `/api/scrape/status`.

## Key Conventions

- Node.js ≥24 required (uses `node:sqlite` built-in module)
- No native compilation dependencies — `better-sqlite3` was replaced with `node:sqlite`
- Tests use `node:test` and `node:assert/strict` (no test framework dependency)
- Listing IDs are MD5 hashes of canonicalized URLs
- All scrapers return arrays of objects with `{ url, address, price, bedrooms, prop_type, thumbnail }` — these get normalized through `_localBase.normalise()`
- URL validation in `pipeline.js` (`VALID_URL_PATTERNS`) rejects non-property-detail URLs per source
- Geocoding rate-limited to ~1 req/1.6s (Nominatim public API)
- Dashboard auto-starts unless `NODE_ENV=test` or `DASHBOARD_AUTOSTART=0`
- Docker image uses multi-stage build with Playwright runtime base image; deploys as linux/amd64 + linux/arm64

## Environment Variables

Configured via `.env` (see `.env.example`):
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — optional, notifications disabled without them
- `MIN_BEDROOMS`, `MAX_PRICE` — override search filters from config.js
- `DB_PATH` — SQLite database location (default: `data/listings.db`)
- `DASHBOARD_PORT` — dashboard port (default: 3000)
