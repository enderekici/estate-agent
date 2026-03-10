const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { loadModule } = require('./helpers/module-loader');

const DB_MODULE_PATH = path.join(__dirname, '..', 'src', 'db.js');
const SERVER_MODULE_PATH = path.join(__dirname, '..', 'src', 'dashboard', 'server.js');

function createIsolatedDbModule(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estate-agent-apitest-'));
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
    address: row.address,
    price: row.price,
    bedrooms: row.bedrooms,
    prop_type: null,
    thumbnail: null,
  });

  dbModule.db.prepare(`
    UPDATE listings SET matches=?, seen=?, lat=?, lng=?
    WHERE id=?
  `).run(row.matches ?? 0, row.seen ?? 0, row.lat ?? null, row.lng ?? null, row.id);
}

async function startServerInTestMode(t) {
  const dbModule = createIsolatedDbModule(t);

  seedListing(dbModule, {
    id: 'api-listing-1',
    source: 'rightmove',
    url: 'https://rightmove.test/api-1',
    address: '42 South Street Farnham',
    price: 450000,
    bedrooms: 3,
    matches: 1,
    seen: 0,
    lat: 51.21,
    lng: -0.79,
  });

  const statusSnapshot = {
    running: false,
    start: null,
    finish: null,
    error: null,
    trigger: 'test',
    startedAt: null,
    finishedAt: null,
  };

  const pipelineStub = {
    startPipeline() {
      return {
        started: false,
        status: statusSnapshot,
        promise: Promise.resolve({ ok: true, started: false }),
      };
    },
    getScrapeStatus() {
      return statusSnapshot;
    },
  };

  const configStub = {
    search: { location: 'Farnham', minBedrooms: 3, maxPrice: null },
    school: {
      name: 'Highfield South Farnham School',
      lat: 51.2064465,
      lng: -0.8030390,
      maxWalkingMiles: 1.2,
    },
    townCentre: {
      name: 'Farnham town centre',
      lat: 51.2152435,
      lng: -0.7982083,
      radiusMiles: 0.5,
    },
    dashboard: { port: 0 },
  };
  let dashboard;
  let server;

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  try {
    dashboard = loadModule(SERVER_MODULE_PATH, {
      stubs: {
        '../db': dbModule,
        '../pipeline': pipelineStub,
        '../../config': configStub,
      },
    });
    server = dashboard.start(configStub.dashboard.port);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }

  assert.ok(server, 'Expected dashboard server to start during module load.');
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    if (dashboard && typeof dashboard.stop === 'function') {
      await dashboard.stop();
    } else if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  return { server };
}

async function getJson(server, pathname) {
  const address = server.address();
  assert.ok(address && typeof address.port === 'number', 'Server did not expose a valid listening port.');

  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`);
  const json = await response.json();
  return { response, json };
}

test('scrape status endpoint returns expected contract shape in test mode', async (t) => {
  const { server } = await startServerInTestMode(t);
  const { response, json } = await getJson(server, '/api/scrape/status');

  assert.equal(response.status, 200);
  assert.equal(typeof json, 'object');
  assert.equal(typeof json.running, 'boolean');
  assert.ok(Object.hasOwn(json, 'start'));
  assert.ok(Object.hasOwn(json, 'finish'));
  assert.ok(Object.hasOwn(json, 'error'));
  assert.ok(Object.hasOwn(json, 'trigger'));
  assert.ok(Object.hasOwn(json, 'startedAt'));
  assert.ok(Object.hasOwn(json, 'finishedAt'));
});

test('listings and stats endpoints return stable basic response structures', async (t) => {
  const { server } = await startServerInTestMode(t);

  const listingsResult = await getJson(server, '/api/listings');
  assert.equal(listingsResult.response.status, 200);
  assert.ok(Array.isArray(listingsResult.json));
  assert.equal(listingsResult.json.length, 1);
  assert.equal(typeof listingsResult.json[0].id, 'string');
  assert.equal(typeof listingsResult.json[0].source, 'string');
  assert.equal(typeof listingsResult.json[0].url, 'string');
  assert.ok(Array.isArray(listingsResult.json[0].also_on));

  const statsResult = await getJson(server, '/api/stats');
  assert.equal(statsResult.response.status, 200);
  assert.equal(typeof statsResult.json.total, 'number');
  assert.equal(typeof statsResult.json.unseen, 'number');
  assert.ok(Array.isArray(statsResult.json.sources));
  assert.equal(typeof statsResult.json.duplicates, 'number');
  assert.ok(statsResult.json.mapCoverage && typeof statsResult.json.mapCoverage === 'object');
  assert.equal(typeof statsResult.json.mapCoverage.geocoded, 'number');
  assert.equal(typeof statsResult.json.mapCoverage.ungeocoded, 'number');
});

test('config endpoint exposes map anchor coordinates', async (t) => {
  const { server } = await startServerInTestMode(t);
  const { response, json } = await getJson(server, '/api/config');

  assert.equal(response.status, 200);
  assert.equal(json.location, 'Farnham');
  assert.equal(json.school.name, 'Highfield South Farnham School');
  assert.equal(typeof json.school.lat, 'number');
  assert.equal(typeof json.school.lng, 'number');
  assert.equal(json.townCentre.name, 'Farnham town centre');
  assert.equal(typeof json.townCentre.lat, 'number');
  assert.equal(typeof json.townCentre.lng, 'number');
});
