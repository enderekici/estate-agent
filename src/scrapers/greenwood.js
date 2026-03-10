const { loadPage, resolveUrl } = require('./http');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildGreenwoodUrl } = require('./search-url-builders');

const SOURCE = 'greenwood';
const BASE_URL = buildGreenwoodUrl();
const BASE = 'https://www.greenwood-property.co.uk';

async function scrape() {
  const listings = [];
  try {
    const $ = await loadPage(BASE_URL);

    $('article.property, .property-item, li.property').each((_, el) => {
      const c = $(el);
      const linkEl = c.find('a[href*="/property/"]').first();
      const fallback = linkEl.length ? linkEl : c.find('a').first();
      const rawHref = fallback.attr('href') || '';
      const url = resolveUrl(BASE, rawHref);
      if (!url || !url.includes('/property/')) return;

      const address = c.find('h2, h3').first().text().trim()
        || c.find('[class*="address"]').first().text().trim()
        || c.find('[class*="title"]').first().text().trim()
        || null;

      listings.push(normalise({
        url,
        address,
        price: parsePrice(c.find('[class*="price"]').first().text().trim()),
        bedrooms: parseBeds(
          (c.find('[class*="bed"]').first().text().trim() || '') + ' ' + (address || '')
        ),
        prop_type: c.find('[class*="type"]').first().text().trim() || null,
        thumbnail: c.find('img').attr('src') || null,
      }, SOURCE));
    });
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  }
  return listings;
}

module.exports = { scrape, SOURCE };
