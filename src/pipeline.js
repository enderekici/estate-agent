const { upsertListing, updateGeo, getUngeocoded, getPendingNotifications, isNew, markNotified, logRun, deduplicateListings } = require('./db');
const { geocode, distanceToSchool, distanceToTownCentre, meetsLocationCriteria } = require('./geocoder');
const { sendNewListing, sendSummary, sendError } = require('./telegram');
const { runAll } = require('./scrapers/index');
const config = require('../config');

const GEOCODE_DELAY = 1600; // Conservative spacing to reduce 429s from shared public geocoders

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Per-source URL patterns — only store URLs that match a real property detail page
const VALID_URL_PATTERNS = {
  rightmove:     /rightmove\.co\.uk\/properties\/\d+/i,
  zoopla:        /zoopla\.co\.uk\/for-sale\/details\/\d+/i,
  onthemarket:   /onthemarket\.com\/(details|for-sale\/property)\//i,
  bridges:       /bridges\.co\.uk\/property\/[a-z0-9]/i,
  winkworth:     /winkworth\.co\.uk\/properties\/sales\//i,
  romans:        /romans\.co\.uk\/properties-for-sale\//i,
  hamptons:      /hamptons\.co\.uk\/properties\/\d+/i,
  keatsfearn:    /keatsfearn\.co\.uk\/properties\/\d+/i,
  truemangrundy: /truemanandgrundy\.co\.uk\/property\/[a-z0-9]/i,
  savills:       /search\.savills\.com\/property-detail\//i,
  andrewlodge:   /andrewlodge\.net\/properties\/sale\//i,
  bourne:        /bourneestateagents\.com\/property\//i,
  charters:      /chartersestateagents\.co\.uk\/property-for-sale\//i,
  curchods:      /curchods\.com\/display\//i,
  greenwood:     /greenwood-property\.co\.uk\/propert(y|ies)\//i,
  wpr:           /wpr\.co\.uk\/properties\/sale\//i,
};

function isValidPropertyUrl(source, url) {
  const pattern = VALID_URL_PATTERNS[source];
  if (!pattern) return true;
  return pattern.test(url);
}

const scrapeState = {
  running: false,
  start: null,
  finish: null,
  error: null,
  trigger: null,
};

let activeRunPromise = null;

function getScrapeStatus() {
  return {
    running: scrapeState.running,
    start: scrapeState.start,
    finish: scrapeState.finish,
    error: scrapeState.error,
    trigger: scrapeState.trigger,
    startedAt: scrapeState.start,
    finishedAt: scrapeState.finish,
  };
}

/**
 * Geocode all listings that don't have coordinates yet.
 */
async function geocodeNew() {
  const pending = getUngeocoded();
  if (pending.length === 0) return;

  console.log(`\nGeocoding ${pending.length} new addresses...`);
  for (const { id, address } of pending) {
    if (!address) continue;
    const coords = await geocode(address);
    if (coords) {
      const dSchool = distanceToSchool(coords.lat, coords.lng);
      const dCentre = distanceToTownCentre(coords.lat, coords.lng);
      const matches = meetsLocationCriteria(coords.lat, coords.lng);
      updateGeo(id, coords.lat, coords.lng, dSchool, dCentre, matches);
    }
    await sleep(GEOCODE_DELAY);
  }
}

/**
 * Send Telegram notifications for all un-notified matching listings.
 */
async function notifyMatches() {
  const pending = getPendingNotifications();
  if (pending.length === 0) return;

  console.log(`\nSending ${pending.length} Telegram notifications...`);
  for (const listing of pending) {
    const sent = await sendNewListing(listing);
    if (sent) markNotified(listing.id);
    await sleep(500);
  }
}

async function runPipelineCore(startedAt) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Pipeline started: ${startedAt}`);
  console.log('─'.repeat(60));

  let totalFound = 0;
  let totalNew   = 0;
  const sources  = [];

  try {
    const allResults = await runAll();

    for (const [source, listings] of Object.entries(allResults)) {
      if (!listings.length) continue;
      sources.push(source);

      let newCount = 0;
      for (const listing of listings) {
        // Reject URLs that don't look like property detail pages
        if (!isValidPropertyUrl(source, listing.url)) continue;

        // Skip if bedrooms clearly below threshold
        if (listing.bedrooms !== null && listing.bedrooms < config.search.minBedrooms) continue;
        // Price filter
        if (config.search.maxPrice && listing.price && listing.price > config.search.maxPrice) continue;

        const fresh = isNew(listing.url);
        upsertListing(listing);
        if (fresh) newCount++;
      }

      totalFound += listings.length;
      totalNew   += newCount;

      logRun(source, startedAt, new Date().toISOString(), listings.length, newCount);
      console.log(`  ${source}: ${listings.length} found, ${newCount} new`);
    }

    await geocodeNew();

    // Deduplicate listings that appear on multiple sources
    const merged = deduplicateListings();
    if (merged > 0) console.log(`  Merged ${merged} cross-source duplicates`);

    await notifyMatches();

    const stats = { total: totalFound, newMatches: totalNew, sources };
    console.log(`\nDone. Total: ${totalFound} listings, ${totalNew} new.`);
    if (totalNew > 0) await sendSummary(stats);
    return { ok: true, total: totalFound, newMatches: totalNew, sources };

  } catch (err) {
    console.error('Pipeline error:', err);
    await sendError('pipeline', err.message);
    return { ok: false, error: err.message, total: totalFound, newMatches: totalNew, sources };
  }
}

function startPipeline(options = {}) {
  const trigger = options.trigger || 'unknown';

  if (activeRunPromise) {
    console.log(`Pipeline already in progress, skipping ${trigger} trigger.`);
    return { started: false, status: getScrapeStatus(), promise: activeRunPromise };
  }

  scrapeState.running = true;
  scrapeState.start = new Date().toISOString();
  scrapeState.finish = null;
  scrapeState.error = null;
  scrapeState.trigger = trigger;

  const startedAt = scrapeState.start;
  activeRunPromise = runPipelineCore(startedAt)
    .then((result) => {
      scrapeState.running = false;
      scrapeState.finish = new Date().toISOString();
      scrapeState.error = result.ok ? null : (result.error || 'Unknown pipeline error');
      return result;
    })
    .catch((err) => {
      scrapeState.running = false;
      scrapeState.finish = new Date().toISOString();
      scrapeState.error = err.message || 'Unknown pipeline error';
      return { ok: false, error: scrapeState.error, total: 0, newMatches: 0, sources: [] };
    })
    .finally(() => {
      activeRunPromise = null;
    });

  return { started: true, status: getScrapeStatus(), promise: activeRunPromise };
}

async function runPipeline(options = {}) {
  const run = startPipeline(options);
  if (!run.started) {
    return { ok: true, started: false, skipped: true, status: run.status };
  }

  const result = await run.promise;
  return { ...result, started: true, status: getScrapeStatus() };
}

module.exports = { runPipeline, startPipeline, getScrapeStatus, geocodeNew, notifyMatches };
