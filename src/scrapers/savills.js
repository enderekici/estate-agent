const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildSavillsUrl } = require('./search-url-builders');

const SOURCE = 'savills';
// Use search.savills.com which renders results correctly
// Id_40145 = Farnham, Category_TownVillageCity; GRS_B_3 = 3+ bedrooms; GRS_T_B = buy
const URL = buildSavillsUrl();
const MAX_PAGES = 10;

function isFarnhamArea(address) {
  const text = String(address || '').toUpperCase();
  return text.includes('FARNHAM') || text.includes('GU9') || text.includes('GU10');
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Accept cookies if shown
    try {
      const btn = await page.$('button[class*="accept"], #onetrust-accept-btn-handler, [class*="CookieAccept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1500); }
    } catch (_) {}

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('article.sv-property-card'));
        const seen = new Set();
        const results = cards.map(card => {
          const linkEl = card.querySelector('a.sv-details__link, a[href*="/property-detail/"]');
          const href = linkEl?.href;
          if (!href || seen.has(href)) return null;
          seen.add(href);

          const headlineEl = card.querySelector('.sv-details__address1, .sv-details__title, h3, h2');
          const addr2 = card.querySelector('p.sv-details__address2');
          const headline = headlineEl?.textContent?.replace(/\s+/g, ' ').trim().replace(/…+$/g, '') || '';
          const locality = addr2?.textContent?.replace(/\s+/g, ' ').trim() || '';
          const address = [headline, locality]
            .filter(Boolean)
            .join(', ')
            .replace(/\s+,/g, ',')
            .replace(/,+/g, ',')
            .trim();

          // Price: span after sv-property-price__guide
          const priceGuide = card.querySelector('.sv-property-price__guide');
          const priceEl = priceGuide?.nextElementSibling || card.querySelector('[class*="price"]');

          // Beds from [class*="bed"]
          const bedsEl = card.querySelector('[class*="bed"], [class*="Bed"]');
          // Try picture > source srcset first, then img with various src attrs
          const thumb = (() => {
            const source = card.querySelector('picture source[srcset]');
            if (source) {
              const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
              if (first && !first.includes('.svg')) return first;
            }
            const img = card.querySelector('img');
            return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
          })();

          return {
            url:       href,
            address:   address || null,
            price:     priceEl?.textContent?.trim() || null,
            bedrooms:  bedsEl?.textContent?.trim() || null,
            thumbnail: thumb,
          };
        }).filter(Boolean);

        const nextEl = document.querySelector('a[rel="next"], [class*="pagination"] a, [class*="next"]');
        const nextHref = nextEl?.href || null;

        return { results, nextHref };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        const listing = normalise({
          ...r,
          price: parsePrice(r.price),
          bedrooms: parseBeds((r.bedrooms || '') + ' ' + (r.address || '')),
        }, SOURCE);
        if (!isFarnhamArea(listing.address)) continue;
        listings.push(listing);
        newOnPage++;
      }

      if (newOnPage === 0 || !pageData.nextHref) break;

      // Navigate to next page
      try {
        pageNum++;
        await randomDelay();
        await page.goto(pageData.nextHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(3000);
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

module.exports = { scrape, SOURCE, isFarnhamArea };
