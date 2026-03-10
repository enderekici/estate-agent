const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildBridgesUrl } = require('./search-url-builders');

const SOURCE = 'bridges';
const URL = buildBridgesUrl();

// Parse beds/address from Bridges URL slug
// e.g. /property/4-bedroom-property-for-sale-fuggle-hop-close-tongham-farnham-surrey-lan260046/
function parseBridgesSlug(url) {
  const m = url.match(/\/property\/(\d+)-bedroom-([^/]+)-for-sale-(?:in-)?(.+?)-[a-z]{3}\d+[a-z0-9]*\//i);
  if (!m) return { bedrooms: null, prop_type: null, address: null };
  const bedrooms = parseInt(m[1]);
  const prop_type = m[2].replace(/-/g, ' ');
  const addressSlug = m[3].replace(/-/g, ' ').split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { bedrooms, prop_type, address: addressSlug };
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Accept Cookiebot if shown
    try {
      const btn = await page.$('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, button[id*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    try {
      await page.waitForSelector('article.property', { timeout: 10000 });
    } catch (_) {}

    const raw = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article.component.property, article.property'));
      const seen = new Set();
      return cards.map(card => {
        const linkEl = card.querySelector('a[href*="/property/"]');
        const href = linkEl?.href;
        if (!href || seen.has(href)) return null;
        seen.add(href);

        const img = card.querySelector('img');
        // Price text anywhere in card (H2 on Bridges shows price like "£650,000")
        const priceEl = card.querySelector('[class*="price"], h2, h3');
        const addressEl = card.querySelector('.property__content--address, [class*="address"]');
        return {
          url:       href,
          address:   addressEl?.textContent?.trim() || null,
          price:     priceEl?.textContent?.trim() || null,
          thumbnail: img?.src || null,
        };
      }).filter(Boolean);
    });

    raw.forEach(r => {
      const slug = parseBridgesSlug(r.url);
      listings.push(normalise({
        url:       r.url,
        price:     parsePrice(r.price),
        address:   r.address || slug.address,
        bedrooms:  slug.bedrooms,
        prop_type: slug.prop_type,
        thumbnail: r.thumbnail,
      }, SOURCE));
    });
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
