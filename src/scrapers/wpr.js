const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildWprUrl } = require('./search-url-builders');

const SOURCE = 'wpr';
const URL = buildWprUrl();
const MAX_PAGES = 10;

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomDelay();

    try {
      await page.waitForSelector('a.property-grid__image', { timeout: 10000 });
    } catch (_) {}

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        // Each property card: a.property-grid__image (image+link) + sibling div with H4/H5/SPAN
        const imageLinks = Array.from(document.querySelectorAll('a.property-grid__image[href*="/properties/sale/"]'));
        const seen = new Set();
        const results = imageLinks.map(imgLink => {
          const href = imgLink.href;
          if (!href || seen.has(href)) return null;
          seen.add(href);

          const img = imgLink.querySelector('img');
          // Sibling text container
          const parent = imgLink.parentElement;
          const textDiv = parent ? Array.from(parent.children).find(c => c !== imgLink) : null;

          const h4 = textDiv?.querySelector('h4');
          const h5 = textDiv?.querySelector('h5');
          // Price: SPAN after .guide__price label
          const guidePriceLabel = textDiv?.querySelector('.guide__price, span.guide__price');
          const priceSpan = guidePriceLabel?.nextElementSibling || textDiv?.querySelector('span:not(.guide__price)');

          return {
            url:       href,
            address:   h4?.textContent?.trim() || null,
            bedrooms:  h5?.textContent?.trim() || null,
            price:     priceSpan?.textContent?.trim() || null,
            thumbnail: (() => {
              const source = imgLink.querySelector('picture source[srcset]');
              if (source) {
                const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
                if (first && !first.includes('.svg')) return first;
              }
              return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
            })(),
          };
        }).filter(Boolean);

        const nextEl = document.querySelector('a[rel="next"], .pagination a.next, [class*="next"] a');
        const nextHref = nextEl?.href || null;

        return { results, nextHref };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        listings.push(normalise({
          ...r,
          price:    parsePrice(r.price),
          bedrooms: parseBeds((r.bedrooms || '') + ' ' + (r.address || '')),
          prop_type: inferPropertyType(r.bedrooms, r.address, r.url),
        }, SOURCE));
        newOnPage++;
      }

      if (newOnPage === 0 || !pageData.nextHref) break;

      // Navigate to next page
      try {
        pageNum++;
        await randomDelay();
        await page.goto(pageData.nextHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(2000);
        try {
          await page.waitForSelector('a.property-grid__image', { timeout: 10000 });
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
