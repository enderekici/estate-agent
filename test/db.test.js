const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadModule } = require('./helpers/module-loader');

const DB_MODULE_PATH = path.join(__dirname, '..', 'src', 'db.js');

function createIsolatedDbModule(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estate-agent-dbtest-'));
  const dbPath = path.join(tempDir, 'listings.db');
  const dbModule = loadModule(DB_MODULE_PATH, {
    stubs: {
      '../config': {
        db: { path: dbPath },
      },
    },
  });

  t.after(() => {
    if (dbModule.db && typeof dbModule.db.close === 'function') {
      dbModule.db.close();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  return dbModule;
}

function seedListing(dbModule, row) {
  dbModule.upsertListing({
    id: row.id,
    source: row.source,
    url: row.url,
    address: row.address || null,
    price: row.price ?? null,
    bedrooms: row.bedrooms ?? null,
    prop_type: row.propType || null,
    thumbnail: row.thumbnail || null,
  });

  dbModule.db.prepare(`
    UPDATE listings
    SET
      matches = COALESCE(?, matches),
      seen = COALESCE(?, seen),
      favourite = COALESCE(?, favourite),
      active = COALESCE(?, active),
      lat = ?,
      lng = ?,
      first_seen = COALESCE(?, first_seen),
      duplicate_of = ?
    WHERE id = ?
  `).run(
    row.matches ?? null,
    row.seen ?? null,
    row.favourite ?? null,
    row.active ?? null,
    row.lat ?? null,
    row.lng ?? null,
    row.firstSeen ?? null,
    row.duplicateOf ?? null,
    row.id
  );
}

test('unseen filter returns all unseen listings, not only matches', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'unseen-unmatched',
    source: 'rightmove',
    url: 'https://rightmove.test/1',
    address: '1 Cedar Lane Farnham',
    price: 400000,
    bedrooms: 3,
    seen: 0,
    matches: 0,
  });
  seedListing(dbModule, {
    id: 'unseen-matched',
    source: 'zoopla',
    url: 'https://zoopla.test/2',
    address: '2 Cedar Lane Farnham',
    price: 420000,
    bedrooms: 3,
    seen: 0,
    matches: 1,
  });
  seedListing(dbModule, {
    id: 'seen-matched',
    source: 'savills',
    url: 'https://savills.test/3',
    address: '3 Cedar Lane Farnham',
    price: 430000,
    bedrooms: 3,
    seen: 1,
    matches: 1,
  });

  const unseen = dbModule.getAllListings({ unseen: true });
  const unseenIds = unseen.map((listing) => listing.id).sort();

  assert.deepEqual(unseenIds, ['unseen-matched', 'unseen-unmatched']);
  assert.ok(unseen.some((listing) => listing.id === 'unseen-unmatched' && listing.matches === 0));
  assert.ok(unseen.some((listing) => listing.id === 'unseen-matched' && listing.matches === 1));
  assert.ok(!unseen.some((listing) => listing.id === 'seen-matched'));
});

test('listings are ordered with unseen above seen', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'seen-matched',
    source: 'rightmove',
    url: 'https://rightmove.test/seen-matched',
    address: '1 Oak Lane Farnham',
    price: 450000,
    bedrooms: 3,
    seen: 1,
    matches: 1,
    firstSeen: '2024-01-04 10:00:00',
  });
  seedListing(dbModule, {
    id: 'unseen-unmatched',
    source: 'zoopla',
    url: 'https://zoopla.test/unseen-unmatched',
    address: '2 Oak Lane Farnham',
    price: 455000,
    bedrooms: 3,
    seen: 0,
    matches: 0,
    firstSeen: '2024-01-03 10:00:00',
  });
  seedListing(dbModule, {
    id: 'seen-unmatched',
    source: 'savills',
    url: 'https://savills.test/seen-unmatched',
    address: '3 Oak Lane Farnham',
    price: 460000,
    bedrooms: 3,
    seen: 1,
    matches: 0,
    firstSeen: '2024-01-02 10:00:00',
  });
  seedListing(dbModule, {
    id: 'unseen-matched',
    source: 'hamptons',
    url: 'https://hamptons.test/unseen-matched',
    address: '4 Oak Lane Farnham',
    price: 465000,
    bedrooms: 3,
    seen: 0,
    matches: 1,
    firstSeen: '2024-01-01 10:00:00',
  });

  const orderedIds = dbModule.getAllListings().map((listing) => listing.id);

  assert.deepEqual(orderedIds, [
    'unseen-matched',
    'unseen-unmatched',
    'seen-matched',
    'seen-unmatched',
  ]);
});

test('stats include map coverage fields with consistent counts', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'geo-a',
    source: 'rightmove',
    url: 'https://rightmove.test/geo-a',
    address: '10 Oak Road Farnham',
    price: 500000,
    bedrooms: 4,
    lat: 51.2,
    lng: -0.8,
  });
  seedListing(dbModule, {
    id: 'geo-b',
    source: 'zoopla',
    url: 'https://zoopla.test/geo-b',
    address: '11 Oak Road Farnham',
    price: 510000,
    bedrooms: 4,
  });
  seedListing(dbModule, {
    id: 'geo-dup',
    source: 'savills',
    url: 'https://savills.test/geo-dup',
    address: '10 Oak Road Farnham',
    price: 500000,
    bedrooms: 4,
    duplicateOf: 'geo-a',
  });

  const stats = dbModule.getListingStats();

  assert.equal(typeof stats.total, 'number');
  assert.equal(typeof stats.geocoded, 'number');
  assert.equal(typeof stats.ungeocoded, 'number');
  assert.equal(stats.total, 2);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.geocoded, 1);
  assert.equal(stats.ungeocoded, 1);

  assert.ok(stats.mapCoverage && typeof stats.mapCoverage === 'object');
  assert.equal(stats.mapCoverage.geocoded, stats.geocoded);
  assert.equal(stats.mapCoverage.ungeocoded, stats.ungeocoded);
});

test('source filter safely handles quote-like injection input', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'src-rightmove',
    source: 'rightmove',
    url: 'https://rightmove.test/source-safe',
    address: '20 Maple Avenue Farnham',
    price: 375000,
    bedrooms: 3,
  });
  seedListing(dbModule, {
    id: 'src-zoopla',
    source: 'zoopla',
    url: 'https://zoopla.test/source-safe',
    address: '21 Maple Avenue Farnham',
    price: 380000,
    bedrooms: 3,
  });

  const injected = "rightmove' OR 1=1 --";
  const filtered = dbModule.getAllListings({ source: injected });
  assert.equal(filtered.length, 0);

  const rightmoveOnly = dbModule.getAllListings({ source: 'rightmove' });
  assert.equal(rightmoveOnly.length, 1);
  assert.equal(rightmoveOnly[0].id, 'src-rightmove');
});

test('inactive and broken rows are hidden from listing queries and stats', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'visible-row',
    source: 'rightmove',
    url: 'https://rightmove.test/visible',
    address: '10 South Street, Farnham, GU9',
    price: 450000,
    bedrooms: 3,
  });
  seedListing(dbModule, {
    id: 'inactive-row',
    source: 'zoopla',
    url: 'https://zoopla.test/inactive',
    address: '11 South Street, Farnham, GU9',
    price: 455000,
    bedrooms: 3,
    active: 0,
  });
  seedListing(dbModule, {
    id: 'broken-row',
    source: 'gascoignepees',
    url: 'https://gpees.test/broken',
    address: null,
    price: null,
    bedrooms: 3,
  });

  const listings = dbModule.getAllListings();
  assert.deepEqual(listings.map((listing) => listing.id), ['visible-row']);

  const stats = dbModule.getListingStats();
  assert.equal(stats.total, 1);
  assert.deepEqual(stats.sources, ['rightmove']);
});

test('deduplicate chooses the listing with earliest first_seen as canonical', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'late-listing',
    source: 'rightmove',
    url: 'https://rightmove.test/dedupe-late',
    address: '10 Cedar Lane Farnham Surrey',
    price: 600000,
    bedrooms: 4,
    firstSeen: '2024-01-02 10:00:00',
  });
  seedListing(dbModule, {
    id: 'early-listing',
    source: 'zoopla',
    url: 'https://zoopla.test/dedupe-early',
    address: '10 Cedar Lane, Farnham, Surrey GU9',
    price: 600000,
    bedrooms: 4,
    firstSeen: '2024-01-01 10:00:00',
  });

  const merged = dbModule.deduplicateListings();
  assert.equal(merged, 1);

  const lateRow = dbModule.db.prepare('SELECT duplicate_of FROM listings WHERE id=?').get('late-listing');
  const earlyRow = dbModule.db.prepare('SELECT duplicate_of FROM listings WHERE id=?').get('early-listing');

  assert.equal(lateRow.duplicate_of, 'early-listing');
  assert.equal(earlyRow.duplicate_of, null);
});

test('deduplicate does not merge exact same-address listings within the same source', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'same-source-earlier',
    source: 'rightmove',
    url: 'https://rightmove.test/dedupe-same-source-a',
    address: 'Water Lane, Farnham, Surrey, GU9',
    price: 450000,
    bedrooms: 3,
    firstSeen: '2024-01-01 10:00:00',
  });
  seedListing(dbModule, {
    id: 'same-source-later',
    source: 'rightmove',
    url: 'https://rightmove.test/dedupe-same-source-b',
    address: 'Water Lane, Farnham',
    price: 450000,
    bedrooms: 3,
    firstSeen: '2024-01-02 10:00:00',
  });

  const merged = dbModule.deduplicateListings();
  assert.equal(merged, 0);

  const earlier = dbModule.db.prepare('SELECT duplicate_of FROM listings WHERE id=?').get('same-source-earlier');
  const later = dbModule.db.prepare('SELECT duplicate_of FROM listings WHERE id=?').get('same-source-later');

  assert.equal(earlier.duplicate_of, null);
  assert.equal(later.duplicate_of, null);
});

test('reconcileSourceListings deactivates missing source rows and clears stale duplicate markers', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'src-a',
    source: 'gascoignepees',
    url: 'https://gpees.test/a',
    address: '1 River Lane, Farnham, GU9',
    price: 350000,
    bedrooms: 3,
  });
  seedListing(dbModule, {
    id: 'src-b',
    source: 'gascoignepees',
    url: 'https://gpees.test/b',
    address: null,
    price: null,
    bedrooms: 5,
    duplicateOf: 'src-a',
  });

  dbModule.reconcileSourceListings('gascoignepees', ['https://gpees.test/a']);

  const activeRows = dbModule.db.prepare('SELECT id, active, duplicate_of FROM listings ORDER BY id').all()
    .map((row) => ({ ...row }));
  assert.deepEqual(activeRows, [
    { id: 'src-a', active: 1, duplicate_of: null },
    { id: 'src-b', active: 0, duplicate_of: null },
  ]);
});

test('deduplicate clears stale duplicate markers before recomputing', (t) => {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'canonical',
    source: 'rightmove',
    url: 'https://rightmove.test/canonical',
    address: '1 High Street, Farnham, GU9',
    price: 500000,
    bedrooms: 3,
  });
  seedListing(dbModule, {
    id: 'former-duplicate',
    source: 'zoopla',
    url: 'https://zoopla.test/former-duplicate',
    address: '9 Other Street, Farnham, GU9',
    price: 650000,
    bedrooms: 4,
    duplicateOf: 'canonical',
  });

  const merged = dbModule.deduplicateListings();
  assert.equal(merged, 0);

  const rows = dbModule.db.prepare('SELECT id, duplicate_of FROM listings ORDER BY id').all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: 'canonical', duplicate_of: null },
    { id: 'former-duplicate', duplicate_of: null },
  ]);
});

test('upsert updates property type when a later scrape provides it', (t) => {
  const dbModule = createIsolatedDbModule(t);

  dbModule.upsertListing({
    id: 'ptype-row',
    source: 'zoopla',
    url: 'https://zoopla.test/ptype-row',
    address: '1 Cedar Lane Farnham',
    price: 450000,
    bedrooms: 3,
    prop_type: null,
    thumbnail: null,
  });

  dbModule.upsertListing({
    id: 'ptype-row',
    source: 'zoopla',
    url: 'https://zoopla.test/ptype-row',
    address: '1 Cedar Lane Farnham',
    price: 450000,
    bedrooms: 3,
    prop_type: 'Detached House',
    thumbnail: null,
  });

  const row = dbModule.db.prepare('SELECT prop_type FROM listings WHERE id=?').get('ptype-row');
  assert.equal(row.prop_type, 'Detached House');
});

test('upsert replaces weaker addresses with cleaner formatted addresses', (t) => {
  const dbModule = createIsolatedDbModule(t);

  dbModule.upsertListing({
    id: 'addr-row',
    source: 'bridges',
    url: 'https://bridges.test/addr-row',
    address: 'Fuggle Hop Close Tongham Farnham Surrey',
    price: 575000,
    bedrooms: 3,
    prop_type: 'House',
    thumbnail: null,
  });

  dbModule.upsertListing({
    id: 'addr-row',
    source: 'bridges',
    url: 'https://bridges.test/addr-row',
    address: 'Fuggle Hop Close, Tongham, Surrey, GU10',
    price: 575000,
    bedrooms: 3,
    prop_type: 'House',
    thumbnail: null,
  });

  const row = dbModule.db.prepare('SELECT address FROM listings WHERE id=?').get('addr-row');
  assert.equal(row.address, 'Fuggle Hop Close, Tongham, Surrey, GU10');
});
