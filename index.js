require('dotenv').config();
const { resolveSchoolCoords } = require('./src/geocoder');
const { start: startScheduler } = require('./src/scheduler');

// Start the dashboard server
require('./src/dashboard/server');

async function main() {
  console.log('🏠 Farnham Home Finder starting...');
  console.log('────────────────────────────────────');

  // Resolve school coordinates from OSM for accuracy
  await resolveSchoolCoords();

  // Start the scraping scheduler (also runs immediately)
  startScheduler();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
