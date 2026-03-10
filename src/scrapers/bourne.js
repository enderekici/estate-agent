const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildBourneUrl } = require('./search-url-builders');

const SOURCE = 'bourne';
const URL = buildBourneUrl();
const MAX_PAGES = 10;

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
  const seenUrls = new Set();
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

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/property/"]'));
        const seen = new Set();
        const results = links.map(a => {
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
            thumbnail: (() => {
              const source = card?.querySelector('picture source[srcset]');
              if (source) {
                const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
                if (first && !first.includes('.svg')) return first;
              }
              const img = card?.querySelector('img');
              return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
            })(),
          };
        }).filter(Boolean);

        const nextEl = document.querySelector('a[rel="next"], .pagination a, a.next, [class*="next"] a');
        const nextHref = nextEl?.href || null;

        return { results, nextHref };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        listings.push(normalise({
          ...r, price: parsePrice(r.price),
          bedrooms: parseBeds(`${r.bedrooms || ''} ${r.address || ''} ${r.cardText || ''}`) ?? bedsFromUrl(r.url),
          prop_type: inferPropertyType(r.cardText, r.address, r.url),
        }, SOURCE));
        newOnPage++;
      }

      if (newOnPage === 0 || !pageData.nextHref) break;

      // Navigate to next page
      try {
        pageNum++;
        await randomDelay();
        await page.goto(pageData.nextHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        try {
          await page.waitForSelector('a[href*="/property/"]', { timeout: 8000 });
        } catch (_) {}
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
      } catch (navErr) {
        console.warn(`[${SOURCE}] Pagination error on page ${pageNum}:`, navErr.message);
        break;
      }
    }

    // Bourne listing cards often omit bed count; enrich by visiting detail pages after all pages scraped.
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
