const express = require('express');
const path = require('path');
const { getAllListings, getListingStats, markSeen, toggleFav, setNotes, db } = require('../db');
const { startPipeline, getScrapeStatus } = require('../pipeline');
const config = require('../../config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────

app.get('/api/listings', (req, res) => {
  const filters = {
    matches:  req.query.matches !== undefined ? req.query.matches === '1' : undefined,
    favourite: req.query.favourite === '1',
    unseen:    req.query.unseen === '1',
    source:    req.query.source || undefined,
    minBeds:   req.query.minBeds ? parseInt(req.query.minBeds) : undefined,
    // Apply query param if provided, otherwise fall back to configured max
    maxPrice:  req.query.maxPrice ? parseInt(req.query.maxPrice) : (config.search.maxPrice || undefined),
  };
  const listings = getAllListings(filters);
  // Attach duplicate sources so UI can show "Also on X" (one entry per source)
  const dupeMap = {};
  db.prepare('SELECT duplicate_of, source, url FROM listings WHERE duplicate_of IS NOT NULL').all()
    .forEach(d => {
      if (!dupeMap[d.duplicate_of]) dupeMap[d.duplicate_of] = {};
      if (!dupeMap[d.duplicate_of][d.source]) dupeMap[d.duplicate_of][d.source] = d.url;
    });
  listings.forEach(l => {
    l.also_on = Object.entries(dupeMap[l.id] || {}).map(([source, url]) => ({ source, url }));
  });
  res.json(listings);
});

app.post('/api/listings/:id/seen', (req, res) => {
  markSeen(req.params.id);
  res.json({ ok: true });
});

app.post('/api/listings/:id/favourite', (req, res) => {
  toggleFav(req.params.id);
  res.json({ ok: true });
});

app.post('/api/listings/:id/notes', (req, res) => {
  setNotes(req.params.id, req.body.notes || '');
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    maxPrice:    config.search.maxPrice || null,
    minBedrooms: config.search.minBedrooms,
    location:    config.search.location || null,
    school: config.school ? {
      name: config.school.name || null,
      lat: config.school.lat ?? null,
      lng: config.school.lng ?? null,
      maxWalkingMiles: config.school.maxWalkingMiles ?? null,
    } : null,
    townCentre: config.townCentre ? {
      name: config.townCentre.name || null,
      lat: config.townCentre.lat ?? null,
      lng: config.townCentre.lng ?? null,
      radiusMiles: config.townCentre.radiusMiles ?? null,
    } : null,
  });
});

// Trigger a manual scrape
app.post('/api/scrape', async (req, res) => {
  const run = startPipeline({ trigger: 'manual' });

  if (!run.started) {
    return res.json({
      ok: true,
      started: false,
      message: 'Scrape already running',
      status: run.status,
    });
  }

  run.promise.catch((err) => {
    console.error('Manual scrape failed:', err);
  });

  return res.status(202).json({
    ok: true,
    started: true,
    message: 'Scrape started',
    status: run.status,
  });
});

app.get('/api/scrape/status', (req, res) => {
  res.json(getScrapeStatus());
});

app.get('/api/stats', (req, res) => {
  const stats = getListingStats();
  res.json(stats);
});

// Get all sources a duplicate property appears on
app.get('/api/listings/:id/duplicates', (req, res) => {
  const rows = db.prepare('SELECT source, url FROM listings WHERE duplicate_of=?').all(req.params.id);
  res.json(rows);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

// ── Start ──────────────────────────────────────────────────────────────────

let server = null;

function start(port = config.dashboard.port) {
  if (server) return server;
  server = app.listen(port, () => {
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;
    console.log(`\nDashboard running at http://localhost:${actualPort}\n`);
  });
  return server;
}

function stop() {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) return reject(err);
      server = null;
      return resolve();
    });
  });
}

const shouldAutoStart = process.env.DASHBOARD_AUTOSTART
  ? !['0', 'false'].includes(String(process.env.DASHBOARD_AUTOSTART).toLowerCase())
  : process.env.NODE_ENV !== 'test';

if (shouldAutoStart) {
  start();
}

module.exports = app;
module.exports.start = start;
module.exports.stop = stop;
