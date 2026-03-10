const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, inferPropertyType } = require('./_localBase');
const { getSearchParams } = require('./search-params');
const { buildHamptonsUrl } = require('./search-url-builders');

const SOURCE = 'hamptons';
const MAX_PAGES = 12;
const MAX_STALE_PAGES = 2;

// Homeflow CMS path-based search URL.
// text-farnham  = text filter scoped to Farnham (returns Farnham GU9/GU10 area, ~120 results)
// from-3-bed    = minimum bedrooms filter
// Pagination is appended as /page-N at the end of the path.
const BASE_URL = buildHamptonsUrl();

// Only keep Farnham-area results
const isFarnham = (addr) => {
  if (!addr) return false;
  const a = addr.toUpperCase();
  const search = getSearchParams();
  return a.includes(search.location.toUpperCase()) || search.postcodeDistricts.some((code) => a.includes(code));
};

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();

  try {
    let pageNum = 1;
    let hasNextPage = true;
    let stalePages = 0;

    while (hasNextPage && pageNum <= MAX_PAGES && stalePages < MAX_STALE_PAGES) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}/page-${pageNum}`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(900);

      // Wait for Homeflow to render property cards
      try {
        await page.waitForSelector('article.property-card, a.property-card__link', { timeout: 9000 });
      } catch (_) {}

      // Extract pagination state from inline JSON in the page source
      const paginationState = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script:not([src])'));
        for (const s of scripts) {
          const m = s.textContent.match(/"pagination"\s*:\s*(\{[^}]+\})/);
          if (m) {
            try { return JSON.parse(m[1]); } catch (_) {}
          }
        }
        return null;
      });

      hasNextPage = paginationState ? paginationState.has_next_page === true : false;

      // Extract cards — the page renders each card twice (SSR + React hydration)
      // Deduplicate by URL using seenUrls.
      const raw = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('article.property-card'));
        return cards.map(c => {
          // Link: only cards with a.property-card__link are real listings
          const linkEl = c.querySelector('a.property-card__link');
          if (!linkEl || !linkEl.href) return null;

          // Address / title
          const titleEl = c.querySelector('.property-card__title');

          // Price — .property-card__price contains the numeric price
          const priceEl = c.querySelector('.property-card__price');

          // Bedrooms — first .property-card__bedbath-item is beds count (text node)
          // The element contains a number followed by an icon image.
          // Bed items: first = beds, second (has --bath modifier) = baths, third = receptions
          const bedbathItems = Array.from(c.querySelectorAll('.property-card__bedbath-item'));
          const bedItem = bedbathItems.find(el => !el.classList.contains('property-card__bedbath-item--bath'));
          // Extract the leading numeric text from the beds element
          const bedsRaw = bedItem ? bedItem.textContent.trim().match(/^\d+/) : null;

          // Thumbnail
          const imgEl = c.querySelector('img.property-card__image, img');

          return {
            url:       linkEl.href,
            address:   titleEl ? titleEl.textContent.trim() : null,
            price:     priceEl ? priceEl.textContent.trim() : null,
            bedrooms:  bedsRaw ? parseInt(bedsRaw[0], 10) : null,
            cardText:  c.textContent?.replace(/\s+/g, ' ').trim() || '',
            thumbnail: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || null) : null,
          };
        }).filter(r => r !== null && r.url && r.url.includes('/properties/'));
      });

      let newOnPage = 0;
      for (const r of raw) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        const listing = normalise({
          ...r,
          price: parsePrice(r.price),
          prop_type: inferPropertyType(r.cardText, r.address, r.url),
        }, SOURCE);
        if (!isFarnham(listing.address)) continue;  // skip non-Farnham
        listings.push(listing);
        newOnPage++;
      }

      stalePages = newOnPage === 0 ? stalePages + 1 : 0;
      pageNum++;
      if (hasNextPage) await randomDelay();
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }

  return listings;
}

module.exports = { scrape, SOURCE };
