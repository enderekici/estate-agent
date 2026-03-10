const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildBourneUrl } = require('./search-url-builders');

const SOURCE = 'bourne';
const URL = buildBourneUrl();

function bedsFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(?:^|\/)(\d+)-bed(?:room)?(?:-|\/)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

async function enrichMissingBeds(page, listing) {
  if (!listing?.url) return listing;
  try {
    await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(500);
    const detail = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const bedMatch = text.match(/(\d+)\s*bed(?:room)?s?/i);
      return { bedsText: bedMatch ? bedMatch[0] : null };
    });
    const parsed = parseBeds(detail?.bedsText || '');
    if (parsed !== null) listing.bedrooms = parsed;
  } catch (_) {}
  return listing;
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay();

    try {
      await page.waitForSelector('[class*="property"], article', { timeout: 8000 });
    } catch (_) {}

    // Bourne uses div.grid-box-card > a[href*="/property/"] structure
    try { await page.waitForSelector('a[href*="/property/"]', { timeout: 8000 }); } catch (_) {}
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const raw = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/property/"]'));
      const seen = new Set();
      return links.map(a => {
        const href = a.href;
        if (!href || seen.has(href) || !href.includes('/property/')) return null;
        seen.add(href);
        const card = a.closest('.grid-box-card, .grid-box, [class*="property"]') || a.parentElement;
        return {
          url:       href,
          address:   (card?.querySelector('h2, h3, [class*="address"], [class*="title"]') || {}).textContent?.trim() || null,
          price:     (card?.querySelector('[class*="price"]') || {}).textContent?.trim() || null,
          bedrooms:  (card?.querySelector('[class*="bed"]') || {}).textContent?.trim() || null,
          cardText:  card?.textContent?.replace(/\s+/g, ' ').trim() || null,
          thumbnail: (card?.querySelector('img') || {}).src || null,
        };
      }).filter(Boolean);
    });

    raw.forEach(r => listings.push(normalise({
      ...r, price: parsePrice(r.price),
      bedrooms: parseBeds(`${r.bedrooms || ''} ${r.address || ''} ${r.cardText || ''}`) ?? bedsFromUrl(r.url),
    }, SOURCE)));

    // Bourne listing cards often omit bed count; enrich by visiting detail pages as needed.
    for (const listing of listings) {
      if (listing.bedrooms == null) {
        await enrichMissingBeds(page, listing);
      }
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
