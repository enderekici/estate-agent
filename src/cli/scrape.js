require('dotenv').config();
const { resolveSchoolCoords } = require('../geocoder');
const { runPipeline } = require('../pipeline');

async function main() {
  console.log('Starting manual scrape pipeline...');
  await resolveSchoolCoords();

  const result = await runPipeline({ trigger: 'cli' });
  if (!result.started) {
    console.log('Pipeline already running, skipping CLI run.');
    return;
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Scrape CLI error:', err);
  process.exit(1);
});
