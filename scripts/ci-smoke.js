#!/usr/bin/env node
'use strict';

const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const projectRoot = path.resolve(__dirname, '..');
const startupTimeoutMs = 15000;
const shutdownTimeoutMs = 5000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(route) {
  const response = await fetch(`${globalThis.__smokeBaseUrl}${route}`, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`GET ${route} returned HTTP ${response.status}`);
  }

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`GET ${route} did not return JSON`);
  }
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close((err) => {
        if (err) return reject(err);
        resolve(port);
      });
    });
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dashboard server exited early with code ${child.exitCode}`);
    }

    try {
      await fetchJson('/api/stats');
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new Error(`Dashboard server failed to start within ${startupTimeoutMs}ms: ${lastError ? lastError.message : 'unknown error'}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;

  child.kill('SIGTERM');
  const shutdownDeadline = Date.now() + shutdownTimeoutMs;
  while (child.exitCode === null && Date.now() < shutdownDeadline) {
    await delay(100);
  }

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function run() {
  const stdout = [];
  const stderr = [];
  const port = await getFreePort();
  globalThis.__smokeBaseUrl = `http://127.0.0.1:${port}`;

  const server = spawn(process.execPath, ['src/dashboard/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DASHBOARD_PORT: String(port),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    stdout.push(chunk.toString());
  });

  server.stderr.on('data', (chunk) => {
    stderr.push(chunk.toString());
  });

  try {
    await waitForServer(server);

    const stats = await fetchJson('/api/stats');
    assert(stats && typeof stats === 'object', '/api/stats response must be an object');
    assert(typeof stats.total === 'number', '/api/stats.total must be a number');
    assert(typeof stats.unseen === 'number', '/api/stats.unseen must be a number');

    const config = await fetchJson('/api/config');
    assert(config && typeof config === 'object', '/api/config response must be an object');
    assert(typeof config.minBedrooms === 'number', '/api/config.minBedrooms must be a number');
    assert(config.maxPrice === null || typeof config.maxPrice === 'number', '/api/config.maxPrice must be null or number');

    const listings = await fetchJson('/api/listings');
    assert(Array.isArray(listings), '/api/listings response must be an array');

    const scrapeStatus = await fetchJson('/api/scrape/status');
    assert(scrapeStatus && typeof scrapeStatus === 'object', '/api/scrape/status response must be an object');
    assert(typeof scrapeStatus.running === 'boolean', '/api/scrape/status.running must be a boolean');
  } catch (error) {
    const output = [
      `Smoke test failed: ${error.message}`,
      '',
      'Server stdout:',
      stdout.join('').trim() || '(empty)',
      '',
      'Server stderr:',
      stderr.join('').trim() || '(empty)',
    ].join('\n');
    throw new Error(output);
  } finally {
    await stopServer(server);
  }
}

run()
  .then(() => {
    console.log('Smoke checks passed against dashboard API on localhost.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
