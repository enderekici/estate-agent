const cron = require('node-cron');
const config = require('../config');
const { startPipeline } = require('./pipeline');

function start() {
  console.log(`\nScheduler started. Cron: "${config.scheduler.cron}"`);
  console.log('Running first scrape now...\n');

  // Run immediately on start
  runSafe();

  // Then on schedule
  cron.schedule(config.scheduler.cron, runSafe, { timezone: 'Europe/London' });
}

function runSafe() {
  const run = startPipeline({ trigger: 'scheduler' });
  if (!run.started) {
    console.log('Scheduled scrape skipped: pipeline already in progress.');
    return;
  }
  run.promise.catch((err) => {
    console.error('Scheduled scrape failed:', err);
  });
}

module.exports = { start };
