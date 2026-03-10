const { newPage, randomDelay } = require('./browser');
const crypto = require('crypto');
const { buildOnTheMarketUrl } = require('./search-url-builders');

const SOURCE = 'onthemarket';
const BASE_URL = buildOnTheMarketUrl();

function normalizeDeveloperAddress(address) {
  const input = String(address || '').replace(/\s+/g, ' ').trim();
  if (!input) return null;

  const plotAtMatch = input.match(/^Plot\s+\d+\s*,\s*([^,]+?)\s+at\s+([^,]+),\s*(.+)$/i);
  if (plotAtMatch) {
    const development = plotAtMatch[2].trim();
    const tail = plotAtMatch[3].trim();
    const locality = /\bfarnham\b/i.test(tail) ? tail : `${tail}, Farnham, Surrey`;
    return `${development}, ${locality}`.replace(/\s+/g, ' ').trim();
  }

  return input;
}

function parseCardTitle(title) {
  const input = String(title || '').trim();
  if (!input) return { address: null, bedrooms: null, propType: null };

  const cleaned = input.replace(/^View the details for\s+/i, '').trim();
  const match = cleaned.match(/^(.*?)\s*-\s*(\d+)\s+bedroom\s+(.+?)\s+for\s+sale$/i);
  if (!match) return { address: cleaned || null, bedrooms: null, propType: null };

  return {
    address: normalizeDeveloperAddress(match[1].trim()) || null,
    bedrooms: Number.parseInt(match[2], 10),
    propType: match[3].trim() || null,
  };
}

async function scrape() {
  const page = await newPage();
  const listings = [];

  try {
    let pageNum = 1;
    let hasMore = true;

    while (hasMore) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}&page=${pageNum}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay();

      try {
        const btn = await page.$('#onetrust-accept-btn-handler');
        if (btn) { await btn.click(); await page.waitForTimeout(1000); }
      } catch (_) {}

      // OTM uses article cards with a stable data-component marker.
      try {
        await page.waitForSelector('article[data-component="search-result-property-card"] a[href*="/details/"]', { timeout: 10000 });
      } catch (_) {}

      const results = await page.evaluate(() => {
        const parseCardTitle = (title) => {
          const input = String(title || '').trim();
          if (!input) return { address: null, bedrooms: null, propType: null };

          const cleaned = input.replace(/^View the details for\s+/i, '').trim();
          const match = cleaned.match(/^(.*?)\s*-\s*(\d+)\s+bedroom\s+(.+?)\s+for\s+sale$/i);
          if (!match) return { address: cleaned || null, bedrooms: null, propType: null };

          return {
            address: match[1].trim() || null,
            bedrooms: Number.parseInt(match[2], 10),
            propType: match[3].trim() || null,
          };
        };

        const cards = Array.from(document.querySelectorAll('article[data-component="search-result-property-card"]'));
        const seen = new Set();
        return cards.map((card) => {
          const linkEl = card.querySelector('a[href*="/details/"]');
          const href = linkEl?.href;
          if (!href || seen.has(href)) return null;
          seen.add(href);

          const fullText = card.textContent || '';
          const priceMatch = fullText.match(/£([\d,]+)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
          const titleInfo = parseCardTitle(card.getAttribute('title'));
          const imgEl = card.querySelector('img[src*="media.onthemarket.com/properties/"]');

          return {
            url:       href,
            address:   titleInfo.address,
            price,
            bedrooms:  titleInfo.bedrooms,
            prop_type: titleInfo.propType,
            thumbnail: imgEl?.src || null,
          };
        }).filter(r => r && r.url?.includes('/details/'));
      });

      results.forEach(r => listings.push({ ...r, source: SOURCE, id: crypto.createHash('md5').update(r.url).digest('hex') }));

      // OTM pagination
      const nextBtn = await page.$('a[rel="next"], [aria-label="Next page"], button[aria-label="Next"]');
      hasMore = !!nextBtn && results.length > 0 && pageNum < 10;
      pageNum++;
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }

  return listings;
}

module.exports = { scrape, SOURCE, parseCardTitle, normalizeDeveloperAddress };
