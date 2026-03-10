const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildWinkworthUrl } = require('./search-url-builders');

const SOURCE = 'winkworth';
const URL = buildWinkworthUrl();
const MAX_PAGES = 10;

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomDelay();

    // Accept cookies
    try {
      const btn = await page.$('[class*="accept"], button[id*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Wait specifically for property card links
    // Winkworth uses /properties/sales/ not /property/
    try {
      await page.waitForSelector('a[href*="/properties/sales/"]', { timeout: 10000 });
    } catch (_) {}

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/properties/sales/"]'));
        const seen = new Set();
        const results = [];

        links.forEach(link => {
          const href = link.href;
          if (!href || seen.has(href)) return;
          if (!href.includes('/properties/sales/')) return;
          // Skip contact form anchors
          if (href.includes('#contact_form')) return;
          seen.add(href);

          const card = link.closest('[class*="property-result"], [class*="listing"], article, li[class*="property"], li') || link.parentElement;
          const priceEl = card?.querySelector('[class*="price"]') || card?.nextElementSibling?.querySelector('[class*="price"]');
          const addrEl  = card?.querySelector('h2, h3, address, [class*="address"]');
          const bedsEl  = card?.querySelector('[class*="bed"]');
          const thumb = (() => {
            const source = card?.querySelector('picture source[srcset]');
            if (source) {
              const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
              if (first && !first.includes('.svg')) return first;
            }
            const img = card?.querySelector('img');
            return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
          })();

          results.push({
            url:       href,
            address:   addrEl ? addrEl.textContent.trim() : null,
            price:     priceEl ? priceEl.textContent.trim() : null,
            bedrooms:  bedsEl  ? bedsEl.textContent.trim()  : null,
            thumbnail: thumb,
          });
        });

        const nextEl = document.querySelector('a[rel="next"], .pagination a, [class*="next"] a');
        const nextHref = nextEl?.href || null;

        return { results, nextHref };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        listings.push(normalise({
          ...r, price: parsePrice(r.price),
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
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        try {
          await page.waitForSelector('a[href*="/properties/sales/"]', { timeout: 10000 });
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
