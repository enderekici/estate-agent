// Uses Node.js built-in SQLite (v22+) — no native compilation required
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const configuredDbPath = config.db && config.db.path ? config.db.path : path.join(__dirname, '../data/listings.db');
const DB_PATH = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(__dirname, '..', configuredDbPath);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    url         TEXT UNIQUE NOT NULL,
    address     TEXT,
    price       INTEGER,
    bedrooms    INTEGER,
    prop_type   TEXT,
    thumbnail   TEXT,
    lat         REAL,
    lng         REAL,
    dist_school REAL,
    dist_centre REAL,
    matches     INTEGER DEFAULT 0,
    notified    INTEGER DEFAULT 0,
    seen        INTEGER DEFAULT 0,
    favourite   INTEGER DEFAULT 0,
    notes       TEXT DEFAULT '',
    price_history TEXT DEFAULT '[]',
    first_seen  TEXT DEFAULT (datetime('now')),
    last_seen   TEXT DEFAULT (datetime('now')),
    duplicate_of TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS scrape_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT,
    started_at   TEXT,
    finished_at  TEXT,
    found        INTEGER DEFAULT 0,
    new_count    INTEGER DEFAULT 0,
    error        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_listings_price_bedrooms ON listings(price, bedrooms);
  CREATE INDEX IF NOT EXISTS idx_listings_duplicate_of ON listings(duplicate_of);
  CREATE INDEX IF NOT EXISTS idx_listings_seen_matches ON listings(seen, matches);
  CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
`);

// Add duplicate_of column if upgrading from older schema
try { db.exec('ALTER TABLE listings ADD COLUMN duplicate_of TEXT DEFAULT NULL'); } catch (_) {}

// ── helpers ────────────────────────────────────────────────────────────────

const stmtUpsert = db.prepare(`
  INSERT INTO listings (id, source, url, address, price, bedrooms, prop_type, thumbnail)
  VALUES (:id, :source, :url, :address, :price, :bedrooms, :prop_type, :thumbnail)
  ON CONFLICT(url) DO UPDATE SET
    last_seen = datetime('now'),
    price = CASE WHEN :price IS NOT NULL THEN :price ELSE listings.price END,
    price_history = CASE WHEN :price IS NOT NULL AND listings.price IS NOT NULL AND :price != listings.price
      THEN json_insert(listings.price_history, '$[#]', json_object('date', datetime('now'), 'price', :price))
      ELSE listings.price_history END,
    address  = CASE
      WHEN :address IS NULL THEN listings.address
      WHEN listings.address IS NULL THEN :address
      WHEN instr(listings.address, ',') = 0 AND instr(:address, ',') > 0 THEN :address
      WHEN length(:address) > length(listings.address) THEN :address
      ELSE listings.address
    END,
    bedrooms = CASE WHEN :bedrooms IS NOT NULL THEN :bedrooms ELSE listings.bedrooms END,
    prop_type = CASE WHEN :prop_type IS NOT NULL THEN :prop_type ELSE listings.prop_type END,
    thumbnail= CASE WHEN :thumbnail IS NOT NULL THEN :thumbnail ELSE listings.thumbnail END
`);

function upsertListing(row) {
  stmtUpsert.run({
    id: row.id, source: row.source, url: row.url,
    address: row.address || null, price: row.price || null,
    bedrooms: row.bedrooms || null, prop_type: row.prop_type || null,
    thumbnail: row.thumbnail || null,
  });
}

function updateGeo(id, lat, lng, distSchool, distCentre, matches) {
  db.prepare(`
    UPDATE listings SET lat=:lat, lng=:lng, dist_school=:ds, dist_centre=:dc, matches=:m
    WHERE id=:id
  `).run({ lat, lng, ds: distSchool, dc: distCentre, m: matches ? 1 : 0, id });
}

/**
 * Cross-source deduplication: mark a listing as a duplicate of an existing one
 * when they have the same price + very similar address.
 * The canonical listing is the one seen first (lowest first_seen timestamp).
 */
function normalizeAddressForDedupe(address) {
  return String(address || '')
    .toLowerCase()
    .replace(/\b(united kingdom|surrey|hampshire)\b/g, ' ')
    .replace(/\bgu\d[a-z0-9 ]*\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateListings() {
  // Strategy 1: Find listings with same price and bedrooms, check address similarity
  const priceBedCandidates = db.prepare(`
    SELECT a.id as aid, a.address as aaddr, a.source as asrc, a.first_seen as afirst,
           a.prop_type as atype, a.thumbnail as athumb,
           b.id as bid, b.address as baddr, b.source as bsrc, b.first_seen as bfirst,
           b.prop_type as btype, b.thumbnail as bthumb
    FROM listings a JOIN listings b
      ON a.price = b.price
      AND a.bedrooms = b.bedrooms
      AND (
        a.first_seen < b.first_seen OR
        (a.first_seen = b.first_seen AND a.id < b.id)
      )
      AND a.duplicate_of IS NULL
      AND b.duplicate_of IS NULL
      AND a.price IS NOT NULL
      AND a.bedrooms IS NOT NULL
  `).all();

  // Strategy 2: Find cross-source listings with exact same normalized address
  // (catches duplicates where price or bedrooms is NULL on one side)
  const addressCandidates = db.prepare(`
    SELECT a.id as aid, a.address as aaddr, a.source as asrc, a.first_seen as afirst,
           a.prop_type as atype, a.thumbnail as athumb, a.price as aprice, a.bedrooms as abeds,
           b.id as bid, b.address as baddr, b.source as bsrc, b.first_seen as bfirst,
           b.prop_type as btype, b.thumbnail as bthumb, b.price as bprice, b.bedrooms as bbeds
    FROM listings a JOIN listings b
      ON a.source != b.source
      AND (
        a.first_seen < b.first_seen OR
        (a.first_seen = b.first_seen AND a.id < b.id)
      )
      AND a.duplicate_of IS NULL
      AND b.duplicate_of IS NULL
      AND a.address IS NOT NULL
      AND b.address IS NOT NULL
      AND (a.price IS NULL OR b.price IS NULL OR a.price = b.price)
      AND (a.bedrooms IS NULL OR b.bedrooms IS NULL OR a.bedrooms = b.bedrooms)
  `).all();

  let merged = 0;
  const alreadyMerged = new Set();
  const stmtDup = db.prepare('UPDATE listings SET duplicate_of=? WHERE id=?');
  const stmtBackfill = db.prepare(`
    UPDATE listings SET
      prop_type = CASE WHEN prop_type IS NULL AND ?1 IS NOT NULL THEN ?1 ELSE prop_type END,
      thumbnail = CASE WHEN thumbnail IS NULL AND ?2 IS NOT NULL THEN ?2 ELSE thumbnail END
    WHERE id=?3
  `);

  function markDuplicate(row) {
    if (alreadyMerged.has(row.bid)) return;
    stmtDup.run(row.aid, row.bid);
    stmtBackfill.run(row.btype, row.bthumb, row.aid);
    alreadyMerged.add(row.bid);
    merged++;
  }

  // Process price+beds matches (existing logic)
  for (const row of priceBedCandidates) {
    if (!row.aaddr || !row.baddr) continue;
    const a = normalizeAddressForDedupe(row.aaddr);
    const b = normalizeAddressForDedupe(row.baddr);
    if (!a || !b) continue;

    if (a === b) {
      markDuplicate(row);
      continue;
    }

    const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
    const common = [...wordsA].filter(w => wordsB.has(w));
    if (row.asrc !== row.bsrc && common.length >= 2) {
      markDuplicate(row);
    }
  }

  // Process address-only matches (catches NULL price/beds cases)
  for (const row of addressCandidates) {
    const a = normalizeAddressForDedupe(row.aaddr);
    const b = normalizeAddressForDedupe(row.baddr);
    if (!a || !b || a.length < 10) continue; // skip very short addresses like "farnham surrey"

    if (a === b) {
      markDuplicate(row);
    }
  }

  return merged;
}

function getUngeocoded() {
  return db.prepare('SELECT id, address FROM listings WHERE lat IS NULL AND duplicate_of IS NULL').all();
}

function getPendingNotifications() {
  return db.prepare(`
    SELECT * FROM listings
    WHERE notified=0 AND matches=1 AND duplicate_of IS NULL
    ORDER BY first_seen DESC
  `).all();
}

function getAllListings(filters = {}) {
  const clauses = ['duplicate_of IS NULL'];
  const params = [];

  if (filters.matches !== undefined) {
    clauses.push('matches=?');
    params.push(filters.matches ? 1 : 0);
  }
  if (filters.favourite) {
    clauses.push('favourite=1');
  }
  if (filters.unseen) {
    clauses.push('seen=0');
  }
  if (filters.source) {
    clauses.push('source=?');
    params.push(String(filters.source));
  }

  const minBeds = Number.parseInt(filters.minBeds, 10);
  if (Number.isFinite(minBeds) && minBeds > 0) {
    clauses.push('(bedrooms IS NULL OR bedrooms>=?)');
    params.push(minBeds);
  }

  const maxPrice = Number.parseInt(filters.maxPrice, 10);
  if (Number.isFinite(maxPrice) && maxPrice > 0) {
    clauses.push('(price IS NULL OR price<=?)');
    params.push(maxPrice);
  }

  const sql = `SELECT * FROM listings WHERE ${clauses.join(' AND ')} ORDER BY seen ASC, matches DESC, first_seen DESC LIMIT 500`;
  return db.prepare(sql).all(...params);
}

function getListingStats() {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN matches=1 THEN 1 ELSE 0 END), 0) AS matched,
      COALESCE(SUM(CASE WHEN favourite=1 THEN 1 ELSE 0 END), 0) AS favourites,
      COALESCE(SUM(CASE WHEN seen=0 THEN 1 ELSE 0 END), 0) AS unseen,
      COALESCE(SUM(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END), 0) AS geocoded,
      COALESCE(SUM(CASE WHEN lat IS NULL OR lng IS NULL THEN 1 ELSE 0 END), 0) AS ungeocoded
    FROM listings
    WHERE duplicate_of IS NULL
  `).get();

  const duplicates = db.prepare('SELECT COUNT(*) AS n FROM listings WHERE duplicate_of IS NOT NULL').get().n;
  const sources = db.prepare('SELECT DISTINCT source FROM listings WHERE duplicate_of IS NULL ORDER BY source').all()
    .map((row) => row.source);

  return {
    total: counts.total,
    matched: counts.matched,
    favourites: counts.favourites,
    unseen: counts.unseen,
    sources,
    duplicates,
    geocoded: counts.geocoded,
    ungeocoded: counts.ungeocoded,
    mapCoverage: { geocoded: counts.geocoded, ungeocoded: counts.ungeocoded },
  };
}

function logRun(source, startedAt, finishedAt, found, newCount, error = null) {
  db.prepare(`
    INSERT INTO scrape_runs (source, started_at, finished_at, found, new_count, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(source, startedAt, finishedAt, found, newCount, error);
  db.prepare("DELETE FROM scrape_runs WHERE started_at < datetime('now', '-60 days')").run();
}

function isNew(url) {
  return !db.prepare('SELECT 1 FROM listings WHERE url=?').get(url);
}

module.exports = {
  db,
  upsertListing,
  updateGeo,
  getUngeocoded,
  getPendingNotifications,
  getAllListings,
  getListingStats,
  deduplicateListings,
  normalizeAddressForDedupe,
  logRun,
  isNew,
  markNotified: (id) => db.prepare('UPDATE listings SET notified=1 WHERE id=?').run(id),
  markSeen:     (id) => db.prepare('UPDATE listings SET seen=1    WHERE id=?').run(id),
  toggleFav:    (id) => db.prepare('UPDATE listings SET favourite = 1 - favourite WHERE id=?').run(id),
  setNotes:     (id, notes) => db.prepare('UPDATE listings SET notes=? WHERE id=?').run(notes, id),
};
