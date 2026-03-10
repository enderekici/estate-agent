const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { getSearchParams } = require('./search-params');

const SOURCE = 'rightmove';
const PAGE_SIZE = 24;
const MAX_PAGES = 12;
const MAX_STALE_PAGES = 2;

// Rightmove location IDs — REGION covers the whole town (521 results),
// OUTCODE only covers one postcode area (88 results for GU9).
// Use REGION^506 (Farnham) as primary search to capture all Farnham listings.
// Verify at: https://www.rightmove.co.uk/property-for-sale/Farnham.html
//   (look for REGION^NNN or OUTCODE^NNNN in the page source)
const REGION_ID = 'REGION^506'; // Farnham

function getLocationIds() {
  return [REGION_ID];
}

async function scrape() {
  const search = getSearchParams();
  const locationIds = getLocationIds();
  const page = await newPage();
  const listings = [];
  const seenIds = new Set();

  try {
    for (const locationId of locationIds) {
    const encodedId = encodeURIComponent(locationId);
    let pageNum = 0;
    let stalePages = 0;

    while (pageNum < MAX_PAGES && stalePages < MAX_STALE_PAGES) {
      const pageIndex = pageNum * PAGE_SIZE;
      const maxPriceParam = search.maxPrice ? `&maxPrice=${search.maxPrice}` : '';
      const url = `https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=${encodedId}&minBedrooms=${search.minBedrooms || 0}${maxPriceParam}&sortType=6&index=${pageIndex}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      if (pageNum === 0) {
        try {
          const btn = await page.$('#acceptAllCookies, [data-testid="cookie-accept-all"], [id*="onetrust-accept-btn"]');
          if (btn) { await btn.click(); await page.waitForTimeout(1000); }
        } catch (_) {}
      }

      try {
        await page.waitForSelector('[data-testid^="propertyCard-"], a[href*="/properties/"]', { timeout: 10000 });
      } catch (_) {}

      const pageData = await page.evaluate(() => {
        const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
        const first = (root, selectors) => {
          for (const selector of selectors) {
            const node = root.querySelector(selector);
            if (node) return node;
          }
          return null;
        };
        const cardSet = new Set();
        const cardSelectors = [
          '[data-testid^="propertyCard-"]',
          'div[data-testid="propertyCard"]',
          'article[class*="PropertyCard"]',
          'div[class*="PropertyCard_propertyCardContainer"]',
        ];
        for (const selector of cardSelectors) {
          document.querySelectorAll(selector).forEach((node) => cardSet.add(node));
        }
        if (!cardSet.size) {
          document.querySelectorAll('a[href*="/properties/"]').forEach((a) => {
            cardSet.add(a.closest('article, li, div') || a.parentElement);
          });
        }

        const cards = Array.from(cardSet).filter(Boolean);
        const seen = new Set();
        const results = cards.map((card) => {
          const linkEl = card.querySelector('a[href*="/properties/"]');
          if (!linkEl) return null;
          const href = linkEl.getAttribute('href') || linkEl.href || '';
          const url = href.startsWith('http') ? href : `https://www.rightmove.co.uk${href}`;
          if (seen.has(url)) return null;
          seen.add(url);

          const priceEl = first(card, [
            '[data-testid="property-price"]',
            '[data-testid="property-price-wrapper"]',
            '[class*="PropertyPrice"]',
          ]);
          const addressEl = first(card, [
            '[data-testid="property-address"]',
            'address',
            '[class*="PropertyAddress"]',
          ]);
          const infoEl = first(card, [
            '[data-testid="property-information"]',
            '[data-testid="property-features"]',
            '[class*="PropertyInformation"]',
          ]);
          const titleEl = first(card, [
            'h2',
            '[data-testid="propertyCard-title"]',
            '[class*="PropertyType"]',
          ]);
          const descriptionEl = first(card, [
            '[data-testid="property-description"]',
            '[class*="PropertyCardSummary"]',
          ]);

          const featureText = Array.from(card.querySelectorAll('li, [data-testid="property-feature"]'))
            .map((node) => text(node))
            .filter(Boolean)
            .slice(0, 8)
            .join(' ');

          const imgs = Array.from(card.querySelectorAll(
            '[data-testid^="property-img-"], [aria-label^="Property image"], [data-testid="photo-collage"] img, img'
          ));
          const propImg = imgs.find((img) => {
            const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
            const alt = img.getAttribute('alt') || '';
            const testId = img.getAttribute('data-testid') || '';
            const isPropertyPhoto = /property-photo|_max_\d+x\d+\.(?:jpe?g|png)\b|media\.rightmove\.co\.uk\/dir\//i.test(src);
            const looksLikePhotoNode = /^property-img-\d+$/i.test(testId) || /^picture no\./i.test(alt) || /^property image \d+/i.test(alt);
            const isUiAsset = /floorplan|virtualtour|camera-|chevron|logo|brand\/|placeholder|transparent|\.svg(?:\?|$)/i.test(src);
            return src && !isUiAsset && (isPropertyPhoto || looksLikePhotoNode);
          });

          return {
            url,
            address: text(addressEl),
            priceText: text(priceEl),
            infoText: text(infoEl),
            titleText: text(titleEl),
            descriptionText: text(descriptionEl),
            featureText,
            thumbnail: propImg ? (propImg.currentSrc || propImg.src || propImg.getAttribute('data-src') || '') : null,
          };
        }).filter(r => r && r.url?.includes('/properties/'));

        const nextEl = document.querySelector('a[rel="next"], a[aria-label="Next"], [data-testid="pagination-next"], [class*="Pagination"] a:last-of-type');
        const nextDisabled = nextEl && (
          nextEl.hasAttribute('disabled') ||
          nextEl.getAttribute('aria-disabled') === 'true' ||
          /\bdisabled\b/i.test(String(nextEl.className || ''))
        );

        return { results, hasNext: Boolean(nextEl) && !nextDisabled };
      });

      let newOnPage = 0;
      for (const row of pageData.results) {
        const combinedBeds = `${row.featureText || ''} ${row.infoText || ''} ${row.titleText || ''} ${row.descriptionText || ''}`;
        let bedrooms = parseBeds(combinedBeds);
        let propType = row.titleText || row.infoText || null;

        // Some cards collapse stats as "...32" (beds+baths); prefer the first digit as beds.
        if (bedrooms === null) {
          const compact = (row.infoText || '').match(/[a-z)\]]\s*(\d)(\d)\b/i);
          if (compact) bedrooms = Number.parseInt(compact[1], 10);
        }
        if (propType && /\d/.test(propType) && row.infoText) {
          propType = row.infoText.replace(/\d+\s*(?:bed|bath|sq\.?\s*ft|m2)?/gi, '').trim() || propType;
        }
        propType = propType && !/\b(featured property|close to schools|guide price|home office)\b/i.test(propType)
          ? propType
          : inferPropertyType(row.titleText, row.infoText, row.descriptionText, row.featureText, row.url);

        const listing = normalise({
          url: row.url,
          address: row.address,
          price: parsePrice(row.priceText),
          bedrooms,
          prop_type: propType,
          thumbnail: row.thumbnail,
        }, SOURCE);

        if (!listing.id || seenIds.has(listing.id)) continue;
        seenIds.add(listing.id);
        listings.push(listing);
        newOnPage++;
      }

      stalePages = newOnPage === 0 ? stalePages + 1 : 0;
      if (!pageData.hasNext || pageData.results.length === 0) break;
      pageNum++;
      await randomDelay();
    }
    } // end for locationIds
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }

  return listings;
}

module.exports = { scrape, SOURCE };
