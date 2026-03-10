const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildZooplaUrl } = require('./search-url-builders');

const SOURCE = 'zoopla';
const BASE_URL = buildZooplaUrl();
const MAX_PAGES = 12;
const MAX_STALE_PAGES = 2;

function normalizeZooplaAddress(address) {
  const input = String(address || '').trim();
  if (!input) return null;
  return input
    .replace(/\s+(GU\d[A-Z\d]*)$/i, ', $1')
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .trim();
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenIds = new Set();

  try {
    let pageNum = 1;
    let stalePages = 0;

    while (pageNum <= MAX_PAGES && stalePages < MAX_STALE_PAGES) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}&pn=${pageNum}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2500);

      if (pageNum === 1) {
        try {
          const btn = await page.$('[data-testid="dialog-accept-all"], button[id*="accept"], #onetrust-accept-btn-handler');
          if (btn) { await btn.click(); await page.waitForTimeout(1500); }
        } catch (_) {}
      }

      try {
        await page.waitForSelector('a[href*="/for-sale/details/"], div[id^="listing_"]', { timeout: 10000 });
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

        const rowSet = new Set();
        const rowSelectors = [
          'div[id^="listing_"]',
          'article[data-testid^="listing"]',
          '[data-testid="search-result"]',
          '[data-testid^="regular-listing"]',
        ];
        for (const selector of rowSelectors) {
          document.querySelectorAll(selector).forEach((node) => rowSet.add(node));
        }
        if (!rowSet.size) {
          document.querySelectorAll('a[href*="/for-sale/details/"]').forEach((a) => {
            rowSet.add(a.closest('article, li, div') || a.parentElement);
          });
        }

        const rows = Array.from(rowSet).filter(Boolean);
        const seen = new Set();
        const results = rows.map((row) => {
          const linkEl = row.querySelector('a[href*="/for-sale/details/"]');
          if (!linkEl) return null;
          const url = linkEl.href || linkEl.getAttribute('href') || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);

          const priceEl = first(row, [
            '[data-testid="listing-price"]',
            '[class*="price_priceText"]',
            '[class*="price"]',
          ]);
          const addrEl = first(row, [
            'address',
            '[data-testid="listing-address"]',
            '[class*="address"]',
          ]);
          const titleEl = first(row, [
            '[data-testid="listing-title"]',
            'h2',
            'h3',
          ]);
          const bedsEl = first(row, [
            '[data-testid="beds-label"]',
            '[aria-label*="bed" i]',
            '[class*="bedroom"]',
          ]);
          const amenities = Array.from(row.querySelectorAll('[class*="amenities_amenityItem"], li, [data-testid*="amenit"]'))
            .map((el) => text(el))
            .filter(Boolean)
            .slice(0, 10)
            .join(' ');
          // Try multiple strategies for thumbnail extraction (lazy-loaded images)
          const thumb = (() => {
            // 1. <picture><source srcset="...">
            const source = row.querySelector('picture source[srcset]');
            if (source) {
              const srcset = source.getAttribute('srcset') || '';
              const first = srcset.split(',')[0].trim().split(/\s+/)[0];
              if (first && !first.includes('.svg')) return first;
            }
            // 2. <img> with various src attributes
            const imgs = Array.from(row.querySelectorAll('img'));
            for (const img of imgs) {
              const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '';
              if (src && !src.includes('.svg') && !src.includes('logo') && !src.includes('placeholder')) return src;
            }
            return null;
          })();

          return {
            url,
            address: text(addrEl),
            priceText: text(priceEl),
            titleText: text(titleEl),
            bedroomsText: text(bedsEl),
            amenitiesText: amenities,
            thumbnail: thumb,
          };
        }).filter(Boolean);

        const nextEl = document.querySelector('a[rel="next"], a[aria-label*="next" i], [data-testid="pagination-next"]');
        const nextDisabled = nextEl && (
          nextEl.hasAttribute('disabled') ||
          nextEl.getAttribute('aria-disabled') === 'true' ||
          /\bdisabled\b/i.test(String(nextEl.className || ''))
        );
        const paginationEl = document.querySelector('[data-testid="pagination-count"], [aria-label*="Page"]');
        return {
          results,
          hasNext: Boolean(nextEl) && !nextDisabled,
          paginationText: text(paginationEl),
        };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        const listing = normalise({
          ...r,
          address: normalizeZooplaAddress(r.address),
          price: parsePrice(r.priceText),
          bedrooms: parseBeds(`${r.bedroomsText || ''} ${r.amenitiesText || ''} ${r.titleText || ''} ${r.address || ''}`),
          prop_type: inferPropertyType(r.titleText, r.amenitiesText, r.address, r.url) || 'House',
        }, SOURCE);
        if (!listing.id || seenIds.has(listing.id)) continue;
        seenIds.add(listing.id);
        listings.push(listing);
        newOnPage++;
      }

      stalePages = newOnPage === 0 ? stalePages + 1 : 0;
      if (!pageData.results.length) stalePages++;

      let hasMore = pageData.hasNext;
      if (!hasMore && pageData.paginationText) {
        const pageCountMatch = pageData.paginationText.match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
        if (pageCountMatch) {
          hasMore = Number.parseInt(pageCountMatch[1], 10) < Number.parseInt(pageCountMatch[2], 10);
        }
      }

      if (!hasMore) break;
      pageNum++;
      await randomDelay();
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }

  return listings;
}

module.exports = { scrape, SOURCE, normalizeZooplaAddress };
