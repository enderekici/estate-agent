const cheerio = require('cheerio');
const config = require('../../config');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

async function loadPage(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return cheerio.load(html);
}

function resolveUrl(base, href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${base}${href.startsWith('/') ? '' : '/'}${href}`;
}

function randomDelay() {
  const ms = Math.floor(
    Math.random() * (config.scraper.maxDelay - config.scraper.minDelay + 1)
  ) + config.scraper.minDelay;
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { loadPage, resolveUrl, randomDelay };
