const { db, updateGeo } = require('../src/db');
const { geocode, distanceToSchool, distanceToTownCentre, meetsLocationCriteria } = require('../src/geocoder');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    source: null,
    limit: null,
    delayMs: 1800,
  };

  for (const arg of argv) {
    if (arg.startsWith('--source=')) options.source = arg.slice('--source='.length) || null;
    else if (arg.startsWith('--limit=')) options.limit = Number.parseInt(arg.slice('--limit='.length), 10) || null;
    else if (arg.startsWith('--delay-ms=')) options.delayMs = Number.parseInt(arg.slice('--delay-ms='.length), 10) || options.delayMs;
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const clauses = ['lat IS NULL', 'duplicate_of IS NULL', 'address IS NOT NULL'];
  const params = [];

  if (options.source) {
    clauses.push('source = ?');
    params.push(options.source);
  }

  let sql = `
    SELECT id, source, address
    FROM listings
    WHERE ${clauses.join(' AND ')}
    ORDER BY last_seen DESC
  `;
  if (options.limit) sql += ` LIMIT ${options.limit}`;

  const rows = db.prepare(sql).all(...params);
  console.log(`Backfilling ${rows.length} listing(s)${options.source ? ` for source=${options.source}` : ''}...`);

  let updated = 0;
  let missed = 0;

  for (const row of rows) {
    const coords = await geocode(row.address);
    if (coords) {
      const distSchool = distanceToSchool(coords.lat, coords.lng);
      const distCentre = distanceToTownCentre(coords.lat, coords.lng);
      const matches = meetsLocationCriteria(coords.lat, coords.lng);
      updateGeo(row.id, coords.lat, coords.lng, distSchool, distCentre, matches);
      updated += 1;
      console.log(`updated [${row.source}] ${row.address}`);
    } else {
      missed += 1;
      console.log(`missed  [${row.source}] ${row.address}`);
    }

    await sleep(options.delayMs);
  }

  console.log(JSON.stringify({ updated, missed, total: rows.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
