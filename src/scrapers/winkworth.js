const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');

const SOURCE = 'winkworth';
const URL = 'https://www.winkworth.co.uk/surrey/farnham/properties-for-sale?min_beds=3';

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 35000 });
    await randomDelay();

    // Accept cookies
    try {
      const btn = await page.$('[class*="accept"], button[id*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Wait specifically for property card links
    // Winkworth uses /properties/sales/ not /property/
    try {
      await page.waitForSelector('a[href*="/properties/sales/"]', { timeout: 10000 });
    } catch (_) {}

    const raw = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/properties/sales/"]'));
      const seen = new Set();
      const cards = [];

      links.forEach(link => {
        const href = link.href;
        if (!href || seen.has(href)) return;
        if (!href.includes('/properties/sales/')) return;
        // Skip contact form anchors
        if (href.includes('#contact_form')) return;
        seen.add(href);

        const card = link.closest('[class*="property-result"], [class*="listing"], article, li[class*="property"], li') || link.parentElement;
        const priceEl = card?.querySelector('[class*="price"]') || card?.nextElementSibling?.querySelector('[class*="price"]');
        const addrEl  = card?.querySelector('h2, h3, address, [class*="address"]');
        const bedsEl  = card?.querySelector('[class*="bed"]');
        const imgEl   = card?.querySelector('img');

        cards.push({
          url:       href,
          address:   addrEl ? addrEl.textContent.trim() : null,
          price:     priceEl ? priceEl.textContent.trim() : null,
          bedrooms:  bedsEl  ? bedsEl.textContent.trim()  : null,
          thumbnail: imgEl   ? (imgEl.src || imgEl.dataset.src) : null,
        });
      });
      return cards;
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
