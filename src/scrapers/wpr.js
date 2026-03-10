const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildWprUrl } = require('./search-url-builders');

const SOURCE = 'wpr';
const URL = buildWprUrl();

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 35000 });
    await randomDelay();

    try {
      await page.waitForSelector('a.property-grid__image', { timeout: 10000 });
    } catch (_) {}

    const raw = await page.evaluate(() => {
      // Each property card: a.property-grid__image (image+link) + sibling div with H4/H5/SPAN
      const imageLinks = Array.from(document.querySelectorAll('a.property-grid__image[href*="/properties/sale/"]'));
      const seen = new Set();
      return imageLinks.map(imgLink => {
        const href = imgLink.href;
        if (!href || seen.has(href)) return null;
        seen.add(href);

        const img = imgLink.querySelector('img');
        // Sibling text container
        const parent = imgLink.parentElement;
        const textDiv = parent ? Array.from(parent.children).find(c => c !== imgLink) : null;

        const h4 = textDiv?.querySelector('h4');
        const h5 = textDiv?.querySelector('h5');
        // Price: SPAN after .guide__price label
        const guidePriceLabel = textDiv?.querySelector('.guide__price, span.guide__price');
        const priceSpan = guidePriceLabel?.nextElementSibling || textDiv?.querySelector('span:not(.guide__price)');

        return {
          url:       href,
          address:   h4?.textContent?.trim() || null,
          bedrooms:  h5?.textContent?.trim() || null,
          price:     priceSpan?.textContent?.trim() || null,
          thumbnail: img?.src || null,
        };
      }).filter(Boolean);
    });

    raw.forEach(r => listings.push(normalise({
      ...r,
      price:    parsePrice(r.price),
      bedrooms: parseBeds((r.bedrooms || '') + ' ' + (r.address || '')),
      prop_type: inferPropertyType(r.bedrooms, r.address, r.url),
    }, SOURCE)));
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
