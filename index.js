require('dotenv').config();
const { resolveSchoolCoords } = require('./src/geocoder');
const { start: startScheduler } = require('./src/scheduler');
const { closeBrowser } = require('./src/scrapers/browser');
const { db } = require('./src/db');

// Start the dashboard server
require('./src/dashboard/server');

function warnMissingConfig() {
  const missing = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.TELEGRAM_CHAT_ID)   missing.push('TELEGRAM_CHAT_ID');
  if (missing.length) {
    console.warn(`\n⚠️  Telegram not configured (missing: ${missing.join(', ')})`);
    console.warn('   Notifications will be disabled. Set these in .env to enable alerts.\n');
  }
}

async function main() {
  console.log('🏠 Farnham Home Finder starting...');
  console.log('────────────────────────────────────');

  warnMissingConfig();

  // Resolve school coordinates from OSM for accuracy
  await resolveSchoolCoords();

  // Start the scraping scheduler (also runs immediately)
  startScheduler();
}

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  closeBrowser()
    .catch(() => {})
    .finally(() => {
      try { db.close(); } catch (_) {}
      process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
