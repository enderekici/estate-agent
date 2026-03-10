const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildGreenwoodUrl } = require('./search-url-builders');

const SOURCE = 'greenwood';
const URL = buildGreenwoodUrl();

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay();

    try {
      await page.waitForSelector('article.property, .property-item', { timeout: 8000 });
    } catch (_) {}

    const raw = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(
        'article.property, .property-item, [class*="property-card"], li.property'
      ));
      return cards.map(c => ({
        url:       (c.querySelector('a[href*="/property/"]') || c.querySelector('a') || {}).href || null,
        address:   (c.querySelector('h2, h3, [class*="address"], [class*="title"]') || {}).textContent?.trim(),
        price:     (c.querySelector('[class*="price"]') || {}).textContent?.trim(),
        bedrooms:  (c.querySelector('[class*="bed"]') || {}).textContent?.trim(),
        prop_type: (c.querySelector('[class*="type"]') || {}).textContent?.trim(),
        thumbnail: (c.querySelector('img') || {}).src,
      })).filter(r => r.url && r.url.includes('/property/'));
    });

    raw.forEach(r => listings.push(normalise({
      ...r, price: parsePrice(r.price),
      bedrooms: parseBeds((r.bedrooms || '') + ' ' + (r.address || '')),
    }, SOURCE)));
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
