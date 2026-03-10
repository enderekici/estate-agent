const scrapers = [
  require('./rightmove'),
  require('./zoopla'),
  require('./onthemarket'),
  require('./andrewlodge'),
  require('./bourne'),
  require('./bridges'),
  require('./charters'),
  require('./curchods'),
  require('./hamptons'),
  require('./keatsfearn'),
  require('./romans'),
  require('./savills'),
  require('./truemangrundy'),
  require('./wpr'),
  require('./winkworth'),
  require('./greenwood'),
];

const { closeBrowser } = require('./browser');

const CONCURRENCY = parseInt(process.env.SCRAPE_CONCURRENCY || '4', 10);

/**
 * Run all scrapers in parallel (bounded concurrency) and return combined results.
 */
async function runAll(options = {}) {
  const { only } = options; // optional array of source names to restrict
  const active = scrapers.filter(s => !only || only.includes(s.SOURCE));
  const results = {};

  // Process scrapers in batches of CONCURRENCY
  for (let i = 0; i < active.length; i += CONCURRENCY) {
    const batch = active.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (scraper) => {
        console.log(`  Scraping ${scraper.SOURCE}...`);
        const start = Date.now();
        try {
          const listings = await scraper.scrape();
          results[scraper.SOURCE] = listings;
          console.log(`  ✓ ${scraper.SOURCE}: ${listings.length} listings (${Date.now() - start}ms)`);
        } catch (err) {
          console.error(`  ✗ ${scraper.SOURCE}: ${err.message}`);
          results[scraper.SOURCE] = [];
        }
      })
    );
  }

  await closeBrowser();
  return results;
}

module.exports = { runAll, scrapers };
