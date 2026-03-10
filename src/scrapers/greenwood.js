const { loadPage, resolveUrl } = require('./http');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildGreenwoodUrl } = require('./search-url-builders');

const SOURCE = 'greenwood';
const BASE_URL = buildGreenwoodUrl();
const BASE = 'https://www.greenwood-property.co.uk';

async function scrape() {
  const listings = [];
  const seen = new Set();
  let pageNum = 1;
  let hasMore = true;

  while (hasMore && pageNum <= 10) {
    try {
      const pageUrl = pageNum === 1 ? BASE_URL : `${BASE_URL}&page=${pageNum}`;
      const $ = await loadPage(pageUrl);
      let countOnPage = 0;

      $('article.property, .property-item, li.property').each((_, el) => {
        const c = $(el);
        const linkEl = c.find('a[href*="/property/"]').first();
        const fallback = linkEl.length ? linkEl : c.find('a').first();
        const rawHref = fallback.attr('href') || '';
        const url = resolveUrl(BASE, rawHref);
        if (!url || !url.includes('/property/')) return;
        if (seen.has(url)) return;
        seen.add(url);
        countOnPage++;

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

      if (countOnPage === 0) hasMore = false;
    } catch (err) {
      console.error(`[${SOURCE}] Error (page ${pageNum}):`, err.message);
      hasMore = false;
    }
    if (hasMore) {
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    }
    pageNum++;
  }
  return listings;
}

module.exports = { scrape, SOURCE };
