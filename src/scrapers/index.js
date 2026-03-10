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
];

const { closeBrowser } = require('./browser');

/**
 * Run all scrapers sequentially and return combined results.
 */
async function runAll(options = {}) {
  const { only } = options; // optional array of source names to restrict
  const results = {};

  for (const scraper of scrapers) {
    if (only && !only.includes(scraper.SOURCE)) continue;

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
  }

  await closeBrowser();
  return results;
}

module.exports = { runAll, scrapers };
