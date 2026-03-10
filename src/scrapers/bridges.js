const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildBridgesUrl } = require('./search-url-builders');

const SOURCE = 'bridges';
const URL = buildBridgesUrl();
const MAX_PAGES = 10;

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
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Accept Cookiebot if shown
    try {
      const btn = await page.$('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, button[id*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    try {
      await page.waitForSelector('article.property', { timeout: 10000 });
    } catch (_) {}

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('article.component.property, article.property'));
        const seen = new Set();
        const results = cards.map(card => {
          const linkEl = card.querySelector('a[href*="/property/"]');
          const href = linkEl?.href;
          if (!href || seen.has(href)) return null;
          seen.add(href);

          const img = card.querySelector('img');
          const priceEl = card.querySelector('[class*="price"], h2, h3');
          const addressEl = card.querySelector('.property__content--address, [class*="address"]');
          return {
            url:       href,
            address:   addressEl?.textContent?.trim() || null,
            price:     priceEl?.textContent?.trim() || null,
            thumbnail: (() => {
              const source = card.querySelector('picture source[srcset]');
              if (source) {
                const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
                if (first && !first.includes('.svg')) return first;
              }
              return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
            })(),
          };
        }).filter(Boolean);

        const nextEl = document.querySelector('a.next, a[rel="next"], .pagination a:last-child, a[href*="page/"]');
        const nextHref = nextEl?.href || null;

        return { results, nextHref };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        const slug = parseBridgesSlug(r.url);
        listings.push(normalise({
          url:       r.url,
          price:     parsePrice(r.price),
          address:   r.address || slug.address,
          bedrooms:  slug.bedrooms,
          prop_type: slug.prop_type,
          thumbnail: r.thumbnail,
        }, SOURCE));
        newOnPage++;
      }

      if (newOnPage === 0 || !pageData.nextHref) break;

      // Navigate to next page
      try {
        pageNum++;
        await randomDelay();
        await page.goto(pageData.nextHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(3000);
        try {
          await page.waitForSelector('article.property', { timeout: 10000 });
        } catch (_) {}
      } catch (navErr) {
        console.warn(`[${SOURCE}] Pagination error on page ${pageNum}:`, navErr.message);
        break;
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
